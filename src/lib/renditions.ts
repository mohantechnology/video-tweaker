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

/** Set when a swapped clip should stay silent after its reel is closed. */
export const STOP_MARK = "data-vee-stop"

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
  /** Bits per second from the DASH manifest. Picks the best file among same-size tracks. */
  bandwidth?: number
  /** Length in seconds, used to tell one post from another. */
  duration?: number
  /** Post caption or title carried with this file. */
  title?: string
  /** Instagram shortcode for the post these files belong to. */
  code?: string
  /** Instagram media id. Slides that share a shortcode still differ here. */
  pk?: string
}

export type RenditionMessage = {
  source: typeof RENDITION_SOURCE
  kind: "ask" | "list" | "use" | "drop" | "used" | "failed" | "hold"
  groups?: Rendition[][]
  batch?: Rendition[][]
  /** Pathnames of media files the page just requested, newest first. */
  played?: string[]
  /** Identifies the video element for a resolution swap. */
  token?: string
  /** Instagram shortcode of the clip currently on screen. */
  code?: string
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
const MAX_SCAN = 32_000_000
const MAX_GROUPS = 240
const MAX_DEPTH = 40
const MAX_NODES = 150_000

export function readRenditionMessage(data: unknown): RenditionMessage | null {
  if (!data || typeof data !== "object") return null
  const message = data as Partial<RenditionMessage>
  if (message.source !== RENDITION_SOURCE) return null
  if (message.kind === "hold") {
    const code = typeof message.code === "string" && /^[A-Za-z0-9_-]{5,20}$/.test(message.code.trim()) ? message.code.trim() : undefined
    const played = sanitizePlayed(message.played)
    if (!code && !played.length) return null
    return { source: RENDITION_SOURCE, kind: "hold", code, played }
  }
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

/** Tell the page hook which clip is on screen so its files are not discarded. */
export function postRenditionHold(code: string, path: string): void {
  const safe = /^[A-Za-z0-9_-]{5,20}$/.test(code) ? code : undefined
  const played = path.startsWith("/") && path.length <= 500 ? [path] : undefined
  if (!safe && !played) return
  window.postMessage(
    { source: RENDITION_SOURCE, kind: "hold", code: safe, played } satisfies RenditionMessage,
    "*"
  )
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
  if (!text || text.length > MAX_SCAN) return []
  const found: Rendition[][] = []
  if (text.length <= MAX_TEXT) {
    const parsed = parseLooseJson(text)
    if (parsed) absorbGroups(found, groupsFromValue(parsed))
  }
  absorbGroups(found, scanLoose(text))
  return found
}

export function groupsFromValue(value: unknown): Rendition[][] {
  const walked: Rendition[][] = []
  walk(value, walked, 0, { nodes: 0 })
  const found: Rendition[][] = []
  absorbGroups(found, walked)
  return found
}

export function sanitizeGroups(value: unknown): Rendition[][] {
  if (!Array.isArray(value)) return []
  const groups: Rendition[][] = []
  for (const group of value.slice(0, MAX_GROUPS)) {
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

const STANDARD_HEIGHTS = [144, 240, 360, 480, 540, 720, 1080, 1440, 2160]

/** Encoders pad sizes like 1088 or 716. Name them by the standard height they are made for. */
function standardHeight(item: Rendition): number {
  const pixels = Math.min(item.width, item.height)
  const near = STANDARD_HEIGHTS.find((height) => Math.abs(height - pixels) <= height * 0.02)
  return near ?? pixels
}

/** Instagram's FBQualityLabel names a bitrate tier, so a measured size wins over it. */
export function qualityLabel(item: Rendition, group: readonly Rendition[]): string {
  if (item.label && item.measured === false) return item.label
  const pixels = standardHeight(item)
  const same = group.filter((other) => standardHeight(other) === pixels).length
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

function nestedText(value: unknown): string | undefined {
  if (typeof value === "string") return cleanTitle(value)
  if (!value || typeof value !== "object") return undefined
  const text = (value as { text?: unknown }).text
  return typeof text === "string" ? cleanTitle(text) : undefined
}

function keptTitle(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (/^(hd|sd|video|original audio|facebook|watch|reel|reels|fb)$/i.test(value)) return undefined
  return value
}

/** Caption on this record, or the story text sitting above a Facebook video. */
function storyTitle(record: Record<string, unknown>): string | undefined {
  return (
    keptTitle(nestedText(record.message)) ||
    keptTitle(nestedText(record.caption)) ||
    keptTitle(nestedText(record.savable_description)) ||
    keptTitle(nestedText(record.title))
  )
}

function captionOn(record: Record<string, unknown>): string | undefined {
  const named = nestedText(record.name)
  const direct =
    storyTitle(record) || (named && !/^(facebook|watch|reel|reels|video|fb)$/i.test(named) ? named : undefined)
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
  const bandwidth = dimension(raw.bandwidth)
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases
        .filter((item): item is string => typeof item === "string")
        .map((item) => fileUrl(item))
        .filter((item): item is string => item != null && item !== url)
    : undefined
  const code = readCodeValue(raw.code) || readCodeValue(raw.shortcode)
  const pk = readPkValue(raw.pk)
  return {
    width: Math.round(width),
    height: Math.round(height),
    url,
    label,
    measured,
    audioUrl: audio || undefined,
    soundtrack: soundtrack || audio || undefined,
    aliases: aliases && aliases.length ? aliases : undefined,
    bandwidth: bandwidth > 0 ? Math.round(bandwidth) : undefined,
    duration: duration > 0 ? duration : undefined,
    title: cleanTitle(raw.title),
    code: code || undefined,
    pk: pk || undefined
  }
}

function readCodeValue(value: unknown): string {
  if (typeof value !== "string") return ""
  const code = value.trim()
  if (!/^[A-Za-z0-9_-]{8,20}$/.test(code)) return ""
  return code
}

function readPkValue(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return ""
    const text = String(value)
    return /^\d{6,}$/.test(text) ? text : ""
  }
  if (typeof value !== "string") return ""
  const text = value.trim()
  return /^\d{6,}$/.test(text) ? text : ""
}

function pkFromId(value: unknown): string {
  if (typeof value !== "string") return ""
  return readPkValue(value.split("_")[0])
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

/** Nearest post text before a Facebook playable URL. */
function facebookSliceTitle(before: string): string | undefined {
  const patterns = [
    /"message"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /"savable_description"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /"title"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /"name"\s*:\s*"((?:\\.|[^"\\]){2,200})"/g
  ]
  for (const pattern of patterns) {
    let best = ""
    let found: RegExpExecArray | null
    while ((found = pattern.exec(before))) {
      const text = keptTitle(cleanTitle(readJsonString(found[1])))
      if (text) best = text
    }
    if (best) return best
  }
  return undefined
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
    const before = text.slice(Math.max(0, match.index - 12000), match.index)
    stampTitle(group, facebookSliceTitle(before))
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
      if (item.code && !existing.code) existing.code = item.code
      if (item.pk && !existing.pk) existing.pk = item.pk
      if (item.duration && !existing.duration) existing.duration = item.duration
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
const MEDIA_MARKERS = ["video_versions", "video_dash_manifest", "dash_manifest", "manifest_xml", "video_url"]

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
      const near = previous != null && dash.at - previous.end < 8000
      const samePost = previous != null && sameIdentity(previous, dash)
      if (previous && near && samePost) absorbGroups(found, [mergeRenditions(previous.group, dash.videos)])
      else absorbGroups(found, [dash.videos])
    }
  }
  if (text.includes("progressive_url")) absorbGroups(found, progressiveGroups(text))
  if (text.includes('"video_url"')) absorbGroups(found, videoUrlGroups(text))
  return found
}

