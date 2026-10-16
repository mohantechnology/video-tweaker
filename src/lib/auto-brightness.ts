import { AUTO_BRIGHTNESS_SAMPLE_MS } from "../settings"
import { applyVisual, getLiveBrightness, setLiveBrightness } from "./effects"
import { paintedVideoBox, type ViewportBox } from "./find-video"
import {
  BLACK_STREAK,
  FRAME_SAMPLE_MESSAGE,
  HISTOGRAM_BINS,
  nextAutoBrightness,
  type HistogramBins
} from "./luminance"
import type { EffectSettings } from "./types"

export const HISTOGRAM_WIDTH = 140
export const HISTOGRAM_HEIGHT = 72
export const HISTOGRAM_INSET = 8

const CENTER_INSET = 0.2

export type AutoBrightnessReadout = {
  live: number | null
  blocked: boolean
  bins: HistogramBins | null
}

export const EMPTY_BRIGHTNESS_READOUT: AutoBrightnessReadout = {
  live: null,
  blocked: false,
  bins: null
}

type SampleRect = {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}

type SampleResponse =
  | { ok: true; luma: number; bins: HistogramBins; black: boolean }
  | { ok: false }

function isPlaying(video: HTMLVideoElement): boolean {
  return !video.paused && !video.ended && video.readyState >= 2
}

function adjusts(settings: EffectSettings): boolean {
  return settings.autoBrightness && settings.enabled && settings.videoEnabled !== false
}

/** Center of the picture, keeping the histogram corner out of the sample. */
export function centerSample(box: ViewportBox): { x: number; y: number; width: number; height: number } | null {
  const insetX = box.width * CENTER_INSET
  const insetY = box.height * CENTER_INSET
  let x = box.left + insetX
  let y = box.top + insetY
  let width = box.width - insetX * 2
  let height = box.height - insetY * 2
  const histLeft = box.left + box.width - HISTOGRAM_INSET - HISTOGRAM_WIDTH
  const histBottom = box.top + HISTOGRAM_INSET + HISTOGRAM_HEIGHT
  if (y < histBottom && x + width > histLeft) {
    const below = histBottom + 4
    const bottom = box.top + box.height - insetY
    if (bottom - below >= 36) {
      y = below
      height = bottom - below
    } else {
      width = histLeft - 4 - x
    }
  }
  if (width < 16 || height < 16) return null
  return { x, y, width, height }
}

function clipSample(
  rect: { x: number; y: number; width: number; height: number } | null
): SampleRect | null {
  if (!rect) return null
  const left = Math.max(0, rect.x)
  const top = Math.max(0, rect.y)
  const right = Math.min(window.innerWidth, rect.x + rect.width)
  const bottom = Math.min(window.innerHeight, rect.y + rect.height)
  const width = right - left
  const height = bottom - top
  if (width < 16 || height < 16) return null
  return {
    x: left,
    y: top,
    width,
    height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  }
}

function isBins(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === HISTOGRAM_BINS &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  )
}

function readResponse(value: unknown): SampleResponse {
  if (!value || typeof value !== "object") return { ok: false }
  const raw = value as Record<string, unknown>
  if (raw.ok !== true || !Number.isFinite(Number(raw.luma))) return { ok: false }
  if (!raw.bins || typeof raw.bins !== "object") return { ok: false }
  const bins = raw.bins as Record<string, unknown>
  if (!isBins(bins.r) || !isBins(bins.g) || !isBins(bins.b)) return { ok: false }
  return {
    ok: true,
    luma: Number(raw.luma),
    black: raw.black === true,
    bins: { r: bins.r, g: bins.g, b: bins.b }
  }
}

async function requestSample(rect: SampleRect): Promise<SampleResponse> {
  const response: unknown = await chrome.runtime.sendMessage({
    type: FRAME_SAMPLE_MESSAGE,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    viewportWidth: rect.viewportWidth,
    viewportHeight: rect.viewportHeight
  })
  return readResponse(response)
}

