import { fileUrl, mediaPath } from "./media-file"

/** Page event carrying renditions Instagram already loaded. */
export const RENDITION_SOURCE = "vee-renditions"

/** Synchronous swap. postMessage runs too late to start playback in the click. */
export const RENDITION_USE_EVENT = "vee-rendition-use"

/** Attribute holding the swap the synchronous event should apply. */
export const RENDITION_PENDING_ATTR = "data-vee-rendition"

/** Set before a user pause so a resolution swap does not resume over it. */
export const USER_PAUSE_MARK = "data-vee-user-pause"

/** Marks the video element a resolution swap should use. */
export const QUALITY_MARK = "data-vee-quality"

export type Rendition = {
  width: number
  height: number
  url: string
  /** Shown instead of the pixel height. Used for HD and SD pairs. */
  label?: string
  /** False when the size is only a label, so it is not matched to the picture size. */
  measured?: boolean
  /** Soundtrack file when `url` is a video-only rendition. */
  audioUrl?: string
  /**
   * Shared soundtrack for this picture.
   * Present even when `url` might already include audio, so playback can probe.
   */
  soundtrack?: string
  /** Other addresses for this same picture, such as a video-only DASH file. */
  aliases?: string[]
  /** Length in seconds, used to tell one post from another. */
  duration?: number
  /** Post caption or title carried with this file. */
  title?: string
}

export type RenditionMessage = {
  source: typeof RENDITION_SOURCE
  kind: "ask" | "list" | "use" | "drop" | "used" | "failed"
  groups?: Rendition[][]
  batch?: Rendition[][]
  /** Pathnames of media files the page just requested, newest first. */
  played?: string[]
  /** Identifies the video element for a resolution swap. */
  token?: string
  url?: string
  audioUrl?: string
  time?: number
  paused?: boolean
  ended?: boolean
  rate?: number
  muted?: boolean
  volume?: number
  /** When dropping a swap, put the player's previous source back. */
  restore?: boolean
}

const MAX_TEXT = 12_000_000
const MAX_DEPTH = 40
const MAX_NODES = 150_000

export function readRenditionMessage(data: unknown): RenditionMessage | null {
  if (!data || typeof data !== "object") return null
  const message = data as Partial<RenditionMessage>
  if (message.source !== RENDITION_SOURCE) return null
  if (message.kind === "ask" || message.kind === "list") {
    return {
      source: RENDITION_SOURCE,
      kind: message.kind,
      groups: message.kind === "list" ? sanitizeGroups(message.groups) : undefined,
      batch: message.kind === "list" ? sanitizeGroups(message.batch) : undefined,
      played: message.kind === "list" ? sanitizePlayed(message.played) : undefined
    }
  }
  if (message.kind !== "use" && message.kind !== "drop" && message.kind !== "used" && message.kind !== "failed") {
    return null
  }
  const token = qualityToken(message.token)
  if (!token) return null
  const url = fileUrl(typeof message.url === "string" ? message.url : "") || undefined
  if (message.kind === "use" && !url) return null
  const audio = fileUrl(typeof message.audioUrl === "string" ? message.audioUrl : "") || undefined
  const time = typeof message.time === "number" && Number.isFinite(message.time) ? Math.min(86_400, Math.max(0, message.time)) : 0
  const rate = typeof message.rate === "number" && Number.isFinite(message.rate) ? Math.min(16, Math.max(0.25, message.rate)) : 1
  const volume = typeof message.volume === "number" && Number.isFinite(message.volume) ? Math.min(1, Math.max(0, message.volume)) : 1
  return {
    source: RENDITION_SOURCE,
    kind: message.kind,
    token,
    url,
    audioUrl: audio,
    time,
    paused: message.paused === true,
    ended: message.ended === true,
    rate,
    muted: message.muted === true,
    volume,
    restore: message.restore !== false
  }
}

function qualityToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(value)) return ""
  return value
}

