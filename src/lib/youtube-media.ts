/** Streams YouTube already opened for a watch page or a Short. */

import { isIsoBmff, muxAvcAac } from "./mp4-mux"

export const YT_MEDIA_SOURCE = "vee-youtube-media"

const MAX_HEIGHT = 1080
const MAX_VIDEO_BYTES = 450_000_000
const MAX_AUDIO_BYTES = 200_000_000
const MAX_FILE_BYTES = 500_000_000

const AVC_ITAGS = new Set([133, 134, 135, 136, 137, 160, 298, 299])
const AAC_ITAGS = new Set([139, 140, 141, 256, 258, 327])

const AVC_HEIGHT: Record<number, number> = {
  160: 144,
  133: 240,
  134: 360,
  135: 480,
  136: 720,
  137: 1080,
  298: 720,
  299: 1080,
  18: 360,
  22: 720,
  37: 1080
}

export type YtTrack = {
  itag: number
  url: string
  mime: string
  codecs: string
  width: number
  height: number
  bitrate: number
  fps: number
  contentLength: number
  hasVideo: boolean
  hasAudio: boolean
  muxed: boolean
  /** True when this address came from a request the player already made. */
  played: boolean
}

export type YtMedia = {
  videoId: string
  title: string
  live: boolean
  tracks: YtTrack[]
}

export type YtOffer = {
  videoId: string
  title: string
  live: boolean
  combinedUrl: string
  videoUrl: string
  audioUrl: string
}

export type YtOfferMessage = {
  source: typeof YT_MEDIA_SOURCE
  kind: "offer"
} & YtOffer

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const TOKEN = /^[A-Za-z0-9]{8,40}$/

export function youtubeVideoId(href: string): string {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return ""
  }
  const host = url.hostname.replace(/^www\./, "")
  const youtube =
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  if (!youtube) return ""
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") || ""
    return VIDEO_ID.test(id) ? id : ""
  }
  const parts = url.pathname.split("/").filter(Boolean)
  const marker = parts.findIndex((part) => part === "shorts" || part === "embed" || part === "live" || part === "v")
  const id = marker >= 0 ? parts[marker + 1] || "" : ""
  return VIDEO_ID.test(id) ? id : ""
}

/** Signed media address with the fragment window removed. */
export function playbackUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null
  if (!url.hostname.endsWith("googlevideo.com")) return null
  if (!url.pathname.includes("videoplayback")) return null
  url.searchParams.delete("range")
  url.searchParams.delete("rn")
  url.searchParams.delete("rbuf")
  const itag = Number(url.searchParams.get("itag") || "")
  if (!Number.isInteger(itag) || itag <= 0) return null
  const signed =
    url.searchParams.has("expire") ||
    url.searchParams.has("signature") ||
    url.searchParams.has("sig") ||
    url.searchParams.has("lsig") ||
    url.searchParams.has("n")
  if (!signed) return null
  return url.href
}

/** Whole-file window when a bare address is refused. */
export function fullRangeUrl(value: string): string | null {
  const clean = playbackUrl(value)
  if (!clean) return null
  const url = new URL(clean)
  const length = Number(url.searchParams.get("clen") || "")
  if (!Number.isFinite(length) || length <= 1 || length > MAX_FILE_BYTES) return null
  url.searchParams.set("range", `0-${Math.floor(length) - 1}`)
  return url.href
}

export function parsePlayerResponse(value: unknown): YtMedia | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const details = record.videoDetails
  if (!details || typeof details !== "object" || Array.isArray(details)) return null
  const video = details as Record<string, unknown>
  const videoId = typeof video.videoId === "string" && VIDEO_ID.test(video.videoId) ? video.videoId : ""
  if (!videoId) return null
  const title = clipTitle(video.title)
  const live = video.isLiveContent === true || video.isLive === true || hasLiveStream(record)
  const streaming = record.streamingData
  if (!streaming || typeof streaming !== "object" || Array.isArray(streaming)) {
    return live ? { videoId, title, live: true, tracks: [] } : null
  }
  const stream = streaming as Record<string, unknown>
  if (live) return { videoId, title, live: true, tracks: [] }
  const tracks: YtTrack[] = []
  for (const format of asList(stream.formats)) {
    const track = parseFormat(format, true)
    if (track) tracks.push(track)
  }
  for (const format of asList(stream.adaptiveFormats)) {
    const track = parseFormat(format, false)
    if (track) tracks.push(track)
  }
  return { videoId, title, live: false, tracks }
}

