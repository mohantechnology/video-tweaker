import {
  nativePlayerSeq,
  queueNativeMirror,
  readNativePlayer,
  YT_ECHO_ATTR,
  type NativeMirrorPatch
} from "./native-mirror"
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

/** CSS inset percent. The crop sliders show this 0–50 range as 0–100%. */
export const CROP_MAX = 50
export const CROP_CONTROL_MAX = 100
/** Below this the picture collapses, and the player used to flicker as it was lost and found. */
export const STRETCH_MIN = 0.25
export const STRETCH_MAX = 4
/** 10%–400%. CSS scale supports this; the player may clip the picture above 100%. */
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4
/** Shift as a percent of the video box. ±200% reaches the edge of a 4× zoom. */
export const PAN_MIN = -200
export const PAN_MAX = 200
export const BLUR_MAX = 20
export const OPACITY_MIN = 0.02
export const OPACITY_MAX = 1

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
    "panX",
    "panY",
    "rotate",
    "flipH",
    "flipV"
  ],
  advancedVideoOn: ["hueRotate", "grayscale", "sepia", "invert", "blur", "opacity"],
  basicAudioOn: ["volume", "muted"],
  basicPlaybackOn: ["playbackRate", "preservePitch", "loop"]
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
    if (settings[flag]) continue
    for (const key of SECTION_FIELDS[flag]) assign(next, key, defaults[key])
  }
  return next
}

export function cropControlToCss(control: number): number {
  return round((clamp(control, 0, CROP_CONTROL_MAX) / CROP_CONTROL_MAX) * CROP_MAX, 2)
}