export function postRenditionAsk(): void {
  window.postMessage({ source: RENDITION_SOURCE, kind: "ask" } satisfies RenditionMessage, "*")
}

export function postRenditionUse(body: {
  token: string
  url: string
  audioUrl?: string
  time: number
  paused: boolean
  ended: boolean
  rate: number
  muted: boolean
  volume: number
}): void {
  const message = {
    source: RENDITION_SOURCE,
    kind: "use",
    token: body.token,
    url: body.url,
    audioUrl: body.audioUrl || undefined,
    time: body.time,
    paused: body.paused,
    ended: body.ended,
    rate: body.rate,
    muted: body.muted,
    volume: body.volume
  } satisfies RenditionMessage
  const root = document.documentElement
  if (root) {
    root.setAttribute(RENDITION_PENDING_ATTR, JSON.stringify(message))
    window.dispatchEvent(new Event(RENDITION_USE_EVENT))
  }
  window.postMessage(message, "*")
}

export function postRenditionDrop(token: string, restore: boolean): void {
  window.postMessage(
    { source: RENDITION_SOURCE, kind: "drop", token, restore } satisfies RenditionMessage,
    "*"
  )
}

export function postRenditionResult(kind: "used" | "failed", token: string, url: string, audioUrl: string): void {
  window.postMessage(
    {
      source: RENDITION_SOURCE,
      kind,
      token,
      url,
      audioUrl: audioUrl || undefined
    } satisfies RenditionMessage,
    "*"
  )
}

export function groupsFromText(text: string): Rendition[][] {
  if (!text || text.length > MAX_TEXT) return []
  const found: Rendition[][] = []
  const parsed = parseLooseJson(text)
  if (parsed) absorbGroups(found, groupsFromValue(parsed))
  absorbGroups(found, scanLoose(text))
  return found
}

export function groupsFromValue(value: unknown): Rendition[][] {
  const found: Rendition[][] = []
  walk(value, found, 0, { nodes: 0 })
  return found
}

export function sanitizeGroups(value: unknown): Rendition[][] {
  if (!Array.isArray(value)) return []
  const groups: Rendition[][] = []
  for (const group of value.slice(0, 48)) {
    if (!Array.isArray(group)) continue
    const items: Rendition[] = []
    for (const item of group.slice(0, 12)) {
      const rendition = asRendition(item)
      if (rendition) items.push(rendition)
    }
    const unique = dedupe(items)
    shareSoundtrack(unique)
    if (unique.length) groups.push(unique)
  }
  return groups
}

export function qualityLabel(item: Rendition, group: readonly Rendition[]): string {
  if (item.label) return item.label
  const pixels = Math.min(item.width, item.height)
  const same = group.filter((other) => Math.min(other.width, other.height) === pixels).length
  return same > 1 ? `${pixels}p · ${Math.max(item.width, item.height)}` : `${pixels}p`
}

export function sortRenditions(group: readonly Rendition[]): Rendition[] {
  return [...group].sort((a, b) => b.height - a.height || b.width - a.width)
}

function cleanTitle(value: unknown): string | undefined {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string"
        ? (value as { text: string }).text
        : ""
  const text = raw.replace(/\s+/g, " ").trim()
  if (!text) return undefined
  return text.slice(0, 160)
}

function captionOn(record: Record<string, unknown>): string | undefined {
  const caption = cleanTitle(record.caption)
  const titled = cleanTitle(record.title)
  const direct = caption || (titled && !/^(hd|sd|video|original audio)$/i.test(titled) ? titled : undefined)
  if (direct) return direct
  const edge = record.edge_media_to_caption
  if (!edge || typeof edge !== "object") return undefined
  const edges = (edge as { edges?: unknown }).edges
  if (!Array.isArray(edges) || !edges[0] || typeof edges[0] !== "object") return undefined
  const node = (edges[0] as { node?: unknown }).node
  if (!node || typeof node !== "object") return undefined
  return cleanTitle((node as { text?: unknown }).text)
}

