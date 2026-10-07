import { SITE_POLICY_KEY, sanitizeSitePolicy, siteAllowed } from "./sites"
import { loadSiteSettings, saveSiteSettings, siteStorageKey } from "./storage"
import { type EffectSettings } from "./types"

/**
 * Hosts the blocker may touch. Keep this list identical to
 * optional_host_permissions in package.json.
 * youtube.com is included so ad paths on that host can be blocked.
 * googlevideo.com is intentionally absent: that host carries the movie.
 */
export const AD_BLOCK_ORIGINS = [
  "*://*.doubleclick.net/*",
  "*://doubleclick.net/*",
  "*://*.googlesyndication.com/*",
  "*://googlesyndication.com/*",
  "*://*.googleadservices.com/*",
  "*://googleadservices.com/*",
  "*://*.googletagservices.com/*",
  "*://googletagservices.com/*",
  "*://*.2mdn.net/*",
  "*://2mdn.net/*",
  "*://adservice.google.com/*",
  "*://*.youtube.com/*",
  "*://youtube.com/*",
  "*://ads.hotstar.com/*",
  "*://*.ads.hotstar.com/*",
  "*://ads.jiohotstar.com/*",
  "*://*.ads.jiohotstar.com/*"
] as const

export const AD_REQUEST_DOMAINS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "googletagservices.com",
  "2mdn.net",
  "adservice.google.com",
  "ads.hotstar.com",
  "ads.jiohotstar.com"
]

/**
 * YouTube ad endpoints. Each pattern is specific enough that it does not
 * also match the watch or video-stream URLs (for example player/adaptive).
 */
export const YOUTUBE_AD_FILTERS = [
  "||youtube.com/pagead/",
  "||youtube.com/get_midroll_",
  "||youtube.com/api/stats/ads^",
  "||youtube.com/ptracking^",
  "||youtube.com/youtubei/v1/player/ad_"
]

export const AD_BLOCK_RULE_IDS = [1, 2, 3, 4, 5, 6]

function ruleResourceTypes(): chrome.declarativeNetRequest.ResourceType[] {
  const types = chrome.declarativeNetRequest.ResourceType
  return [
    types.XMLHTTPREQUEST,
    types.SCRIPT,
    types.IMAGE,
    types.MEDIA,
    types.SUB_FRAME,
    types.OTHER,
    types.PING
  ]
}

export const AD_BLOCK_CHECK = "VEE_AD_BLOCK_CHECK"
export const AD_BLOCK_GRANTED = "VEE_AD_BLOCK_GRANTED"
export const AD_BLOCK_READY = "VEE_AD_BLOCK_READY"
export const AD_BLOCK_CANCELLED = "VEE_AD_BLOCK_CANCELLED"
export const AD_BLOCK_DISMISS = "VEE_AD_BLOCK_DISMISS"
export const AD_BLOCK_PENDING = "VEE_AD_BLOCK_PENDING"

const SITE_KEY_PREFIX = "veeSite:"

export function initiatorDomain(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "")
  if (!host || host.includes("/") || host.includes(":") || host.includes("..")) return null
  if (host === "localhost") return host
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return null
  return host
}

export function blockInputsChanged(changes: { [key: string]: chrome.storage.StorageChange }): boolean {
  if (changes[SITE_POLICY_KEY]) return true
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith(SITE_KEY_PREFIX)) continue
    const previous = readBlockSlice(change.oldValue)
    const next = readBlockSlice(change.newValue)
    if (
      previous.skipAdsBlock !== next.skipAdsBlock ||
      previous.skipAdsEnabled !== next.skipAdsEnabled ||
      previous.enabled !== next.enabled ||
      previous.playbackEnabled !== next.playbackEnabled
    ) {
      return true
    }
  }
  return false
}

function readBlockSlice(
  value: unknown
): Pick<EffectSettings, "skipAdsBlock" | "skipAdsEnabled" | "enabled" | "playbackEnabled"> {
  const raw = value && typeof value === "object" ? (value as Partial<EffectSettings>) : {}
  return {
    skipAdsBlock: raw.skipAdsBlock === true,
    skipAdsEnabled: raw.skipAdsEnabled === true,
    enabled: raw.enabled !== false,
    playbackEnabled: raw.playbackEnabled !== false
  }
}

export async function blockInitiatorDomains(): Promise<string[]> {
  const bag = await chrome.storage.local.get(null)
  const policy = sanitizeSitePolicy(bag[SITE_POLICY_KEY])
  const domains: string[] = []
  for (const [key, value] of Object.entries(bag)) {
    if (!key.startsWith(SITE_KEY_PREFIX)) continue
    const hostname = key.slice(SITE_KEY_PREFIX.length)
    const domain = initiatorDomain(hostname)
    if (!domain || domains.includes(domain)) continue
    const slice = readBlockSlice(value)
    if (!slice.skipAdsBlock || !slice.skipAdsEnabled || !slice.enabled || !slice.playbackEnabled) continue
    if (!siteAllowed(hostname, policy)) continue
    domains.push(domain)
  }
  return domains
}

export function adBlockRules(initiatorDomains: string[]): chrome.declarativeNetRequest.Rule[] {
  if (initiatorDomains.length === 0) return []
  const rules: chrome.declarativeNetRequest.Rule[] = [
    {
      id: AD_BLOCK_RULE_IDS[0],
      priority: 1,
      action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
      condition: {
        requestDomains: [...AD_REQUEST_DOMAINS],
        initiatorDomains,
        resourceTypes: ruleResourceTypes()
      }
    }
  ]
  YOUTUBE_AD_FILTERS.forEach((urlFilter, index) => {
    rules.push({
      id: AD_BLOCK_RULE_IDS[index + 1],
      priority: 1,
      action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
      condition: {
        urlFilter,
        initiatorDomains,
        resourceTypes: ruleResourceTypes()
      }
    })
  })
  return rules
}

export async function syncAdBlockRules(): Promise<void> {
  const granted = await chrome.permissions.contains({ origins: [...AD_BLOCK_ORIGINS] })
  if (!granted) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [...AD_BLOCK_RULE_IDS],
        addRules: []
      })
    } catch {
      /* Host access is not granted, so there are no rules to clear. */
    }
    return
  }
  const domains = await blockInitiatorDomains()
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...AD_BLOCK_RULE_IDS],
    addRules: adBlockRules(domains)
  })
}

export async function persistSkipAdsBlock(hostname: string): Promise<void> {
  const domain = initiatorDomain(hostname)
  if (!domain) return
  const current = await loadSiteSettings(domain)
  if (current.skipAdsBlock) {
    await syncAdBlockRules()
    return
  }
  await saveSiteSettings(domain, { ...current, skipAdsBlock: true })
}

export async function clearSkipAdsBlock(hostname: string): Promise<void> {
  const domain = initiatorDomain(hostname)
  if (!domain) return
  const current = await loadSiteSettings(domain)
  if (!current.skipAdsBlock) {
    await syncAdBlockRules()
    return
  }
  await saveSiteSettings(domain, { ...current, skipAdsBlock: false })
}
