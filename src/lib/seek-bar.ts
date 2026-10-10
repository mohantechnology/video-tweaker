import { formatClock } from "./progress"
import type { EffectSettings } from "./types"

export const SEEK_BAR_ID = "vee-seek-bar"

const STYLE_ID = "vee-seek-bar-style"
const Z_INDEX = 2147483646
const TRACK_HEIGHT_PX = 4
const HIT_HEIGHT_PX = 20

const BAR_STYLE = `
#${SEEK_BAR_ID} {
  position: fixed !important;
  inset: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  z-index: ${Z_INDEX};
  box-sizing: border-box;
  pointer-events: auto !important;
  touch-action: none;
  display: none;
  cursor: pointer;
  font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
}
#${SEEK_BAR_ID}[data-visible="true"] {
  display: block;
}
#${SEEK_BAR_ID} .vee-seek-hit {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${HIT_HEIGHT_PX}px;
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
`

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

let boundVideo: HTMLVideoElement | null = null
let dragging = false
let dragPointerId = -1
let getSettings: (() => EffectSettings) | null = null

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const node = document.createElement("style")
  node.id = STYLE_ID
  node.textContent = BAR_STYLE
  ;(document.head ?? document.documentElement).appendChild(node)
}

function ensureBar(): HTMLDivElement {
  if (root) return root
  ensureStyle()
  const node = document.createElement("div")
  node.id = SEEK_BAR_ID
  node.setAttribute("role", "slider")
  node.setAttribute("aria-label", "Video progress")
  node.innerHTML = `
    <div class="vee-seek-hit">
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
  hit?.addEventListener("pointerdown", onPointerDown)
  hit?.addEventListener("pointermove", (event) => {
    if (!dragging) updateTip(event.clientX)
  })
  hit?.addEventListener("pointerleave", () => {
    if (!dragging && tipEl) tipEl.textContent = ""
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
  if (!video || !playedEl || !bufferedEl || !root) return
  const timeline = timelineRange(video)
  const played = fractionAlong(video, timeline)
  const buffered = bufferedFraction(video, timeline)
  playedEl.style.width = `${played * 100}%`
  bufferedEl.style.width = `${buffered * 100}%`
  root.setAttribute("aria-valuemin", String(Math.floor(timeline.start)))
  root.setAttribute("aria-valuemax", String(Math.floor(timeline.end)))
  root.setAttribute("aria-valuenow", String(Math.floor(video.currentTime)))
  root.setAttribute("aria-disabled", timeline.seekable ? "false" : "true")
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

function onMediaUpdate(): void {
  updateFill()
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
  if (!dragging || event.pointerId !== dragPointerId) return
  dragging = false
  dragPointerId = -1
  if (root) delete root.dataset.drag
  try {
    hit?.releasePointerCapture(event.pointerId)
  } catch {
    /* Pointer already released. */
  }
}

function unbindVideo(video: HTMLVideoElement | null): void {
  if (!video) return
  video.removeEventListener("timeupdate", onMediaUpdate)
  video.removeEventListener("progress", onMediaUpdate)
  video.removeEventListener("durationchange", onMediaUpdate)
  video.removeEventListener("loadedmetadata", onMediaUpdate)
  video.removeEventListener("emptied", onMediaUpdate)
}

function bindVideo(video: HTMLVideoElement): void {
  video.addEventListener("timeupdate", onMediaUpdate)
  video.addEventListener("progress", onMediaUpdate)
  video.addEventListener("durationchange", onMediaUpdate)
  video.addEventListener("loadedmetadata", onMediaUpdate)
  video.addEventListener("emptied", onMediaUpdate)
}

function shouldShow(settings: EffectSettings): boolean {
  return settings.enabled && settings.playbackEnabled !== false && settings.showNativeControls
}

function hideBar(): void {
  if (!root) return
  root.dataset.visible = "false"
  root.style.display = "none"
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
  const rect = bar.getBoundingClientRect()
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
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
  root.style.setProperty("top", `${clipped.bottom - HIT_HEIGHT_PX}px`, "important")
  root.style.setProperty("width", `${clipped.width}px`, "important")
  root.style.setProperty("height", `${HIT_HEIGHT_PX}px`, "important")
  root.style.display = "block"
  root.dataset.visible = "true"
  updateFill()
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
}

export function stopSeekBar(): void {
  document.removeEventListener("pointermove", onPointerMove, true)
  document.removeEventListener("pointerup", onPointerUp, true)
  document.removeEventListener("pointercancel", onPointerUp, true)
  unbindVideo(boundVideo)
  boundVideo = null
  dragging = false
  if (root?.isConnected) root.remove()
  root = null
  hit = null
  bufferedEl = null
  playedEl = null
  tipEl = null
}

export function startSeekBar(options: { getSettings: () => EffectSettings }): {
  sync: (video: HTMLVideoElement | null) => void
  place: (video: HTMLVideoElement | null) => void
  stop: () => void
} {
  getSettings = options.getSettings
  ensureBar()
  document.addEventListener("pointermove", onPointerMove, true)
  document.addEventListener("pointerup", onPointerUp, true)
  document.addEventListener("pointercancel", onPointerUp, true)
  return {
    sync(video) {
      syncSeekBar(video, getSettings!())
    },
    place(video) {
      placeSeekBar(video)
    },
    stop() {
      stopSeekBar()
      getSettings = null
    }
  }
}
