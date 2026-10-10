import { seekBy, togglePictureInPicture } from "./effects"
import { formatClock } from "./progress"
import type { EffectSettings } from "./types"

export const SEEK_BAR_ID = "vee-seek-bar"

const STYLE_ID = "vee-seek-bar-style"
const Z_INDEX = 2147483646
const TRACK_HEIGHT_PX = 4
const HIT_HEIGHT_PX = 20
const DOCK_HEIGHT_PX = 76
const HIDE_MS = 650
const TOUCH_HIDE_MS = 2400
const WRITE_GUARD_MS = 280
const SKIP_SECONDS = 10
const SPEEDS = [0.5, 1, 1.5, 2, 3, 4]

export type DockControl =
  | { type: "audio"; volume?: number; muted?: boolean }
  | { type: "rate"; playbackRate: number }
  | { type: "loop"; loop: boolean }

export type DockMedia = {
  volume: number
  muted: boolean
  /** Null while a hold or an ad boost owns the rate, so that speed is not saved. */
  playbackRate: number | null
  loop: boolean
}

export type DockRateSource = "hold" | "ignore" | "live"

const BAR_STYLE = `
#${SEEK_BAR_ID} {
  position: fixed !important;
  inset: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  z-index: ${Z_INDEX};
  box-sizing: border-box;
  pointer-events: none !important;
  display: none;
  font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  color: #fff;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}
#${SEEK_BAR_ID}[data-visible="true"] {
  display: block;
}
#${SEEK_BAR_ID} .vee-scrim {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 108px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.22) 48%, rgba(0, 0, 0, 0) 100%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
}
#${SEEK_BAR_ID}[data-hot="true"] .vee-scrim {
  opacity: 1;
}
#${SEEK_BAR_ID} .vee-chrome {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 16px;
  height: 52px;
  opacity: 0;
  visibility: hidden;
  transform: translateY(6px);
  pointer-events: none;
  transition: opacity 180ms ease, transform 180ms ease, visibility 0s linear 180ms;
}
#${SEEK_BAR_ID}[data-hot="true"] .vee-chrome {
  opacity: 1;
  visibility: visible;
  transform: none;
  pointer-events: auto;
  transition: opacity 180ms ease, transform 180ms ease, visibility 0s linear 0s;
}
#${SEEK_BAR_ID} .vee-chrome-row {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
#${SEEK_BAR_ID} .vee-chrome-cluster {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
#${SEEK_BAR_ID} .vee-chrome-cluster[data-side="right"] {
  margin-left: auto;
}
#${SEEK_BAR_ID} [hidden] {
  display: none !important;
}
#${SEEK_BAR_ID} .vee-chrome-btn,
#${SEEK_BAR_ID} .vee-rate-btn,
#${SEEK_BAR_ID} .vee-speed-opt {
  font: inherit;
  color: inherit;
  cursor: pointer;
}
#${SEEK_BAR_ID} .vee-chrome-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #fff;
}
#${SEEK_BAR_ID} .vee-chrome-btn:hover,
#${SEEK_BAR_ID} .vee-rate-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
#${SEEK_BAR_ID} .vee-chrome-btn[data-on="true"] {
  color: #8d73ff;
}
#${SEEK_BAR_ID} .vee-chrome-btn svg {
  display: block;
}
#${SEEK_BAR_ID} .vee-chrome-time {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  white-space: nowrap;
}
#${SEEK_BAR_ID} .vee-pop-anchor {
  position: relative;
  display: flex;
  align-items: center;
}
#${SEEK_BAR_ID} .vee-rate-btn {
  min-width: 36px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
}
#${SEEK_BAR_ID} .vee-rate-btn[data-on="true"] {
  color: #e4dcff;
  background: rgba(141, 115, 255, 0.42);
}
#${SEEK_BAR_ID} .vee-pop {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  border-radius: 12px;
  background: rgba(18, 16, 24, 0.94);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 120ms ease;
}
#${SEEK_BAR_ID} .vee-pop[data-open="true"] {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
#${SEEK_BAR_ID} .vee-speed-pop {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 76px;
  padding: 6px;
}
#${SEEK_BAR_ID} .vee-speed-opt {
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
#${SEEK_BAR_ID} .vee-speed-opt:hover {
  background: rgba(255, 255, 255, 0.1);
}
#${SEEK_BAR_ID} .vee-speed-opt[data-on="true"] {
  color: #c8b6ff;
}
#${SEEK_BAR_ID} .vee-volume-pop {
  padding: 10px 8px;
}
#${SEEK_BAR_ID} .vee-volume-pop input[type="range"] {
  writing-mode: vertical-lr;
  direction: rtl;
  width: 22px;
  height: 84px;
  margin: 0;
  accent-color: #8d73ff;
  cursor: pointer;
}
#${SEEK_BAR_ID} .vee-seek-hit {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${HIT_HEIGHT_PX}px;
  pointer-events: auto;
  touch-action: none;
  cursor: pointer;
}
#${SEEK_BAR_ID} .vee-seek-track {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${TRACK_HEIGHT_PX}px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.28);
  transition: height 120ms ease;
}
#${SEEK_BAR_ID}:hover .vee-seek-track,
#${SEEK_BAR_ID}[data-hot="true"] .vee-seek-track,
#${SEEK_BAR_ID}[data-drag="true"] .vee-seek-track {
  height: 6px;
}
#${SEEK_BAR_ID} .vee-seek-buffered {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}
#${SEEK_BAR_ID} .vee-seek-played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: rgba(141, 115, 255, 0.95);
  pointer-events: none;
}
#${SEEK_BAR_ID} .vee-seek-tip {
  position: absolute;
  bottom: ${HIT_HEIGHT_PX + 4}px;
  left: 0;
  transform: translateX(-50%);
  padding: 3px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  color: #f6f3ff;
  background: rgba(20, 16, 32, 0.92);
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
  white-space: nowrap;
}
#${SEEK_BAR_ID}:hover .vee-seek-tip,
#${SEEK_BAR_ID}[data-drag="true"] .vee-seek-tip {
  opacity: 1;
}
#${SEEK_BAR_ID}[data-hot="true"] .vee-seek-tip {
  bottom: 62px;
}
@media (prefers-reduced-motion: reduce) {
  #${SEEK_BAR_ID} .vee-scrim,
  #${SEEK_BAR_ID} .vee-chrome,
  #${SEEK_BAR_ID} .vee-seek-track,
  #${SEEK_BAR_ID} .vee-seek-tip,
  #${SEEK_BAR_ID} .vee-pop {
    transition: none;
  }
}
`

