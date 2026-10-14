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
import { isHoldBoosting, maintainHold, releaseHold, startHoldSpeed } from "./hold-speed"
import { setNativeMirrorSuspended } from "./native-mirror"
import { createProgressTracker } from "./progress"
import { startSeekBar, suppressDockMedia, type DockControl, type DockMedia } from "./seek-bar"
import { applySkipMethods, isSkipBoosted, releaseSkipBoost, skipSpeedOwnsRate } from "./skip-ads"
import { dockLayoutStamp, type EffectSettings } from "./types"

/** How often to rescan while a main video is already selected. */
const PRESENT_POLL_MS = 700

export const HOST_ID = "vee-csui"

let activeVideo: HTMLVideoElement | null = null
let hostParked = false
let parkedHost: HTMLElement | null = null
let dockHost: HTMLElement | null = null

function extensionHost(): HTMLElement | null {
  const found = document.getElementById(HOST_ID)
  if (found instanceof HTMLElement) {
    dockHost = found
    return found
  }
  return dockHost
}

export function parkExtensionHost(): void {
  hostParked = true
  const host = extensionHost()
  if (!host) return
  dockHost = host
  parkedHost = host
  if (host.isConnected) host.remove()
}

export function restoreExtensionHost(): void {
  hostParked = false
  const host = extensionHost()
  parkedHost = null
  if (!host) return
  dockHost = host
  if (!host.isConnected) document.documentElement.appendChild(host)
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
    settings.showNativeControls,
    settings.dockEnabled,
    settings.dockProgress,
    dockLayoutStamp(settings.dockLayout),
    settings.dockPlay,
    settings.dockTime,
    settings.dockVolume,
    settings.dockSpeed,
    settings.dockLoop,
    settings.dockPip,
    settings.dockFullscreen,
    settings.dockDownload,
    settings.dockQuality,
    settings.dockSkip
  ].join("|")
}

function placeDock(video: HTMLVideoElement | null): void {
  if (hostParked) return
  const host = extensionHost()
  if (!host) return
  host.style.pointerEvents = "none"
  const fullscreen = document.fullscreenElement
  const parent =
    fullscreen instanceof HTMLElement &&
    video &&
    fullscreen !== video &&
    fullscreen.contains(video)
      ? fullscreen
      : document.documentElement
  if (host.parentElement !== parent) parent.appendChild(host)

  const dock = host.shadowRoot?.querySelector(".vee-dock") as HTMLElement | null
  if (!dock) return

  dock.style.display = "flex"
  dock.style.right = "auto"
  dock.style.top = "auto"
}

export function startVideoBridge(options: {
  getSettings: () => EffectSettings
  /** Panel values, including ones a disabled section would otherwise hide. */
  getUiSettings?: () => EffectSettings
  isAllowed?: () => boolean
  onPresence: (present: boolean) => void
  onVideo?: (video: HTMLVideoElement | null) => void
  /** Called before playback is written, so a new clip can drop tab-only choices. */
  onClip?: () => void
  onControl?: (control: DockControl) => void
  onMedia?: (media: DockMedia) => void
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
  const seekBar = startSeekBar({
    getSettings: options.getSettings,
    getUiSettings: options.getUiSettings,
    onControl: options.onControl,
    onMedia: options.onMedia,
    rateSource: (video) => {
      if (isHoldBoosting(video)) return "hold"
      if (isSkipBoosted(video)) return "ignore"
      return "live"
    }
  })
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
      if (!stopped) {
        placeDock(activeVideo)
        seekBar.place(activeVideo)
      }
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
    if (allowed) options.onClip?.()
    const settings = options.getSettings()
    // Write speed, loop, and loudness before the bar reads the video.
    // Otherwise the bar copies the old loop back into the domain settings.
    if (next && allowed) {
      const nextStamp = playbackStamp(settings)
      if (nextStamp !== stamp) {
        // Hold and ad boost write the video element themselves. Mirroring that
        // rate into the site menu would fight the boost.
        setNativeMirrorSuspended(isHoldBoosting(next) || skipSpeedOwnsRate(next, roots, settings, true))
        try {
          // Our write fires volume and rate events. Don't adopt those as player edits.
          suppressDockMedia()
          applyPlayback(next, settings)
        } finally {
          setNativeMirrorSuspended(false)
        }
        stamp = nextStamp
      }
    }
    seekBar.sync(allowed ? next : null)
    progress.setTracking(allowed)
    if (!allowed) {
      releaseSkipBoost(next, settings)
      progress.follow(null)
      return
    }
    progress.follow(next)
    if (next) {
      applyVisual(next, settings)
      applyNativeControls(next, settings)
    }
    applySkipMethods({ video: next, roots, settings, allowed: true })
    maintainHold(next)
  }

  const applyNow = () => {
    if (stopped) return
    stamp = ""
    sync()
  }

  const onFullscreenPlace = () => {
    if (stopped || hostParked) return
    placeDock(activeVideo)
  }

  rootObserver = new MutationObserver(() => schedule())
  observeRoot(document)

  document.addEventListener("fullscreenchange", onFullscreenPlace, true)
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
      document.removeEventListener("fullscreenchange", onFullscreenPlace, true)
      document.removeEventListener("fullscreenchange", schedule)
      document.removeEventListener("scroll", schedulePlace, true)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("yt-navigate-finish", schedule)
      document.removeEventListener("visibilitychange", schedule)
      progress.stop()
      seekBar.stop()
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
