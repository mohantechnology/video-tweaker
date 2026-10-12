import { registrableDomain } from "./host"
import {
  DOCK_CONTROL_KEYS,
  DOCK_FLAG_KEYS,
  DOCK_ICON_ORDER,
  customAnchor,
  defaultDockPlacement,
  resolveDockLayout,
  type ControlLayout,
  type DockEdge,
  type DockFlagKey,
  type DockPlaceId,
  type DockPlacement,
  type DockSlot,
  type EffectSettings
} from "./types"

export type DockSkin =
  | "default"
  | "youtube"
  | "instagram"
  | "facebook"
  | "prime"
  | "netflix"
  | "hotstar"

export type DockContext = {
  pathname: string
  videoWidth: number
  videoHeight: number
  /** Rendered video box. A portrait file in a wide player still uses the long-video bar. */
  boxWidth: number
  boxHeight: number
}

export type DomainDockPreset = {
  /** Controls turned on while this preset is still automatic. */
  controls: Partial<Record<DockFlagKey, boolean>>
  layout: Partial<ControlLayout>
  /** Order along a shared side. Icons not listed keep the generic order. */
  order: readonly DockPlaceId[]
  /**
   * Measure a control on the video and sit the right-hand stack under it.
   * Used for Facebook reels. Missing means the layout slots alone.
   */
  anchor?: "facebook-search"
}

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
  /** Icon treatment for this player. Other sites keep the generic controls. */
  skin: DockSkin
  /** Extra host test. Amazon storefronts share one registrable name per country. */
  matchHost?: (domain: string) => boolean
  /**
   * When set, the profile applies only on these paths. Omitted pathname
   * skips the profile, so a product page does not inherit Prime Video.
   */
  path?: (pathname: string) => boolean
  /** Placement and controls used when no variant matches. */
  dock?: DomainDockPreset
  /** First match wins. Facebook reels use this; long video uses `dock`. */
  variants?: { id: string; match: (ctx: DockContext) => boolean; dock: DomainDockPreset }[]
}

function at(edge: DockEdge, slot: DockSlot): DockPlacement {
  return { edge, slot, ...customAnchor("play", edge, slot) }
}

const PROGRESS_BOTTOM: DockPlacement = { edge: "bottom", slot: "start", x: 0, y: 100 }

const YOUTUBE_DOCK: DomainDockPreset = {
  controls: { dockLoop: true, dockSkip: true, dockSpeed: true },
  layout: {
    loop: at("bottom", "center"),
    skip: at("bottom", "center"),
    speed: at("bottom", "center")
  },
  order: ["loop", "skip", "speed"]
}

const INSTAGRAM_DOCK: DomainDockPreset = {
  controls: {
    dockProgress: true,
    dockTime: true,
    dockSpeed: true,
    dockSkip: true,
    dockFullscreen: true,
    dockDownload: true,
    dockQuality: true
  },
  layout: {
    progress: PROGRESS_BOTTOM,
    time: at("bottom", "start"),
    speed: at("bottom", "start"),
    skip: at("bottom", "start"),
    download: at("top", "end"),
    quality: at("top", "end"),
    fullscreen: at("top", "end")
  },
  order: ["time", "speed", "skip", "download", "quality", "fullscreen"]
}

const FACEBOOK_LONG: DomainDockPreset = {
  controls: { dockSpeed: true, dockLoop: true, dockDownload: true, dockQuality: true },
  layout: {
    speed: at("bottom", "end"),
    loop: at("bottom", "end"),
    quality: at("bottom", "end"),
    download: at("bottom", "end")
  },
  order: ["speed", "loop", "quality", "download"]
}

const FACEBOOK_VERTICAL: DomainDockPreset = {
  controls: { dockTime: true, dockSpeed: true, dockFullscreen: true, dockDownload: true, dockQuality: true },
  layout: {
    time: at("top", "center"),
    speed: at("right", "end"),
    quality: at("right", "end"),
    fullscreen: at("right", "end"),
    download: at("right", "end")
  },
  order: ["speed", "quality", "fullscreen", "download", "time"],
  anchor: "facebook-search"
}

const PRIME_DOCK: DomainDockPreset = {
  controls: { dockSpeed: true, dockLoop: true },
  layout: {
    speed: at("top", "end"),
    loop: at("top", "end")
  },
  order: ["speed", "loop"]
}

const BOTTOM_RIGHT_DOCK: DomainDockPreset = {
  controls: { dockSpeed: true, dockLoop: true },
  layout: {
    speed: at("bottom", "end"),
    loop: at("bottom", "end")
  },
  order: ["speed", "loop"]
}

function facebookVertical(ctx: DockContext): boolean {
  if (/\/reels?(?:\/|$)/i.test(ctx.pathname)) return true
  const width = ctx.boxWidth || ctx.videoWidth
  const height = ctx.boxHeight || ctx.videoHeight
  return width > 0 && height > width
}