const ICON_PLAY =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8.2 5.2v13.6c0 .8.9 1.3 1.6.9l10.2-6.8c.6-.4.6-1.3 0-1.7L9.8 4.3c-.7-.4-1.6.1-1.6.9z"/></svg>'
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6.5 5h3.4c.3 0 .6.3.6.6v12.8c0 .3-.3.6-.6.6H6.5c-.3 0-.6-.3-.6-.6V5.6c0-.3.3-.6.6-.6zm7.6 0h3.4c.3 0 .6.3.6.6v12.8c0 .3-.3.6-.6.6h-3.4c-.3 0-.6-.3-.6-.6V5.6c0-.3.3-.6.6-.6z"/></svg>'
const ICON_BACK =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>'
const ICON_FORWARD =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 17 5-5-5-5"/><path d="m6 17 5-5-5-5"/></svg>'
const ICON_VOLUME =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
const ICON_VOLUME_LOW =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>'
const ICON_MUTED =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>'
const ICON_LOOP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
const ICON_PIP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>'
const ICON_FULL =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'
const ICON_EXIT_FULL =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>'

type Timeline = {
  start: number
  end: number
  seekable: boolean
}

let root: HTMLDivElement | null = null
let hit: HTMLDivElement | null = null
let bufferedEl: HTMLDivElement | null = null
let playedEl: HTMLDivElement | null = null
let tipEl: HTMLDivElement | null = null
let playBtn: HTMLButtonElement | null = null
let timeEl: HTMLSpanElement | null = null
let backBtn: HTMLButtonElement | null = null
let forwardBtn: HTMLButtonElement | null = null
let speedAnchor: HTMLDivElement | null = null
let speedBtn: HTMLButtonElement | null = null
let speedPop: HTMLDivElement | null = null
let volumeAnchor: HTMLDivElement | null = null
let muteBtn: HTMLButtonElement | null = null
let volumePop: HTMLDivElement | null = null
let volumeInput: HTMLInputElement | null = null
let loopBtn: HTMLButtonElement | null = null
let pipBtn: HTMLButtonElement | null = null
let fullBtn: HTMLButtonElement | null = null
let leftCluster: HTMLDivElement | null = null

let boundVideo: HTMLVideoElement | null = null
let dragging = false
let dragPointerId = -1
let volumeDrag = false
let hotTimer = 0
let ignoreUntil = 0
let lastAudible = 1
let pointerInside = false
let getSettings: (() => EffectSettings) | null = null
let getUiSettings: (() => EffectSettings) | null = null
let onControl: ((control: DockControl) => void) | null = null
let onMedia: ((media: DockMedia) => void) | null = null
let rateSource: ((video: HTMLVideoElement) => DockRateSource) | null = null

