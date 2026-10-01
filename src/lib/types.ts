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

export type EffectSettings = ColorSettings & {
  enabled: boolean
  flipH: boolean
  flipV: boolean
  rotate: number
  zoom: number
  playbackRate: number
  preservePitch: boolean
  volume: number
  muted: boolean
  loop: boolean
  playbackTouched: boolean
  presetId: string
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
    playbackRate: 1,
    preservePitch: true,
    volume: 1,
    muted: false,
    loop: false,
    playbackTouched: false,
    presetId: "default"
  }
}

export function settingsEqual(a: EffectSettings, b: EffectSettings): boolean {
  const keys = Object.keys(a) as (keyof EffectSettings)[]
  return keys.every((key) => a[key] === b[key])
}
