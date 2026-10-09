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

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
}

/** Standard and WebKit fullscreen. Dailymotion fullscreens `document.body`. */
function activeFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

/**
 * The fullscreen node when it contains the video and is not the video itself.
 * A fullscreen `<video>` is the top layer; the host stays on the document.
 */
function dockParent(video: HTMLVideoElement | null): HTMLElement {
  const fullscreen = activeFullscreenElement()
  if (
    fullscreen instanceof HTMLElement &&
    video &&
    fullscreen !== video &&
    fullscreen.contains(video)
  ) {
    return fullscreen
  }
  return document.documentElement
}

/** The host is the page's stacking box. A shadow child with z-index auto paints under the player. */
function raiseExtensionHost(host: HTMLElement): void {
  const inFrame = window.top !== window
  const set = (property: string, value: string) => host.style.setProperty(property, value, "important")
  set("position", "fixed")
  set("z-index", "2147483647")
  set("overflow", "visible")
  set("pointer-events", "none")
  set("top", "0")
  set("right", "auto")
  set("bottom", "auto")
  set("left", "0")
  // A zero-size host inside Dailymotion's player is clipped, so the dock never appears.
  if (inFrame) {
    set("width", "100%")
    set("height", "100%")
  } else {
    set("width", "0")
    set("height", "0")
  }
}

function placeDock(video: HTMLVideoElement | null): void {
  if (hostParked) return
  const host = document.getElementById(HOST_ID)
  if (host) {
    raiseExtensionHost(host)
    const parent = dockParent(video)
    if (host.parentElement !== parent || parent.lastElementChild !== host) parent.appendChild(host)
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

  const sync = () => {
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
  document.addEventListener("webkitfullscreenchange", schedule)
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
      if (stopped) return
      stopped = true
      window.clearTimeout(queued)
      window.clearInterval(interval)
      rootObserver?.disconnect()
      styleObserver?.disconnect()
      rootObserver = null
      styleObserver = null
      document.removeEventListener("fullscreenchange", schedule)
      document.removeEventListener("webkitfullscreenchange", schedule)
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