function ensureStyle(): void {
  let node = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!node) {
    node = document.createElement("style")
    node.id = STYLE_ID
    ;(document.head ?? document.documentElement).appendChild(node)
  }
  if (node.textContent !== BAR_STYLE) node.textContent = BAR_STYLE
}

function readSettings(): EffectSettings | null {
  const read = getUiSettings ?? getSettings
  if (!read) return null
  try {
    return read()
  } catch {
    return null
  }
}

function formatRate(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return `${rounded.toFixed(2).replace(/\.?0+$/, "")}×`
}

function controlsWanted(settings: EffectSettings): boolean {
  return (
    settings.dockPlay ||
    settings.dockTime ||
    settings.dockVolume ||
    settings.dockSpeed ||
    settings.dockLoop ||
    settings.dockPip ||
    settings.dockFullscreen ||
    settings.dockSkip
  )
}

function noteWrite(): void {
  ignoreUntil = performance.now() + WRITE_GUARD_MS
}

function closePops(): void {
  if (speedPop) delete speedPop.dataset.open
  if (volumePop) delete volumePop.dataset.open
}

function showChrome(hideAfter = 0): void {
  const settings = readSettings()
  if (!root || !settings || !controlsWanted(settings)) return
  window.clearTimeout(hotTimer)
  root.dataset.hot = "true"
  if (hideAfter > 0) {
    hotTimer = window.setTimeout(() => {
      hideChromeSoon(0)
    }, hideAfter)
  }
}

function hideChromeSoon(delay = HIDE_MS): void {
  window.clearTimeout(hotTimer)
  hotTimer = window.setTimeout(() => {
    if (!root) return
    if (root.matches(":hover")) return
    if (pointerInside && root.querySelector(":focus")) return
    delete root.dataset.hot
    closePops()
    pointerInside = false
  }, delay)
}

function pointerOverVideo(event: Pick<PointerEvent, "clientX" | "clientY">): boolean {
  const video = boundVideo
  if (!video) return false
  const rect = video.getBoundingClientRect()
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

function onDocumentHover(event: PointerEvent): void {
  if (!root || root.dataset.visible !== "true" || dragging) return
  if (event.pointerType === "touch") return
  const target = event.target
  const inside = pointerOverVideo(event) || (target instanceof Node && root.contains(target))
  if (inside) {
    pointerInside = true
    showChrome()
    return
  }
  if (!pointerInside) return
  pointerInside = false
  hideChromeSoon()
}

function onDockEnter(): void {
  showChrome()
}

function onDockLeave(event: PointerEvent): void {
  if (pointerOverVideo(event)) return
  const next = event.relatedTarget
  if (next instanceof Node && root?.contains(next)) return
  pointerInside = false
  hideChromeSoon()
}

function onDocPointerDown(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node && root?.contains(target))) closePops()
  if (event.pointerType === "touch" && pointerOverVideo(event)) showChrome(TOUCH_HIDE_MS)
}

