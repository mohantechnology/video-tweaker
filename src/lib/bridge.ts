import {
  applyNativeControls,
  applyPlayback,
  applyVisual,
  clearNativeControls,
  clearVisual,
  visualWritesLocked
} from "./effects"
import { findMainVideo, scanPage } from "./find-video"
import { createProgressTracker } from "./progress"
import type { EffectSettings } from "./types"

export const HOST_ID = "vee-csui"

let activeVideo: HTMLVideoElement | null = null

export function getActiveVideo(): HTMLVideoElement | null {
  return activeVideo
}

export type VideoBridge = {
  poke: () => void
  applyNow: () => void
  stop: () => void
}

function playbackStamp(settings: EffectSettings): string {
  return [
    settings.enabled,
    settings.playbackTouched,
    settings.playbackRate,
    settings.preservePitch,
    settings.volume,
    settings.muted,
    settings.loop,
    settings.audioEnabled,
    settings.playbackEnabled,
    settings.showNativeControls
  ].join("|")
}

function placeDock(video: HTMLVideoElement | null): void {
  const host = document.getElementById(HOST_ID)
  if (host) {
    host.style.pointerEvents = "none"
    const fullscreen = document.fullscreenElement
    const parent =
      fullscreen &&
      video &&
      fullscreen !== video &&
      fullscreen.contains(video)
        ? fullscreen
        : document.documentElement
    if (host.parentElement !== parent) parent.appendChild(host)
  }

  const dock = host?.shadowRoot?.querySelector(".vee-dock") as HTMLElement | null
  if (!dock) return

  if (!video) {
    dock.style.display = "none"
    return
  }

  dock.style.display = "flex"
  dock.style.right = "auto"
  dock.style.top = "auto"
}

export function startVideoBridge(options: {
  getSettings: () => EffectSettings
  onPresence: (present: boolean) => void
  onVideo?: (video: HTMLVideoElement | null) => void
}): VideoBridge {
  let current: HTMLVideoElement | null = null
  let present = false
  let stamp = ""
  let stopped = false
  let queued = 0
  let placeQueued = false
  const observedRoots = new Set<Node>()
  const boundVideos = new WeakSet<HTMLVideoElement>()
  let rootObserver: MutationObserver | null = null
  let styleObserver: MutationObserver | null = null
  let interval = 0
  const progress = createProgressTracker(options.getSettings)

  const schedule = () => {
    if (stopped) return
    window.clearTimeout(queued)
    queued = window.setTimeout(sync, 180)
  }

  const schedulePlace = () => {
    if (stopped || placeQueued) return
    placeQueued = true
    requestAnimationFrame(() => {
      placeQueued = false
      if (!stopped) placeDock(activeVideo)
    })
  }

  const forcePlayback = () => {
    stamp = ""
    schedule()
  }

  const bindVideo = (video: HTMLVideoElement) => {
    if (boundVideos.has(video)) return
    boundVideos.add(video)
    video.addEventListener("play", forcePlayback)
    video.addEventListener("loadeddata", schedule)
    video.addEventListener("emptied", schedule)
  }

  const watchStyle = (video: HTMLVideoElement) => {
    styleObserver?.disconnect()
    styleObserver = new MutationObserver(() => {
      if (stopped || current !== video) return
      const settings = options.getSettings()
      if (!visualWritesLocked()) applyVisual(video, settings)
      applyNativeControls(video, settings)
    })
    styleObserver.observe(video, {
      attributes: true,
      attributeFilter: ["style"]
    })
  }

  const observeRoot = (root: ParentNode) => {
    if (observedRoots.has(root) || !rootObserver) return
    observedRoots.add(root)
    rootObserver.observe(root, { childList: true, subtree: true })
  }

  const sync = () => {
    if (stopped) return
    const { videos, roots } = scanPage()
    for (const root of roots) observeRoot(root)
    for (const video of videos) bindVideo(video)

    const next = document.hidden ? current : findMainVideo(videos)
    if (current && current !== next) {
      clearVisual(current)
      clearNativeControls(current)
    }

    if (next !== current) {
      current = next
      activeVideo = next
      stamp = ""
      if (next) watchStyle(next)
      else styleObserver?.disconnect()
      options.onVideo?.(next)
    }

    const now = !!next
    if (now !== present) {
      present = now
      options.onPresence(now)
    }

    placeDock(next)
    progress.follow(next)
    if (!next) return

    const settings = options.getSettings()
    applyVisual(next, settings)
    applyNativeControls(next, settings)
    const nextStamp = playbackStamp(settings)
    if (nextStamp !== stamp) {
      applyPlayback(next, settings)
      stamp = nextStamp
    }
  }

  const applyNow = () => {
    if (stopped) return
    stamp = ""
    sync()
  }

  rootObserver = new MutationObserver(() => schedule())
  observeRoot(document)

  document.addEventListener("fullscreenchange", schedule)
  document.addEventListener("scroll", schedulePlace, true)
  window.addEventListener("resize", schedule)
  window.addEventListener("yt-navigate-finish", schedule)
  document.addEventListener("visibilitychange", schedule)

  interval = window.setInterval(() => {
    if (!document.hidden) sync()
  }, 700)

  sync()

  return {
    poke: forcePlayback,
    applyNow,
    stop() {
      stopped = true
      window.clearTimeout(queued)
      window.clearInterval(interval)
      rootObserver?.disconnect()
      styleObserver?.disconnect()
      document.removeEventListener("fullscreenchange", schedule)
      document.removeEventListener("scroll", schedulePlace, true)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("yt-navigate-finish", schedule)
      document.removeEventListener("visibilitychange", schedule)
      progress.stop()
      if (current) {
        clearVisual(current)
        clearNativeControls(current)
      }
      current = null
      activeVideo = null
      present = false
    }
  }
}

export function repositionDock(): void {
  placeDock(activeVideo)
}