function stampTitle(items: Rendition[], title: string | undefined): void {
  if (!title) return
  for (const item of items) if (!item.title) item.title = title
}

function dimension(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) ? number : 0
}

function asRendition(value: unknown): Rendition | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const url = fileUrl(typeof raw.url === "string" ? raw.url : "")
  const width = dimension(raw.width)
  const height = dimension(raw.height)
  if (!url || width < 1 || height < 1 || width > 8000 || height > 8000) return null
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : undefined
  const measured = raw.measured === false ? false : raw.measured === true || (label == null && width > 0 && height > 0)
  const audio = fileUrl(typeof raw.audioUrl === "string" ? raw.audioUrl : "")
  const soundtrack = fileUrl(typeof raw.soundtrack === "string" ? raw.soundtrack : "")
  const duration = dimension(raw.duration)
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases
        .filter((item): item is string => typeof item === "string")
        .map((item) => fileUrl(item))
        .filter((item): item is string => item != null && item !== url)
    : undefined
  return {
    width: Math.round(width),
    height: Math.round(height),
    url,
    label,
    measured,
    audioUrl: audio || undefined,
    soundtrack: soundtrack || audio || undefined,
    aliases: aliases && aliases.length ? aliases : undefined,
    duration: duration > 0 ? duration : undefined,
    title: cleanTitle(raw.title)
  }
}

function readJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw.replace(/\\\//g, "/")
  }
}

function pairUrls(hd: string, sd: string): Rendition[] | null {
  const high = fileUrl(hd)
  const low = fileUrl(sd)
  if (!high || !low || mediaPath(high) === mediaPath(low)) return null
  return [
    { width: 1280, height: 720, url: high, label: "HD", measured: false },
    { width: 640, height: 360, url: low, label: "SD", measured: false }
  ]
}

function facebookGroups(text: string): Rendition[][] {
  const groups: Rendition[][] = []
  const hdKey = /"(browser_native_hd_url|playable_url_quality_hd)"\s*:\s*"((?:\\.|[^"\\])*)"/g
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = hdKey.exec(text))) {
    const high = readJsonString(match[2])
    if (seen.has(high)) continue
    const slice = text.slice(Math.max(0, match.index - 4000), match.index + 4000)
    const sdMatch = /"(browser_native_sd_url|playable_url)"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(slice)
    if (!sdMatch) continue
    const group = pairUrls(high, readJsonString(sdMatch[2]))
    if (!group) continue
    seen.add(high)
    groups.push(group)
    if (groups.length >= 24) break
  }
  return groups
}

function dedupe(items: Rendition[]): Rendition[] {
  const seen = new Map<string, Rendition>()
  const next: Rendition[] = []
  for (const item of items) {
    if (item.audioUrl && !item.soundtrack) item.soundtrack = item.audioUrl
    const key = `${item.width}x${item.height}:${mediaPath(item.url)}`
    const existing = seen.get(key)
    if (existing) {
      if (item.audioUrl && !existing.audioUrl) existing.audioUrl = item.audioUrl
      if (item.soundtrack && !existing.soundtrack) existing.soundtrack = item.soundtrack
      continue
    }
    seen.set(key, item)
    next.push(item)
  }
  return next
}

function soundtrackOf(items: readonly Rendition[]): string {
  for (const item of items) {
    if (item.soundtrack) return item.soundtrack
    if (item.audioUrl) return item.audioUrl
  }
  return ""
}

/** One soundtrack covers every quality of the same picture. */
function shareSoundtrack(items: Rendition[]): void {
  const track = soundtrackOf(items)
  if (!track) return
  for (const item of items) if (!item.soundtrack) item.soundtrack = track
}