function stopAct(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

function shownRate(video: HTMLVideoElement, settings: EffectSettings): number {
  if (rateSource?.(video) === "hold") return video.playbackRate || settings.playbackRate
  return settings.playbackRate
}

function videoIsFullscreen(video: HTMLVideoElement): boolean {
  const current = document.fullscreenElement
  return !!current && (current === video || current.contains(video))
}

function paintTime(video: HTMLVideoElement): void {
  if (!timeEl) return
  const current = formatClock(video.currentTime || 0)
  const duration =
    Number.isFinite(video.duration) && video.duration > 0 ? formatClock(video.duration) : ""
  timeEl.textContent = duration ? `${current} / ${duration}` : current
}

function paintControls(): void {
  const video = boundVideo
  const settings = readSettings()
  if (!video || !settings || !root) return
  const pipOn = document.pictureInPictureElement === video
  const fullOn = videoIsFullscreen(video)
  const silent = settings.muted || settings.volume <= 0.001
  const rate = shownRate(video, settings)
  if (settings.volume > 0.001) lastAudible = settings.volume

  if (playBtn) {
    playBtn.hidden = !settings.dockPlay
    const paused = video.paused || video.ended
    setIcon(playBtn, paused ? "play" : "pause", paused ? ICON_PLAY : ICON_PAUSE)
    playBtn.setAttribute("aria-label", paused ? "Play" : "Pause")
  }
  if (timeEl) {
    timeEl.hidden = !settings.dockTime
    paintTime(video)
  }
  if (backBtn) backBtn.hidden = !settings.dockSkip
  if (forwardBtn) forwardBtn.hidden = !settings.dockSkip
  if (speedAnchor) speedAnchor.hidden = !settings.dockSpeed
  if (speedBtn) {
    speedBtn.textContent = formatRate(rate)
    speedBtn.dataset.on = String(Math.abs(rate - 1) > 0.001)
    speedBtn.setAttribute("aria-label", `Playback speed ${formatRate(rate)}`)
  }
  speedPop?.querySelectorAll<HTMLButtonElement>(".vee-speed-opt").forEach((button) => {
    const speed = Number(button.dataset.speed)
    button.dataset.on = String(Math.abs(rate - speed) < 0.001)
  })
  if (volumeAnchor) volumeAnchor.hidden = !settings.dockVolume
  if (muteBtn) {
    const volumeIcon = silent ? "muted" : settings.volume < 0.5 ? "low" : "high"
    setIcon(
      muteBtn,
      volumeIcon,
      silent ? ICON_MUTED : settings.volume < 0.5 ? ICON_VOLUME_LOW : ICON_VOLUME
    )
    muteBtn.dataset.on = String(silent)
    muteBtn.setAttribute("aria-label", silent ? "Unmute" : "Mute")
    muteBtn.setAttribute("aria-pressed", String(silent))
  }
  if (volumeInput && !volumeDrag) volumeInput.value = String(settings.volume)
  if (loopBtn) {
    loopBtn.hidden = !settings.dockLoop
    loopBtn.dataset.on = String(settings.loop)
    loopBtn.setAttribute("aria-pressed", String(settings.loop))
  }
  if (pipBtn) {
    pipBtn.hidden = !settings.dockPip || !document.pictureInPictureEnabled
    pipBtn.dataset.on = String(pipOn)
    pipBtn.setAttribute("aria-pressed", String(pipOn))
  }
  if (fullBtn) {
    fullBtn.hidden = !settings.dockFullscreen
    setIcon(fullBtn, fullOn ? "exit" : "full", fullOn ? ICON_EXIT_FULL : ICON_FULL)
    fullBtn.dataset.on = String(fullOn)
    fullBtn.setAttribute("aria-label", fullOn ? "Exit full screen" : "Full screen")
    fullBtn.setAttribute("aria-pressed", String(fullOn))
  }
  if (leftCluster) {
    const visible = [playBtn, timeEl].some((node) => node && !node.hidden)
    leftCluster.hidden = !visible
  }
  if (!controlsWanted(settings)) {
    delete root.dataset.hot
    closePops()
  }
}

function reportLoop(): void {
  const video = boundVideo
  const settings = readSettings()
  if (!video || !settings || !onMedia || root?.dataset.visible !== "true") return
  if (volumeDrag || performance.now() < ignoreUntil) return
  if (video.loop === settings.loop) return
  onMedia({
    volume: settings.volume,
    muted: settings.muted,
    playbackRate: null,
    loop: video.loop
  })
}

function reportMedia(): void {
  const video = boundVideo
  if (!video || !onMedia || root?.dataset.visible !== "true") return
  if (volumeDrag || performance.now() < ignoreUntil) return
  const source = rateSource?.(video) ?? "live"
  if (source === "hold") return
  onMedia({
    volume: video.volume,
    muted: video.muted,
    playbackRate: source === "live" ? video.playbackRate || 1 : null,
    loop: video.loop
  })
}

function setIcon(button: HTMLButtonElement, name: string, html: string): void {
  if (button.dataset.icon === name) return
  button.dataset.icon = name
  button.innerHTML = html
}

function onTime(): void {
  updateFill()
  const video = boundVideo
  if (!video) return
  paintTime(video)
  if (rateSource?.(video) === "hold") paintControls()
}

function onMediaSignal(): void {
  reportMedia()
  paintControls()
  updateFill()
}

function ensureBar(): HTMLDivElement {
  if (root) return root
  ensureStyle()
  const node = document.createElement("div")
  node.id = SEEK_BAR_ID
  node.innerHTML = `
    <div class="vee-scrim"></div>
    <div class="vee-chrome">
      <div class="vee-chrome-row">
        <div class="vee-chrome-cluster" data-side="left">
          <button type="button" class="vee-chrome-btn" data-act="play" aria-label="Play">${ICON_PLAY}</button>
          <span class="vee-chrome-time" data-act="time"></span>
        </div>
        <div class="vee-chrome-cluster" data-side="right">
          <button type="button" class="vee-chrome-btn" data-act="back" aria-label="Back 10 seconds" hidden>${ICON_BACK}</button>
          <button type="button" class="vee-chrome-btn" data-act="forward" aria-label="Forward 10 seconds" hidden>${ICON_FORWARD}</button>
          <div class="vee-pop-anchor" data-act="speed">
            <button type="button" class="vee-rate-btn" data-act="speed-btn" aria-haspopup="menu" aria-label="Playback speed">1×</button>
            <div class="vee-pop vee-speed-pop" data-pop="speed" role="menu"></div>
          </div>
          <div class="vee-pop-anchor" data-act="volume">
            <button type="button" class="vee-chrome-btn" data-act="mute" aria-label="Mute">${ICON_VOLUME}</button>
            <div class="vee-pop vee-volume-pop" data-pop="volume">
              <input type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume" />
            </div>
          </div>
          <button type="button" class="vee-chrome-btn" data-act="loop" aria-label="Loop" aria-pressed="false" hidden>${ICON_LOOP}</button>
          <button type="button" class="vee-chrome-btn" data-act="pip" aria-label="Picture in picture" hidden>${ICON_PIP}</button>
          <button type="button" class="vee-chrome-btn" data-act="full" aria-label="Full screen" hidden>${ICON_FULL}</button>
        </div>
      </div>
    </div>
    <div class="vee-seek-hit" role="slider" aria-label="Video progress">
      <div class="vee-seek-track">
        <div class="vee-seek-buffered"></div>
        <div class="vee-seek-played"></div>
      </div>
    </div>
    <span class="vee-seek-tip" aria-hidden="true"></span>
  `
  hit = node.querySelector(".vee-seek-hit")
  bufferedEl = node.querySelector(".vee-seek-buffered")
  playedEl = node.querySelector(".vee-seek-played")
  tipEl = node.querySelector(".vee-seek-tip")
  playBtn = node.querySelector("[data-act='play']")
  timeEl = node.querySelector("[data-act='time']")
  backBtn = node.querySelector("[data-act='back']")
  forwardBtn = node.querySelector("[data-act='forward']")
  speedAnchor = node.querySelector("[data-act='speed']")
  speedBtn = node.querySelector("[data-act='speed-btn']")
  speedPop = node.querySelector("[data-pop='speed']")
  volumeAnchor = node.querySelector("[data-act='volume']")
  muteBtn = node.querySelector("[data-act='mute']")
  volumePop = node.querySelector("[data-pop='volume']")
  volumeInput = node.querySelector(".vee-volume-pop input")
  loopBtn = node.querySelector("[data-act='loop']")
  pipBtn = node.querySelector("[data-act='pip']")
  fullBtn = node.querySelector("[data-act='full']")
  leftCluster = node.querySelector("[data-side='left']")

  if (speedPop) {
    for (const speed of SPEEDS) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "vee-speed-opt"
      button.dataset.speed = String(speed)
      button.textContent = formatRate(speed)
      button.setAttribute("role", "menuitem")
      button.addEventListener("click", (event) => {
        stopAct(event)
        noteWrite()
        onControl?.({ type: "rate", playbackRate: speed })
        closePops()
        paintControls()
      })
      speedPop.appendChild(button)
    }
  }

  speedBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const open = speedPop?.dataset.open === "true"
    closePops()
    if (!open && speedPop) speedPop.dataset.open = "true"
    showChrome()
  })
  playBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    if (!video) return
    if (video.paused || video.ended) void video.play().catch(() => undefined)
    else video.pause()
  })
  backBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    if (!video) return
    seekBy(video, -SKIP_SECONDS)
    updateFill()
    paintTime(video)
  })
  forwardBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    if (!video) return
    seekBy(video, SKIP_SECONDS)
    updateFill()
    paintTime(video)
  })
  muteBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const settings = readSettings()
    if (!settings) return
    noteWrite()
    const silent = settings.muted || settings.volume <= 0.001
    if (silent) {
      const volume = settings.volume > 0.001 ? settings.volume : lastAudible > 0.001 ? lastAudible : 1
      onControl?.({ type: "audio", volume, muted: false })
    } else {
      onControl?.({ type: "audio", muted: true })
    }
    paintControls()
  })
  volumeAnchor?.addEventListener("pointerenter", () => {
    if (volumePop) volumePop.dataset.open = "true"
    showChrome()
  })
  volumeAnchor?.addEventListener("pointerleave", (event) => {
    const next = event.relatedTarget
    if (next instanceof Node && volumeAnchor?.contains(next)) return
    if (volumeAnchor?.contains(document.activeElement)) return
    if (volumePop) delete volumePop.dataset.open
  })
  volumeAnchor?.addEventListener("focusin", () => {
    if (volumePop) volumePop.dataset.open = "true"
  })
  volumeAnchor?.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (volumeAnchor?.contains(document.activeElement)) return
      if (volumePop) delete volumePop.dataset.open
    }, 0)
  })
  volumeInput?.addEventListener("input", () => {
    if (!volumeInput) return
    volumeDrag = true
    noteWrite()
    const volume = Math.min(1, Math.max(0, Number(volumeInput.value)))
    onControl?.({ type: "audio", volume, muted: volume <= 0.001 ? true : false })
  })
  volumeInput?.addEventListener("change", () => {
    volumeDrag = false
    paintControls()
  })
  volumeInput?.addEventListener("pointerup", () => {
    volumeDrag = false
  })
  volumeInput?.addEventListener("pointercancel", () => {
    volumeDrag = false
  })
  loopBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const settings = readSettings()
    if (!settings) return
    noteWrite()
    onControl?.({ type: "loop", loop: !settings.loop })
    paintControls()
  })
  pipBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    if (!video) return
    void togglePictureInPicture(video).catch(() => undefined)
  })
  fullBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    if (!video) return
    const exit = videoIsFullscreen(video)
    const action = exit ? document.exitFullscreen() : video.requestFullscreen()
    void action.catch(() => undefined)
  })

  hit?.addEventListener("pointerdown", onPointerDown)
  hit?.addEventListener("pointermove", (event) => {
    if (!dragging) updateTip(event.clientX)
  })
  hit?.addEventListener("pointerleave", () => {
    if (!dragging && tipEl) tipEl.textContent = ""
  })
  node.addEventListener("pointerenter", onDockEnter)
  node.addEventListener("pointerleave", onDockLeave)
  node.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!root || root.contains(document.activeElement) || root.matches(":hover")) return
      hideChromeSoon(0)
    }, 0)
  })
  root = node
  return node
}

