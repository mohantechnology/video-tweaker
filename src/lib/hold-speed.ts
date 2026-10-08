import { clamp } from "./effects"
import { HOLD_PLAYBACK_RATE, PLAYBACK_RATE_MAX, PLAYBACK_RATE_MIN, type EffectSettings } from "./types"

/** Matches the shadow host id in bridge.ts. Kept here so this file does not import the bridge. */
const DOCK_HOST_ID = "vee-csui"

const HOLD_DELAY_MS = 400
const MOVE_CANCEL_PX = 12
const CLICK_SWALLOW_MS = 500
/** Browser control bars sit on the bottom edge of the video element. */
const CONTROL_STRIP_PX = 48
/** A control this large is the picture's own tap surface, not a like or volume button. */
const SURFACE_COVERS = 0.5
/** Horizontal center, this far down from the top of the picture. */
const BADGE_TOP_RATIO = 0.14

const mediaRate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate")
const mediaDefaultRate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "defaultPlaybackRate")

const CONTROL_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='slider']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='switch']",
  ".ytp-chrome-bottom",
  ".ytp-chrome-top",
  ".ytp-progress-bar",
  ".ytp-settings-menu",
  ".ytp-popup"
].join(", ")

const BADGE_STYLE = `
.vee-hold-badge {
  position: fixed !important;
  inset: auto !important;
  width: max-content !important;
  height: auto !important;
  margin: 0 !important;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 0 !important;
  border-radius: 999px;
  overflow: visible !important;
  pointer-events: none !important;
  color: #fff !important;
  background: rgba(0, 0, 0, 0.72) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  font-size: 15px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: 0.01em;
  transform: translate(-50%, -50%);
  user-select: none;
}
.vee-hold-badge svg {
  display: block;
  flex: none;
}
`

type Phase = "pending" | "boosting" | "yielded"

type Session = {
  pointerId: number
  video: HTMLVideoElement
  originX: number
  originY: number
  savedRate: number
  savedDefault: number
  phase: Phase
  swallowClick: boolean
  target: Element | null
  holdTimer: number
  reassertTimer: number
}

export type HoldSpeedOptions = {
  getVideo: () => HTMLVideoElement | null
  getSettings: () => EffectSettings
  isAllowed: () => boolean
  isAdBoosted: (video: HTMLVideoElement) => boolean
  /** Writes the site's saved speed after a hold, when this extension owns playback. */
  restoreOwned: (video: HTMLVideoElement) => void
}

let options: HoldSpeedOptions | null = null
let session: Session | null = null
let swallowUntil = 0
let swallowVideo: HTMLVideoElement | null = null
let listening = false
let badge: HTMLDivElement | null = null
let badgeLabel: HTMLSpanElement | null = null
let lockedVideo: HTMLVideoElement | null = null
let savedRateDesc: PropertyDescriptor | undefined
let savedDefaultDesc: PropertyDescriptor | undefined

function holdRate(): number {
  return clamp(HOLD_PLAYBACK_RATE, PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX)
}

function formatHoldRate(rate: number): string {
  const rounded = Math.round(rate * 100) / 100
  return `${rounded.toFixed(2).replace(/\.?0+$/, "")}×`
}

function gestureAllowed(): boolean {
  if (!options?.isAllowed()) return false
  const settings = options.getSettings()
  return settings.enabled && settings.playbackEnabled !== false && settings.holdToSpeed !== false
}

function playing(video: HTMLVideoElement): boolean {
  return !video.paused && !video.ended && video.isConnected
}

/**
 * Rate from before this hold, so an ad boost can restore that speed instead of 2×.
 * Null while the press has not changed the rate yet.
 */
export function heldTransport(video: HTMLVideoElement): { rate: number; defaultRate: number } | null {
  if (!session || session.video !== video || session.phase === "pending") return null
  return { rate: session.savedRate, defaultRate: session.savedDefault }
}

