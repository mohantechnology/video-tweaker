import {
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  type ColorSettings,
  type EffectSettings,
  defaultColor,
  defaultSettings
} from "./types"

const colorDefaults = defaultColor()
const visualDefaults = defaultSettings()

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001
}

export function isColorIdentity(settings: EffectSettings): boolean {
  return (Object.keys(colorDefaults) as (keyof ColorSettings)[]).every((key) =>
    near(settings[key], colorDefaults[key])
  )
}

export function isGeometryIdentity(settings: EffectSettings): boolean {
  return (
    !settings.flipH &&
    !settings.flipV &&
    near(settings.rotate, visualDefaults.rotate) &&
    near(settings.zoom, visualDefaults.zoom)
  )
}

export function isVisualIdentity(settings: EffectSettings): boolean {
  return isColorIdentity(settings) && isGeometryIdentity(settings)
}

export function buildFilter(settings: EffectSettings): string {
  return [
    `brightness(${round(settings.brightness)})`,
    `contrast(${round(settings.contrast)})`,
    `saturate(${round(settings.saturate)})`,
    `hue-rotate(${round(settings.hueRotate, 2)}deg)`,
    `grayscale(${round(settings.grayscale)})`,
    `sepia(${round(settings.sepia)})`,
    `invert(${round(settings.invert)})`,
    `blur(${round(settings.blur, 2)}px)`,
    `opacity(${round(settings.opacity)})`
  ].join(" ")
}

export function buildTransform(settings: EffectSettings): string {
  const zoom = settings.zoom
  const x = (settings.flipH ? -1 : 1) * zoom
  const y = (settings.flipV ? -1 : 1) * zoom
  return `rotate(${round(settings.rotate, 2)}deg) scale(${round(x)}, ${round(y)})`
}

let suppressStyleWrites = false

function holdStyleWrites(): void {
  if (suppressStyleWrites) return
  suppressStyleWrites = true
  queueMicrotask(() => {
    suppressStyleWrites = false
  })
}

function writeVisual(
  video: HTMLVideoElement,
  property: "filter" | "transform" | "transform-origin",
  value: string
): void {
  const key = property === "transform-origin" ? "veeOrigin" : property === "transform" ? "veeTransform" : "veeFilter"
  if (video.dataset[key] === value && video.style.getPropertyValue(property)) return
  video.dataset[key] = value
  video.style.setProperty(property, value, "important")
}

export function visualWritesLocked(): boolean {
  return suppressStyleWrites
}

export function applyVisual(
  video: HTMLVideoElement,
  settings: EffectSettings
): void {
  if (suppressStyleWrites) return

  if (!settings.enabled || isVisualIdentity(settings)) {
    clearVisual(video)
    return
  }

  holdStyleWrites()
  video.dataset.veeVisual = "1"

  if (isColorIdentity(settings)) {
    video.style.removeProperty("filter")
    delete video.dataset.veeFilter
  } else {
    writeVisual(video, "filter", buildFilter(settings))
  }

  if (isGeometryIdentity(settings)) {
    video.style.removeProperty("transform")
    video.style.removeProperty("transform-origin")
    delete video.dataset.veeTransform
    delete video.dataset.veeOrigin
  } else {
    writeVisual(video, "transform", buildTransform(settings))
    writeVisual(video, "transform-origin", "center center")
  }
}

export function clearVisual(video: HTMLVideoElement): void {
  if (video.dataset.veeVisual !== "1") return
  holdStyleWrites()
  video.style.removeProperty("filter")
  video.style.removeProperty("transform")
  video.style.removeProperty("transform-origin")
  delete video.dataset.veeVisual
  delete video.dataset.veeFilter
  delete video.dataset.veeTransform
  delete video.dataset.veeOrigin
}

type PitchVideo = HTMLVideoElement & {
  mozPreservesPitch?: boolean
  webkitPreservesPitch?: boolean
}

export function applyPlayback(
  video: HTMLVideoElement,
  settings: EffectSettings
): void {
  if (!settings.enabled || !settings.playbackTouched) return

  try {
    const rate = clamp(settings.playbackRate, PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX)
    if (video.playbackRate !== rate) video.playbackRate = rate

    const pitched = video as PitchVideo
    pitched.preservesPitch = settings.preservePitch
    pitched.mozPreservesPitch = settings.preservePitch
    pitched.webkitPreservesPitch = settings.preservePitch

    const volume = clamp(settings.volume, 0, 1)
    if (Math.abs(video.volume - volume) > 0.005) video.volume = volume
    if (video.muted !== settings.muted) video.muted = settings.muted
    if (video.loop !== settings.loop) video.loop = settings.loop
  } catch {
    /* Some players reject rate or volume changes while a frame is locked. */
  }
}

export function seekBy(video: HTMLVideoElement, delta: number): void {
  const duration = Number.isFinite(video.duration) ? video.duration : Infinity
  const next = Math.min(Math.max(0, video.currentTime + delta), duration)
  video.currentTime = next
}

export async function togglePictureInPicture(
  video: HTMLVideoElement
): Promise<void> {
  if (!document.pictureInPictureEnabled) return
  if (document.pictureInPictureElement === video) {
    await document.exitPictureInPicture()
    return
  }
  if (document.pictureInPictureElement) await document.exitPictureInPicture()
  await video.requestPictureInPicture()
}