function barParent(video: HTMLVideoElement): HTMLElement {
  const fullscreen = document.fullscreenElement
  if (fullscreen === video) {
    return video.parentElement instanceof HTMLElement ? video.parentElement : document.documentElement
  }
  if (fullscreen instanceof HTMLElement && fullscreen.contains(video)) return fullscreen
  return document.documentElement
}

function viewportClip(rect: DOMRectReadOnly): DOMRectReadOnly {
  const left = Math.max(rect.left, 0)
  const top = Math.max(rect.top, 0)
  const right = Math.min(rect.right, window.innerWidth)
  const bottom = Math.min(rect.bottom, window.innerHeight)
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
}

function timelineRange(video: HTMLVideoElement): Timeline {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return { start: 0, end: video.duration, seekable: true }
  }
  const ranges = video.seekable
  if (ranges.length > 0) {
    const start = ranges.start(0)
    const end = ranges.end(ranges.length - 1)
    if (end > start) return { start, end, seekable: true }
  }
  return { start: 0, end: 0, seekable: false }
}

function fractionAlong(video: HTMLVideoElement, timeline: Timeline): number {
  if (timeline.end <= timeline.start) return 0
  const value = (video.currentTime - timeline.start) / (timeline.end - timeline.start)
  return Math.min(1, Math.max(0, value))
}

