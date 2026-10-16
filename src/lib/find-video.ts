import { QUALITY_MARK } from "./renditions"

const MIN_WIDTH = 280
const MIN_HEIGHT = 150

export type PageScan = {
  videos: HTMLVideoElement[]
  roots: ParentNode[]
}

export function scanPage(): PageScan {
  const videos: HTMLVideoElement[] = []
  const roots: ParentNode[] = []
  const seen = new Set<ParentNode>()

  const walk = (root: ParentNode) => {
    if (seen.has(root)) return
    seen.add(root)
    roots.push(root)

    root.querySelectorAll("video").forEach((node) => {
      videos.push(node as HTMLVideoElement)
    })

    root.querySelectorAll("*").forEach((node) => {
      const shadow = (node as Element).shadowRoot
      if (shadow) walk(shadow)
    })
  }

  walk(document)
  return { videos, roots }
}

function laidOutSize(video: HTMLVideoElement): { width: number; height: number } {
  const width = video.offsetWidth || video.clientWidth
  const height = video.offsetHeight || video.clientHeight
  if (width > 0 && height > 0) return { width, height }
  const rect = video.getBoundingClientRect()
  return { width: rect.width, height: rect.height }
}

function originAxis(token: string | undefined, size: number): number {
  if (!token || token === "center") return size / 2
  if (token === "left" || token === "top") return 0
  if (token === "right" || token === "bottom") return size
  if (token.endsWith("%")) return (Number.parseFloat(token) / 100) * size
  const value = Number.parseFloat(token)
  return Number.isFinite(value) ? value : size / 2
}

/**
 * Viewport box of the video's layout, ignoring its own CSS transform.
 * Pan, zoom, and rotate move getBoundingClientRect(). Once that painted box
 * leaves the viewport the finder used to drop the video, clear the transform,
 * and apply it again on the next pass.
 */
function layoutViewportBox(
  video: HTMLVideoElement,
  width: number,
  height: number,
  style: CSSStyleDeclaration
): {
  left: number
  top: number
  right: number
  bottom: number
} {
  const painted = video.getBoundingClientRect()
  const transform = style.transform
  if (!transform || transform === "none") {
    return {
      left: painted.left,
      top: painted.top,
      right: painted.left + width,
      bottom: painted.top + height
    }
  }

  const [originX, originY] = style.transformOrigin.split(/\s+/)
  const origin = {
    x: originAxis(originX, width),
    y: originAxis(originY, height)
  }
  const matrix = new DOMMatrix(transform)
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ]
  let minX = Infinity
  let minY = Infinity
  for (const corner of corners) {
    const point = matrix.transformPoint(new DOMPoint(corner.x - origin.x, corner.y - origin.y))
    minX = Math.min(minX, origin.x + point.x)
    minY = Math.min(minY, origin.y + point.y)
  }

  const left = painted.left - minX
  const top = painted.top - minY
  return { left, top, right: left + width, bottom: top + height }
}

function scoreVideo(video: HTMLVideoElement): number {
  // A resolution swap empties the element for a moment. Dropping it then ends the swap and its soundtrack.
  if (video.videoWidth === 0 && video.readyState < 2 && !video.hasAttribute(QUALITY_MARK)) return 0

  // Stretch, zoom, and pan change the painted box, not the layout box.
  const size = laidOutSize(video)
  if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) return 0

  const style = getComputedStyle(video)
  const rect = layoutViewportBox(video, size.width, size.height, style)
  if (rect.bottom < 0 || rect.top > window.innerHeight) return 0
  if (rect.right < 0 || rect.left > window.innerWidth) return 0

  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  ) {
    return 0
  }

  let score = size.width * size.height
  if (!video.paused && !video.ended && video.readyState >= 2) score *= 2.4

  const fullscreen = document.fullscreenElement
  if (fullscreen && (fullscreen === video || fullscreen.contains(video))) {
    score *= 3
  }

  return score
}

export type ViewportBox = {
  left: number
  top: number
  width: number
  height: number
}

/** Painted box of the video, including zoom and pan. Capture samples this, not the layout box. */
export function paintedVideoBox(video: HTMLVideoElement): ViewportBox | null {
  if (document.pictureInPictureElement === video) return null
  const rect = video.getBoundingClientRect()
  if (rect.width < 32 || rect.height < 32) return null
  if (rect.bottom <= 0 || rect.right <= 0) return null
  if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return null
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

export function findMainVideo(videos: HTMLVideoElement[]): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null
  let bestScore = 0

  for (const video of videos) {
    const score = scoreVideo(video)
    if (score > bestScore) {
      best = video
      bestScore = score
    }
  }

  return best
}
