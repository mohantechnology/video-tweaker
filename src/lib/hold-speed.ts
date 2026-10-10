import { clamp, protectMediaLevel } from "./effects"
import { scanPage } from "./find-video"
import { registrableDomain } from "./host"
import { SEEK_BAR_ID, seekBarHitTest } from "./seek-bar"
import { PLAYBACK_RATE_MAX, PLAYBACK_RATE_MIN, clampHoldPlaybackRate, type EffectSettings } from "./types"

/** Matches the shadow host id in bridge.ts. Kept here so this file does not import the bridge. */
const DOCK_HOST_ID = "vee-csui"
const YOUTUBE_SPEED_STYLE_ID = "vee-hide-yt-speed"

const HOLD_DELAY_MS = 400
const MOVE_CANCEL_PX = 12
const CLICK_SWALLOW_MS = 500
/** Browser control bars sit on the bottom edge of the video element. */
const CONTROL_STRIP_PX = 48
/** A control this large is the picture's own tap surface, not a like or volume button. */
const SURFACE_COVERS = 0.5
/** Center of the badge, this far down from the top of the visible picture. */
const BADGE_TOP_RATIO = 0.1

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
  transform: translate(-50%, -50%) !important;
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
  /** Loudness before this hold. Rate changes must not keep a different level. */
  savedVolume: number
  savedMuted: boolean
  /** True when the picture was already playing at pointer down. */
  wasPlaying: boolean
  phase: Phase
  swallowClick: boolean
  target: Element | null
  holdTimer: number
  reassertTimer: number
}

export type HoldSpeedOptions = {
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
let resumePending = false
let resumeNotBefore = 0

function holdRate(): number {
  return clampHoldPlaybackRate(options?.getSettings().holdPlaybackRate ?? Number.NaN)
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
 * Rate from before this hold, so an ad boost can restore that speed instead of the hold speed.
 * Null while the press has not changed the rate yet.
 */
export function heldTransport(video: HTMLVideoElement): { rate: number; defaultRate: number } | null {
  if (!session || session.video !== video || session.phase === "pending") return null
  return { rate: session.savedRate, defaultRate: session.savedDefault }
}

/** Ad playback takes the rate. A hold in progress stops writing the hold speed and does not restore over the ad. */
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
  // The pointer still owns this picture. Switching the dock's main video must
  // not cancel a press that has not been released yet.
  if (video && session.phase !== "yielded") return
  finish(session.phase === "boosting")
}

/** Puts the hold speed back after another writer, such as the playback settings, touched the same video. */
export function maintainHold(video: HTMLVideoElement | null): void {
  if (!options || !session || session.phase !== "boosting" || !video || video !== session.video) return
  if (options.isAdBoosted(video)) {
    yieldHoldToAd(video)
    return
  }
  if (!gestureAllowed() || !video.isConnected || video.ended) {
    finish(true)
    return
  }
  if (session.wasPlaying && video.paused) resumeHeld(video)
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
        const next = forcingHold(video) ? holdRate() : value
        if (get.call(video) === next) return
        set.call(video, next)
        if (forcingHold(video) && session?.video === video) {
          protectMediaLevel(video, session.savedVolume, session.savedMuted)
        }
      } finally {
        applyingRate = false
      }
    }
  })
}

/**
 * Players such as Instagram, Facebook, and Dailymotion write playbackRate
 * back as soon as it changes. While the hold is on, those writes stay at the hold speed.
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

function writeHoldRate(video: HTMLVideoElement): void {
  const rate = holdRate()
  const volume = session?.video === video ? session.savedVolume : video.volume
  const muted = session?.video === video ? session.savedMuted : video.muted
  let wrote = false
  try {
    if (video.playbackRate !== rate) {
      video.playbackRate = rate
      wrote = true
    }
  } catch {
    /* The player rejected the rate. The next frame tries again. */
  }
  try {
    if (video.defaultPlaybackRate !== rate) {
      video.defaultPlaybackRate = rate
      wrote = true
    }
  } catch {
    /* Some players lock the default rate. The playback rate still changes. */
  }
  if (wrote) protectMediaLevel(video, volume, muted)
}

/**
 * A press on Facebook or Dailymotion pauses the picture before the hold starts.
 * While the button stays down, start that picture again.
 */