export function collectPlayers(value: unknown): YtMedia[] {
  const found: YtMedia[] = []
  const stack: unknown[] = [value]
  let seen = 0
  while (stack.length && seen < 2000 && found.length < 4) {
    const current = stack.pop()
    seen += 1
    if (!current || typeof current !== "object") continue
    if (!Array.isArray(current)) {
      const parsed = parsePlayerResponse(current)
      if (parsed) {
        found.push(parsed)
        continue
      }
    }
    const children = Array.isArray(current) ? current : Object.values(current as Record<string, unknown>)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (child && typeof child === "object") stack.push(child)
    }
  }
  return found
}

export function extractAssignedObject(text: string, name: string): unknown {
  let from = 0
  while (from < text.length) {
    const marker = text.indexOf(name, from)
    if (marker < 0) return null
    const brace = text.indexOf("{", marker + name.length)
    if (brace < 0 || brace - marker > 80) {
      from = marker + name.length
      continue
    }
    const json = sliceJsonObject(text, brace)
    if (!json) return null
    try {
      return JSON.parse(json) as unknown
    } catch {
      from = brace + 1
    }
  }
  return null
}

export function mergeTracks(current: readonly YtTrack[], incoming: readonly YtTrack[]): YtTrack[] {
  const map = new Map<number, YtTrack>()
  for (const track of current) map.set(track.itag, { ...track })
  for (const track of incoming) {
    const prev = map.get(track.itag)
    if (!prev) {
      map.set(track.itag, { ...track })
      continue
    }
    map.set(track.itag, {
      ...track,
      url: track.url || prev.url,
      played: prev.played && !track.url
    })
  }
  return [...map.values()]
}

export function rememberPlayback(tracks: readonly YtTrack[], rawUrl: string): readonly YtTrack[] {
  const url = playbackUrl(rawUrl)
  if (!url) return tracks
  const itag = itagOf(url)
  if (!itag) return tracks
  const index = tracks.findIndex((track) => track.itag === itag)
  if (index < 0 || tracks[index].url) return tracks
  const next = tracks.slice()
  next[index] = {
    ...tracks[index],
    url,
    played: true,
    contentLength: tracks[index].contentLength || clenOf(url)
  }
  return next
}

export function downloadOffer(videoId: string, title: string, live: boolean, tracks: readonly YtTrack[]): YtOffer {
  const empty = { videoId, title, live, combinedUrl: "", videoUrl: "", audioUrl: "" }
  if (!videoId || live) return empty
  const pick = pickDownload(tracks)
  if (!pick) return empty
  if (pick.kind === "file") return { ...empty, live: false, combinedUrl: pick.url }
  return { ...empty, live: false, videoUrl: pick.videoUrl, audioUrl: pick.audioUrl }
}

export function readYtAsk(data: unknown): boolean {
  return isRecord(data) && data.source === YT_MEDIA_SOURCE && data.kind === "ask"
}

export function readYtRefresh(data: unknown): boolean {
  return isRecord(data) && data.source === YT_MEDIA_SOURCE && data.kind === "refresh"
}

export function readYtOffer(data: unknown): YtOfferMessage | null {
  if (!isRecord(data) || data.source !== YT_MEDIA_SOURCE || data.kind !== "offer") return null
  const videoId = typeof data.videoId === "string" && VIDEO_ID.test(data.videoId) ? data.videoId : ""
  if (!videoId) return null
  const combinedUrl = optionalPlayback(data.combinedUrl)
  const videoUrl = optionalPlayback(data.videoUrl)
  const audioUrl = optionalPlayback(data.audioUrl)
  if (combinedUrl == null || videoUrl == null || audioUrl == null) return null
  const live = data.live === true
  return {
    source: YT_MEDIA_SOURCE,
    kind: "offer",
    videoId,
    title: clipTitle(data.title),
    live,
    combinedUrl: live ? "" : combinedUrl,
    videoUrl: live ? "" : videoUrl,
    audioUrl: live ? "" : audioUrl
  }
}

/** Playback address, including a full-file range window. */
export function allowedFetchUrl(value: string): string | null {
  const clean = playbackUrl(value)
  if (!clean) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith("googlevideo.com")) return null
  const range = url.searchParams.get("range")
  if (!range) return clean
  if (!/^0-\d+$/.test(range)) return null
  const restored = new URL(clean)
  restored.searchParams.set("range", range)
  return restored.href
}