function matchBracket(text: string, start: number): number {
  let depth = 0
  let quote = false
  let escape = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (escape) escape = false
      else if (char === "\\") escape = true
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') quote = true
    else if (char === "[") depth += 1
    else if (char === "]") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

const DASH_KEYS = new Set(["video_dash_manifest", "dash_manifest", "manifest_xml"])

function sanitizePlayed(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const paths: string[] = []
  for (const item of value.slice(0, 16)) {
    if (typeof item !== "string" || !item.startsWith("/") || item.length > 500) continue
    paths.push(item)
  }
  return paths
}

function parseLooseJson(text: string): unknown | null {
  let body = text.trimStart()
  if (body.startsWith("for (;;);")) body = body.slice("for (;;);".length).trimStart()
  else if (body.startsWith("while(1);")) body = body.slice("while(1);".length).trimStart()
  if (!body.startsWith("{") && !body.startsWith("[")) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

function mediaKeyRank(key: string): number {
  if (DASH_KEYS.has(key) || key === "video_versions" || key === "progressive_urls") return 3
  if (key.includes("video") || key.includes("media") || key === "items" || key === "edges") return 2
  if (key === "data" || key === "node") return 1
  return 0
}

function scanLoose(text: string): Rendition[][] {
  const found: Rendition[][] = []
  if (text.includes("browser_native_hd_url") || text.includes("playable_url_quality_hd")) {
    absorbGroups(found, facebookGroups(text))
  }
  const versions = versionSlices(text)
  for (const slice of versions) absorbGroups(found, [slice.group])
  if (text.includes("video_dash_manifest") || text.includes("dash_manifest") || text.includes("<MPD") || text.includes("<Representation")) {
    for (const dash of dashSlices(text)) {
      const previous = versions.filter((slice) => slice.end <= dash.at).pop()
      if (previous && dash.at - previous.end < 8000) absorbGroups(found, [mergeRenditions(previous.group, dash.videos)])
      else absorbGroups(found, [dash.videos])
    }
  }
  if (text.includes("progressive_url")) absorbGroups(found, progressiveGroups(text))
  return found
}

function versionSlices(text: string): { group: Rendition[]; end: number }[] {
  const slices: { group: Rendition[]; end: number }[] = []
  let from = 0
  while (slices.length < 48 && from < text.length) {
    const at = text.indexOf("video_versions", from)
    if (at < 0) break
    const colon = text.indexOf(":", at + 14)
    if (colon < 0 || colon - at > 40) {
      from = at + 14
      continue
    }
    let start = colon + 1
    while (start < text.length && /\s/.test(text[start])) start += 1
    if (text[start] !== "[") {
      from = at + 14
      continue
    }
    const end = matchBracket(text, start)
    if (end < 0) break
    const group = sanitizeGroups([parseJsonSlice(text.slice(start, end + 1))])[0]
    if (group?.length) slices.push({ group, end })
    from = (end > at ? end : at) + 1
  }
  return slices
}

function dashSlices(text: string): { at: number; videos: Rendition[] }[] {
  const found: { at: number; videos: Rendition[] }[] = []
  const keys = ["video_dash_manifest", "dash_manifest", "manifest_xml"]
  for (const key of keys) {
    let from = 0
    while (found.length < 48 && from < text.length) {
      const at = text.indexOf(key, from)
      if (at < 0) break
      const colon = text.indexOf(":", at + key.length)
      if (colon < 0 || colon - at > key.length + 24) {
        from = at + key.length
        continue
      }
      const xml = readEncodedString(text, colon + 1)
      if (xml && (xml.includes("<MPD") || xml.includes("<Representation"))) {
        const parsed = parseDash(xml)
        if (parsed.videos.length) found.push({ at, videos: parsed.videos })
      }
      from = at + key.length
    }
  }
  if (!found.length && (text.includes("<MPD") || text.includes("<Representation"))) {
    const parsed = parseDash(text)
    if (parsed.videos.length) found.push({ at: 0, videos: parsed.videos })
  }
  return found
}

function progressiveGroups(text: string): Rendition[][] {
  const found: { url: string; label: string; at: number }[] = []
  const pattern = /"progressive_url"\s*:\s*"((?:\\.|[^"\\])*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) && found.length < 64) {
    const around = text.slice(Math.max(0, match.index - 250), match.index + 450)
    const quality = /"quality"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(around)
    found.push({
      url: readJsonString(match[1]),
      label: quality ? readJsonString(quality[1]) : "",
      at: match.index
    })
  }
  const groups: Rendition[][] = []
  const used = new Set<number>()
  for (let index = 0; index < found.length; index += 1) {
    if (used.has(index)) continue
    const item = found[index]
    const rendition = fileRendition(item.url, item.label)
    if (!rendition) continue
    const partner = found.findIndex(
      (other, otherIndex) =>
        otherIndex > index &&
        !used.has(otherIndex) &&
        other.at - item.at < 2000 &&
        other.label !== "" &&
        item.label !== "" &&
        other.label.toLowerCase() !== item.label.toLowerCase()
    )
    if (partner >= 0) {
      const other = fileRendition(found[partner].url, found[partner].label)
      if (other && mediaPath(other.url) !== mediaPath(rendition.url)) {
        used.add(index)
        used.add(partner)
        groups.push(dedupe([rendition, other]))
        continue
      }
    }
    used.add(index)
    groups.push([rendition])
  }
  return groups
}