function resumeHeld(video: HTMLVideoElement): void {
  if (resumePending || performance.now() < resumeNotBefore) return
  if (!video.isConnected || video.ended || !video.paused) return
  resumePending = true
  let pending: Promise<void>
  try {
    pending = video.play()
  } catch {
    resumePending = false
    resumeNotBefore = performance.now() + HOLD_DELAY_MS
    return
  }
  void pending.then(
    () => {
      resumePending = false
    },
    () => {
      resumePending = false
      resumeNotBefore = performance.now() + HOLD_DELAY_MS
    }
  )
}

function restoreRates(
  video: HTMLVideoElement,
  savedRate: number,
  savedDefault: number,
  volume: number,
  muted: boolean
): void {
  if (!options) return
  const settings = options.getSettings()
  const playbackOn = settings.enabled && settings.playbackEnabled !== false
  const managed = settings.playbackTouched && playbackOn
  const audioOn =
    settings.audioTouched &&
    settings.enabled &&
    settings.audioEnabled !== false &&
    settings.basicAudioOn !== false
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
  if (settings.playbackTouched || settings.audioTouched) options.restoreOwned(video)
  // Last write wins. The rate restore above can change loudness after restoreOwned
  // has already sampled it, so put the intended level back once more.
  if (audioOn) protectMediaLevel(video, settings.volume, settings.muted)
  else protectMediaLevel(video, volume, muted)
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
  const savedVolume = current.savedVolume
  const savedMuted = current.savedMuted
  session = null
  resumePending = false
  resumeNotBefore = 0
  unlockRates()
  if (current.swallowClick) {
    swallowUntil = performance.now() + CLICK_SWALLOW_MS
    swallowVideo = current.video
  }
  if (restoreBoost) {
    restoreRates(current.video, current.savedRate, current.savedDefault, savedVolume, savedMuted)
  }
}

function unwatch(video: HTMLVideoElement): void {
  video.removeEventListener("pause", onVideoStop)
  video.removeEventListener("ended", onVideoStop)
}

function onVideoStop(): void {
  if (!session || session.phase !== "boosting") return
  if (session.video.ended) finish(true)
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
  if (seekBarHitTest(event)) return false
  const picture = visiblePicture(video)
  if (!boxVisible(picture)) return false
  if (event.clientX < picture.left || event.clientX > picture.right) return false
  if (event.clientY < picture.top || event.clientY > picture.bottom) return false
  if (video.controls && event.clientY >= picture.bottom - CONTROL_STRIP_PX) return false
  return true
}

/**
 * Facebook and Dailymotion lay a button or link over the whole picture for play and pause.
 * That surface contains the press, but it does not contain the video element,
 * so a size check against the visible picture separates it from the small buttons beside the picture.
 */
function coversPicture(node: Element, video: HTMLVideoElement): boolean {
  const picture = visiblePicture(video)
  if (!boxVisible(picture)) return false
  const box = node.getBoundingClientRect()
  if (box.width < 1 || box.height < 1) return false
  const width = Math.min(box.right, picture.right) - Math.max(box.left, picture.left)
  const height = Math.min(box.bottom, picture.bottom) - Math.max(box.top, picture.top)
  if (width <= 0 || height <= 0) return false
  return (width * height) / (boxWidth(picture) * boxHeight(picture)) >= SURFACE_COVERS
}

function pressBlocked(event: PointerEvent, video: HTMLVideoElement): boolean {
  if (seekBarHitTest(event)) return true
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue
    if (node.id === DOCK_HOST_ID) return true
    if (node !== video && node.contains(video)) break
    if (node instanceof HTMLElement && node.isContentEditable) return true
    if (node.matches(CONTROL_SELECTOR) && !coversPicture(node, video)) return true
  }
  return false
}

/** Playing, or paused by this press before the listener ran. A never-started picture stays out. */
function canHold(video: HTMLVideoElement): boolean {
  if (!video.isConnected || video.ended) return false
  if (playing(video)) return true
  return video.paused && video.currentTime > 0
}

/**
 * The picture under the pointer. Pages often have more than one video,
 * and the dock's main video is not always the one being pressed.
 * The smallest matching picture wins when several overlap.
 */
function videoAtPoint(event: PointerEvent): HTMLVideoElement | null {
  if (!options) return null
  let best: HTMLVideoElement | null = null
  let bestArea = Infinity
  for (const video of scanPage().videos) {
    if (!canHold(video) || options.isAdBoosted(video)) continue
    if (!pointInVideo(event, video) || pressBlocked(event, video)) continue
    const picture = visiblePicture(video)
    const area = boxWidth(picture) * boxHeight(picture)
    if (area < bestArea) {
      best = video
      bestArea = area
    }
  }
  return best
}