function versionSlices(text: string): { group: Rendition[]; end: number; code: string; pk: string }[] {
  const slices: { group: Rendition[]; end: number; code: string; pk: string }[] = []
  let from = 0
  while (slices.length < MAX_GROUPS && from < text.length) {
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
    if (group?.length) {
      const id = identityNear(text, at)
      const seconds = durationNear(text, end)
      stampIdentity(group, id.code, id.pk)
      if (seconds > 0) for (const item of group) if (!item.duration) item.duration = seconds
      slices.push({ group, end, code: id.code, pk: id.pk })
    }
    from = (end > at ? end : at) + 1
  }
  return slices
}

function dashSlices(text: string): { at: number; videos: Rendition[]; code: string; pk: string }[] {
  const found: { at: number; videos: Rendition[]; code: string; pk: string }[] = []
  const keys = ["video_dash_manifest", "dash_manifest", "manifest_xml"]
  for (const key of keys) {
    let from = 0
    while (found.length < MAX_GROUPS && from < text.length) {
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
        if (parsed.videos.length) {
          const id = identityNear(text, at)
          stampIdentity(parsed.videos, id.code, id.pk)
          found.push({ at, videos: parsed.videos, code: id.code, pk: id.pk })
        }
      }
      from = at + key.length
    }
  }
  if (!found.length && (text.includes("<MPD") || text.includes("<Representation"))) {
    const parsed = parseDash(text)
    if (parsed.videos.length) found.push({ at: 0, videos: parsed.videos, code: "", pk: "" })
  }
  return found
}

