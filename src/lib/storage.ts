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
