import { clamp } from "./effects"
import { registrableDomain } from "./host"
import { PLAYBACK_RATE_MAX, PLAYBACK_RATE_MIN, type EffectSettings } from "./types"

/** Matches the shadow host id in bridge.ts. Kept here so this file does not import the bridge. */
const DOCK_HOST_ID = "vee-csui"

export const AD_PLAYBACK_RATE = 16
const SEEK_TAIL_SECONDS = 0.05
const SEEK_ALREADY_SECONDS = 0.3
const CLICK_COOLDOWN_MS = 650
const CLICK_FOLLOW_UP_MS = 400
const CLICK_FOLLOW_UP_HOPS = 2

const BLOCKED_NAME = /\b(intro|recap|credits|preview|song)\b/i
/** "Skip ad", "Skip ads", "Close ad", plus a trailing pod label such as "2 of 3". */
const EXACT_SKIP = /^(?:skip\s+ads?|close\s+ad)(?:\s+.+)?$/i
const BARE_SKIP = /^skip$/i
const AD_BADGE = /^(ad|ads|advertisement)$/i
const AD_COUNTDOWN = /^skip\s+ads?\s+in\b/i
const COUNTDOWN_TEXT = /\bskip(?:\s+ads?)?\s+in\b|\b(?:wait|in)\s+\d+/i

const YOUTUBE_SKIP_SELECTOR = [
  ".ytp-ad-skip-button",
  ".ytp-ad-skip-button-modern",
  ".ytp-skip-ad-button",
  ".ytp-ad-skip-button-slot",
  ".ytp-ad-skip-button-container button",
  ".ytp-ad-overlay-close-button"
].join(", ")

/**
 * Where the current player draws an ad, including layouts that omit `ad-showing`.
 * The centered card (`ytp-video-interstitial-buttoned-centered-layout`) is a
 * Sponsored interstitial: the movie `<video>` is slid off screen and Skip lives on the card.
 */
const YOUTUBE_AD_UI =
  ".ad-showing, .ad-interrupting, .video-ads, .ytp-ad-module, .ytp-ad-player-overlay, .ytp-video-interstitial-buttoned-centered-layout"

type SavedRate = {
  rate: number
  defaultRate: number
}

const boosted = new WeakMap<HTMLVideoElement, SavedRate>()
const lastClick = new WeakMap<HTMLElement, { at: number; key: string }>()
let clickArmed = false
let followUp = 0

export function normalizeLabel(name: string): string {
  return name.replace(/\s+/g, " ").trim()
}

export function isCountdownLabel(name: string): boolean {
  const text = normalizeLabel(name)
  return text.length > 0 && (AD_COUNTDOWN.test(text) || COUNTDOWN_TEXT.test(text))
}

/**
 * True for "Skip ad", "Skip ads", and "Close ad", including a pod suffix
 * such as "Skip ad 2 of 2". "Skip" alone and skip-intro are not.
 */
export function isExactSkipAdLabel(name: string): boolean {
  const text = normalizeLabel(name)
  if (!text || BLOCKED_NAME.test(text) || isCountdownLabel(text)) return false
  return EXACT_SKIP.test(text)
}

/** YouTube's ad player may label the control "Skip" with no further words. */
export function isSkipControlLabel(name: string, allowBareSkip = false): boolean {
  if (isExactSkipAdLabel(name)) return true
  if (!allowBareSkip) return false
  const text = normalizeLabel(name)
  return text.length > 0 && !BLOCKED_NAME.test(text) && !isCountdownLabel(text) && BARE_SKIP.test(text)
}

/** Hotstar ad badge, countdown, or an exact skip/close label. */
export function isAdSignalLabel(name: string): boolean {
  const text = normalizeLabel(name)
  if (!text || text.length > 48 || BLOCKED_NAME.test(text)) return false
  return EXACT_SKIP.test(text) || AD_BADGE.test(text) || AD_COUNTDOWN.test(text)
}

export function isAdBadgeLabel(name: string): boolean {
  const text = normalizeLabel(name)
  return text.length > 0 && text.length <= 48 && AD_BADGE.test(text)
}