type ClipId = { code: string; pk: string }

type TextHit = { value: string; index: number; end: number }

function usableCode(value: string): string {
  if (!/^[A-Za-z0-9_-]{8,20}$/.test(value)) return ""
  if (/^(audio|explore|tags|locations|saved|accounts)$/i.test(value)) return ""
  return value
}

/** Depth of `{}` in `slice`, or null once a brace closes the object we started in. */
function objectDepth(slice: string): number | null {
  let depth = 0
  let quote = false
  let escape = false
  for (let index = 0; index < slice.length; index += 1) {
    const char = slice[index]
    if (quote) {
      if (escape) escape = false
      else if (char === "\\") escape = true
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') quote = true
    else if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth < 0) return null
    }
  }
  return depth
}

function collectHits(region: string, pattern: RegExp): TextHit[] {
  const source = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)
  const found: TextHit[] = []
  let match: RegExpExecArray | null
  while ((match = source.exec(region))) {
    if (!match[1]) continue
    found.push({ value: match[1], index: match.index, end: match.index + match[0].length })
    if (match[0].length === 0) source.lastIndex += 1
  }
  return found
}

/** Last id that still belongs to the object containing the media key. */
function idBefore(region: string, pattern: RegExp, clean: (value: string) => string): string {
  let found = ""
  for (const hit of collectHits(region, pattern)) {
    const value = clean(hit.value)
    if (!value || objectDepth(region.slice(hit.end)) == null) continue
    found = value
  }
  return found
}

/** First id at the media object's own level, before the next object starts. */
function idAfter(region: string, pattern: RegExp, clean: (value: string) => string): string {
  for (const hit of collectHits(region, pattern)) {
    const value = clean(hit.value)
    if (!value) continue
    const depth = objectDepth(region.slice(0, hit.index))
    if (depth === 0) return value
  }
  return ""
}

function markerAt(text: string, at: number): number {
  for (const marker of MEDIA_MARKERS) {
    if (text.startsWith(marker, at)) return marker.length
  }
  return 1
}

function markerBound(text: string, at: number, dir: "before" | "after"): number {
  const origin = dir === "before" ? Math.max(0, at - 12000) : at + markerAt(text, at)
  const end = dir === "before" ? at : Math.min(text.length, at + 12000)
  const slice = text.slice(origin, end)
  let nearest = -1
  for (const marker of MEDIA_MARKERS) {
    const pos = dir === "before" ? slice.lastIndexOf(marker) : slice.indexOf(marker)
    if (pos < 0) continue
    if (nearest < 0 || (dir === "before" ? pos > nearest : pos < nearest)) nearest = pos
  }
  if (nearest < 0) return dir === "before" ? origin : end
  return origin + nearest + (dir === "before" ? markerAt(slice, nearest) : 0)
}

/**
 * Shortcode and media id for the clip that owns the key at `at`.
 * The id is often after `video_versions`, so a backward-only search tags the previous post.
 */