export function readYtFetchRequest(data: unknown): { token: string; url: string } | null {
  if (!isRecord(data) || data.source !== YT_MEDIA_SOURCE || data.kind !== "fetch") return null
  const token = typeof data.token === "string" && TOKEN.test(data.token) ? data.token : ""
  const url = typeof data.url === "string" ? allowedFetchUrl(data.url) : null
  if (!token || !url) return null
  return { token, url }
}

export function readYtFetchResult(data: unknown): { token: string; buffer: ArrayBuffer | null } | null {
  if (!isRecord(data) || data.source !== YT_MEDIA_SOURCE || data.kind !== "data") return null
  const token = typeof data.token === "string" && TOKEN.test(data.token) ? data.token : ""
  if (!token) return null
  const buffer = data.buffer instanceof ArrayBuffer && data.buffer.byteLength <= MAX_FILE_BYTES ? data.buffer : null
  return { token, buffer: data.ok === true ? buffer : null }
}

export async function assembleDownload(
  request: { combinedUrl: string; videoUrl: string; audioUrl: string },
  fetchBytes: (url: string) => Promise<Uint8Array>
): Promise<Uint8Array> {
  if (request.combinedUrl) {
    const file = await fetchBytes(request.combinedUrl)
    if (!isIsoBmff(file)) throw new Error("media")
    return file
  }
  if (!request.videoUrl || !request.audioUrl) throw new Error("media")
  const video = await fetchBytes(request.videoUrl)
  const audio = await fetchBytes(request.audioUrl)
  if (!isIsoBmff(video) || !isIsoBmff(audio)) throw new Error("media")
  return muxAvcAac(video, audio)
}

export function youtubeMediaSelfCheck(): string[] {
  const errors: string[] = []
  const watch = youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12")
  const short = youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")
  const embed = youtubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
  if (watch !== "dQw4w9WgXcQ" || short !== "dQw4w9WgXcQ" || embed !== "dQw4w9WgXcQ") errors.push("video id")
  if (youtubeVideoId("https://www.youtube.com/watch?v=short")) errors.push("bad id")
  const signed = "https://rr1.googlevideo.com/videoplayback?expire=1&itag=18&n=abc&range=0-10&rn=1&rbuf=0&mime=video%2Fmp4"
  const clean = playbackUrl(signed)
  if (!clean || clean.includes("range=") || clean.includes("rn=") || clean.includes("rbuf=")) errors.push("strip")
  if (playbackUrl("https://example.com/videoplayback?expire=1&itag=18")) errors.push("host")
  const ranged = fullRangeUrl(`${clean}&clen=20`)
  if (!ranged || !ranged.includes("range=0-19")) errors.push("full range")

  const player = parsePlayerResponse({
    videoDetails: { videoId: "dQw4w9WgXcQ", title: "Sample", isLiveContent: false },
    streamingData: {
      formats: [
        {
          itag: 18,
          mimeType: "video/mp4; codecs=\"avc1.42001E, mp4a.40.2\"",
          bitrate: 500000,
          width: 640,
          height: 360,
          contentLength: "1000",
          url: "https://rr1.googlevideo.com/videoplayback?expire=1&itag=18&sig=abc"
        }
      ],
      adaptiveFormats: [
        {
          itag: 137,
          mimeType: "video/mp4; codecs=\"avc1.640028\"",
          bitrate: 4000000,
          height: 1080,
          contentLength: "9000",
          signatureCipher: "s=secret&url=https%3A%2F%2Frr1.googlevideo.com%2Fvideoplayback"
        },
        {
          itag: 140,
          mimeType: "audio/mp4; codecs=\"mp4a.40.2\"",
          bitrate: 128000,
          contentLength: "500",
          url: "https://rr1.googlevideo.com/videoplayback?expire=1&itag=140&sig=sound"
        }
      ]
    }
  })
  if (!player || player.tracks.length !== 3 || player.tracks.find((track) => track.itag === 137)?.url) errors.push("parse")
  const playedVideo = rememberPlayback(
    player?.tracks || [],
    "https://rr1.googlevideo.com/videoplayback?expire=1&itag=137&n=played&range=0-99&mime=video%2Fmp4&clen=9000"
  )
  const played = rememberPlayback(
    playedVideo,
    "https://rr1.googlevideo.com/videoplayback?expire=1&itag=140&n=sound&range=0-9&mime=audio%2Fmp4&clen=500"
  )
  const offer = downloadOffer("dQw4w9WgXcQ", "Sample", false, played)
  if (!offer.combinedUrl.includes("itag=18")) errors.push("keep combined file")
  const pair = downloadOffer(
    "dQw4w9WgXcQ",
    "Sample",
    false,
    played.filter((track) => track.itag !== 18)
  )
  if (pair.combinedUrl || !pair.videoUrl.includes("itag=137") || !pair.audioUrl.includes("sig=sound")) errors.push("played pair")
  const onlyCombined = downloadOffer("dQw4w9WgXcQ", "Sample", false, player?.tracks || [])
  if (!onlyCombined.combinedUrl.includes("itag=18")) errors.push("combined fallback")
  const tall = downloadOffer("dQw4w9WgXcQ", "Sample", false, [
    track(399, 2160, 9_000_000, false),
    track(136, 720, 1_000_000, false),
    track(137, 1080, 4_000_000, false, 500_000_000),
    audioTrack()
  ])
  if (!tall.videoUrl.includes("itag=136")) errors.push("height cap")
  const live = parsePlayerResponse({
    videoDetails: { videoId: "dQw4w9WgXcQ", title: "Live", isLiveContent: true },
    streamingData: { hlsManifestUrl: "https://example.com/live.m3u8" }
  })
  if (!live?.live || downloadOffer(live.videoId, live.title, live.live, live.tracks).combinedUrl) errors.push("live")
  const bareLive = parsePlayerResponse({
    videoDetails: { videoId: "dQw4w9WgXcQ", title: "Live", isLiveContent: true }
  })
  if (!bareLive?.live || bareLive.tracks.length) errors.push("bare live")
  const message = readYtOffer({
    source: YT_MEDIA_SOURCE,
    kind: "offer",
    videoId: "dQw4w9WgXcQ",
    title: "Sample",
    live: false,
    combinedUrl: "javascript:alert(1)",
    videoUrl: "",
    audioUrl: ""
  })
  if (message) errors.push("reject bad url")
  return errors
}