/** Ad playback takes the rate. A hold in progress stops writing 2× and does not restore over the ad. */
export function yieldHoldToAd(video: HTMLVideoElement): void {
  if (!session || session.video !== video) return
  if (session.phase === "pending") {
    finish(false)
    return
  }
  if (session.phase !== "boosting") return
  unwatch(session.video)
  cancelAnimationFrame(session.reassertTimer)
  session.reassertTimer = 0
  hideBadge()
  session.phase = "yielded"
  unlockRates()
}

export function releaseHold(video: HTMLVideoElement | null): void {
  if (!session) return
  if (video && session.video !== video) return
  finish(session.phase === "boosting")
}

/** Puts 2× back after another writer, such as the playback settings, touched the same video. */
export function maintainHold(video: HTMLVideoElement | null): void {
  if (!options || !session || session.phase !== "boosting" || !video || video !== session.video) return
  if (options.isAdBoosted(video)) {
    yieldHoldToAd(video)
    return
  }
  if (!playing(video) || !gestureAllowed()) {
    finish(true)
    return
  }
  writeHoldRate(video)
  placeBadge(video)
}

function forcingHold(video: HTMLVideoElement): boolean {
  return session?.phase === "boosting" && session.video === video
}

let applyingRate = false

function installRateGuard(
  video: HTMLVideoElement,
  key: "playbackRate" | "defaultPlaybackRate",
  proto: PropertyDescriptor | undefined
): void {
  if (!proto?.get || !proto.set) return
  const get = proto.get
  const set = proto.set
  Object.defineProperty(video, key, {
    configurable: true,
    enumerable: true,
    get() {
      return get.call(video)
    },
    set(value: number) {
      if (applyingRate) return
      applyingRate = true
      try {
        set.call(video, forcingHold(video) ? holdRate() : value)
      } finally {
        applyingRate = false
      }
    }
  })
}

/**
 * Instagram writes playbackRate back to 1 as soon as it changes.
 * While the hold is on, those writes stay at the hold speed.
 */
function lockRates(video: HTMLVideoElement): void {
  unlockRates()
  savedRateDesc = Object.getOwnPropertyDescriptor(video, "playbackRate")
  savedDefaultDesc = Object.getOwnPropertyDescriptor(video, "defaultPlaybackRate")
  lockedVideo = video
  try {
    installRateGuard(video, "playbackRate", mediaRate)
    installRateGuard(video, "defaultPlaybackRate", mediaDefaultRate)
  } catch {
    unlockRates()
  }
}

function restoreRateProperty(
  video: HTMLVideoElement,
  key: "playbackRate" | "defaultPlaybackRate",
  desc: PropertyDescriptor | undefined
): void {
  try {
    if (desc) Object.defineProperty(video, key, desc)
    else Reflect.deleteProperty(video, key)
  } catch {
    /* The player sealed the property. The next direct write still runs. */
  }
}

function unlockRates(): void {
  const video = lockedVideo
  if (!video) return
  lockedVideo = null
  const rateDesc = savedRateDesc
  const defaultDesc = savedDefaultDesc
  savedRateDesc = undefined
  savedDefaultDesc = undefined
  restoreRateProperty(video, "playbackRate", rateDesc)
  restoreRateProperty(video, "defaultPlaybackRate", defaultDesc)
}

function writeHoldRate(video: HTMLVideoElement): boolean {
  const rate = holdRate()
  const previous = video.playbackRate
  const previousDefault = video.defaultPlaybackRate
  try {
    if (video.playbackRate !== rate) video.playbackRate = rate
    if (video.defaultPlaybackRate !== rate) video.defaultPlaybackRate = rate
    return true
  } catch {
    try {
      video.playbackRate = previous
      video.defaultPlaybackRate = previousDefault
    } catch {
      /* The player rejected both the hold and the rollback. */
    }
    return false
  }
}

