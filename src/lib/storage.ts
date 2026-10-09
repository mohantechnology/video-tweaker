import {
  BLUR_MAX,
  CROP_MAX,
  OPACITY_MAX,
  OPACITY_MIN,
  STRETCH_MAX,
  STRETCH_MIN,
  PAN_MAX,
  PAN_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  clamp
} from "./effects"
import {
  PRESET_SNAPSHOT_KEYS,
  defaultSnapshot,
  snapshotFrom,
  type PresetSnapshot,
  type UserPreset
} from "./presets"
import { clampHoldPlaybackRate, defaultSettings, type EffectSettings } from "./types"

export const OPEN_REQUEST_KEY = "veeOpenRequest"
export const OPEN_MESSAGE = "VEE_OPEN"

/** One switch for every site. Missing means on. */
export const GLOBAL_ENABLED_KEY = "veeGloballyEnabled"

export function readGlobalEnabled(value: unknown): boolean {
  return value !== false
}

export async function loadGlobalEnabled(): Promise<boolean> {
  const bag = await chrome.storage.local.get(GLOBAL_ENABLED_KEY)
  return readGlobalEnabled(bag[GLOBAL_ENABLED_KEY])
}

export async function saveGlobalEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [GLOBAL_ENABLED_KEY]: enabled })
}

export type OpenRequest = {
  hostname: string
  at: number
}

const SITE_KEY_PREFIX = "veeSite:"

export function siteStorageKey(hostname: string): string {
  return `${SITE_KEY_PREFIX}${hostname}`
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function normalizeSettings(value: unknown): EffectSettings {
  const defaults = defaultSettings()
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const next: EffectSettings = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof EffectSettings)[]) {
    const field = raw[key]
    if (typeof field !== typeof defaults[key]) continue
    if (typeof field === "number" && !Number.isFinite(field)) continue
    next[key] = field as never
  }
  if (typeof raw.cropLeft !== "number" && finiteNumber(raw.cropX)) next.cropLeft = raw.cropX
  if (typeof raw.cropRight !== "number" && finiteNumber(raw.cropX)) next.cropRight = raw.cropX
  if (typeof raw.cropTop !== "number" && finiteNumber(raw.cropY)) next.cropTop = raw.cropY
  if (typeof raw.cropBottom !== "number" && finiteNumber(raw.cropY)) next.cropBottom = raw.cropY
  next.stretchX = clamp(next.stretchX, STRETCH_MIN, STRETCH_MAX)
  next.stretchY = clamp(next.stretchY, STRETCH_MIN, STRETCH_MAX)
  next.zoom = clamp(Math.round(next.zoom * 100) / 100, ZOOM_MIN, ZOOM_MAX)
  next.panX = clamp(Math.round(next.panX), PAN_MIN, PAN_MAX)
  next.panY = clamp(Math.round(next.panY), PAN_MIN, PAN_MAX)
  next.cropLeft = clamp(next.cropLeft, 0, CROP_MAX)
  next.cropRight = clamp(next.cropRight, 0, CROP_MAX)
  next.cropTop = clamp(next.cropTop, 0, CROP_MAX)
  next.cropBottom = clamp(next.cropBottom, 0, CROP_MAX)
  next.blur = Math.round(clamp(next.blur, 0, BLUR_MAX) * 10) / 10
  next.opacity = clamp(next.opacity, OPACITY_MIN, OPACITY_MAX)
  next.holdPlaybackRate = clampHoldPlaybackRate(next.holdPlaybackRate)
  return next
}

export async function loadSiteSettings(hostname: string): Promise<EffectSettings> {
  const key = siteStorageKey(hostname)
  const bag = await chrome.storage.local.get(key)
  return normalizeSettings(bag[key])
}

/** Saved site record, or null when this domain has never been edited. */
export async function loadStoredSiteSettings(hostname: string): Promise<EffectSettings | null> {
  const key = siteStorageKey(hostname)
  const bag = await chrome.storage.local.get(key)
  if (bag[key] == null) return null
  return normalizeSettings(bag[key])
}

export async function saveSiteSettings(
  hostname: string,
  settings: EffectSettings
): Promise<void> {
  await chrome.storage.local.set({ [siteStorageKey(hostname)]: settings })
}

/** Popup preset. Missing or empty `presetId` means no global preset is applied. */
export const GLOBAL_PRESET_KEY = "veeGlobalPreset"

export type GlobalPreset = {
  presetId: string
  snapshot: PresetSnapshot
}

export function readGlobalPreset(value: unknown): GlobalPreset | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<GlobalPreset>
  if (typeof raw.presetId !== "string" || !raw.presetId) return null
  const snapshot = sanitizeSnapshot(raw.snapshot)
  if (!snapshot) return null
  return { presetId: raw.presetId, snapshot }
}

export async function loadGlobalPreset(): Promise<GlobalPreset | null> {
  const bag = await chrome.storage.local.get(GLOBAL_PRESET_KEY)
  return readGlobalPreset(bag[GLOBAL_PRESET_KEY])
}