function identityNear(text: string, at: number): ClipId {
  const back = text.slice(markerBound(text, at, "before"), at)
  const forward = text.slice(at, markerBound(text, at, "after"))
  const codePattern = /"(?:code|shortcode)"\s*:\s*"([A-Za-z0-9_-]{8,20})"/g
  const linkPattern = /instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{8,20})/gi
  const pkPattern = /"pk"\s*:\s*"?(\d{6,})"?/g
  return {
    code: idBefore(back, codePattern, usableCode) || idBefore(back, linkPattern, usableCode) || idAfter(forward, codePattern, usableCode) || idAfter(forward, linkPattern, usableCode),
    pk: idBefore(back, pkPattern, (value) => value) || idAfter(forward, pkPattern, (value) => value)
  }
}

function durationNear(text: string, end: number): number {
  const region = text.slice(end, Math.min(text.length, end + 2500))
  const match = /"video_duration"\s*:\s*(\d+(?:\.\d+)?)/.exec(region)
  if (!match) return 0
  const value = Number(match[1])
  return value > 0 && value < 86_400 ? value : 0
}

function sameIdentity(a: ClipId, b: ClipId): boolean {
  if (a.code && b.code && a.code !== b.code) return false
  if (a.pk && b.pk && a.pk !== b.pk) return false
  return Boolean((a.code && b.code && a.code === b.code) || (a.pk && b.pk && a.pk === b.pk))
}

function stampIdentity(items: Rendition[], code: string, pk: string): void {
  if (!code && !pk) return
  for (const item of items) {
    if (code && !item.code) item.code = code
    if (pk && !item.pk) item.pk = pk
  }
}