export function cropCssToControl(css: number): number {
  return Math.round((clamp(css, 0, CROP_MAX) / CROP_MAX) * CROP_CONTROL_MAX)
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
    near(settings.panX, visualDefaults.panX) &&
    near(settings.panY, visualDefaults.panY) &&
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
  const zoom = clamp(settings.zoom, ZOOM_MIN, ZOOM_MAX)
  const stretchX = clamp(settings.stretchX, STRETCH_MIN, STRETCH_MAX)
  const stretchY = clamp(settings.stretchY, STRETCH_MIN, STRETCH_MAX)
  const x = (settings.flipH ? -1 : 1) * zoom * stretchX
  const y = (settings.flipV ? -1 : 1) * zoom * stretchY
  const panX = clamp(settings.panX, PAN_MIN, PAN_MAX)
  const panY = clamp(settings.panY, PAN_MIN, PAN_MAX)
  return `translate(${round(panX, 2)}%, ${round(panY, 2)}%) rotate(${round(settings.rotate, 2)}deg) scale(${round(x)}, ${round(y)})`
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

/**
 * True when pitch preservation actually changed.
 * Assigning the same value restarts the audio resampler and the loudness jumps.
 * Prefixed flags are set only when the browser already exposes them as booleans,
 * so a missing moz/webkit flag cannot force a rewrite on every apply.
 */
function writePitch(video: HTMLVideoElement, preserve: boolean): boolean {
  const pitched = video as PitchVideo
  let wrote = false
  if (pitched.preservesPitch !== preserve) {
    pitched.preservesPitch = preserve
    wrote = true
  }
  if (typeof pitched.mozPreservesPitch === "boolean" && pitched.mozPreservesPitch !== preserve) {
    pitched.mozPreservesPitch = preserve
    wrote = true
  }
  if (typeof pitched.webkitPreservesPitch === "boolean" && pitched.webkitPreservesPitch !== preserve) {
    pitched.webkitPreservesPitch = preserve
    wrote = true
  }
  return wrote
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

/**
 * True when playbackRate actually changed. A hold guard can ignore the write,
 * and loop changes do not disturb loudness.
 */
function writeTransport(video: HTMLVideoElement, rate: number, loop: boolean): boolean {
  const nextRate = clamp(rate, PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX)
  const before = video.playbackRate
  // Loop has no media event. Set it before playbackRate so a ratechange
  // listener reports the loop we just chose, not the previous one.
  if (video.loop !== loop) video.loop = loop
  if (before !== nextRate) video.playbackRate = nextRate
  return video.playbackRate !== before
}

function writeAudio(video: HTMLVideoElement, volume: number, muted: boolean): void {
  restoreMediaLevel(video, volume, muted)
}

const LEVEL_EPSILON = 0.005

export function restoreMediaLevel(video: HTMLVideoElement, volume: number, muted: boolean): void {
  const nextVolume = clamp(volume, 0, 1)
  if (Math.abs(video.volume - nextVolume) > LEVEL_EPSILON) video.volume = nextVolume
  if (video.muted !== muted) video.muted = muted
}

type LevelGuard = { ticket: number; frame: number; timer: number }

let levelTicket = 0
const levelGuards = new WeakMap<HTMLVideoElement, LevelGuard>()

/**
 * Players and Chrome itself rewrite volume from the ratechange handler,
 * sometimes a frame later. Put the previous loudness back.
 * A newer call cancels the pending one so a stale restore cannot land last.
 */
export function protectMediaLevel(video: HTMLVideoElement, volume: number, muted: boolean): void {
  const ticket = ++levelTicket
  const apply = () => {
    const guard = levelGuards.get(video)
    if (!guard || guard.ticket !== ticket) return
    try {
      restoreMediaLevel(video, volume, muted)
    } catch {
      /* The element can already be detached. */
    }
  }
  try {
    restoreMediaLevel(video, volume, muted)
  } catch {
    return
  }
  const previous = levelGuards.get(video)
  if (previous) {
    if (previous.frame) cancelAnimationFrame(previous.frame)
    window.clearTimeout(previous.timer)
  }
  const timer = window.setTimeout(apply, 0)
  levelGuards.set(video, { ticket, frame: 0, timer })
  queueMicrotask(apply)
  try {
    const guard = levelGuards.get(video)
    if (guard && guard.ticket === ticket) guard.frame = requestAnimationFrame(apply)
  } catch {
    /* No animation frame here. The timeout still puts the loudness back. */
  }
}

const VOLUME_DRIFT = 0.01
/** Smaller than the custom 0.01 step, so 1.00 and 1.02 stay different. */
const RATE_DRIFT = 0.005

type MediaBaseline = {
  volume?: number
  muted?: boolean
  playbackRate?: number
  loop?: boolean
  seq: number
}

const mediaBaseline = new WeakMap<HTMLVideoElement, MediaBaseline>()

function rememberBaseline(video: HTMLVideoElement, patch: NativeMirrorPatch): void {
  const prev = mediaBaseline.get(video)
  mediaBaseline.set(video, {
    volume: typeof patch.volume === "number" ? patch.volume : prev?.volume,
    muted: typeof patch.muted === "boolean" ? patch.muted : prev?.muted,
    playbackRate: typeof patch.playbackRate === "number" ? patch.playbackRate : prev?.playbackRate,
    loop: typeof patch.loop === "boolean" ? patch.loop : prev?.loop,
    seq: nativePlayerSeq(video)
  })
}

function forgetBaseline(video: HTMLVideoElement, volume: boolean, playback: boolean): void {
  const prev = mediaBaseline.get(video)
  if (!prev) return
  if (volume) {
    delete prev.volume
    delete prev.muted
  }
  if (playback) {
    delete prev.playbackRate
    delete prev.loop
  }
}

/** Drop remembered loudness and speed without writing them back onto a new clip. */
export function releaseOwnedMedia(video: HTMLVideoElement): void {
  ownedMedia.delete(video)
  mediaBaseline.delete(video)
}

function driftedNumber(
  base: number | undefined,
  element: number | undefined,
  published: number | undefined,
  epsilon: number
): number | undefined {
  if (typeof base !== "number") return undefined
  let live = element
  if (typeof published === "number" && (typeof element !== "number" || Math.abs(published - element) >= epsilon)) {
    live = published
  }
  if (typeof live !== "number" || Math.abs(live - base) < epsilon) return undefined
  return live
}

function driftedBool(
  base: boolean | undefined,
  element: boolean | undefined,
  published: boolean | undefined
): boolean | undefined {
  if (typeof base !== "boolean") return undefined
  const live = typeof published === "boolean" && published !== element ? published : element
  if (typeof live !== "boolean" || live === base) return undefined
  return live
}

/**
 * YouTube's player rate stays put when the custom speed is not a slider step.
 * That rate is not a user edit, on the player or copied back onto the element.
 */
function publishedRateIsEcho(video: HTMLVideoElement, published: number | undefined): boolean {
  if (typeof published !== "number") return false
  const echo = Number(video.getAttribute(YT_ECHO_ATTR))
  return Number.isFinite(echo) && Math.abs(published - echo) < RATE_DRIFT
}

/**
 * Fields we last wrote that the site player has since changed.
 * A speed the site slider cannot show stays on the element.
 * A newer site rate wins when the element itself did not move, which is how
 * speeds below 1× come back from YouTube's slider.
 * Loop can live only on the site control, so a newer published loop wins.
 */
export function mediaDrift(video: HTMLVideoElement, live: NativeMirrorPatch): NativeMirrorPatch | null {
  const base = mediaBaseline.get(video)
  if (!base) return null
  const published = nativePlayerSeq(video) > base.seq ? readNativePlayer(video) : null
  const patch: NativeMirrorPatch = {}
  const volume = driftedNumber(base.volume, live.volume, published?.volume, VOLUME_DRIFT)
  const muted = driftedBool(base.muted, live.muted, published?.muted)
  const publishedRate = publishedRateIsEcho(video, published?.playbackRate) ? undefined : published?.playbackRate
  let playbackRate: number | undefined
  if (typeof base.playbackRate === "number") {
    const elementRate = live.playbackRate
    const elementMoved =
      typeof elementRate === "number" &&
      !publishedRateIsEcho(video, elementRate) &&
      Math.abs(elementRate - base.playbackRate) >= RATE_DRIFT
    if (elementMoved) playbackRate = elementRate
    else if (typeof publishedRate === "number" && Math.abs(publishedRate - base.playbackRate) >= RATE_DRIFT) {
      playbackRate = publishedRate
    }
  }
  const loop = driftedBool(base.loop, live.loop, published?.loop)
  if (typeof volume === "number") patch.volume = volume
  if (typeof muted === "boolean") patch.muted = muted
  if (typeof playbackRate === "number") patch.playbackRate = playbackRate
  if (typeof loop === "boolean") patch.loop = loop
  return typeof patch.volume === "number" ||
    typeof patch.muted === "boolean" ||
    typeof patch.playbackRate === "number" ||
    typeof patch.loop === "boolean"
    ? patch
    : null
}

function playbackControlled(settings: EffectSettings): boolean {
  return settings.enabled && settings.playbackEnabled !== false && settings.playbackTouched
}

function audioControlled(settings: EffectSettings): boolean {
  return (
    settings.enabled &&
    settings.audioEnabled !== false &&
    settings.basicAudioOn !== false &&
    settings.audioTouched
  )
}

export function applyPlayback(video: HTMLVideoElement, settings: EffectSettings): void {
  const playbackOn = playbackControlled(settings)
  const audioOn = audioControlled(settings)
  const existing = ownedMedia.get(video)
  if (!playbackOn && !audioOn && !existing?.playback && !existing?.audio) return

  const state = existing ?? mediaState(video)
  const patch: NativeMirrorPatch = {}
  try {
    // Remember the player loudness before a rate write can replace it.
    if (audioOn && !state.audio) {
      state.volume = video.volume
      state.muted = video.muted
      state.audio = true
    }

    const level = { volume: video.volume, muted: video.muted }
    let disturbed = false

    if (playbackOn) {
      if (!state.playback) {
        state.playbackRate = video.playbackRate || 1
        state.loop = video.loop
        state.preservesPitch = readPitch(video)
        state.playback = true
      }
      const liveRate = video.playbackRate || 1
      const nextRate =
        liveRate > PLAYBACK_RATE_MAX
          ? liveRate
          : clamp(settings.playbackRate, PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX)
      // Record the write before the media event, so our own change is not a player edit.
      // An ad boost is above the normal range. Leave that rate alone and only keep loop.
      if (liveRate > PLAYBACK_RATE_MAX) {
        rememberBaseline(video, { loop: settings.loop })
        if (video.loop !== settings.loop) video.loop = settings.loop
      } else {
        rememberBaseline(video, { playbackRate: nextRate, loop: settings.loop })
        disturbed = writeTransport(video, nextRate, settings.loop)
      }
      disturbed = writePitch(video, settings.preservePitch) || disturbed
      if (liveRate <= PLAYBACK_RATE_MAX) patch.playbackRate = nextRate
      patch.loop = settings.loop
    } else if (state.playback) {
      forgetBaseline(video, false, true)
      patch.playbackRate = state.playbackRate
      patch.loop = state.loop
      disturbed = writeTransport(video, state.playbackRate, state.loop)
      disturbed = writePitch(video, state.preservesPitch) || disturbed
      state.playback = false
    }

    if (audioOn) {
      const nextVolume = clamp(settings.volume, 0, 1)
      rememberBaseline(video, { volume: nextVolume, muted: settings.muted })
      writeAudio(video, nextVolume, settings.muted)
      if (disturbed) protectMediaLevel(video, nextVolume, settings.muted)
      patch.volume = nextVolume
      patch.muted = settings.muted
    } else if (state.audio) {
      forgetBaseline(video, true, false)
      const saved = { volume: state.volume, muted: state.muted }
      writeAudio(video, saved.volume, saved.muted)
      state.audio = false
      if (disturbed) protectMediaLevel(video, saved.volume, saved.muted)
      patch.volume = saved.volume
      patch.muted = saved.muted
    } else if (disturbed) {
      protectMediaLevel(video, level.volume, level.muted)
    }
    queueNativeMirror(video, patch)
  } catch {
    /* Some players reject rate or volume changes while a frame is locked. */
  }
}

export function releasePlayback(video: HTMLVideoElement): void {
  const state = ownedMedia.get(video)
  if (!state) return
  const level = { volume: video.volume, muted: video.muted }
  try {
    let disturbed = false
    if (state.playback) {
      disturbed = writeTransport(video, state.playbackRate, state.loop)
      disturbed = writePitch(video, state.preservesPitch) || disturbed
    }
    if (state.audio) {
      writeAudio(video, state.volume, state.muted)
      if (disturbed) protectMediaLevel(video, state.volume, state.muted)
    } else if (disturbed) {
      protectMediaLevel(video, level.volume, level.muted)
    }
  } catch {
    /* The element can already be detached from the player. */
  }
  ownedMedia.delete(video)
  mediaBaseline.delete(video)
}

export function applyNativeControls(video: HTMLVideoElement, _settings: EffectSettings): void {
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

export function restartVideo(video: HTMLVideoElement): void {
  try {
    video.currentTime = 0
  } catch {
    /* Some players lock the timeline during an ad. */
  }
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