function restoreRates(video: HTMLVideoElement, savedRate: number, savedDefault: number): void {
  if (!options) return
  const settings = options.getSettings()
  const playbackOn = settings.enabled && settings.playbackEnabled !== false
  const managed = settings.playbackTouched && playbackOn
  try {
    if (managed) {
      const rate = clamp(settings.playbackRate, PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX)
      video.defaultPlaybackRate = rate
      video.playbackRate = rate
    } else if (!settings.playbackTouched) {
      video.defaultPlaybackRate = savedDefault
      video.playbackRate = savedRate
    } else {
      video.defaultPlaybackRate = savedDefault
    }
  } catch {
    /* The player can reject a rate write while a frame is locked. */
  }
  if (settings.playbackTouched) options.restoreOwned(video)
}

function finish(restore: boolean): void {
  const current = session
  if (!current) return
  unwatch(current.video)
  window.clearTimeout(current.holdTimer)
  cancelAnimationFrame(current.reassertTimer)
  releaseCapture(current)
  hideBadge()
  const restoreBoost = restore && current.phase === "boosting"
  session = null
  unlockRates()
  if (current.swallowClick) {
    swallowUntil = performance.now() + CLICK_SWALLOW_MS
    swallowVideo = current.video
  }
  if (restoreBoost) restoreRates(current.video, current.savedRate, current.savedDefault)
}

function unwatch(video: HTMLVideoElement): void {
  video.removeEventListener("pause", onVideoStop)
  video.removeEventListener("ended", onVideoStop)
}

function onVideoStop(): void {
  if (session?.phase === "boosting") finish(true)
}

function releaseCapture(current: Session): void {
  const target = current.target
  if (!target?.hasPointerCapture(current.pointerId)) return
  try {
    target.releasePointerCapture(current.pointerId)
  } catch {
    /* The pointer is already gone. */
  }
}

function pointInVideo(event: MouseEvent, video: HTMLVideoElement): boolean {
  const rect = video.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false
  if (event.clientX < rect.left || event.clientX > rect.right) return false
  if (event.clientY < rect.top || event.clientY > rect.bottom) return false
  if (video.controls && event.clientY >= rect.bottom - CONTROL_STRIP_PX) return false
  return true
}

/**
 * Instagram lays a button or link over the whole picture for play and pause.
 * That surface contains the press, but it does not contain the video element,
 * so a size check is what separates it from the small buttons beside the picture.
 */
function coversPicture(node: Element, video: HTMLVideoElement): boolean {
  const picture = video.getBoundingClientRect()
  const box = node.getBoundingClientRect()
  if (picture.width < 1 || picture.height < 1 || box.width < 1 || box.height < 1) return false
  const width = Math.min(box.right, picture.right) - Math.max(box.left, picture.left)
  const height = Math.min(box.bottom, picture.bottom) - Math.max(box.top, picture.top)
  if (width <= 0 || height <= 0) return false
  return (width * height) / (picture.width * picture.height) >= SURFACE_COVERS
}

function pressBlocked(event: PointerEvent, video: HTMLVideoElement): boolean {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue
    if (node.id === DOCK_HOST_ID) return true
    if (node !== video && node.contains(video)) break
    if (node instanceof HTMLElement && node.isContentEditable) return true
    if (node.matches(CONTROL_SELECTOR) && !coversPicture(node, video)) return true
  }
  return false
}

function onPointerDown(event: PointerEvent): void {
  if (!options || session || event.button !== 0 || !event.isPrimary || !gestureAllowed()) return
  const video = options.getVideo()
  if (!video || !playing(video) || options.isAdBoosted(video)) return
  if (!pointInVideo(event, video) || pressBlocked(event, video)) return

  session = {
    pointerId: event.pointerId,
    video,
    originX: event.clientX,
    originY: event.clientY,
    savedRate: video.playbackRate || 1,
    savedDefault: video.defaultPlaybackRate || video.playbackRate || 1,
    phase: "pending",
    swallowClick: false,
    target: event.target instanceof Element ? event.target : null,
    holdTimer: 0,
    reassertTimer: 0
  }
  session.holdTimer = window.setTimeout(engage, HOLD_DELAY_MS)
}