function videoUrlGroups(text: string): Rendition[][] {
  const found: Rendition[][] = []
  const pattern = /"video_url"\s*:\s*"((?:\\.|[^"\\])*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) && found.length < MAX_GROUPS) {
    const rendition = fileRendition(readJsonString(match[1]), "")
    if (!rendition) continue
    const id = identityNear(text, match.index)
    stampIdentity([rendition], id.code, id.pk)
    const seconds = durationNear(text, match.index)
    if (seconds > 0 && !rendition.duration) rendition.duration = seconds
    found.push([rendition])
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
    const id = identityNear(text, item.at)
    stampIdentity([rendition], id.code, id.pk)
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
      const otherId = identityNear(text, found[partner].at)
      if (other) stampIdentity([other], otherId.code, otherId.pk)
      const identified = Boolean(id.code || id.pk || otherId.code || otherId.pk)
      const clash = identified && !sameIdentity(id, otherId)
      if (other && !clash && mediaPath(other.url) !== mediaPath(rendition.url)) {
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

function permalinkCode(value: unknown): string {
  if (typeof value !== "string") return ""
  const match = /instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{8,20})/i.exec(value)
  return match ? usableCode(match[1]) : ""
}

function recordCode(record: Record<string, unknown>, inherited = ""): string {
  return readCodeValue(record.code) || readCodeValue(record.shortcode) || permalinkCode(record.permalink) || permalinkCode(record.link) || inherited
}

function progressiveFile(record: Record<string, unknown>): Rendition | null {
  const raw = typeof record.video_url === "string" ? record.video_url : ""
  if (!raw) return null
  const dims = record.dimensions && typeof record.dimensions === "object" ? (record.dimensions as Record<string, unknown>) : null
  const width = dimension(record.original_width) || dimension(dims?.width) || dimension(record.width)
  const height = dimension(record.original_height) || dimension(dims?.height) || dimension(record.height)
  if (width >= 2 && height >= 2) return asRendition({ url: raw, width, height, measured: true })
  return fileRendition(raw, "")
}

function renditionsOn(record: Record<string, unknown>, inheritedCode = ""): Rendition[] {
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
  const single = progressiveFile(record)
  if (single) muxed.push(single)
  let dashed: Rendition[] = []
  for (const key of DASH_KEYS) {
    const value = record[key]
    if (typeof value !== "string") continue
    dashed = dashed.concat(parseDash(value).videos)
  }
  const code = recordCode(record, inheritedCode)
  const pk = readPkValue(record.pk) || pkFromId(record.id)
  stampIdentity(muxed, code, pk)
  stampIdentity(dashed, code, pk)
  const merged = mergeRenditions(muxed, dashed)
  const duration = dimension(record.video_duration)
  if (duration > 0) {
    for (const item of merged) if (!item.duration) item.duration = duration
  }
  stampTitle(merged, captionOn(record))
  stampIdentity(merged, code, pk)
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

function filePaths(item: Rendition): string[] {
  const paths = [mediaPath(item.url)]
  for (const alias of item.aliases || []) paths.push(mediaPath(alias))
  return paths
}

function sameFile(a: Rendition, b: Rendition): boolean {
  const left = new Set(filePaths(a))
  return filePaths(b).some((path) => left.has(path))
}

/** Keep a muxed progressive file ahead of a video-only DASH address for the same picture. */
function preferPlayable(same: Rendition, item: Rendition): void {
  const touch = sameFile(same, item)
  if (!touch && !sameClip(same, item)) return
  if (touch && same.code && item.code && same.code !== item.code) return
  if (touch && same.pk && item.pk && same.pk !== item.pk) return
  if (item.code && !same.code) same.code = item.code
  if (item.pk && !same.pk) same.pk = item.pk
  if (item.title && !same.title) same.title = item.title
  if (item.duration && !same.duration) same.duration = item.duration
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
    same.bandwidth = undefined
    same.label = same.label || item.label
  } else if ((item.bandwidth || 0) > (same.bandwidth || 0)) {
    rememberAlias(same, same.url)
    same.url = item.url
    same.bandwidth = item.bandwidth
    if (item.audioUrl) same.audioUrl = item.audioUrl
    same.aliases = same.aliases?.filter((alias) => mediaPath(alias) !== mediaPath(item.url))
  } else rememberAlias(same, item.url)
  for (const alias of item.aliases || []) rememberAlias(same, alias)
}

/** True when both files are the same clip, or neither one is identified yet. */
function sameClip(a: Rendition, b: Rendition): boolean {
  if (a.code && b.code && a.code !== b.code) return false
  if (a.pk && b.pk && a.pk !== b.pk) return false
  const aKnown = Boolean(a.code || a.pk)
  const bKnown = Boolean(b.code || b.pk)
  if (!aKnown && !bKnown) return true
  if (!aKnown || !bKnown) return false
  return Boolean((a.code && b.code) || (a.pk && b.pk))
}

function identified(item: Rendition): boolean {
  return Boolean(item.code || item.pk)
}

function mergeRenditions(muxed: Rendition[], dashed: Rendition[]): Rendition[] {
  const next = dedupe(muxed)
  for (const item of dashed) {
    const same = next.find(
      (other) => sameFile(other, item) || (sameClip(other, item) && samePicture(other, item))
    )
    if (!same) {
      const clash = next.some((other) => identified(other) && identified(item) && !sameClip(other, item))
      if (!clash) next.push(item)
      continue
    }
    preferPlayable(same, item)
  }
  const unique = dedupe(next)
  shareSoundtrack(unique)
  return unique
}

function copyRendition(item: Rendition): Rendition {
  return { ...item, aliases: item.aliases ? [...item.aliases] : undefined }
}

/** Join two sightings of the same files without dropping a shortcode or soundtrack. */
export function mergeCatalogEntries(previous: readonly Rendition[], incoming: readonly Rendition[]): Rendition[] {
  return mergeRenditions(previous.map(copyRendition), incoming.map(copyRendition))
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
        measured: true,
        bandwidth: bandwidth > 0 ? Math.round(bandwidth) : undefined
      })
      videoOnly.push(!audioCodec)
    }
  }
  if (audioUrl) {
    for (let index = 0; index < videos.length; index += 1) {
      if (videoOnly[index]) videos[index] = { ...videos[index], audioUrl }
    }
  }
  const seconds = presentationSeconds(xml)
  if (seconds > 0) {
    for (const item of videos) if (!item.duration) item.duration = seconds
  }
  return { videos: dedupe(videos), audioUrl }
}

