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
 * Default playback rate while the video picture is held down.
 * 2 means 2×.
 */
export const HOLD_PLAYBACK_RATE = 2
export const HOLD_RATE_MIN = 1
export const HOLD_RATE_MAX = 4
export const HOLD_RATE_STEP = 0.01

/** Seconds before a saved moment that resume starts. */
export const RESUME_LEAD_DEFAULT = 3
export const RESUME_LEAD_MIN = 0
export const RESUME_LEAD_MAX = 30

/** Snaps the resume lead onto a whole number of seconds. */
export function clampResumeLead(value: number): number {
  if (!Number.isFinite(value)) return RESUME_LEAD_DEFAULT
  return Math.min(RESUME_LEAD_MAX, Math.max(RESUME_LEAD_MIN, Math.round(value)))
}

/** Snaps a hold speed onto the 1×–4× range, one hundredth at a time. */
export function clampHoldPlaybackRate(value: number): number {
  if (!Number.isFinite(value)) return HOLD_PLAYBACK_RATE
  const stepped = Math.round(value / HOLD_RATE_STEP) * HOLD_RATE_STEP
  const hundredths = Math.round(stepped * 100) / 100
  return Math.min(HOLD_RATE_MAX, Math.max(HOLD_RATE_MIN, hundredths))
}

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
  /** User changed speed, pitch, or loop. Until then the player keeps its own rate. */
  playbackTouched: boolean
  /**
   * User changed volume or mute. Until then speed changes, hold-to-speed,
   * and the on/off switch leave the player loudness alone.
   */
  audioTouched: boolean
  /**
   * When true, speed, volume, mute, and loop from the on-video bar and the
   * site player are saved into this panel. When false they stay on this tab.
   */
  syncCustomController: boolean
  /**
   * When true, sound and speed changes update every open tab on this site.
   * When false, a tab that is already open keeps its sound until refresh.
   */
  syncOpenTabsAudio: boolean
  /**
   * When true, picture changes update every open tab on this site.
   * When false, a tab that is already open keeps its picture until refresh.
   */
  syncOpenTabsVideo: boolean
  presetId: string
  rememberProgress: boolean
  videoEnabled: boolean
  /**
   * While true, brightness follows the painted frame. The slider value stays
   * the manual level and is not overwritten by the measured one.
   */
  autoBrightness: boolean
  audioEnabled: boolean
  playbackEnabled: boolean
  /** Press and hold the video picture to play at holdPlaybackRate. */
  holdToSpeed: boolean
  /** Speed used while the video picture is held down. */
  holdPlaybackRate: number
  showNativeControls: boolean
  /**
   * Master switch for the on-video controls. Off hides the bar and keeps
   * each control's own on/off and placement.
   */
  dockEnabled: boolean
  /** Seek track on the on-video bar. The buttons stay when this is off. */
  dockProgress: boolean
  /**
   * Older group alignment. New saves use dockLayout. A center or right
   * value is copied onto icon controls only when no layout was saved.
   */
  dockAlign: DockAlign
  /** Where each on-video control sits. Stored per site. */
  dockLayout: ControlLayout
  /**
   * While true, on-video placement follows this site's preset, including a
   * Facebook reel versus a long video. Moving a control turns it off.
   */
  dockLayoutAuto: boolean
  /**
   * While true, which on-video controls are shown follows this site's preset.
   * Toggling a control turns it off.
   */
  dockFlagsAuto: boolean
  /** Resume starts this many seconds before the saved moment. */
  resumeLeadSeconds: number
  /** Play and pause on the on-video bar. */
  dockPlay: boolean
  /** Current time and duration on the on-video bar. */
  dockTime: boolean
  /** Mute and volume on the on-video bar. */
  dockVolume: boolean
  /** Playback speed on the on-video bar. */
  dockSpeed: boolean
  /** Loop on the on-video bar. */
  dockLoop: boolean
  /** Picture in picture on the on-video bar. */
  dockPip: boolean
  /** Full screen on the on-video bar. */
  dockFullscreen: boolean
  /** Save the video when it is already a normal file link. */
  dockDownload: boolean
  /** Choose a resolution when the page already lists more than one. */
  dockQuality: boolean
  /** Skip back and forward 10 seconds on the on-video bar. */
  dockSkip: boolean
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

export type DockAlign = "left" | "center" | "right"

export type DockEdge = "top" | "right" | "bottom" | "left"
export type DockSlot = "start" | "center" | "end" | "custom"

export type DockPlacement = {
  edge: DockEdge
  slot: DockSlot
  /** 0–100, percent of the player. Used when slot is custom. */
  x: number
  y: number
}

export const DOCK_PLACE_IDS = [
  "progress",
  "play",
  "time",
  "skip",
  "speed",
  "volume",
  "loop",
  "pip",
  "download",
  "quality",
  "fullscreen"
] as const

export type DockPlaceId = (typeof DOCK_PLACE_IDS)[number]

/** Icon controls, in the order they pack along a shared side. */
export const DOCK_ICON_ORDER = [
  "play",
  "time",
  "skip",
  "speed",
  "volume",
  "loop",
  "pip",
  "download",
  "quality",
  "fullscreen"
] as const satisfies readonly DockPlaceId[]

export type ControlLayout = Record<DockPlaceId, DockPlacement>

const DOCK_EDGES = new Set<DockEdge>(["top", "right", "bottom", "left"])
const DOCK_SLOTS = new Set<DockSlot>(["start", "center", "end", "custom"])