function onPointerDown(event: PointerEvent): void {
  if (!options || session || event.button !== 0 || !event.isPrimary || !gestureAllowed()) return
  const video = videoAtPoint(event)
  if (!video) return

  session = {
    pointerId: event.pointerId,
    video,
    originX: event.clientX,
    originY: event.clientY,
    savedRate: video.playbackRate || 1,
    savedDefault: video.defaultPlaybackRate || video.playbackRate || 1,
    savedVolume: video.volume,
    savedMuted: video.muted,
    wasPlaying: true,
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
  if (
    event.composedPath().some(
      (node) => node instanceof Element && (node.id === DOCK_HOST_ID || node.id === SEEK_BAR_ID)
    )
  ) {
    return
  }
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
  if (!video.isConnected || video.ended || !gestureAllowed() || options.isAdBoosted(video)) {
    finish(false)
    return
  }
  session.phase = "boosting"
  session.savedVolume = video.volume
  session.savedMuted = video.muted
  lockRates(video)
  writeHoldRate(video)
  session.swallowClick = true
  video.addEventListener("pause", onVideoStop)
  video.addEventListener("ended", onVideoStop)
  if (session.wasPlaying && video.paused) resumeHeld(video)
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
  if (!video.isConnected || video.ended || !gestureAllowed()) {
    finish(true)
    return
  }
  if (options.isAdBoosted(video)) {
    yieldHoldToAd(video)
    return
  }
  if (session.wasPlaying && video.paused) resumeHeld(video)
  writeHoldRate(video)
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

type Box = { left: number; top: number; right: number; bottom: number }

function boxFromRect(rect: DOMRectReadOnly): Box {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

function boxWidth(box: Box): number {
  return box.right - box.left
}

function boxHeight(box: Box): number {
  return box.bottom - box.top
}

function boxVisible(box: Box): boolean {
  return boxWidth(box) >= 1 && boxHeight(box) >= 1
}

function intersectBoxes(a: Box, b: Box, clipX = true, clipY = true): Box {
  return {
    left: clipX ? Math.max(a.left, b.left) : a.left,
    top: clipY ? Math.max(a.top, b.top) : a.top,
    right: clipX ? Math.min(a.right, b.right) : a.right,
    bottom: clipY ? Math.min(a.bottom, b.bottom) : a.bottom
  }
}

function cssPx(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parentElementOf(node: Node): Element | null {
  if (node.parentElement) return node.parentElement
  const root = node.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

function transformIsFlat(transform: string): boolean {
  if (!transform || transform === "none") return true
  try {
    const matrix = new DOMMatrix(transform)
    return (
      Math.abs(matrix.m12) < 0.001 &&
      Math.abs(matrix.m21) < 0.001 &&
      Math.abs(matrix.m13) < 0.001 &&
      Math.abs(matrix.m23) < 0.001 &&
      Math.abs(matrix.m31) < 0.001 &&
      Math.abs(matrix.m32) < 0.001
    )
  } catch {
    return false
  }
}

function paintsContent(style: CSSStyleDeclaration): boolean {
  return style.contentVisibility === "auto" || /paint|strict|content/.test(style.contain)
}

/** Fixed boxes escape overflow until an ancestor becomes their containing block. */
function makesContainingBlock(style: CSSStyleDeclaration): boolean {
  if (style.transform && style.transform !== "none") return true
  if (style.filter && style.filter !== "none") return true
  if (style.perspective && style.perspective !== "none") return true
  if (style.backdropFilter && style.backdropFilter !== "none") return true
  if (/paint|layout|strict|content/.test(style.contain)) return true
  if (style.contentVisibility === "auto" || style.contentVisibility === "hidden") return true
  const will = style.willChange
  return Boolean(will && will !== "auto" && /transform|filter|perspective|contain/.test(will))
}

function clipBounds(element: Element, style: CSSStyleDeclaration): Box {
  const rect = element.getBoundingClientRect()
  const box = boxFromRect(rect)
  if (!transformIsFlat(style.transform)) return box
  const localW = element instanceof HTMLElement ? element.offsetWidth : rect.width
  const localH = element instanceof HTMLElement ? element.offsetHeight : rect.height
  if (localW < 1 || localH < 1) return box
  const scaleX = rect.width / localW
  const scaleY = rect.height / localH
  return {
    left: box.left + cssPx(style.borderLeftWidth) * scaleX,
    top: box.top + cssPx(style.borderTopWidth) * scaleY,
    right: box.right - cssPx(style.borderRightWidth) * scaleX,
    bottom: box.bottom - cssPx(style.borderBottomWidth) * scaleY
  }
}

function axisOffset(token: string | undefined, extra: number, scale: number): number {
  const value = token?.trim() || "50%"
  if (value.endsWith("%")) {
    const pct = Number.parseFloat(value)
    return Number.isFinite(pct) ? (extra * pct) / 100 : extra / 2
  }
  if (value.endsWith("px")) {
    const px = Number.parseFloat(value)
    return Number.isFinite(px) ? px * scale : extra / 2
  }
  if (value === "left" || value === "top") return 0
  if (value === "right" || value === "bottom") return extra
  if (value === "center") return extra / 2
  return extra / 2
}

function contentBox(video: HTMLVideoElement, border: Box, style: CSSStyleDeclaration): Box {
  const localW = video.offsetWidth || boxWidth(border)
  const localH = video.offsetHeight || boxHeight(border)
  if (localW < 1 || localH < 1) return border
  const scaleX = boxWidth(border) / localW
  const scaleY = boxHeight(border) / localH
  const box = {
    left: border.left + (cssPx(style.borderLeftWidth) + cssPx(style.paddingLeft)) * scaleX,
    top: border.top + (cssPx(style.borderTopWidth) + cssPx(style.paddingTop)) * scaleY,
    right: border.right - (cssPx(style.borderRightWidth) + cssPx(style.paddingRight)) * scaleX,
    bottom: border.bottom - (cssPx(style.borderBottomWidth) + cssPx(style.paddingBottom)) * scaleY
  }
  return boxVisible(box) ? box : border
}

function fittedSize(fit: string, localW: number, localH: number, videoW: number, videoH: number): {
  width: number
  height: number
} | null {
  const ratio = videoW / videoH
  const elementRatio = localW / localH
  if (fit === "contain") {
    if (ratio > elementRatio) return { width: localW, height: localW / ratio }
    return { width: localH * ratio, height: localH }
  }
  if (fit === "none") return { width: videoW, height: videoH }
  if (fit === "scale-down") {
    const contained =
      ratio > elementRatio
        ? { width: localW, height: localW / ratio }
        : { width: localH * ratio, height: localH }
    if (videoW <= contained.width && videoH <= contained.height) return { width: videoW, height: videoH }
    return contained
  }
  return null
}

/** Frames drawn inside the element. Letterboxing stays outside this box. */
function fittedFrame(video: HTMLVideoElement, border: Box, style: CSSStyleDeclaration): Box {
  const videoW = video.videoWidth
  const videoH = video.videoHeight
  const fit = style.objectFit
  if (!videoW || !videoH || fit === "fill" || fit === "cover") return border

  const box = contentBox(video, border, style)
  const width = boxWidth(box)
  const height = boxHeight(box)
  const localW = Math.max(1, video.clientWidth - cssPx(style.paddingLeft) - cssPx(style.paddingRight))
  const localH = Math.max(1, video.clientHeight - cssPx(style.paddingTop) - cssPx(style.paddingBottom))
  const size = fittedSize(fit, localW, localH, videoW, videoH)
  if (!size || width < 1 || height < 1) return border

  const scaleX = width / localW
  const scaleY = height / localH
  const contentW = size.width * scaleX
  const contentH = size.height * scaleY
  const extraX = width - contentW
  const extraY = height - contentH
  const [xToken, yToken] = style.objectPosition.split(/\s+/).filter(Boolean)
  const left = box.left + axisOffset(xToken, extraX, scaleX)
  const top = box.top + axisOffset(yToken, extraY, scaleY)
  const frame = { left, top, right: left + contentW, bottom: top + contentH }
  const visible = intersectBoxes(frame, box)
  return boxVisible(visible) ? visible : border
}

function insetClip(video: HTMLVideoElement, border: Box, style: CSSStyleDeclaration): Box | null {
  const clip = style.clipPath
  if (!clip.startsWith("inset(") || !clip.endsWith(")")) return null
  const parts = clip
    .slice(6, -1)
    .split(/\s+round\b/i)[0]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const edges =
    parts.length === 1
      ? [parts[0], parts[0], parts[0], parts[0]]
      : parts.length === 2
        ? [parts[0], parts[1], parts[0], parts[1]]
        : parts.length === 3
          ? [parts[0], parts[1], parts[2], parts[1]]
          : parts.length === 4
            ? parts
            : null
  if (!edges) return null

  const width = boxWidth(border)
  const height = boxHeight(border)
  const localW = video.offsetWidth || width
  const localH = video.offsetHeight || height
  const scaleX = localW ? width / localW : 1
  const scaleY = localH ? height / localH : 1
  const top = insetLength(edges[0], height, scaleY)
  const right = insetLength(edges[1], width, scaleX)
  const bottom = insetLength(edges[2], height, scaleY)
  const left = insetLength(edges[3], width, scaleX)
  if (top === null || right === null || bottom === null || left === null) return null
  const box = {
    left: border.left + left,
    top: border.top + top,
    right: border.right - right,
    bottom: border.bottom - bottom
  }
  return boxVisible(box) ? box : null
}

function insetLength(token: string, size: number, scale: number): number | null {
  if (token.endsWith("%")) {
    const pct = Number.parseFloat(token)
    return Number.isFinite(pct) ? (size * pct) / 100 : null
  }
  if (token.endsWith("px")) {
    const px = Number.parseFloat(token)
    return Number.isFinite(px) ? px * scale : null
  }
  return null
}

function viewportBox(): Box {
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
}

/**
 * Picture the viewer can see. The video element also includes letterboxing
 * and the parts an overflow parent has cropped away.
 */
function visiblePicture(video: HTMLVideoElement): Box {
  const border = boxFromRect(video.getBoundingClientRect())
  if (!boxVisible(border)) return border

  const videoStyle = getComputedStyle(video)
  let flat = transformIsFlat(videoStyle.transform)
  let fixed = videoStyle.position === "fixed"
  const clips: { box: Box; clipX: boolean; clipY: boolean }[] = []

  for (let node = parentElementOf(video); node; node = parentElementOf(node)) {
    const style = getComputedStyle(node)
    if (flat && !transformIsFlat(style.transform)) flat = false
    const contained = makesContainingBlock(style)
    if (!fixed || contained) {
      const paints = paintsContent(style)
      const clipX = style.overflowX !== "visible" || paints
      const clipY = style.overflowY !== "visible" || paints
      if (clipX || clipY) {
        const bounds = clipBounds(node, style)
        if (boxVisible(bounds)) clips.push({ box: bounds, clipX, clipY })
      }
    }
    if (fixed && contained) fixed = false
  }

  let frame = flat ? fittedFrame(video, border, videoStyle) : border
  if (flat) {
    const inset = insetClip(video, border, videoStyle)
    if (inset) frame = intersectBoxes(frame, inset)
  }
  for (const clip of clips) frame = intersectBoxes(frame, clip.box, clip.clipX, clip.clipY)

  const seen = intersectBoxes(frame, viewportBox())
  if (boxVisible(seen)) return seen
  if (boxVisible(frame)) return frame
  return border
}

function placeBadge(video: HTMLVideoElement): void {
  const node = ensureBadge()
  const label = formatHoldRate(holdRate())
  if (badgeLabel && badgeLabel.textContent !== label) {
    badgeLabel.textContent = label
    node.setAttribute("aria-label", label)
  }
  const picture = visiblePicture(video)
  const parent = node.matches(":popover-open")
    ? (document.body ?? document.documentElement)
    : badgeParent(video)
  if (node.parentElement !== parent) parent.appendChild(node)
  const x = picture.left + boxWidth(picture) / 2
  const y = picture.top + boxHeight(picture) * BADGE_TOP_RATIO
  node.style.setProperty("left", `${x}px`, "important")
  node.style.setProperty("top", `${y}px`, "important")
  node.style.setProperty("right", "auto", "important")
  node.style.setProperty("bottom", "auto", "important")
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

function hideYoutubeSpeedLabel(hidden: boolean): void {
  if (registrableDomain(location.hostname) !== "youtube.com") return
  const current = document.getElementById(YOUTUBE_SPEED_STYLE_ID)
  if (!hidden) {
    current?.remove()
    return
  }
  if (current) return
  const style = document.createElement("style")
  style.id = YOUTUBE_SPEED_STYLE_ID
  style.textContent = ".ytp-speedmaster-overlay{display:none!important}"
  document.documentElement.append(style)
}

function showBadge(video: HTMLVideoElement): void {
  const node = ensureBadge()
  const label = formatHoldRate(holdRate())
  if (badgeLabel) badgeLabel.textContent = label
  node.setAttribute("aria-label", label)
  presentBadge(node)
  placeBadge(video)
  hideYoutubeSpeedLabel(true)
}

function hideBadge(): void {
  hideYoutubeSpeedLabel(false)
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
  hideYoutubeSpeedLabel(false)
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