function presentationSeconds(xml: string): number {
  const tag = /<MPD\b[^>]*>/i.exec(xml.slice(0, 1200))
  if (!tag) return 0
  const raw = attr(tag[0], "mediaPresentationDuration")
  const match = /PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/i.exec(raw)
  if (!match) return 0
  const total = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
  return total > 0 && total < 86_400 ? total : 0
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

function clipsConflict(host: readonly Rendition[], incoming: readonly Rendition[]): boolean {
  let shared = false
  for (const left of host) {
    for (const right of incoming) {
      if (!sameFile(left, right)) continue
      shared = true
      if (left.code && right.code && left.code !== right.code) return true
      if (left.pk && right.pk && left.pk !== right.pk) return true
    }
  }
  if (shared) return false
  return host.some((left) =>
    incoming.some((right) => !sameClip(left, right) && Boolean((left.code || left.pk) && (right.code || right.pk)))
  )
}

function groupCodeOf(group: readonly Rendition[]): string {
  let code = ""
  for (const item of group) {
    if (!item.code) continue
    if (!code) code = item.code
    else if (code !== item.code) return ""
  }
  return code
}

function groupPkOf(group: readonly Rendition[]): string {
  let pk = ""
  for (const item of group) {
    if (!item.pk) continue
    if (!pk) pk = item.pk
    else if (pk !== item.pk) return ""
  }
  return pk
}

function groupDuration(group: readonly Rendition[]): number {
  return group.find((item) => item.duration && item.duration > 0)?.duration || 0
}

/** Same post and same slide, so a separate dash list can join the progressive file. */
function sameCatalogClip(a: readonly Rendition[], b: readonly Rendition[]): boolean {
  const codeA = groupCodeOf(a)
  const codeB = groupCodeOf(b)
  if (!codeA || codeA !== codeB) return false
  const pkA = groupPkOf(a)
  const pkB = groupPkOf(b)
  if (pkA && pkB) return pkA === pkB
  const durA = groupDuration(a)
  const durB = groupDuration(b)
  if (!durA || !durB) return false
  return Math.abs(durA - durB) <= Math.max(1.25, Math.max(durA, durB) * 0.05)
}

function absorbGroups(found: Rendition[][], incoming: Rendition[][]): void {
  for (const group of incoming) {
    if (!group.length || found.length >= MAX_GROUPS) continue
    const paths = new Set(group.map((item) => mediaPath(item.url)))
    let host = found.find((existing) => existing.some((item) => paths.has(mediaPath(item.url))))
    if (host && clipsConflict(host, group)) host = undefined
    if (!host) host = found.find((existing) => sameCatalogClip(existing, group))
    if (!host) {
      const unique = dedupe(group)
      shareSoundtrack(unique)
      if (unique.length && found.length < MAX_GROUPS) found.push(unique)
      continue
    }
    stampTitle(host, group.find((item) => item.title)?.title)
    for (const item of group) {
      const existing = host.find(
        (other) => mediaPath(other.url) === mediaPath(item.url) || (sameClip(other, item) && samePicture(other, item))
      )
      if (existing) {
        preferPlayable(existing, item)
        continue
      }
      host.push(item)
    }
    shareSoundtrack(host)
  }
}

function walk(
  value: unknown,
  found: Rendition[][],
  depth: number,
  budget: { nodes: number },
  inheritedCode = "",
  inheritedTitle = ""
): void {
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES || value == null || typeof value !== "object") return
  budget.nodes += 1
  if (Array.isArray(value)) {
    for (const item of value) walk(item, found, depth + 1, budget, inheritedCode, inheritedTitle)
    return
  }
  const record = value as Record<string, unknown>
  const ownCode = recordCode(record)
  const ownTitle = storyTitle(record) || inheritedTitle
  const group = renditionsOn(record, ownCode || inheritedCode)
  if (group.length) {
    if (ownTitle) stampTitle(group, ownTitle)
    found.push(group)
  }
  const keys = Object.keys(record)
  keys.sort((a, b) => mediaKeyRank(b) - mediaKeyRank(a))
  const nextCode = ownCode || inheritedCode
  for (const key of keys) {
    if (key === "video_versions" || key === "progressive_urls" || DASH_KEYS.has(key)) continue
    walk(record[key], found, depth + 1, budget, nextCode, ownTitle)
  }
}
