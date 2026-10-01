import { defaultSettings, type EffectSettings } from "./types"

export const OPEN_REQUEST_KEY = "veeOpenRequest"
export const OPEN_MESSAGE = "VEE_OPEN"

export type OpenRequest = {
  hostname: string
  at: number
}

export function siteStorageKey(hostname: string): string {
  return `veeSite:${hostname}`
}

export async function loadSiteSettings(hostname: string): Promise<EffectSettings> {
  const key = siteStorageKey(hostname)
  const bag = await chrome.storage.local.get(key)
  return { ...defaultSettings(), ...(bag[key] as Partial<EffectSettings> | undefined) }
}

export async function saveSiteSettings(
  hostname: string,
  settings: EffectSettings
): Promise<void> {
  await chrome.storage.local.set({ [siteStorageKey(hostname)]: settings })
}

export async function requestOpenPanel(hostname: string): Promise<void> {
  const request: OpenRequest = { hostname, at: Date.now() }
  await chrome.storage.local.set({ [OPEN_REQUEST_KEY]: request })
}

export const DOCK_LAYOUT_KEY = "veeDockLayout"
export const DOCK_INSET = 32

export type DockMode = "max" | "min" | "closed"

export type DockPoint = {
  x: number
  y: number
}

export type DockLayout = {
  mode: DockMode
  max: DockPoint
  min: DockPoint
  minPlaced: boolean
}

export function defaultDockLayout(): DockLayout {
  const origin = { x: DOCK_INSET, y: DOCK_INSET }
  return {
    mode: "max",
    max: origin,
    min: { ...origin },
    minPlaced: false
  }
}

function sanitizePoint(value: unknown, fallback: DockPoint): DockPoint {
  if (!value || typeof value !== "object") return fallback
  const point = value as Partial<DockPoint>
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return fallback
  return { x: point.x as number, y: point.y as number }
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
    max: sanitizePoint(stored.max, fallback.max),
    min: sanitizePoint(stored.min, fallback.min),
    minPlaced: stored.minPlaced === true
  }
}

export async function saveDockLayout(layout: DockLayout): Promise<void> {
  await chrome.storage.local.set({ [DOCK_LAYOUT_KEY]: layout })
}

export function clampDockPoint(
  point: DockPoint,
  bounds: { width: number; height: number; dockWidth: number; dockHeight: number },
  margin = 16
): DockPoint {
  const maxX = Math.max(margin, bounds.width - bounds.dockWidth - margin)
  const maxY = Math.max(margin, bounds.height - bounds.dockHeight - margin)
  return {
    x: Math.min(maxX, Math.max(margin, point.x)),
    y: Math.min(maxY, Math.max(margin, point.y))
  }
}
