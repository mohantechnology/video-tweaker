/** Rec. 601 weights. Channels are 0–1. */
const REC601_R = 0.299
const REC601_G = 0.587
const REC601_B = 0.114

export const HISTOGRAM_BINS = 32

/** Scene luminance auto brightness aims for. 0 is black, 1 is white. */
export const LUMA_TARGET = 0.42

export const BRIGHTNESS_MIN = 0.35
export const BRIGHTNESS_MAX = 1.85

/** How far one sample moves toward the new brightness. */
export const BRIGHTNESS_EASE = 0.35

/**
 * Near-zero frames are treated as unreadable. A flat field a little above
 * that still counts, because a JPEG of a black frame is not exact zero.
 */
export const BLACK_LUMA = 0.02
const FLAT_BLACK_LUMA = 0.08
const FLAT_BLACK_SPREAD = 0.04

/** Playing samples in a row that must be black before auto mode stops. */
export const BLACK_STREAK = 3

export const FRAME_SAMPLE_MESSAGE = "VEE_FRAME_SAMPLE"

export type HistogramBins = {
  r: number[]
  g: number[]
  b: number[]
}

export type PixelSample = {
  luma: number
  bins: HistogramBins
  black: boolean
}

export function channelLuma(red: number, green: number, blue: number): number {
  return REC601_R * red + REC601_G * green + REC601_B * blue
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

function binOf(channel: number): number {
  const index = Math.floor((channel * HISTOGRAM_BINS) / 256)
  if (index <= 0) return 0
  if (index >= HISTOGRAM_BINS) return HISTOGRAM_BINS - 1
  return index
}

function emptyBins(): HistogramBins {
  return {
    r: new Array<number>(HISTOGRAM_BINS).fill(0),
    g: new Array<number>(HISTOGRAM_BINS).fill(0),
    b: new Array<number>(HISTOGRAM_BINS).fill(0)
  }
}

/** Mean Rec. 601 luminance and an RGB histogram. Channels in the buffer are 0–255. */
export function measurePixels(data: Uint8ClampedArray): PixelSample {
  const bins = emptyBins()
  let sum = 0
  let count = 0
  let min = 1
  let max = 0
  for (let index = 0; index + 3 < data.length; index += 4) {
    if (data[index + 3] < 8) continue
    const red = data[index]
    const green = data[index + 1]
    const blue = data[index + 2]
    const luma = channelLuma(red / 255, green / 255, blue / 255)
    sum += luma
    count += 1
    if (luma < min) min = luma
    if (luma > max) max = luma
    bins.r[binOf(red)] += 1
    bins.g[binOf(green)] += 1
    bins.b[binOf(blue)] += 1
  }
  const luma = count > 0 ? sum / count : 0
  const spread = count > 0 ? max - min : 0
  const black = count === 0 || luma < BLACK_LUMA || (luma < FLAT_BLACK_LUMA && spread < FLAT_BLACK_SPREAD)
  return { luma, bins, black }
}

/**
 * Next CSS brightness. `rawLuma` is the painted frame, which already includes
 * the current filter, so it is divided by `applied` before aiming at the target.
 */
export function nextAutoBrightness(rawLuma: number, applied: number, previous: number): number {
  const safeApplied = Math.max(applied, 0.05)
  const intrinsic = rawLuma / safeApplied
  const gain = clamp(LUMA_TARGET / Math.max(intrinsic, 0.02), BRIGHTNESS_MIN, BRIGHTNESS_MAX)
  const eased = previous + (gain - previous) * BRIGHTNESS_EASE
  return clamp(Math.round(eased * 100) / 100, BRIGHTNESS_MIN, BRIGHTNESS_MAX)
}

export function luminanceSelfCheck(): string[] {
  const errors: string[] = []
  const white = measurePixels(new Uint8ClampedArray([255, 255, 255, 255]))
  if (Math.abs(white.luma - 1) > 0.0001) errors.push(`white luma ${white.luma}`)
  if (white.black) errors.push("white flagged black")
  if (white.bins.r[HISTOGRAM_BINS - 1] !== 1) errors.push("white missed the last bin")

  const red = measurePixels(new Uint8ClampedArray([255, 0, 0, 255]))
  if (Math.abs(red.luma - 0.299) > 0.0001) errors.push(`red luma ${red.luma}`)

  const black = measurePixels(new Uint8ClampedArray([0, 0, 0, 255]))
  if (!black.black) errors.push("black not flagged")

  const flat = measurePixels(new Uint8ClampedArray([16, 16, 16, 255]))
  if (!flat.black) errors.push("flat limited black not flagged")

  const detail = measurePixels(new Uint8ClampedArray([0, 0, 0, 255, 40, 40, 40, 255]))
  if (detail.black) errors.push("dark detail flagged black")

  const scene = nextAutoBrightness(0.21, 1, 1)
  if (Math.abs(scene - 1.3) > 0.001) errors.push(`scene step ${scene}`)

  const held = nextAutoBrightness(0.42, 1.5, 1.5)
  if (Math.abs(held - 1.5) > 0.001) errors.push(`held brightness ${held}`)

  return errors
}