function parseJsonSlice(slice: string): unknown {
  try {
    return JSON.parse(slice) as unknown
  } catch {
    /* Escaped JSON from a script tag is unescaped below. */
  }
  const unescaped = slice.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/\\"/g, '"')
  try {
    return JSON.parse(unescaped) as unknown
  } catch {
    return null
  }
}

function readEncodedString(text: string, start: number): string | null {
  let index = start
  while (index < text.length && /\s/.test(text[index])) index += 1
  if (text.startsWith('\\"', index)) {
    const end = text.indexOf('\\"', index + 2)
    if (end < 0) return null
    return readJsonString(text.slice(index + 2, end).replace(/\\\\/g, "\\"))
  }
  if (text[index] !== '"') return null
  let escape = false
  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    const char = text[cursor]
    if (escape) {
      escape = false
      continue
    }
    if (char === "\\") escape = true
    else if (char === '"') return readJsonString(text.slice(index + 1, cursor))
  }
  return null
}

function renditionsOn(record: Record<string, unknown>): Rendition[] {
  const muxed: Rendition[] = []
  if (Array.isArray(record.video_versions)) {
    for (const item of record.video_versions) {
      const rendition = asRendition(item)
      if (rendition) muxed.push(rendition)
    }
  }
  if (Array.isArray(record.progressive_urls)) {
    for (const item of record.progressive_urls) {
      const rendition = progressiveRendition(item)
      if (rendition) muxed.push(rendition)
    }
  }
  const hd = record.browser_native_hd_url || record.playable_url_quality_hd
  const sd = record.browser_native_sd_url || record.playable_url
  if (typeof hd === "string" && typeof sd === "string") {
    const pair = pairUrls(hd, sd)
    if (pair) muxed.push(...pair)
  }
  let dashed: Rendition[] = []
  for (const key of DASH_KEYS) {
    const value = record[key]
    if (typeof value !== "string") continue
    dashed = dashed.concat(parseDash(value).videos)
  }
  const merged = mergeRenditions(muxed, dashed)
  const duration = dimension(record.video_duration)
  if (duration > 0) {
    for (const item of merged) if (!item.duration) item.duration = duration
  }
  stampTitle(merged, captionOn(record))
  const unique = dedupe(merged)
  shareSoundtrack(unique)
  return unique
}

function progressiveRendition(value: unknown): Rendition | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const url = typeof raw.progressive_url === "string" ? raw.progressive_url : typeof raw.url === "string" ? raw.url : ""
  const meta = raw.metadata && typeof raw.metadata === "object" ? (raw.metadata as Record<string, unknown>) : null
  const quality = typeof raw.quality === "string" ? raw.quality : meta && typeof meta.quality === "string" ? meta.quality : ""
  const sized = asRendition({
    url,
    width: raw.width ?? meta?.width,
    height: raw.height ?? meta?.height,
    label: quality || undefined,
    measured: true
  })
  return sized || fileRendition(url, quality)
}