/**
 * Where to put currentTime, or null when this timeline must not be seeked.
 * Callers only use this while an ad signal is present. Length is not capped:
 * some ads run longer than a few minutes, and the ad signal is what keeps
 * this off the movie.
 */
export function seekTarget(duration: number, currentTime: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null
  if (!Number.isFinite(currentTime)) return null
  const target = Math.max(0, duration - SEEK_TAIL_SECONDS)
  if (currentTime >= target - SEEK_ALREADY_SECONDS) return null
  return target
}

export function skipMethodFlags(
  settings: EffectSettings,
  allowed: boolean
): { click: boolean; speed: boolean; seek: boolean } {
  const on =
    allowed &&
    settings.enabled &&
    settings.playbackEnabled !== false &&
    settings.skipAdsEnabled === true
  return {
    click: on && settings.skipAds,
    speed: on && settings.skipAdsSpeed,
    seek: on && settings.skipAdsSeek
  }
}

export function releaseSkipBoost(video: HTMLVideoElement | null, settings?: EffectSettings): void {
  if (!video) return
  const saved = boosted.get(video)
  if (!saved) return
  const managed =
    !!settings &&
    settings.playbackTouched &&
    settings.enabled &&
    settings.playbackEnabled !== false
  const rate = managed
    ? clamp(settings.playbackRate, PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX)
    : saved.rate
  try {
    video.playbackRate = rate
    video.defaultPlaybackRate = managed ? rate : saved.defaultRate
    boosted.delete(video)
  } catch {
    /* Keep the saved rate and try again on the next scan. */
  }
}

export function applySkipMethods(options: {
  video: HTMLVideoElement | null
  roots: ParentNode[]
  settings: EffectSettings
  allowed: boolean
}): void {
  const { video, roots, settings, allowed } = options
  const flags = skipMethodFlags(settings, allowed)
  if (!flags.speed) releaseSkipBoost(video, settings)
  clickArmed = flags.click
  if (!flags.click) {
    window.clearTimeout(followUp)
    followUp = 0
  }
  if (!flags.click && !flags.speed && !flags.seek) return

  const ad = video && (flags.speed || flags.seek) ? findAdRoot(video, roots) : null
  if (video && flags.speed && ad) boostAdPlayback(video)
  else if (video && flags.speed) releaseSkipBoost(video, settings)
  if (video && flags.seek && ad) seekAd(video)
  if (flags.click && clickSkipButtons(roots)) scheduleAnotherPass(roots, CLICK_FOLLOW_UP_HOPS)
}

function boostAdPlayback(video: HTMLVideoElement): void {
  if (!boosted.has(video)) {
    boosted.set(video, {
      rate: video.playbackRate || 1,
      defaultRate: video.defaultPlaybackRate || video.playbackRate || 1
    })
  }
  try {
    if (video.playbackRate !== AD_PLAYBACK_RATE) video.playbackRate = AD_PLAYBACK_RATE
    if (video.defaultPlaybackRate !== AD_PLAYBACK_RATE) {
      video.defaultPlaybackRate = AD_PLAYBACK_RATE
    }
  } catch {
    /* The player can reject rate changes during an ad. The next scan tries again. */
  }
}

function seekAd(video: HTMLVideoElement): void {
  const target = seekTarget(video.duration, video.currentTime)
  if (target == null) return
  try {
    video.currentTime = target
  } catch {
    /* Some players lock the timeline. The next scan tries again while the ad signal lasts. */
  }
}

function findAdRoot(video: HTMLVideoElement, roots: ParentNode[]): HTMLElement | null {
  const domain = registrableDomain(location.hostname)
  if (domain === "youtube.com") return youtubeAdRoot(video, roots)
  const player = nearestPlayer(video)
  if (domain === "hotstar.com" || domain === "jiohotstar.com") {
    return hotstarAdVisible(player) ? player : null
  }
  return exactSkipVisible(player) ? player : null
}

function youtubeAdRoot(video: HTMLVideoElement, roots: ParentNode[]): HTMLElement | null {
  const closest = video.closest(".html5-video-player, #movie_player")
  if (closest instanceof HTMLElement && playerIsShowingAd(closest)) return closest
  for (const root of roots) {
    if (!canSearch(root)) continue
    const players = root.querySelectorAll(".html5-video-player, #movie_player")
    for (const player of players) {
      if (!(player instanceof HTMLElement) || !player.contains(video) || !playerIsShowingAd(player)) continue
      return player
    }
  }
  return null
}

