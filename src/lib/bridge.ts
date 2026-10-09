import { VIDEO_DETECT_INTERVAL_MS } from "../settings"
import {
  applyNativeControls,
  applyPlayback,
  applyVisual,
  clearNativeControls,
  clearVisual,
  releasePlayback,
  visualWritesLocked
} from "./effects"
import { findMainVideo, scanPage } from "./find-video"
import { maintainHold, releaseHold, startHoldSpeed } from "./hold-speed"
import { createProgressTracker } from "./progress"
import { applySkipMethods, isSkipBoosted, releaseSkipBoost } from "./skip-ads"
import type { EffectSettings } from "./types"

/** How often to rescan while a main video is already selected. */
const PRESENT_POLL_MS = 700

export const HOST_ID = "vee-csui"

let activeVideo: HTMLVideoElement | null = null
let hostParked = false
let parkedHost: HTMLElement | null = null

export function parkExtensionHost(): void {
  hostParked = true
  const host = parkedHost ?? document.getElementById(HOST_ID)
  if (!(host instanceof HTMLElement)) return
  parkedHost = host
  if (host.isConnected) host.remove()
}

export function restoreExtensionHost(): void {
  hostParked = false
  const host = parkedHost ?? document.getElementById(HOST_ID)
  parkedHost = null
  if (!(host instanceof HTMLElement) || host.isConnected) return
  document.documentElement.appendChild(host)
}

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
    settings.audioTouched,
    settings.basicAudioOn,
    settings.audioEnabled,
    settings.playbackEnabled,
    settings.showNativeControls
  ].join("|")
}

function placeDock(video: HTMLVideoElement | null): void {
  if (hostParked) return
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

  dock.style.display = "flex"
  dock.style.right = "auto"
  dock.style.top = "auto"
}

export function startVideoBridge(options: {
  getSettings: () => EffectSettings
  isAllowed?: () => boolean
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
  let pollHasVideo = false
  const progress = createProgressTracker(options.getSettings)
  const hold = startHoldSpeed({
    getSettings: options.getSettings,
    isAllowed: () => options.isAllowed?.() !== false,
    isAdBoosted: isSkipBoosted,
    restoreOwned: (video) => applyPlayback(video, options.getSettings())
  })

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

  let sync!: () => void

  const armPoll = (hasVideo: boolean) => {
    if (interval !== 0 && pollHasVideo === hasVideo) return
    pollHasVideo = hasVideo
    window.clearInterval(interval)
    interval = window.setInterval(() => {
      if (!document.hidden) sync()
    }, hasVideo ? PRESENT_POLL_MS : VIDEO_DETECT_INTERVAL_MS)
  }

  sync = () => {
    if (stopped) return
    const { videos, roots } = scanPage()
    for (const root of roots) observeRoot(root)
    for (const video of videos) bindVideo(video)

    const next = document.hidden ? current : findMainVideo(videos)
    const allowed = options.isAllowed?.() !== false
    if (current && current !== next) {
      releaseHold(current)
      clearVisual(current)
      clearNativeControls(current)
      releaseSkipBoost(current, options.getSettings())
    }
    if (!allowed) releaseHold(null)
    if (current && !allowed) {
      clearVisual(current)
      clearNativeControls(current)
      releasePlayback(current)
    }

    if (next !== current) {
      current = next
      activeVideo = next
      stamp = ""
      styleObserver?.disconnect()
      styleObserver = null
      if (next && allowed) watchStyle(next)
      if (allowed) options.onVideo?.(next)
    } else if (!allowed) {
      styleObserver?.disconnect()
      styleObserver = null
    } else if (next && !styleObserver) {
      watchStyle(next)
    }

    const now = !!next
    if (now !== present) {
      present = now
      options.onPresence(now)
      armPoll(now)
    }

    placeDock(next)
    progress.setTracking(allowed)
    const settings = options.getSettings()
    if (!allowed) {
      releaseSkipBoost(next, settings)
      progress.follow(null)
      return
    }
    progress.follow(next)
    if (next) {
      applyVisual(next, settings)
      applyNativeControls(next, settings)
      const nextStamp = playbackStamp(settings)
      if (nextStamp !== stamp) {
        applyPlayback(next, settings)
        stamp = nextStamp
      }
    }
    applySkipMethods({ video: next, roots, settings, allowed: true })
    maintainHold(next)
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

  armPoll(false)
  sync()

  return {
    poke: forcePlayback,
    applyNow,
    stop() {
      if (stopped) return
      stopped = true
      window.clearTimeout(queued)
      window.clearInterval(interval)
      rootObserver?.disconnect()
      styleObserver?.disconnect()
      rootObserver = null
      styleObserver = null
      document.removeEventListener("fullscreenchange", schedule)
      document.removeEventListener("scroll", schedulePlace, true)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("yt-navigate-finish", schedule)
      document.removeEventListener("visibilitychange", schedule)
      progress.stop()
      hold.stop()
      const settings = options.getSettings()
      applySkipMethods({ video: null, roots: [], settings, allowed: false })
      const videos = new Set(scanPage().videos)
      if (current) videos.add(current)
      for (const video of videos) {
        clearVisual(video)
        clearNativeControls(video)
        releasePlayback(video)
        releaseSkipBoost(video, settings)
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