function labeledPair(url: string, quality: string): Rendition | null {
  const label = quality.trim()
  const hd = /hd/i.test(label)
  const sd = /sd/i.test(label)
  if (!hd && !sd) return null
  return asRendition({
    url,
    width: hd ? 1280 : 640,
    height: hd ? 720 : 360,
    label: label || undefined,
    measured: false
  })
}

function fileRendition(url: string, quality: string): Rendition | null {
  return (
    labeledPair(url, quality) ||
    asRendition({
      url,
      width: 1280,
      height: 720,
      label: quality.trim() || "Video",
      measured: false
    })
  )
}

function samePicture(a: Rendition, b: Rendition): boolean {
  if (a.measured === false || b.measured === false) return false
  return (
    Math.abs(a.height - b.height) <= Math.max(8, b.height * 0.04) &&
    Math.abs(a.width - b.width) <= Math.max(8, b.width * 0.04)
  )
}

function rememberAlias(item: Rendition, url: string): void {
  if (!url || mediaPath(url) === mediaPath(item.url)) return
  const aliases = item.aliases ? [...item.aliases] : []
  if (aliases.some((alias) => mediaPath(alias) === mediaPath(url))) return
  aliases.push(url)
  item.aliases = aliases
}

/** Keep a muxed progressive file ahead of a video-only DASH address for the same picture. */
function preferPlayable(same: Rendition, item: Rendition): void {
  const track = item.soundtrack || item.audioUrl
  if (track && !same.soundtrack) same.soundtrack = track
  if (same.audioUrl && !same.soundtrack) same.soundtrack = same.audioUrl
  if (mediaPath(same.url) === mediaPath(item.url)) {
    if (item.audioUrl && !same.audioUrl) same.audioUrl = item.audioUrl
    for (const alias of item.aliases || []) rememberAlias(same, alias)
    return
  }
  const currentMuxed = !same.audioUrl
  const incomingMuxed = !item.audioUrl
  if (currentMuxed) rememberAlias(same, item.url)
  else if (incomingMuxed) {
    rememberAlias(same, same.url)
    same.url = item.url
    same.audioUrl = undefined
    same.label = same.label || item.label
  } else rememberAlias(same, item.url)
  for (const alias of item.aliases || []) rememberAlias(same, alias)
}

function mergeRenditions(muxed: Rendition[], dashed: Rendition[]): Rendition[] {
  const next = dedupe(muxed)
  for (const item of dashed) {
    const same = next.find((other) => mediaPath(other.url) === mediaPath(item.url) || samePicture(other, item))
    if (!same) {
      next.push(item)
      continue
    }
    preferPlayable(same, item)
  }
  const unique = dedupe(next)
  shareSoundtrack(unique)
  return unique
}

