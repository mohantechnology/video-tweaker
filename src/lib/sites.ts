export const SITE_POLICY_KEY = "veeSitePolicy"
const MAX_SITES = 200

export type SiteMode = "only" | "except"

export type SitePolicy = {
  mode: SiteMode
  sites: string[]
}

export function defaultSitePolicy(): SitePolicy {
  return { mode: "except", sites: [] }
}

function isHostLabel(label: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
}

export function normalizeHost(value: string): string | null {
  let raw = value.trim().toLowerCase()
  if (!raw) return null

  if (raw.includes("://") || raw.startsWith("//")) {
    try {
      raw = new URL(raw.startsWith("//") ? `https:${raw}` : raw).hostname
    } catch {
      return null
    }
  } else if (/[/?#:]/.test(raw)) {
    try {
      raw = new URL(`https://${raw}`).hostname
    } catch {
      return null
    }
  }

  raw = raw.replace(/\.$/, "").replace(/^www\./, "")
  if (raw === "localhost") return raw
  const labels = raw.split(".")
  if (labels.length < 2 || labels.some((label) => !isHostLabel(label))) return null
  return raw
}

export function hostFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return ""
    return parsed.hostname
  } catch {
    return ""
  }
}

function pageHost(hostname: string): string {
  return normalizeHost(hostname) ?? ""
}

/** True when `hostname` is `entry` or a subdomain of `entry`. */
export function hostMatches(hostname: string, entry: string): boolean {
  const host = pageHost(hostname)
  const site = pageHost(entry)
  if (!host || !site) return false
  return host === site || host.endsWith(`.${site}`)
}

export function siteListed(hostname: string, sites: readonly string[]): boolean {
  return sites.some((site) => hostMatches(hostname, site))
}

export function siteAllowed(hostname: string, policy: SitePolicy): boolean {
  const listed = siteListed(hostname, policy.sites)
  return policy.mode === "only" ? listed : !listed
}

export function policiesEqual(a: SitePolicy, b: SitePolicy): boolean {
  return a.mode === b.mode && a.sites.length === b.sites.length && a.sites.every((site, index) => site === b.sites[index])
}

export function sanitizeSitePolicy(value: unknown): SitePolicy {
  const fallback = defaultSitePolicy()
  if (!value || typeof value !== "object") return fallback
  const raw = value as Partial<SitePolicy>
  const mode: SiteMode = raw.mode === "only" || raw.mode === "except" ? raw.mode : fallback.mode
  const sites: string[] = []
  if (Array.isArray(raw.sites)) {
    for (const item of raw.sites) {
      if (typeof item !== "string") continue
      const host = normalizeHost(item)
      if (!host || sites.includes(host)) continue
      sites.push(host)
      if (sites.length >= MAX_SITES) break
    }
  }
  return { mode, sites }
}

export function policySummary(policy: SitePolicy): string {
  if (policy.mode === "only") {
    return policy.sites.length === 0
      ? "Nothing listed, so effects are off everywhere."
      : "Effects run only on the sites above."
  }
  return policy.sites.length === 0
    ? "Nothing listed, so effects run everywhere."
    : "Effects run everywhere except the sites above."
}

export async function loadSitePolicy(): Promise<SitePolicy> {
  const bag = await chrome.storage.local.get(SITE_POLICY_KEY)
  return sanitizeSitePolicy(bag[SITE_POLICY_KEY])
}

export async function saveSitePolicy(policy: SitePolicy): Promise<void> {
  await chrome.storage.local.set({ [SITE_POLICY_KEY]: sanitizeSitePolicy(policy) })
}
