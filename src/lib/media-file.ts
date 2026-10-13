/** Save a video the page already exposes as a normal file address. */

export const DOWNLOAD_MESSAGE = "VEE_DOWNLOAD"
export const SAVE_BYTES_MESSAGE = "VEE_SAVE_BYTES"

const MEDIA_EXTENSIONS = ["mp4", "webm", "mkv", "mov", "m4v", "ogv", "ogg"] as const

/** Http or https file address. Playlists and non-file schemes are not a video file. */
export function fileUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const path = url.pathname.toLowerCase()
  if (path.endsWith(".m3u8") || path.endsWith(".mpd")) return null
  return url.href
}

/** Direct file on the element. Encrypted players and blob streams have none. */
export function directMediaUrl(video: HTMLVideoElement | null): string | null {
  if (!video) return null
  try {
    if (video.mediaKeys) return null
  } catch {
    return null
  }
  return fileUrl(video.currentSrc || video.src || "")
}

export function mediaPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function mediaExtension(url: string): string {
  const path = mediaPath(url).toLowerCase()
  const match = path.match(/\.([a-z0-9]{2,4})$/)
  if (match && (MEDIA_EXTENSIONS as readonly string[]).includes(match[1])) return match[1]
  return "mp4"
}

/** Title plus a file extension chrome.downloads will accept. */
export function downloadFilename(title: string, file: string): string {
  let base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s.'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!base) base = "video"
  if (base.length > 80) base = base.slice(0, 80).trim()
  return `${base || "video"}.${mediaExtension(file)}`
}