export function defaultDockPlacement(id: DockPlaceId = "play"): DockPlacement {
  if (id === "progress") return { edge: "bottom", slot: "start", x: 0, y: 100 }
  return { edge: "bottom", slot: "start", x: 8, y: 90 }
}

export function defaultControlLayout(): ControlLayout {
  const layout = {} as ControlLayout
  for (const id of DOCK_PLACE_IDS) layout[id] = defaultDockPlacement(id)
  return layout
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function readDockPlacement(value: unknown): DockPlacement | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<DockPlacement>
  if (typeof raw.edge !== "string" || !DOCK_EDGES.has(raw.edge as DockEdge)) return null
  if (typeof raw.slot !== "string" || !DOCK_SLOTS.has(raw.slot as DockSlot)) return null
  return {
    edge: raw.edge as DockEdge,
    slot: raw.slot as DockSlot,
    x: clampPercent(typeof raw.x === "number" ? raw.x : 0),
    y: clampPercent(typeof raw.y === "number" ? raw.y : 0)
  }
}

/**
 * Saved placements win. Missing controls take the site default, then a
 * center or right group alignment from older saves.
 */
export function resolveDockLayout(
  saved: unknown,
  dockAlign: unknown,
  domain: Partial<ControlLayout> = {}
): ControlLayout {
  const layout = defaultControlLayout()
  const record =
    saved && typeof saved === "object" ? (saved as Partial<Record<DockPlaceId, unknown>>) : null
  const migrated: DockSlot | null =
    !record && dockAlign === "center" ? "center" : !record && dockAlign === "right" ? "end" : null

  for (const id of DOCK_PLACE_IDS) {
    const stored = record ? readDockPlacement(record[id]) : null
    if (stored) {
      layout[id] = stored
      continue
    }
    const site = domain[id]
    if (site) layout[id] = { ...site }
    if (migrated && id !== "progress") {
      layout[id] = { ...layout[id], edge: "bottom", slot: migrated }
    }
  }
  return layout
}

/** Point used when a control switches to Custom, so it stays near its side. */
export function customAnchor(
  id: DockPlaceId,
  edge: DockEdge,
  slot: DockSlot
): Pick<DockPlacement, "x" | "y"> {
  if (id === "progress") {
    if (edge === "top" || edge === "left") return { x: 0, y: 0 }
    if (edge === "right") return { x: 100, y: 0 }
    return { x: 0, y: 100 }
  }
  const along = slot === "end" ? 92 : slot === "center" ? 50 : slot === "custom" ? 50 : 8
  const down = slot === "end" ? 88 : slot === "center" ? 50 : slot === "custom" ? 50 : 12
  if (edge === "top") return { x: along, y: 10 }
  if (edge === "bottom") return { x: along, y: 90 }
  if (edge === "left") return { x: 8, y: down }
  return { x: 92, y: down }
}

export function placementsEqual(a: DockPlacement, b: DockPlacement): boolean {
  return a.edge === b.edge && a.slot === b.slot && a.x === b.x && a.y === b.y
}

export function layoutsEqual(a: ControlLayout, b: ControlLayout): boolean {
  return DOCK_PLACE_IDS.every((id) => placementsEqual(a[id], b[id]))
}

export function dockLayoutStamp(layout: ControlLayout): string {
  return DOCK_PLACE_IDS.map((id) => {
    const place = layout[id]
    return `${id}:${place.edge}:${place.slot}:${place.x}:${place.y}`
  }).join(",")
}

/** Which buttons the on-video bar may show. Not part of a color preset. */
export const DOCK_CONTROL_KEYS = [
  "dockPlay",
  "dockTime",
  "dockVolume",
  "dockSpeed",
  "dockLoop",
  "dockPip",
  "dockFullscreen",
  "dockDownload",
  "dockQuality",
  "dockSkip"
] as const satisfies readonly (keyof EffectSettings)[]

/** On-video bar and buttons. Progress is not in the icon pack. */
export const DOCK_FLAG_KEYS = ["dockProgress", ...DOCK_CONTROL_KEYS] as const satisfies readonly (keyof EffectSettings)[]

export type DockFlagKey = (typeof DOCK_FLAG_KEYS)[number]

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
    audioTouched: false,
    syncCustomController: false,
    syncOpenTabsAudio: false,
    syncOpenTabsVideo: true,
    presetId: "default",
    rememberProgress: true,
    videoEnabled: true,
    autoBrightness: false,
    audioEnabled: true,
    playbackEnabled: true,
    holdToSpeed: true,
    holdPlaybackRate: HOLD_PLAYBACK_RATE,
    showNativeControls: false,
    dockEnabled: true,
    dockProgress: false,
    dockAlign: "left",
    dockLayout: defaultControlLayout(),
    dockLayoutAuto: true,
    dockFlagsAuto: true,
    resumeLeadSeconds: RESUME_LEAD_DEFAULT,
    dockPlay: false,
    dockTime: false,
    dockVolume: false,
    dockSpeed: false,
    dockLoop: false,
    dockPip: false,
    dockFullscreen: false,
    dockDownload: false,
    dockQuality: false,
    dockSkip: false,
    skipAdsEnabled: false,
    skipAds: false,
    skipAdsSpeed: false,
    skipAdsSeek: false,
    skipAdsBlock: false
  }
}

export function settingsEqual(a: EffectSettings, b: EffectSettings): boolean {
  const keys = Object.keys(a) as (keyof EffectSettings)[]
  return keys.every((key) => {
    if (key === "dockLayout") return layoutsEqual(a.dockLayout, b.dockLayout)
    return a[key] === b[key]
  })
}