function pickDownload(tracks: readonly YtTrack[]): { kind: "file"; url: string } | { kind: "pair"; videoUrl: string; audioUrl: string } | null {
  const files = tracks.filter((track) => track.url && track.muxed && track.hasVideo && track.hasAudio && track.mime === "video/mp4")
  const videos = videoChoices(tracks.filter((track) => track.url && !track.muxed))
  const audios = tracks.filter((track) => track.url && !track.muxed && isAac(track))
  const playedFile = bestFile(files.filter((track) => track.played))
  if (playedFile) return { kind: "file", url: playedFile.url }
  const playedVideo = bestVideo(videos.filter((track) => track.played))
  const playedAudio = bestAudio(audios.filter((track) => track.played))
  if (playedVideo && playedAudio) return { kind: "pair", videoUrl: playedVideo.url, audioUrl: playedAudio.url }
  const file = bestFile(files)
  if (file) return { kind: "file", url: file.url }
  const video = bestVideo(videos)
  const audio = bestAudio(audios)
  if (video && audio) return { kind: "pair", videoUrl: video.url, audioUrl: audio.url }
  return null
}

function videoChoices(tracks: readonly YtTrack[]): YtTrack[] {
  const avc = tracks.filter((track) => isAvc(track))
  const capped = avc.filter((track) => track.height > 0 && track.height <= MAX_HEIGHT)
  if (capped.length) return capped
  return avc.filter((track) => track.height <= 0)
}

function bestFile(tracks: readonly YtTrack[]): YtTrack | null {
  return bestSized(tracks, (track) => track.height * 1_000_000 + track.bitrate, MAX_FILE_BYTES)
}

function bestVideo(tracks: readonly YtTrack[]): YtTrack | null {
  return bestSized(tracks, (track) => track.height * 1_000_000 + track.fps * 1_000 + track.bitrate, MAX_VIDEO_BYTES)
}

function bestAudio(tracks: readonly YtTrack[]): YtTrack | null {
  return bestSized(tracks, (track) => track.bitrate || (track.itag === 140 ? 128000 : 64000), MAX_AUDIO_BYTES)
}