function movedTooFar(event: PointerEvent): boolean {
  if (!session) return false
  const dx = event.clientX - session.originX
  const dy = event.clientY - session.originY
  return dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX
}

function onPointerMove(event: PointerEvent): void {
  if (!session || event.pointerId !== session.pointerId) return
  if (session.phase === "pending" && movedTooFar(event)) finish(false)
}

function onPointerUp(event: PointerEvent): void {
  if (!session || event.pointerId !== session.pointerId) return
  const tookOver = session.phase === "boosting" || session.phase === "yielded"
  if (tookOver) {
    event.preventDefault()
    event.stopPropagation()
  }
  finish(session.phase === "boosting")
}

function overHeldVideo(event: Event, video: HTMLVideoElement): boolean {
  if (event.composedPath().includes(video)) return true
  return event instanceof MouseEvent && pointInVideo(event, video)
}

function onClick(event: MouseEvent): void {
  if (performance.now() > swallowUntil || !swallowVideo) return
  if (event.composedPath().some((node) => node instanceof Element && node.id === DOCK_HOST_ID)) return
  if (!overHeldVideo(event, swallowVideo)) return
  event.preventDefault()
  event.stopPropagation()
}

function onContextMenu(event: Event): void {
  if (session) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (performance.now() > swallowUntil || !swallowVideo || !overHeldVideo(event, swallowVideo)) return
  event.preventDefault()
  event.stopPropagation()
}

function onVisibility(): void {
  if (!document.hidden) return
  if (session?.phase === "boosting") finish(true)
  else if (session?.phase === "pending") finish(false)
}

function engage(): void {
  if (!session || session.phase !== "pending" || !options) return
  const video = session.video
  const active = options.getVideo()
  if (
    !playing(video) ||
    (active && active !== video) ||
    !gestureAllowed() ||
    options.isAdBoosted(video)
  ) {
    finish(false)
    return
  }
  if (!writeHoldRate(video)) {
    finish(false)
    return
  }
  session.phase = "boosting"
  lockRates(video)
  if (!writeHoldRate(video)) {
    finish(true)
    return
  }
  session.swallowClick = true
  video.addEventListener("pause", onVideoStop)
  video.addEventListener("ended", onVideoStop)
  try {
    session.target?.setPointerCapture(session.pointerId)
  } catch {
    /* The press target may not allow capture. Release still arrives on the document. */
  }
  showBadge(video)
  session.reassertTimer = requestAnimationFrame(tick)
}

function tick(): void {
  if (!session || session.phase !== "boosting") return
  reassert()
  if (!session || session.phase !== "boosting") return
  session.reassertTimer = requestAnimationFrame(tick)
}

function reassert(): void {
  if (!session || session.phase !== "boosting" || !options) return
  const video = session.video
  const active = options.getVideo()
  if (!playing(video) || (active && active !== video) || !gestureAllowed()) {
    finish(true)
    return
  }
  if (options.isAdBoosted(video)) {
    yieldHoldToAd(video)
    return
  }
  if (!writeHoldRate(video)) {
    finish(true)
    return
  }
  placeBadge(video)
}

function ensureStyle(): void {
  if (document.getElementById("vee-hold-style")) return
  const style = document.createElement("style")
  style.id = "vee-hold-style"
  style.textContent = BADGE_STYLE
  document.documentElement.appendChild(style)
}

function chevron(): SVGPathElement {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", "currentColor")
  path.setAttribute("stroke-width", "1.8")
  path.setAttribute("stroke-linecap", "round")
  path.setAttribute("stroke-linejoin", "round")
  return path
}