function parseDash(xml: string): { videos: Rendition[]; audioUrl?: string } {
  if (!xml || !/<Representation\b/i.test(xml)) return { videos: [] }
  const videos: Rendition[] = []
  const videoOnly: boolean[] = []
  let audioUrl: string | undefined
  let audioBandwidth = -1
  const sets = /<AdaptationSet\b/i.test(xml) ? xml.split(/<AdaptationSet\b/i).slice(1) : [xml]
  for (const set of sets) {
    const setEnd = set.indexOf(">")
    const setTag = setEnd >= 0 ? set.slice(0, setEnd) : ""
    const setMime = `${attr(setTag, "mimeType")} ${attr(setTag, "contentType")}`
    const setAudio = /audio/i.test(setMime)
    const setWidth = dimension(attr(setTag, "maxWidth") || attr(setTag, "width"))
    const setHeight = dimension(attr(setTag, "maxHeight") || attr(setTag, "height"))
    for (const block of set.split(/<Representation\b/i).slice(1)) {
      const close = block.search(/<\/Representation>/i)
      const body = close >= 0 ? block.slice(0, close) : block.slice(0, 4000)
      if (/<SegmentList\b/i.test(body)) continue
      const url = representationUrl(body)
      if (!url) continue
      const tagEnd = body.indexOf(">")
      const tag = tagEnd >= 0 ? body.slice(0, tagEnd) : body.slice(0, 500)
      const mime = `${attr(tag, "mimeType")} ${setMime}`
      const codecs = attr(tag, "codecs")
      const videoCodec = /avc1|vp09|vp9|av01|hev1|hvc1/i.test(codecs)
      const audioCodec = /mp4a|opus|ac-3|ec-3/i.test(codecs)
      const width = dimension(attr(tag, "width")) || (setAudio ? 0 : setWidth)
      const height = dimension(attr(tag, "height")) || (setAudio ? 0 : setHeight)
      const bandwidth = dimension(attr(tag, "bandwidth"))
      const audioOnly = !videoCodec && (setAudio || /audio/i.test(mime) || audioCodec)
      if (audioOnly) {
        if (bandwidth >= audioBandwidth) {
          audioBandwidth = bandwidth
          audioUrl = url
        }
        continue
      }
      if (width < 1 || height < 1) continue
      const rawLabel = attr(tag, "FBQualityLabel")
      const label = /^\d{3,4}p$/i.test(rawLabel) ? rawLabel.toLowerCase() : undefined
      videos.push({
        width: Math.round(width),
        height: Math.round(height),
        url,
        label,
        measured: true
      })
      videoOnly.push(!audioCodec)
    }
  }
  if (audioUrl) {
    for (let index = 0; index < videos.length; index += 1) {
      if (videoOnly[index]) videos[index] = { ...videos[index], audioUrl }
    }
  }
  return { videos: dedupe(videos), audioUrl }
}

function representationUrl(body: string): string {
  const base = /<BaseURL[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<]+?)\s*(?:\]\]>)?\s*<\/BaseURL>/i.exec(body)
  if (base) return fileUrl(decodeXml(base[1].trim())) || ""
  const template = /<SegmentTemplate\b([^>]*)>/i.exec(body)
  if (!template) return ""
  const media = attr(template[1], "media") || attr(template[1], "initialization")
  if (!media || media.includes("$")) return ""
  return fileUrl(decodeXml(media)) || ""
}

function attr(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag)
  return match ? decodeXml(match[2]) : ""
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function absorbGroups(found: Rendition[][], incoming: Rendition[][]): void {
  for (const group of incoming) {
    if (!group.length || found.length >= 48) continue
    const paths = new Set(group.map((item) => mediaPath(item.url)))
    const host = found.find((existing) => existing.some((item) => paths.has(mediaPath(item.url))))
    if (!host) {
      const unique = dedupe(group)
      shareSoundtrack(unique)
      found.push(unique)
      continue
    }
    stampTitle(host, group.find((item) => item.title)?.title)
    for (const item of group) {
      const existing = host.find((other) => mediaPath(other.url) === mediaPath(item.url) || samePicture(other, item))
      if (existing) {
        preferPlayable(existing, item)
        continue
      }
      host.push(item)
    }
    shareSoundtrack(host)
  }
}

function walk(value: unknown, found: Rendition[][], depth: number, budget: { nodes: number }): void {
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES || value == null || typeof value !== "object") return
  budget.nodes += 1
  if (Array.isArray(value)) {
    for (const item of value) walk(item, found, depth + 1, budget)
    return
  }
  const record = value as Record<string, unknown>
  const group = renditionsOn(record)
  if (group.length) found.push(group)
  const keys = Object.keys(record)
  keys.sort((a, b) => mediaKeyRank(b) - mediaKeyRank(a))
  for (const key of keys) {
    if (key === "video_versions" || key === "progressive_urls" || DASH_KEYS.has(key)) continue
    walk(record[key], found, depth + 1, budget)
  }
}