function bufferedFraction(video: HTMLVideoElement, timeline: Timeline): number {
  if (timeline.end <= timeline.start) return 0
  const ranges = video.buffered
  let maxEnd = timeline.start
  for (let index = 0; index < ranges.length; index += 1) {
    maxEnd = Math.max(maxEnd, ranges.end(index))
  }
  return Math.min(1, Math.max(0, (maxEnd - timeline.start) / (timeline.end - timeline.start)))
}

function timeFromClientX(video: HTMLVideoElement, clientX: number): number | null {
  const bar = root
  if (!bar || bar.style.display === "none") return null
  const rect = bar.getBoundingClientRect()
  if (rect.width < 1) return null
  const timeline = timelineRange(video)
  if (!timeline.seekable) return null
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return timeline.start + ratio * (timeline.end - timeline.start)
}

function seekVideo(video: HTMLVideoElement, time: number): void {
  const timeline = timelineRange(video)
  if (!timeline.seekable) return
  const next = Math.min(timeline.end, Math.max(timeline.start, time))
  try {
    video.currentTime = next
  } catch {
    /* Player can reject seeks during ads or live edges. */
  }
}

function updateFill(): void {
  const video = boundVideo
  if (!video || !playedEl || !bufferedEl || !hit) return
  const timeline = timelineRange(video)
  const played = fractionAlong(video, timeline)
  const buffered = bufferedFraction(video, timeline)
  playedEl.style.width = `${played * 100}%`
  bufferedEl.style.width = `${buffered * 100}%`
  hit.setAttribute("aria-valuemin", String(Math.floor(timeline.start)))
  hit.setAttribute("aria-valuemax", String(Math.floor(timeline.end)))
  hit.setAttribute("aria-valuenow", String(Math.floor(video.currentTime)))
  hit.setAttribute("aria-disabled", timeline.seekable ? "false" : "true")
}