function playerIsShowingAd(player: HTMLElement): boolean {
  return player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting")
}

function nearestPlayer(video: HTMLVideoElement): HTMLElement {
  let node: HTMLElement = video
  for (let depth = 0; depth < 8 && node.parentElement; depth += 1) {
    const parent = node.parentElement
    if (parent === document.body || parent === document.documentElement) break
    node = parent
  }
  return node
}

function hotstarAdVisible(player: HTMLElement): boolean {
  const nodes = player.querySelectorAll("button, [role='button'], [aria-label], span, p")
  let seen = 0
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (++seen > 400) break
    const name = accessibleName(node)
    if (!isAdSignalLabel(name)) continue
    if (!isShown(node)) continue
    if (isAdBadgeLabel(name)) {
      const rect = node.getBoundingClientRect()
      if (rect.width >= 160 || rect.height >= 80) continue
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim()
      if (text.length > name.length + 2) continue
    }
    return true
  }
  return false
}

function exactSkipVisible(root: ParentNode): boolean {
  if (!canSearch(root)) return false
  const nodes = root.querySelectorAll("button, [role='button']")
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (!isExactSkipAdLabel(accessibleName(node))) continue
    if (isShown(node)) return true
  }
  return false
}

function scheduleAnotherPass(roots: ParentNode[], hops: number): void {
  window.clearTimeout(followUp)
  followUp = window.setTimeout(() => {
    followUp = 0
    if (!clickArmed) return
    const clicked = clickSkipButtons(roots)
    if (clicked && hops > 0) scheduleAnotherPass(roots, hops - 1)
  }, CLICK_FOLLOW_UP_MS)
}

/** Presses every ready Skip or Close control. Returns true when at least one was pressed. */
function clickSkipButtons(roots: ParentNode[]): boolean {
  const domain = registrableDomain(location.hostname)
  const found: HTMLElement[] = []
  for (const root of roots) {
    if (!canSearch(root)) continue
    if (domain === "youtube.com") {
      const buttons = root.querySelectorAll(`button, [role='button'], ${YOUTUBE_SKIP_SELECTOR}`)
      for (const button of buttons) {
        if (!(button instanceof HTMLElement)) continue
        if (!button.closest(YOUTUBE_AD_UI)) continue
        if (!isYoutubeSkipControl(button)) continue
        found.push(button)
      }
    }
    const buttons = root.querySelectorAll("button, [role='button']")
    for (const button of buttons) {
      if (!(button instanceof HTMLElement)) continue
      const label = controlLabel(button)
      if (!isExactSkipAdLabel(label)) continue
      found.push(button)
    }
  }
  const ready = outermost(unique(found))
    .filter((button) => isClickable(button, domain === "youtube.com") && !controlIsCountdown(button))
    .sort((a, b) => closeRank(a) - closeRank(b))
  let clicked = false
  for (const button of ready) {
    if (clickOnce(button)) clicked = true
    if (button.isConnected && domain === "youtube.com" && closeRank(button) === 0) finishYoutubeAd(button)
  }
  return clicked
}

/**
 * Known YouTube skip classes, plus a visible "Skip" that only exists inside the ad UI.
 * Hidden countdown text is ignored so a ready Skip is not rejected by a leftover "Skip in 5".
 */
function isYoutubeSkipControl(element: HTMLElement): boolean {
  const label = controlLabel(element)
  if (label && (BLOCKED_NAME.test(label) || isCountdownLabel(label))) return false
  if (
    element.matches(
      ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot, .ytp-ad-overlay-close-button"
    )
  ) {
    return true
  }
  return isSkipControlLabel(label, true)
}

function controlIsCountdown(element: HTMLElement): boolean {
  const label = controlLabel(element)
  if (isExactSkipAdLabel(label) || isSkipControlLabel(label, true)) return false
  return isCountdownLabel(label)
}

