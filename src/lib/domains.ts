import { registrableDomain } from "./host"
import type { ControlLayout, DockPlaceId } from "./types"

export type DomainProfile = {
  domains: string[]
  /**
   * Later. Netflix keeps the movie name in the page, not the tab title,
   * so this will read that element and return its text.
   */
  readTitle?: () => string
  /**
   * Later. Hotstar already restores the resume point, so this will be true
   * and the extension will not save or seek a timestamp there.
   */
  skipResume?: boolean
  /** Placement used until this site saves its own position for that control. */
  dock?: Partial<ControlLayout>
}

/**
 * Site-specific behavior. Resume tracking already calls these hooks.
 * Netflix and Hotstar are registered now; their title reader and resume
 * skip are filled in later, so nothing about those sites changes yet.
 */
export const DOMAIN_PROFILES: DomainProfile[] = [
  {
    domains: ["netflix.com"]
    // readTitle: later — the movie name is not in the tab title.
  },
  {
    domains: ["hotstar.com"]
    // skipResume: later — Hotstar saves the resume point itself.
  },
  {
    domains: ["instagram.com"],
    dock: {
      fullscreen: { edge: "right", slot: "center", x: 92, y: 50 },
      progress: { edge: "bottom", slot: "start", x: 0, y: 100 },
      time: { edge: "bottom", slot: "start", x: 8, y: 90 }
    }
  }
]

export function domainProfile(hostname: string): DomainProfile | null {
  const domain = registrableDomain(hostname)
  for (const profile of DOMAIN_PROFILES) {
    if (profile.domains.some((entry) => domain === entry || domain.endsWith(`.${entry}`))) {
      return profile
    }
  }
  return null
}

export function readPageTitle(): string {
  let custom = ""
  try {
    const read = domainProfile(location.hostname)?.readTitle?.()
    if (typeof read === "string") custom = read
  } catch {
    custom = ""
  }
  const raw = custom.trim() ? custom : document.title
  return raw.replace(/\s+/g, " ").trim().slice(0, 160)
}

export function siteSkipsResume(hostname = location.hostname): boolean {
  return domainProfile(hostname)?.skipResume === true
}

export function domainDockDefaults(hostname: string): Partial<ControlLayout> {
  return domainProfile(hostname)?.dock ?? {}
}
