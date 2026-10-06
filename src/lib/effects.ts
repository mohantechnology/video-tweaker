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

export const CROP_MAX = 400
export const STRETCH_MIN = 0.01
export const STRETCH_MAX = 4

export const SECTION_FIELDS = {
  basicVideoOn: ["brightness", "contrast", "saturate"],
  frameOn: [
    "stretchX",
    "stretchY",
    "cropLeft",
    "cropRight",
    "cropTop",
    "cropBottom",
    "zoom",
    "rotate",
    "flipH",
    "flipV"
  ],
  advancedVideoOn: ["hueRotate", "grayscale", "sepia", "invert", "blur", "opacity"],
  basicAudioOn: ["volume", "muted"],
  advancedAudioOn: ["preservePitch"],
  basicPlaybackOn: ["playbackRate", "loop"],
  advancedPlaybackOn: ["rememberProgress", "showNativeControls"]
} as const satisfies Record<string, readonly (keyof EffectSettings)[]>

export type SectionFlag = keyof typeof SECTION_FIELDS

function assign<K extends keyof EffectSettings>(
  target: EffectSettings,
  key: K,
  value: EffectSettings[K]
): void {
  target[key] = value
}

export function effectiveSettings(settings: EffectSettings): EffectSettings {
  const defaults = defaultSettings()
  const next = { ...settings }
  const flags = Object.keys(SECTION_FIELDS) as SectionFlag[]
  for (const flag of flags) {
    if (settings[flag] || flag === "advancedPlaybackOn") continue
    for (const key of SECTION_FIELDS[flag]) assign(next, key, defaults[key])
  }
  if (!settings.advancedPlaybackOn) {
    next.rememberProgress = false
    next.showNativeControls = false
  }
  return next
}

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

export function isTransformIdentity(settings: EffectSettings): boolean {
  return (
    !settings.flipH &&
    !settings.flipV &&
    near(settings.rotate, visualDefaults.rotate) &&
    near(settings.zoom, visualDefaults.zoom) &&
    near(settings.stretchX, visualDefaults.stretchX) &&
    near(settings.stretchY, visualDefaults.stretchY)
  )
}

export function isCropIdentity(settings: EffectSettings): boolean {
  return (
    near(settings.cropLeft, visualDefaults.cropLeft) &&
    near(settings.cropRight, visualDefaults.cropRight) &&
    near(settings.cropTop, visualDefaults.cropTop) &&
    near(settings.cropBottom, visualDefaults.cropBottom)
  )
}

export function isGeometryIdentity(settings: EffectSettings): boolean {
  return isTransformIdentity(settings) && isCropIdentity(settings)
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
  const x = (settings.flipH ? -1 : 1) * zoom * settings.stretchX
  const y = (settings.flipV ? -1 : 1) * zoom * settings.stretchY
  return `rotate(${round(settings.rotate, 2)}deg) scale(${round(x)}, ${round(y)})`
}

export function buildClip(settings: EffectSettings): string {
  const top = clamp(settings.cropTop, 0, CROP_MAX)
  const right = clamp(settings.cropRight, 0, CROP_MAX)
  const bottom = clamp(settings.cropBottom, 0, CROP_MAX)
  const left = clamp(settings.cropLeft, 0, CROP_MAX)
  return `inset(${round(top, 2)}% ${round(right, 2)}% ${round(bottom, 2)}% ${round(left, 2)}%)`
}

let suppressStyleWrites = false

function holdStyleWrites(): void {
  if (suppressStyleWrites) return
  suppressStyleWrites = true
  queueMicrotask(() => {
    suppressStyleWrites = false
  })
}

function styleKey(property: "filter" | "transform" | "transform-origin" | "clip-path"): string {
  if (property === "transform-origin") return "veeOrigin"
  if (property === "transform") return "veeTransform"
  if (property === "clip-path") return "veeClip"
  return "veeFilter"
}