/** Defaults, with the global preset applied when one is stored. Does not write storage. */
export function settingsFromGlobalPreset(preset: GlobalPreset | null): EffectSettings {
  if (!preset) return normalizeSettings({ ...defaultSettings(), presetId: "" })
  return normalizeSettings({
    ...defaultSettings(),
    ...preset.snapshot,
    presetId: preset.presetId,
    playbackTouched: true
  })
}

/** Stored site settings, or the in-memory global preset when this domain has no record. */
export async function loadEffectiveSiteSettings(hostname: string): Promise<EffectSettings> {
  const stored = await loadStoredSiteSettings(hostname)
  if (stored) return stored
  return settingsFromGlobalPreset(await loadGlobalPreset())
}

/**
 * Saves the popup preset and copies its snapshot onto every stored site.
 * Skip ads, resume, and the per-site power flag stay as they were.
 * Sites with no record keep inheriting this preset until they are edited.
 */
export async function saveGlobalPreset(preset: GlobalPreset): Promise<void> {
  const snapshot = sanitizeSnapshot(preset.snapshot)
  if (!preset.presetId || !snapshot) return
  const normalized = normalizeSettings({
    ...defaultSettings(),
    ...snapshot,
    presetId: preset.presetId,
    playbackTouched: true
  })
  const stored: GlobalPreset = {
    presetId: preset.presetId,
    snapshot: snapshotFrom(normalized)
  }
  const bag = (await chrome.storage.local.get(null)) as Record<string, unknown>
  const updates: Record<string, unknown> = { [GLOBAL_PRESET_KEY]: stored }
  for (const [key, value] of Object.entries(bag)) {
    if (!key.startsWith(SITE_KEY_PREFIX)) continue
    const current = normalizeSettings(value)
    updates[key] = normalizeSettings({
      ...current,
      ...stored.snapshot,
      presetId: stored.presetId,
      playbackTouched: true
    })
  }
  await chrome.storage.local.set(updates)
}

export const USER_PRESETS_KEY = "veeUserPresets"
export const MAX_USER_PRESETS = 12

function writeSnapshot<K extends keyof PresetSnapshot>(
  snapshot: PresetSnapshot,
  key: K,
  value: PresetSnapshot[K]
): PresetSnapshot {
  return { ...snapshot, [key]: value }
}

function sanitizeSnapshot(value: unknown): PresetSnapshot | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  let snapshot = defaultSnapshot()
  for (const key of PRESET_SNAPSHOT_KEYS) {
    const field = raw[key]
    if (field === undefined) continue
    if (typeof field !== typeof snapshot[key]) return null
    if (typeof field === "number" && !Number.isFinite(field)) return null
    snapshot = writeSnapshot(snapshot, key, field as PresetSnapshot[typeof key])
  }
  if (raw.cropLeft === undefined && finiteNumber(raw.cropX)) {
    snapshot = writeSnapshot(snapshot, "cropLeft", raw.cropX)
  }
  if (raw.cropRight === undefined && finiteNumber(raw.cropX)) {
    snapshot = writeSnapshot(snapshot, "cropRight", raw.cropX)
  }
  if (raw.cropTop === undefined && finiteNumber(raw.cropY)) {
    snapshot = writeSnapshot(snapshot, "cropTop", raw.cropY)
  }
  if (raw.cropBottom === undefined && finiteNumber(raw.cropY)) {
    snapshot = writeSnapshot(snapshot, "cropBottom", raw.cropY)
  }
  return snapshot
}

export function sanitizeUserPresets(value: unknown): UserPreset[] {
  if (!Array.isArray(value)) return []
  const presets: UserPreset[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const raw = item as Partial<UserPreset>
    if (typeof raw.id !== "string" || !raw.id || typeof raw.label !== "string") continue
    const label = raw.label.trim().slice(0, 24)
    const snapshot = sanitizeSnapshot(raw.snapshot)
    if (!label || !snapshot) continue
    presets.push({ id: raw.id, label, snapshot })
  }
  return presets.slice(-MAX_USER_PRESETS)
}

export async function loadUserPresets(): Promise<UserPreset[]> {
  const bag = await chrome.storage.local.get(USER_PRESETS_KEY)
  return sanitizeUserPresets(bag[USER_PRESETS_KEY])
}

export async function saveUserPresets(presets: UserPreset[]): Promise<void> {
  await chrome.storage.local.set({
    [USER_PRESETS_KEY]: sanitizeUserPresets(presets)
  })
}

export async function requestOpenPanel(hostname: string): Promise<void> {
  const request: OpenRequest = { hostname, at: Date.now() }
  await chrome.storage.local.set({ [OPEN_REQUEST_KEY]: request })
}

export const DOCK_LAYOUT_KEY = "veeDockLayout"
export const DOCK_MARGIN = 16
const LEGACY_INSET = 32

export type DockMode = "max" | "min" | "closed"

export type DockBox = {
  x: number
  y: number
  width: number
  height: number
  pinned: boolean
}

export type DockLayout = {
  mode: DockMode
  max: DockBox
  min: DockBox
  closed: DockBox
}

export type Viewport = {
  width: number
  height: number
}