function isAmazonStore(domain: string): boolean {
  return domain === "amazon.com" || /^amazon\.[a-z.]+$/.test(domain)
}

function isPrimePath(pathname: string): boolean {
  return /\/gp\/video(?:\/|$)/i.test(pathname)
}

/**
 * Site-specific behavior. Resume tracking already calls these hooks.
 * Netflix and Hotstar title and resume hooks are filled in later.
 * Player presets apply on first visit and again when positions are reset.
 */
export const DOMAIN_PROFILES: DomainProfile[] = [
  {
    domains: ["youtube.com", "youtube-nocookie.com"],
    skin: "youtube",
    dock: YOUTUBE_DOCK
  },
  {
    domains: ["instagram.com"],
    skin: "instagram",
    dock: INSTAGRAM_DOCK
  },
  {
    domains: ["facebook.com", "fb.com", "fb.watch"],
    skin: "facebook",
    dock: FACEBOOK_LONG,
    variants: [{ id: "vertical", match: facebookVertical, dock: FACEBOOK_VERTICAL }]
  },
  {
    domains: ["primevideo.com"],
    skin: "prime",
    dock: PRIME_DOCK
  },
  {
    domains: [],
    matchHost: isAmazonStore,
    path: isPrimePath,
    skin: "prime",
    dock: PRIME_DOCK
  },
  {
    domains: ["netflix.com"],
    skin: "netflix",
    dock: BOTTOM_RIGHT_DOCK
    // readTitle: later — the movie name is not in the tab title.
  },
  {
    domains: ["hotstar.com", "jiohotstar.com"],
    skin: "hotstar",
    dock: BOTTOM_RIGHT_DOCK
    // skipResume: later — Hotstar saves the resume point itself.
  }
]

function emptyDockContext(): DockContext {
  return { pathname: "", videoWidth: 0, videoHeight: 0, boxWidth: 0, boxHeight: 0 }
}

function hostListed(profile: DomainProfile, domain: string): boolean {
  if (profile.matchHost?.(domain)) return true
  return profile.domains.some((entry) => domain === entry || domain.endsWith(`.${entry}`))
}

export function dockContextOf(video: HTMLVideoElement | null, pathname?: string): DockContext {
  const path = pathname ?? (typeof location === "undefined" ? "" : location.pathname)
  const box = video?.getBoundingClientRect()
  return {
    pathname: path,
    videoWidth: video?.videoWidth || 0,
    videoHeight: video?.videoHeight || 0,
    boxWidth: Math.round(box?.width || 0),
    boxHeight: Math.round(box?.height || 0)
  }
}

/**
 * `pathname` omitted skips path-limited profiles, so title lookup on
 * amazon.com does not treat a product page as Prime Video.
 */
export function domainProfile(hostname: string, pathname?: string): DomainProfile | null {
  const domain = registrableDomain(hostname)
  for (const profile of DOMAIN_PROFILES) {
    if (!hostListed(profile, domain)) continue
    if (profile.path && (pathname == null || !profile.path(pathname))) continue
    return profile
  }
  return null
}

export function domainDockPreset(hostname: string, ctx: DockContext): DomainDockPreset | null {
  const profile = domainProfile(hostname, ctx.pathname)
  if (!profile) return null
  const variant = profile.variants?.find((item) => item.match(ctx))
  return variant?.dock ?? profile.dock ?? null
}

export function domainSkin(hostname: string, pathname: string): DockSkin {
  return domainProfile(hostname, pathname)?.skin ?? "default"
}

export function domainShape(hostname: string, ctx: DockContext): string {
  const profile = domainProfile(hostname, ctx.pathname)
  if (!profile) return ""
  if (profile.skin === "youtube" && /\/shorts(?:\/|$)/i.test(ctx.pathname)) return "short"
  if (profile.skin === "facebook" && facebookVertical(ctx)) return "vertical"
  return ""
}

export function domainIconOrder(hostname: string, ctx: DockContext): readonly DockPlaceId[] {
  const preferred = domainDockPreset(hostname, ctx)?.order
  if (!preferred || preferred.length === 0) return DOCK_ICON_ORDER
  const rank = new Map<DockPlaceId, number>()
  preferred.forEach((id, index) => rank.set(id, index))
  return [...DOCK_ICON_ORDER].sort((a, b) => (rank.get(a) ?? 100) - (rank.get(b) ?? 100))
}

export function domainPlacement(hostname: string, ctx: DockContext, id: DockPlaceId): DockPlacement {
  const site = domainDockPreset(hostname, ctx)?.layout[id]
  return site ? { ...defaultDockPlacement(id), ...site } : defaultDockPlacement(id)
}