function bestSized(tracks: readonly YtTrack[], score: (track: YtTrack) => number, maxBytes: number): YtTrack | null {
  if (!tracks.length) return null
  const fitting = tracks.filter((track) => track.contentLength <= 0 || track.contentLength <= maxBytes)
  const pool = fitting.length ? fitting : [...tracks].sort((left, right) => left.contentLength - right.contentLength).slice(0, 1)
  return pool.slice().sort((left, right) => score(right) - score(left))[0] || null
}

function parseFormat(value: unknown, fromFormats: boolean): YtTrack | null {
  if (!isRecord(value)) return null
  const itag = numberOf(value.itag)
  if (!itag) return null
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : ""
  const split = mimeType.match(/^([^;]+);\s*codecs="([^"]*)"/i)
  const mime = (split?.[1] || mimeType.split(";")[0] || "").trim().toLowerCase()
  const codecs = (split?.[2] || "").trim().toLowerCase()
  const hasVideo = mime.startsWith("video/") || /avc1|avc3|vp9|vp09|av01/.test(codecs)
  const hasAudio = mime.startsWith("audio/") || /mp4a|opus|vorbis/.test(codecs)
  if (!hasVideo && !hasAudio) return null
  const height = numberOf(value.height) || heightLabel(value.qualityLabel) || AVC_HEIGHT[itag] || 0
  const width = numberOf(value.width)
  return {
    itag,
    url: typeof value.url === "string" ? playbackUrl(value.url) || "" : "",
    mime,
    codecs,
    width,
    height,
    bitrate: numberOf(value.bitrate) || numberOf(value.averageBitrate),
    fps: numberOf(value.fps),
    contentLength: numberOf(value.contentLength),
    hasVideo,
    hasAudio,
    muxed: fromFormats || (hasVideo && hasAudio),
    played: false
  }
}

function track(itag: number, height: number, bitrate: number, played: boolean, contentLength = 1000): YtTrack {
  return {
    itag,
    url: `https://rr1.googlevideo.com/videoplayback?expire=1&itag=${itag}&sig=v`,
    mime: "video/mp4",
    codecs: "avc1",
    width: 0,
    height,
    bitrate,
    fps: 30,
    contentLength,
    hasVideo: true,
    hasAudio: false,
    muxed: false,
    played
  }
}

function audioTrack(): YtTrack {
  return {
    itag: 140,
    url: "https://rr1.googlevideo.com/videoplayback?expire=1&itag=140&sig=a",
    mime: "audio/mp4",
    codecs: "mp4a.40.2",
    width: 0,
    height: 0,
    bitrate: 128000,
    fps: 0,
    contentLength: 500,
    hasVideo: false,
    hasAudio: true,
    muxed: false,
    played: true
  }
}

function isAvc(track: YtTrack): boolean {
  if (track.mime !== "video/mp4" || track.hasAudio) return false
  if (track.codecs.includes("avc1") || track.codecs.includes("avc3")) return true
  return !track.codecs && AVC_ITAGS.has(track.itag)
}

function isAac(track: YtTrack): boolean {
  if (track.mime !== "audio/mp4" || track.hasVideo) return false
  if (track.codecs.includes("mp4a")) return true
  return !track.codecs && AAC_ITAGS.has(track.itag)
}

function itagOf(url: string): number {
  try {
    const itag = Number(new URL(url).searchParams.get("itag") || "")
    return Number.isInteger(itag) && itag > 0 ? itag : 0
  } catch {
    return 0
  }
}

function clenOf(url: string): number {
  try {
    return numberOf(new URL(url).searchParams.get("clen"))
  } catch {
    return 0
  }
}

function heightLabel(value: unknown): number {
  if (typeof value !== "string") return 0
  const match = value.match(/(\d{3,4})p/i)
  return match ? Number(match[1]) : 0
}

function numberOf(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

function clipTitle(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim().slice(0, 140)
}

function optionalPlayback(value: unknown): string | null {
  if (typeof value !== "string" || !value) return ""
  return playbackUrl(value)
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

function hasLiveStream(record: Record<string, unknown>): boolean {
  const play = record.playabilityStatus
  if (!play || typeof play !== "object" || Array.isArray(play)) return false
  return Boolean((play as Record<string, unknown>).liveStreamability)
}

function sliceJsonObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null
  let depth = 0
  let inString = false
  let escape = false
  for (let index = start; index < text.length && index < start + 8_000_000; index += 1) {
    const char = text[index]
    if (inString) {
      if (escape) escape = false
      else if (char === "\\") escape = true
      else if (char === "\"") inString = false
      continue
    }
    if (char === "\"") inString = true
    else if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}