export function defaultDockLayout(): DockLayout {
  return {
    mode: "max",
    max: { x: 0, y: DOCK_MARGIN, width: 332, height: 480, pinned: true },
    min: { x: 0, y: DOCK_MARGIN, width: 300, height: 48, pinned: true },
    closed: { x: 0, y: DOCK_MARGIN, width: 48, height: 48, pinned: true }
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function sanitizeBox(value: unknown, fallback: DockBox): DockBox {
  if (!value || typeof value !== "object") return { ...fallback }
  const raw = value as Partial<DockBox>
  if (!finite(raw.x) || !finite(raw.y)) return { ...fallback }
  const pinned =
    typeof raw.pinned === "boolean"
      ? raw.pinned
      : raw.x === LEGACY_INSET && raw.y === LEGACY_INSET
  return {
    x: raw.x,
    y: raw.y,
    width: finite(raw.width) ? raw.width : fallback.width,
    height: finite(raw.height) ? raw.height : fallback.height,
    pinned
  }
}

function fitStoredBox(box: DockBox, slot: DockMode): DockBox {
  if (slot === "closed") {
    const diameter = Math.min(96, Math.max(40, box.width))
    return { ...box, width: diameter, height: diameter }
  }
  if (slot === "min") {
    return {
      ...box,
      width: Math.max(292, box.width),
      height: Math.max(44, box.height)
    }
  }
  return {
    ...box,
    width: Math.max(280, box.width),
    height: Math.max(240, box.height)
  }
}

export async function loadDockLayout(): Promise<DockLayout> {
  const fallback = defaultDockLayout()
  const bag = await chrome.storage.local.get(DOCK_LAYOUT_KEY)
  const stored = bag[DOCK_LAYOUT_KEY] as Partial<DockLayout> | undefined
  if (!stored) return fallback
  const mode: DockMode =
    stored.mode === "min" || stored.mode === "closed" || stored.mode === "max"
      ? stored.mode
      : fallback.mode
  return {
    mode,
    max: fitStoredBox(sanitizeBox(stored.max, fallback.max), "max"),
    min: fitStoredBox(sanitizeBox(stored.min, fallback.min), "min"),
    closed: fitStoredBox(sanitizeBox(stored.closed, fallback.closed), "closed")
  }
}

export async function saveDockLayout(layout: DockLayout): Promise<void> {
  await chrome.storage.local.set({ [DOCK_LAYOUT_KEY]: layout })
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampDockBox(box: DockBox, viewport: Viewport, margin = DOCK_MARGIN): DockBox {
  const maxWidth = Math.max(1, viewport.width - margin * 2)
  const maxHeight = Math.max(1, viewport.height - margin * 2)
  const width = Math.min(Math.max(1, box.width), maxWidth)
  const height = Math.min(Math.max(1, box.height), maxHeight)
  const maxX = Math.max(margin, viewport.width - width - margin)
  const maxY = Math.max(margin, viewport.height - height - margin)
  return {
    ...box,
    width,
    height,
    x: box.pinned ? maxX : Math.min(maxX, Math.max(margin, box.x)),
    y: box.pinned ? margin : Math.min(maxY, Math.max(margin, box.y))
  }
}

export function resizeDockBox(
  start: DockBox,
  edge: string,
  dx: number,
  dy: number,
  slot: DockMode,
  viewport: Viewport,
  pointer?: { x: number; y: number }
): DockBox {
  const margin = DOCK_MARGIN
  const maxWidth = Math.max(1, viewport.width - margin * 2)
  const maxHeight = Math.max(1, viewport.height - margin * 2)

  if (edge === "circle" && pointer) {
    const cx = start.x + start.width / 2
    const cy = viewport.height - start.y - start.height / 2
    const dist = Math.hypot(pointer.x - cx, pointer.y - cy)
    const diameter = clampNumber(Math.round(dist * 2), Math.min(40, maxWidth), Math.min(96, maxWidth))
    return clampDockBox(
      {
        pinned: false,
        width: diameter,
        height: diameter,
        x: cx - diameter / 2,
        y: viewport.height - cy - diameter / 2
      },
      viewport
    )
  }

  let width = start.width
  let height = start.height
  if (edge.includes("e")) width = start.width + dx
  if (edge.includes("w")) width = start.width - dx
  if (slot !== "min" && edge.includes("n")) height = start.height - dy
  if (slot !== "min" && edge.includes("s")) height = start.height + dy

  if (slot === "min") {
    width = clampNumber(width, Math.min(292, maxWidth), maxWidth)
    height = start.height
  } else if (slot === "closed") {
    const diameter = clampNumber(width, Math.min(40, maxWidth), Math.min(96, maxWidth))
    width = diameter
    height = diameter
  } else {
    width = clampNumber(width, Math.min(280, maxWidth), maxWidth)
    height = clampNumber(height, Math.min(240, maxHeight), maxHeight)
  }

  const right = start.x + start.width
  const top = start.y + start.height
  const x = edge.includes("w") ? right - width : start.x
  const y = edge.includes("s") ? top - height : start.y

  return clampDockBox({ x, y, width, height, pinned: false }, viewport)
}