function updateTip(clientX: number): void {
  const video = boundVideo
  if (!video || !tipEl || !root) return
  const time = timeFromClientX(video, clientX)
  if (time === null) {
    tipEl.textContent = ""
    return
  }
  tipEl.textContent = formatClock(time)
  const rect = root.getBoundingClientRect()
  const x = Math.min(rect.width, Math.max(0, clientX - rect.left))
  tipEl.style.left = `${x}px`
}

function onPointerDown(event: PointerEvent): void {
  const video = boundVideo
  if (!video || !root) return
  const timeline = timelineRange(video)
  if (!timeline.seekable) return
  event.preventDefault()
  event.stopPropagation()
  dragging = true
  dragPointerId = event.pointerId
  root.dataset.drag = "true"
  showChrome()
  hit?.setPointerCapture(event.pointerId)
  const time = timeFromClientX(video, event.clientX)
  if (time !== null) seekVideo(video, time)
  updateTip(event.clientX)
  updateFill()
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging || event.pointerId !== dragPointerId) return
  const video = boundVideo
  if (!video) return
  event.preventDefault()
  const time = timeFromClientX(video, event.clientX)
  if (time !== null) seekVideo(video, time)
  updateTip(event.clientX)
  updateFill()
}

function onPointerUp(event: PointerEvent): void {
  volumeDrag = false
  if (!dragging || event.pointerId !== dragPointerId) return
  dragging = false
  dragPointerId = -1
  if (root) delete root.dataset.drag
  try {
    hit?.releasePointerCapture(event.pointerId)
  } catch {
    /* Pointer already released. */
  }
  if (!pointerOverVideo(event)) {
    pointerInside = false
    hideChromeSoon()
  }
}

function onPresentationChange(): void {
  const video = boundVideo
  const settings = readSettings()
  if (video && document.pictureInPictureElement === video) {
    hideBar()
    return
  }
  if (video && settings && shouldShow(settings) && root) {
    root.dataset.visible = "true"
    placeSeekBar(video)
  }
  paintControls()
}

function unbindVideo(video: HTMLVideoElement | null): void {
  if (!video) return
  video.removeEventListener("timeupdate", onTime)
  video.removeEventListener("progress", onTime)
  video.removeEventListener("durationchange", onTime)
  video.removeEventListener("loadedmetadata", onTime)
  video.removeEventListener("emptied", onTime)
  video.removeEventListener("volumechange", onMediaSignal)
  video.removeEventListener("ratechange", onMediaSignal)
  video.removeEventListener("play", onMediaSignal)
  video.removeEventListener("pause", onMediaSignal)
}

function bindVideo(video: HTMLVideoElement): void {
  video.addEventListener("timeupdate", onTime)
  video.addEventListener("progress", onTime)
  video.addEventListener("durationchange", onTime)
  video.addEventListener("loadedmetadata", onTime)
  video.addEventListener("emptied", onTime)
  video.addEventListener("volumechange", onMediaSignal)
  video.addEventListener("ratechange", onMediaSignal)
  video.addEventListener("play", onMediaSignal)
  video.addEventListener("pause", onMediaSignal)
}

function shouldShow(settings: EffectSettings): boolean {
  return settings.enabled && settings.playbackEnabled !== false && settings.showNativeControls
}

function hideBar(): void {
  if (!root) return
  root.dataset.visible = "false"
  delete root.dataset.hot
  root.style.display = "none"
  closePops()
  pointerInside = false
}