function finishYoutubeAd(button: HTMLElement): void {
  // This card is not the ad timeline. The movie is only hidden (top offset). Seeking would jump the movie.
  if (button.closest(".ytp-video-interstitial-buttoned-centered-layout")) return
  const player = button.closest(".html5-video-player, #movie_player")
  if (!(player instanceof HTMLElement) || !playerIsShowingAd(player)) return
  const video = player.querySelector("video.html5-main-video, video")
  if (!(video instanceof HTMLVideoElement)) return
  const target = seekTarget(video.duration, video.currentTime)
  if (target == null) return
  try {
    video.currentTime = target
  } catch {
    /* The player can refuse the seek. The next scan tries again while Skip is showing. */
  }
}

function closeRank(element: HTMLElement): number {
  const name = `${accessibleName(element)} ${normalizeLabel(element.textContent ?? "")}`
  if (/close\s+ad\b/i.test(name) || element.matches(".ytp-ad-overlay-close-button")) return 1
  return 0
}

/**
 * Pod index such as "1 of 2", so the next ad in the same button can be clicked
 * without waiting out the previous ad's cooldown.
 */
function adPodMarker(element: HTMLElement): string {
  const player = element.closest(".html5-video-player, .ad-showing")
  if (!(player instanceof HTMLElement)) return ""
  const nodes = player.querySelectorAll(".ytp-ad-pod-index, .ytp-ad-simple-ad-badge, .ytp-ad-badge")
  for (const node of nodes) {
    const text = normalizeLabel(node.textContent ?? "")
    const pod = text.match(/\b\d+\s+of\s+\d+\b/i)
    if (pod) return pod[0].toLowerCase()
  }
  return ""
}

function unique(elements: HTMLElement[]): HTMLElement[] {
  return [...new Set(elements)]
}

/** Keep the outer Skip control. Clicking an inner slot does not run YouTube's handler. */
function outermost(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((element) => !elements.some((other) => other !== element && other.contains(element)))
}

function clickOnce(element: HTMLElement): boolean {
  const now = Date.now()
  const key = `${controlLabel(element)}|${adPodMarker(element)}`
  const previous = lastClick.get(element)
  if (previous && previous.key === key && now - previous.at < CLICK_COOLDOWN_MS) return false
  lastClick.set(element, { at: now, key })
  try {
    if (registrableDomain(location.hostname) === "youtube.com") {
      // Isolated-world click() never reaches YouTube's handler. The page-world
      // script sees this attribute and calls click() there.
      element.setAttribute("data-vee-press", "1")
    } else {
      element.click()
    }
    return true
  } catch {
    return false
  }
}

function canSearch(root: ParentNode): boolean {
  if (root instanceof ShadowRoot && root.host instanceof Element && root.host.id === DOCK_HOST_ID) {
    return false
  }
  return typeof root.querySelectorAll === "function"
}

function accessibleName(element: HTMLElement): string {
  return controlLabel(element)
}

/** Label from aria, or from text the viewer can see. Hidden countdown nodes are left out. */
function controlLabel(element: HTMLElement): string {
  const aria = element.getAttribute("aria-label")?.trim()
  if (aria) return normalizeLabel(aria)
  const labelledBy = element.getAttribute("aria-labelledby")
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
    const label = normalizeLabel(text)
    if (label) return label
  }
  return normalizeLabel(shownText(element))
}

function shownText(element: HTMLElement): string {
  if (element.getAttribute("aria-hidden") === "true") return ""
  const style = getComputedStyle(element)
  if (style.display === "none" || style.visibility === "hidden") return ""
  let text = ""
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ""
      continue
    }
    if (node instanceof HTMLElement) text += ` ${shownText(node)}`
  }
  return text
}

function isShown(element: HTMLElement): boolean {
  const style = getComputedStyle(element)
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function isClickable(element: HTMLElement, youtube = false): boolean {
  if (element.getAttribute("aria-disabled") === "true") return false
  if ("disabled" in element && (element as HTMLButtonElement).disabled) return false
  const style = getComputedStyle(element)
  if (!youtube && style.pointerEvents === "none") return false
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false
  return hasBox(element)
}

function hasBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  if (rect.width >= 8 && rect.height >= 8) return true
  for (const child of element.children) {
    if (child instanceof HTMLElement && hasBox(child)) return true
  }
  return false
}