function ensureBadge(): HTMLDivElement {
  if (badge) return badge
  ensureStyle()
  const root = document.createElement("div")
  root.className = "vee-hold-badge"
  root.setAttribute("role", "status")
  root.setAttribute("popover", "manual")
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  icon.setAttribute("viewBox", "0 0 18 14")
  icon.setAttribute("width", "18")
  icon.setAttribute("height", "14")
  icon.setAttribute("aria-hidden", "true")
  const left = chevron()
  left.setAttribute("d", "M1 1 L7 7 L1 13")
  const right = chevron()
  right.setAttribute("d", "M8 1 L14 7 L8 13")
  icon.append(left, right)
  const label = document.createElement("span")
  root.append(icon, label)
  badge = root
  badgeLabel = label
  return root
}

function badgeParent(video: HTMLVideoElement): HTMLElement {
  const fullscreen = document.fullscreenElement
  if (fullscreen === video) {
    return video.parentElement instanceof HTMLElement ? video.parentElement : document.documentElement
  }
  if (fullscreen instanceof HTMLElement && fullscreen.contains(video)) return fullscreen
  return document.documentElement
}

function placeBadge(video: HTMLVideoElement): void {
  const node = ensureBadge()
  const rect = video.getBoundingClientRect()
  const parent = node.matches(":popover-open")
    ? (document.body ?? document.documentElement)
    : badgeParent(video)
  if (node.parentElement !== parent) parent.appendChild(node)
  const offset = Math.max(40, Math.min(rect.height * BADGE_TOP_RATIO, 88))
  node.style.left = `${rect.left + rect.width / 2}px`
  node.style.top = `${rect.top + offset}px`
}

function presentBadge(node: HTMLDivElement): void {
  const root = document.body ?? document.documentElement
  if (!node.isConnected) root.appendChild(node)
  if (node.matches(":popover-open")) return
  try {
    node.showPopover()
  } catch {
    /* Popover is unavailable. Drop the attribute so the badge is a normal fixed label. */
    node.removeAttribute("popover")
  }
}

function showBadge(video: HTMLVideoElement): void {
  const node = ensureBadge()
  const label = formatHoldRate(holdRate())
  if (badgeLabel) badgeLabel.textContent = label
  node.setAttribute("aria-label", label)
  presentBadge(node)
  placeBadge(video)
}

function hideBadge(): void {
  if (!badge) return
  try {
    if (badge.matches(":popover-open")) badge.hidePopover()
  } catch {
    /* The badge is already out of the top layer. */
  }
  badge.remove()
}

function addListeners(): void {
  if (listening) return
  listening = true
  document.addEventListener("pointerdown", onPointerDown, true)
  document.addEventListener("pointermove", onPointerMove, true)
  document.addEventListener("pointerup", onPointerUp, true)
  document.addEventListener("pointercancel", onPointerUp, true)
  document.addEventListener("click", onClick, true)
  document.addEventListener("contextmenu", onContextMenu, true)
  document.addEventListener("visibilitychange", onVisibility)
}

function removeListeners(): void {
  if (!listening) return
  listening = false
  document.removeEventListener("pointerdown", onPointerDown, true)
  document.removeEventListener("pointermove", onPointerMove, true)
  document.removeEventListener("pointerup", onPointerUp, true)
  document.removeEventListener("pointercancel", onPointerUp, true)
  document.removeEventListener("click", onClick, true)
  document.removeEventListener("contextmenu", onContextMenu, true)
  document.removeEventListener("visibilitychange", onVisibility)
}

function stopHoldSpeed(): void {
  finish(session?.phase === "boosting")
  removeListeners()
  options = null
  badge?.remove()
  badge = null
  badgeLabel = null
  document.getElementById("vee-hold-style")?.remove()
}

export function startHoldSpeed(next: HoldSpeedOptions): { stop: () => void } {
  stopHoldSpeed()
  options = next
  addListeners()
  return { stop: stopHoldSpeed }
}