function boxHas(node: Element, event: Pick<MouseEvent, "clientX" | "clientY">): boolean {
  const rect = node.getBoundingClientRect()
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

export function seekBarVisible(): boolean {
  return root?.dataset.visible === "true"
}

export function seekBarContains(node: EventTarget | null): boolean {
  if (!(node instanceof Node)) return false
  const bar = document.getElementById(SEEK_BAR_ID)
  return bar instanceof HTMLElement && bar.contains(node)
}

export function seekBarHitTest(event: Pick<MouseEvent, "clientX" | "clientY">): boolean {
  const bar = document.getElementById(SEEK_BAR_ID)
  if (!(bar instanceof HTMLElement) || bar.dataset.visible !== "true") return false
  const seek = bar.querySelector(".vee-seek-hit")
  if (seek && boxHas(seek, event)) return true
  if (bar.dataset.hot === "true") {
    const chrome = bar.querySelector(".vee-chrome")
    if (chrome && boxHas(chrome, event)) return true
  }
  for (const pop of bar.querySelectorAll(".vee-pop[data-open='true']")) {
    if (boxHas(pop, event)) return true
  }
  return false
}

export function placeSeekBar(video: HTMLVideoElement | null): void {
  if (!video || !root || root.dataset.visible !== "true") return
  if (document.pictureInPictureElement === video) {
    hideBar()
    return
  }
  const clipped = viewportClip(video.getBoundingClientRect())
  if (clipped.width < 40 || clipped.height < 40) {
    hideBar()
    return
  }
  const parent = barParent(video)
  if (root.parentElement !== parent) parent.appendChild(root)
  root.style.setProperty("left", `${clipped.left}px`, "important")
  root.style.setProperty("top", `${clipped.bottom - DOCK_HEIGHT_PX}px`, "important")
  root.style.setProperty("width", `${clipped.width}px`, "important")
  root.style.setProperty("height", `${DOCK_HEIGHT_PX}px`, "important")
  root.style.display = "block"
  root.dataset.visible = "true"
  updateFill()
  paintControls()
}

export function syncSeekBar(video: HTMLVideoElement | null, settings: EffectSettings): void {
  if (!shouldShow(settings) || !video || !video.isConnected) {
    if (boundVideo) unbindVideo(boundVideo)
    boundVideo = null
    hideBar()
    return
  }
  if (document.pictureInPictureElement === video) {
    if (boundVideo) unbindVideo(boundVideo)
    boundVideo = null
    hideBar()
    return
  }
  const bar = ensureBar()
  if (boundVideo !== video) {
    unbindVideo(boundVideo)
    boundVideo = video
    bindVideo(video)
  }
  bar.dataset.visible = "true"
  placeSeekBar(video)
  reportLoop()
}

export function suppressDockMedia(ms = WRITE_GUARD_MS): void {
  ignoreUntil = Math.max(ignoreUntil, performance.now() + ms)
}

export function stopSeekBar(): void {
  document.removeEventListener("pointermove", onPointerMove, true)
  document.removeEventListener("pointermove", onDocumentHover)
  document.removeEventListener("pointerup", onPointerUp, true)
  document.removeEventListener("pointercancel", onPointerUp, true)
  document.removeEventListener("pointerdown", onDocPointerDown, true)
  document.removeEventListener("enterpictureinpicture", onPresentationChange)
  document.removeEventListener("leavepictureinpicture", onPresentationChange)
  document.removeEventListener("fullscreenchange", onPresentationChange)
  window.clearTimeout(hotTimer)
  pointerInside = false
  unbindVideo(boundVideo)
  boundVideo = null
  dragging = false
  volumeDrag = false
  if (root?.isConnected) root.remove()
  root = null
  hit = null
  bufferedEl = null
  playedEl = null
  tipEl = null
  playBtn = null
  timeEl = null
  backBtn = null
  forwardBtn = null
  speedAnchor = null
  speedBtn = null
  speedPop = null
  volumeAnchor = null
  muteBtn = null
  volumePop = null
  volumeInput = null
  loopBtn = null
  pipBtn = null
  fullBtn = null
  leftCluster = null
}

export function startSeekBar(options: {
  getSettings: () => EffectSettings
  getUiSettings?: () => EffectSettings
  onControl?: (control: DockControl) => void
  onMedia?: (media: DockMedia) => void
  rateSource?: (video: HTMLVideoElement) => DockRateSource
}): {
  sync: (video: HTMLVideoElement | null) => void
  place: (video: HTMLVideoElement | null) => void
  stop: () => void
} {
  getSettings = options.getSettings
  getUiSettings = options.getUiSettings ?? null
  onControl = options.onControl ?? null
  onMedia = options.onMedia ?? null
  rateSource = options.rateSource ?? null
  ensureBar()
  document.addEventListener("pointermove", onPointerMove, true)
  document.addEventListener("pointermove", onDocumentHover)
  document.addEventListener("pointerup", onPointerUp, true)
  document.addEventListener("pointercancel", onPointerUp, true)
  document.addEventListener("pointerdown", onDocPointerDown, true)
  document.addEventListener("enterpictureinpicture", onPresentationChange)
  document.addEventListener("leavepictureinpicture", onPresentationChange)
  document.addEventListener("fullscreenchange", onPresentationChange)
  return {
    sync(video) {
      const read = getSettings
      if (!read) return
      syncSeekBar(video, read())
    },
    place(video) {
      placeSeekBar(video)
    },
    stop() {
      stopSeekBar()
      getSettings = null
      getUiSettings = null
      onControl = null
      onMedia = null
      rateSource = null
    }
  }
}