export function startAutoBrightness(options: {
  getSettings: () => EffectSettings
  getVideo: () => HTMLVideoElement | null
  onSample: (readout: AutoBrightnessReadout) => void
}): { stop: () => void; poke: () => void } {
  if (window.top !== window) return { stop() {}, poke() {} }

  let stopped = false
  let busy = false
  let queued = false
  let announced = false
  let blocked = false
  let blackStreak = 0
  let watched: HTMLVideoElement | null = null
  let bound: HTMLVideoElement | null = null
  let lastRequest = 0

  const onSeeked = () => {
    void sample()
  }

  const bind = (video: HTMLVideoElement | null) => {
    if (bound === video) return
    if (bound) bound.removeEventListener("seeked", onSeeked)
    bound = video
    if (bound) bound.addEventListener("seeked", onSeeked)
  }

  const release = (settings: EffectSettings) => {
    if (!announced && getLiveBrightness() == null) return
    announced = false
    blocked = false
    blackStreak = 0
    const hadLive = getLiveBrightness() != null
    setLiveBrightness(null)
    if (hadLive) {
      const video = options.getVideo()
      if (video) applyVisual(video, settings)
    }
    options.onSample(EMPTY_BRIGHTNESS_READOUT)
  }

  const waitTurn = async () => {
    const gap = Math.max(500, Math.floor(AUTO_BRIGHTNESS_SAMPLE_MS / 2))
    const delay = lastRequest + gap - Date.now()
    if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay))
  }

  const sample = async () => {
    if (stopped || document.hidden) return
    if (busy) {
      queued = true
      return
    }
    busy = true
    try {
      const settings = options.getSettings()
      if (!adjusts(settings)) {
        release(settings)
        return
      }
      const video = options.getVideo()
      bind(video)
      if (!video || video.readyState < 2 || video.videoWidth === 0) return
      if (video !== watched) {
        watched = video
        blackStreak = 0
        blocked = false
        setLiveBrightness(null)
        applyVisual(video, settings)
      }
      const box = paintedVideoBox(video)
      const rect = box ? clipSample(centerSample(box)) : null
      if (!rect) return
      announced = true
      await waitTurn()
      if (stopped || document.hidden) return
      const afterWait = options.getSettings()
      if (!adjusts(afterWait)) {
        release(afterWait)
        return
      }
      lastRequest = Date.now()
      const response = await requestSample(rect)
      if (stopped || document.hidden) return
      const latest = options.getSettings()
      if (!adjusts(latest)) {
        release(latest)
        return
      }
      const current = options.getVideo()
      if (current !== video) {
        setLiveBrightness(null)
        if (current) applyVisual(current, latest)
        return
      }
      if (!response.ok) return
      if (response.black) {
        if (isPlaying(video)) {
          blackStreak += 1
          if (blackStreak >= BLACK_STREAK) blocked = true
        }
        options.onSample({ live: getLiveBrightness(), blocked, bins: response.bins })
        return
      }
      blackStreak = 0
      blocked = false
      let live = getLiveBrightness()
      if (latest.basicVideoOn) {
        const applied = live ?? latest.brightness
        const previous = live ?? applied
        const next = nextAutoBrightness(response.luma, applied, previous)
        if (live == null || Math.abs(next - previous) >= 0.01) {
          setLiveBrightness(next)
          applyVisual(video, latest)
          live = getLiveBrightness()
        }
      }
      options.onSample({ live, blocked: false, bins: response.bins })
    } catch {
      /* The tab can close between the request and the capture. */
    } finally {
      busy = false
      if (queued && !stopped) {
        queued = false
        void sample()
      }
    }
  }

  const timer = window.setInterval(() => {
    void sample()
  }, AUTO_BRIGHTNESS_SAMPLE_MS)
  void sample()

  return {
    poke() {
      void sample()
    },
    stop() {
      if (stopped) return
      stopped = true
      window.clearInterval(timer)
      bind(null)
      setLiveBrightness(null)
    }
  }
}