/** What the player shows. Automatic flags and placement follow the live preset. */
export function domainDockView(
  settings: EffectSettings,
  hostname: string,
  ctx: DockContext
): EffectSettings {
  const preset = domainDockPreset(hostname, ctx)
  if (!preset || (!settings.dockLayoutAuto && !settings.dockFlagsAuto)) return settings
  const next: EffectSettings = { ...settings }
  if (settings.dockFlagsAuto) {
    next.dockProgress = false
    for (const key of DOCK_CONTROL_KEYS) next[key] = false
    for (const key of DOCK_FLAG_KEYS) {
      if (preset.controls[key] === true) next[key] = true
    }
  }
  if (settings.dockLayoutAuto) {
    next.dockLayout = resolveDockLayout(undefined, "left", preset.layout)
  }
  return next
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

function clipTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160)
}

function genericTitle(value: string): boolean {
  const text = value.replace(/^\(\d+\)\s*/, "").trim()
  return /^(instagram|reels?|watch|video|video player)$/i.test(text)
}

/** Quoted caption from an Instagram tab or Open Graph title. */
function parseInstagramTitle(raw: string): string {
  const text = raw.replace(/^\(\d+\)\s*/, "").replace(/\s+/g, " ").trim()
  if (!text || genericTitle(text)) return ""
  const quoted = text.match(/[“"]([^”"]{1,300})[”"]\s*$/)
  if (quoted?.[1] && /instagram/i.test(text)) return clipTitle(quoted[1])
  const loose = text.match(/on Instagram:\s*(.+)$/i)
  if (!loose?.[1]) return ""
  return clipTitle(loose[1].replace(/^[“"]|[”"]$/g, ""))
}

function pagePostTitle(): string {
  if (!/\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/.test(location.pathname)) return ""
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || ""
  return parseInstagramTitle(og) || parseInstagramTitle(document.title)
}

function isProfileHref(href: string): boolean {
  try {
    const parts = new URL(href, "https://www.instagram.com").pathname.split("/").filter(Boolean)
    if (parts.length !== 1) return false
    return !/^(p|reel|reels|tv|explore|stories|direct|accounts|about)$/i.test(parts[0])
  } catch {
    return false
  }
}

function captionText(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement
  for (const link of clone.querySelectorAll("a")) {
    if (isProfileHref(link.getAttribute("href") || "")) link.remove()
  }
  return clipTitle(clone.textContent || "")
}

function chromeCaption(text: string): boolean {
  if (text.length < 2 || genericTitle(text)) return true
  if (
    /^(follow|following|message|like|liked|comment|comments|share|save|saved|more|send|audio|original audio|view insights|watch more reels|see more|see translation|see original)$/i.test(
      text
    )
  ) {
    return true
  }
  if (/^\d[\d,.]*(\s*(likes?|views?|comments?|shares?|plays?))?$/i.test(text)) return true
  if (/^(\d+\s+)?(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i.test(text)) return true
  if (/^view all \d+ comments$/i.test(text)) return true
  if (/^liked by\b/i.test(text)) return true
  if (/^add a comment\b/i.test(text)) return true
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) return true
  if (/^@?[A-Za-z0-9._]{1,30}$/.test(text)) return true
  return false
}

/** Caption drawn on the current Instagram video. */
function captionNear(video: HTMLVideoElement): string {
  const videoBox = video.getBoundingClientRect()
  if (videoBox.width < 40 || videoBox.height < 40) return ""
  const scope = video.closest("article") || video.closest("[role='dialog']") || video.closest("main") || document.body
  let best = ""
  for (const node of scope.querySelectorAll("h1, span[dir='auto']")) {
    if (!(node instanceof HTMLElement)) continue
    if (node.closest("button, [role='button'], nav")) continue
    if (node.querySelector("span[dir='auto'], h1")) continue
    const text = captionText(node)
    if (chromeCaption(text)) continue
    const box = node.getBoundingClientRect()
    if (box.width < 8 || box.height < 8) continue
    const cx = box.left + box.width / 2
    const cy = box.top + Math.min(box.height, 24) / 2
    const near =
      cx >= videoBox.left - 8 &&
      cx <= videoBox.left + videoBox.width * 0.92 &&
      cy >= videoBox.top + videoBox.height * 0.35 &&
      cy <= videoBox.bottom + 120
    if (!near || text.length <= best.length) continue
    best = text
  }
  return best
}

/** Name to save. Instagram uses the post caption when the page has one. */
export function readVideoTitle(video: HTMLVideoElement | null): string {
  if (video && registrableDomain(location.hostname) === "instagram.com") {
    const caption = captionNear(video) || pagePostTitle()
    if (caption) return caption
  }
  const own = clipTitle(video?.getAttribute("title") || "")
  if (own && !genericTitle(own)) return own
  return readPageTitle()
}

export function siteSkipsResume(hostname = location.hostname): boolean {
  return domainProfile(hostname)?.skipResume === true
}

export function domainDockDefaults(hostname: string): Partial<ControlLayout> {
  return domainDockPreset(hostname, emptyDockContext())?.layout ?? {}
}