function writeVisual(
  video: HTMLVideoElement,
  property: "filter" | "transform" | "transform-origin" | "clip-path",
  value: string
): void {
  const key = styleKey(property)
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

  if (!settings.enabled || settings.videoEnabled === false || isVisualIdentity(settings)) {
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

  if (isTransformIdentity(settings)) {
    video.style.removeProperty("transform")
    video.style.removeProperty("transform-origin")
    delete video.dataset.veeTransform
    delete video.dataset.veeOrigin
  } else {
    writeVisual(video, "transform", buildTransform(settings))
    writeVisual(video, "transform-origin", "center center")
  }

  if (isCropIdentity(settings)) {
    video.style.removeProperty("clip-path")
    delete video.dataset.veeClip
  } else {
    writeVisual(video, "clip-path", buildClip(settings))
  }
}

export function clearVisual(video: HTMLVideoElement): void {
  if (video.dataset.veeVisual !== "1") return
  holdStyleWrites()
  video.style.removeProperty("filter")
  video.style.removeProperty("transform")
  video.style.removeProperty("transform-origin")
  video.style.removeProperty("clip-path")
  delete video.dataset.veeVisual
  delete video.dataset.veeFilter
  delete video.dataset.veeTransform
  delete video.dataset.veeOrigin
  delete video.dataset.veeClip
}

type PitchVideo = HTMLVideoElement & {
  mozPreservesPitch?: boolean
  webkitPreservesPitch?: boolean
}

type OwnedMedia = {
  playback: boolean
  audio: boolean
  playbackRate: number
  loop: boolean
  volume: number
  muted: boolean
  preservesPitch: boolean
}

const ownedMedia = new WeakMap<HTMLVideoElement, OwnedMedia>()

function readPitch(video: HTMLVideoElement): boolean {
  return (video as PitchVideo).preservesPitch !== false
}

function writePitch(video: HTMLVideoElement, preserve: boolean): void {
  const pitched = video as PitchVideo
  pitched.preservesPitch = preserve
  pitched.mozPreservesPitch = preserve
  pitched.webkitPreservesPitch = preserve
}

function mediaState(video: HTMLVideoElement): OwnedMedia {
  const existing = ownedMedia.get(video)
  if (existing) return existing
  const created: OwnedMedia = {
    playback: false,
    audio: false,
    playbackRate: video.playbackRate || 1,
    loop: video.loop,
    volume: video.volume,
    muted: video.muted,
    preservesPitch: readPitch(video)
  }
  ownedMedia.set(video, created)
  return created
}

function writeTransport(video: HTMLVideoElement, rate: number, loop: boolean): void {
  const nextRate = clamp(rate, PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX)
  if (video.playbackRate !== nextRate) video.playbackRate = nextRate
  if (video.loop !== loop) video.loop = loop
}

function writeAudio(
  video: HTMLVideoElement,
  preservePitch: boolean,
  volume: number,
  muted: boolean
): void {
  writePitch(video, preservePitch)
  const nextVolume = clamp(volume, 0, 1)
  if (Math.abs(video.volume - nextVolume) > 0.005) video.volume = nextVolume
  if (video.muted !== muted) video.muted = muted
}

export function applyPlayback(video: HTMLVideoElement, settings: EffectSettings): void {
  if (!settings.playbackTouched) return

  const state = mediaState(video)
  const playbackOn = settings.enabled && settings.playbackEnabled !== false
  const audioOn = settings.enabled && settings.audioEnabled !== false

  try {
    if (playbackOn) {
      if (!state.playback) {
        state.playbackRate = video.playbackRate || 1
        state.loop = video.loop
      }
      writeTransport(video, settings.playbackRate, settings.loop)
      state.playback = true
    } else if (state.playback) {
      writeTransport(video, state.playbackRate, state.loop)
      state.playback = false
    }

    if (audioOn) {
      if (!state.audio) {
        state.volume = video.volume
        state.muted = video.muted
        state.preservesPitch = readPitch(video)
      }
      writeAudio(video, settings.preservePitch, settings.volume, settings.muted)
      state.audio = true
    } else if (state.audio) {
      writeAudio(video, state.preservesPitch, state.volume, state.muted)
      state.audio = false
    }
  } catch {
    /* Some players reject rate or volume changes while a frame is locked. */
  }
}

export function releasePlayback(video: HTMLVideoElement): void {
  const state = ownedMedia.get(video)
  if (!state) return
  try {
    if (state.playback) writeTransport(video, state.playbackRate, state.loop)
    if (state.audio) writeAudio(video, state.preservesPitch, state.volume, state.muted)
  } catch {
    /* The element can already be detached from the player. */
  }
  ownedMedia.delete(video)
}

export function applyNativeControls(video: HTMLVideoElement, settings: EffectSettings): void {
  if (!settings.enabled || settings.playbackEnabled === false) {
    clearNativeControls(video)
    return
  }
  if (settings.showNativeControls) {
    if (!video.controls) {
      video.controls = true
      video.dataset.veeControls = "1"
    }
    return
  }
  clearNativeControls(video)
}

export function clearNativeControls(video: HTMLVideoElement): void {
  if (video.dataset.veeControls !== "1") return
  video.controls = false
  delete video.dataset.veeControls
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
