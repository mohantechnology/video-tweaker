import type { ColorSettings } from "./types"

export type Preset = {
  id: string
  label: string
  color: ColorSettings
}

export const PRESETS: Preset[] = [
  {
    id: "default",
    label: "Default",
    color: {
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
  },
  {
    id: "cinema",
    label: "Cinema",
    color: {
      brightness: 0.9,
      contrast: 1.18,
      saturate: 0.88,
      hueRotate: 0,
      grayscale: 0,
      sepia: 0.12,
      invert: 0,
      blur: 0,
      opacity: 1
    }
  },
  {
    id: "vivid",
    label: "Vivid",
    color: {
      brightness: 1.06,
      contrast: 1.12,
      saturate: 1.55,
      hueRotate: 0,
      grayscale: 0,
      sepia: 0,
      invert: 0,
      blur: 0,
      opacity: 1
    }
  },
  {
    id: "noir",
    label: "Noir",
    color: {
      brightness: 1.08,
      contrast: 1.28,
      saturate: 0,
      hueRotate: 0,
      grayscale: 1,
      sepia: 0.05,
      invert: 0,
      blur: 0,
      opacity: 1
    }
  },
  {
    id: "night",
    label: "Night",
    color: {
      brightness: 0.72,
      contrast: 1.08,
      saturate: 0.8,
      hueRotate: 210,
      grayscale: 0,
      sepia: 0,
      invert: 0,
      blur: 0,
      opacity: 1
    }
  },
  {
    id: "warm",
    label: "Warm",
    color: {
      brightness: 1.04,
      contrast: 1.06,
      saturate: 1.18,
      hueRotate: 12,
      grayscale: 0,
      sepia: 0.28,
      invert: 0,
      blur: 0,
      opacity: 1
    }
  },
  {
    id: "cool",
    label: "Cool",
    color: {
      brightness: 1,
      contrast: 1.08,
      saturate: 1.02,
      hueRotate: 196,
      grayscale: 0,
      sepia: 0,
      invert: 0,
      blur: 0,
      opacity: 1
    }
  }
]

export function presetLabel(id: string): string {
  return PRESETS.find((preset) => preset.id === id)?.label ?? "Custom"
}

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}
