export type ColorSettings = {
  brightness: number
  contrast: number
  saturate: number
  hueRotate: number
  grayscale: number
  sepia: number
  invert: number
  blur: number
  opacity: number
}

export const PLAYBACK_RATE_MIN = 0.1
export const PLAYBACK_RATE_MAX = 4

/**
 * Playback rate while the video picture is held down.
 * 2 means 2×. Change this number to use a different hold speed.
 */
export const HOLD_PLAYBACK_RATE = 2

export type EffectSettings = ColorSettings & {
  enabled: boolean
  flipH: boolean
  flipV: boolean
  rotate: number
  zoom: number
  panX: number
  panY: number
  stretchX: number
  stretchY: number
  cropLeft: number
  cropRight: number
  cropTop: number
  cropBottom: number
  linkCropX: boolean
  linkCropY: boolean
  basicVideoOn: boolean
  frameOn: boolean
  advancedVideoOn: boolean
  basicAudioOn: boolean
  advancedAudioOn: boolean
  basicPlaybackOn: boolean
  advancedPlaybackOn: boolean
  playbackRate: number
  preservePitch: boolean
  volume: number
  muted: boolean
  loop: boolean
  playbackTouched: boolean
  presetId: string
  rememberProgress: boolean
  videoEnabled: boolean
  audioEnabled: boolean
  playbackEnabled: boolean
  /** Play at HOLD_PLAYBACK_RATE while the video picture is pressed. */
  holdToSpeed: boolean
  showNativeControls: boolean
  /**
   * Master switch for skip advertisement. Off leaves the four methods saved
   * and unused. On runs each method whose own switch is on.
   */
  skipAdsEnabled: boolean
  /** Click the site's own Skip ad or Close ad control. */
  skipAds: boolean
  /** Raise playback speed while an ad is showing. */
  skipAdsSpeed: boolean
  /** Jump the ad timeline to the end. */
  skipAdsSeek: boolean
  /** Block known ad request URLs on this website. */
  skipAdsBlock: boolean
}

export const COLOR_KEYS: (keyof ColorSettings)[] = [
  "brightness",
  "contrast",
  "saturate",
  "hueRotate",
  "grayscale",
  "sepia",
  "invert",
  "blur",
  "opacity"
]

export function defaultColor(): ColorSettings {
  return {
    brightness: 1,
    contrast: 1,
    saturate: 1,
    hueRotate: 0,
    grayscale: 0,
    sepia: 0,
    invert: 0,
    blur: 0,
    opacity: 1
  }
}

export function defaultSettings(): EffectSettings {
  return {
    ...defaultColor(),
    enabled: true,
    flipH: false,
    flipV: false,
    rotate: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    stretchX: 1,
    stretchY: 1,
    cropLeft: 0,
    cropRight: 0,
    cropTop: 0,
    cropBottom: 0,
    linkCropX: true,
    linkCropY: true,
    basicVideoOn: true,
    frameOn: true,
    advancedVideoOn: true,
    basicAudioOn: true,
    advancedAudioOn: true,
    basicPlaybackOn: true,
    advancedPlaybackOn: true,
    playbackRate: 1,
    preservePitch: true,
    volume: 1,
    muted: false,
    loop: false,
    playbackTouched: false,
    presetId: "default",
    rememberProgress: true,
    videoEnabled: true,
    audioEnabled: true,
    playbackEnabled: true,
    holdToSpeed: true,
    showNativeControls: false,
    skipAdsEnabled: false,
    skipAds: false,
    skipAdsSpeed: false,
    skipAdsSeek: false,
    skipAdsBlock: false
  }
}

export function settingsEqual(a: EffectSettings, b: EffectSettings): boolean {
  const keys = Object.keys(a) as (keyof EffectSettings)[]
  return keys.every((key) => a[key] === b[key])
}
