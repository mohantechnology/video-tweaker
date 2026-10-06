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

function scoreVideo(video: HTMLVideoElement): number {
  if (video.videoWidth === 0 && video.readyState < 2) return 0

  // Stretch and zoom change the painted box, not the layout box. Scoring the
  // painted box made a small aspect ratio look like the video had disappeared.
  const size = laidOutSize(video)
  if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) return 0

  const rect = video.getBoundingClientRect()
  if (rect.bottom < 0 || rect.top > window.innerHeight) return 0
  if (rect.right < 0 || rect.left > window.innerWidth) return 0

  const style = getComputedStyle(video)
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
