import type { PlasmoCSConfig } from "plasmo"

import { readEngineSignal } from "~lib/engine"
import {
  groupsFromText,
  groupsFromValue,
  mergeCatalogEntries,
  postRenditionResult,
  QUALITY_MARK,
  readRenditionMessage,
  RENDITION_PENDING_ATTR,
  RENDITION_SOURCE,
  RENDITION_USE_EVENT,
  USER_PAUSE_MARK,
  type Rendition,
  type RenditionMessage
} from "~lib/renditions"
import { fileUrl, mediaPath } from "~lib/media-file"
import { applyNativeMirror, NATIVE_MIRROR_ATTR, publishSitePlayer } from "~lib/native-mirror"
import {
  collectPlayers,
  downloadOffer,
  extractAssignedObject,
  mergeTracks,
  readYtAsk,
  readYtRefresh,
  readYtFetchRequest,
  rememberPlayback,
  youtubeVideoId,
  YT_MEDIA_SOURCE,
  type YtTrack
} from "~lib/youtube-media"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: true,
  run_at: "document_start",
  world: "MAIN"
}

const MARK = "data-vee-shadow"
const PRESS = "data-vee-press"
const patchedFlag = "__veeAttachShadow"

type Patched = typeof Element.prototype.attachShadow & { [patchedFlag]?: boolean }

const YOUTUBE_SKIP =
  ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-overlay-close-button"

let original: typeof Element.prototype.attachShadow | null = null
let observer: MutationObserver | null = null
let installed = false

function clearMarks(root: ParentNode): void {
  root.querySelectorAll(`[${MARK}]`).forEach((node) => node.removeAttribute(MARK))
  root.querySelectorAll(`[${PRESS}]`).forEach((node) => node.removeAttribute(PRESS))
  root.querySelectorAll("*").forEach((node) => {
    if (node instanceof Element && node.shadowRoot) clearMarks(node.shadowRoot)
  })
}

function ensureObserver(): void {
  if (observer) return
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.attributeName !== PRESS) continue
      const node = record.target
      if (!(node instanceof HTMLElement) || node.getAttribute(PRESS) !== "1") continue
      if (!node.matches(YOUTUBE_SKIP)) {
        node.removeAttribute(PRESS)
        continue
      }
      node.removeAttribute(PRESS)
      node.click()
    }
  })
  observer.observe(document, { subtree: true, attributes: true, attributeFilter: [PRESS] })
}

function install(): void {
  if (installed) return
  const current = Element.prototype.attachShadow as Patched
  if (!current[patchedFlag]) {
    original = current
    const patched: Patched = function (this: Element, init: ShadowRootInit) {
      const root = original!.call(this, { ...init, mode: "open" })
      try {
        this.setAttribute(MARK, "1")
      } catch {
        /* Hosts that are not elements still return an open root. */
      }
      window.dispatchEvent(new CustomEvent("vee-shadow-root"))
      return root
    }
    patched[patchedFlag] = true
    Element.prototype.attachShadow = patched
  }
  installed = true
  ensureObserver()
}

function uninstall(): void {
  const current = Element.prototype.attachShadow as Patched
  if (current[patchedFlag] && original) Element.prototype.attachShadow = original
  original = null
  installed = false
  observer?.disconnect()
  observer = null
  clearMarks(document)
}

const renditionCatalog = new Map<string, Rendition[]>()
const playedPaths: string[] = []
const heldCodes: string[] = []
const heldPaths: string[] = []
let renditionWatchInstalled = false
const CATALOG_SOFT_CAP = 160
const CATALOG_HARD_CAP = 240

function onRenditionHost(): boolean {
  const host = location.hostname.replace(/^www\./, "")
  return (
    host === "instagram.com" ||
    host.endsWith(".instagram.com") ||
    host === "facebook.com" ||
    host.endsWith(".facebook.com") ||
    host === "fb.com" ||
    host.endsWith(".fb.com") ||
    host === "fb.watch" ||
    host.endsWith(".fb.watch")
  )
}

function absorbText(text: string): void {
  if (!text || text.length > 32_000_000) return
  if (
    !text.includes("video_versions") &&
    !text.includes("video_dash_manifest") &&
    !text.includes("dash_manifest") &&
    !text.includes("progressive_url") &&
    !text.includes("browser_native_hd_url") &&
    !text.includes("playable_url_quality_hd") &&
    !text.includes("video_url") &&
    !text.includes("<MPD") &&
    !text.includes("<Representation")
  ) {
    return
  }
  absorbRenditions(groupsFromText(text))
}

function scanScripts(root: ParentNode): void {
  root.querySelectorAll("script").forEach((script) => absorbText(script.textContent || ""))
}

function watchScripts(): void {
  const scan = () => {
    if (document.documentElement) scanScripts(document)
  }
  scan()
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLScriptElement) absorbText(node.textContent || "")
        else if (node instanceof HTMLElement) scanScripts(node)
      })
    }
  })
  const start = () => {
    if (!document.documentElement) return
    observer.observe(document.documentElement, { childList: true, subtree: true })
    scan()
  }
  if (document.documentElement) start()
  else document.addEventListener("DOMContentLoaded", start, { once: true })
}

function publishRenditions(batch: Rendition[][]): void {
  window.postMessage(
    {
      source: RENDITION_SOURCE,
      kind: "list",
      groups: [...renditionCatalog.values()],
      batch,
      played: playedPaths.slice()
    },
    "*"
  )
}

function notePlayed(url: string, videoFile = false): void {
  const file = fileUrl(url)
  if (!file) return
  const path = mediaPath(file)
  if (!videoFile && !/\.(mp4|webm|m4v|mov)$/i.test(path)) return
  if (playedPaths[0] === path) return
  playedPaths.unshift(path)
  if (playedPaths.length > 48) playedPaths.length = 48
  publishRenditions([])
}

function catalogKey(group: readonly Rendition[]): string {
  return group
    .map((item) => mediaPath(item.url))
    .filter(Boolean)
    .sort()
    .join("|")
}

function catalogStamp(group: readonly Rendition[]): string {
  return group
    .map((item) =>
      [
        mediaPath(item.url),
        item.code || "",
        item.pk || "",
        item.width,
        item.height,
        item.audioUrl || "",
        item.soundtrack || "",
        item.title || "",
        item.duration || "",
        (item.aliases || []).map((alias) => mediaPath(alias)).join(",")
      ].join("~")
    )
    .sort()
    .join("|")
}

function groupPaths(group: readonly Rendition[]): Set<string> {
  const paths = new Set<string>()
  for (const item of group) {
    paths.add(mediaPath(item.url))
    for (const alias of item.aliases || []) paths.add(mediaPath(alias))
  }
  return paths
}

function sharesUrl(left: readonly Rendition[], right: readonly Rendition[]): boolean {
  const paths = groupPaths(left)
  return right.some((item) => paths.has(mediaPath(item.url)) || item.aliases?.some((alias) => paths.has(mediaPath(alias))))
}

function pageShortcode(): string {
  const match = location.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/)
  if (!match || match[1].length < 5 || /^(audio|explore|tags|locations|saved|accounts)$/i.test(match[1])) return ""
  return match[1]
}

function noteHold(message: RenditionMessage): void {
  if (message.code && !heldCodes.includes(message.code)) {
    heldCodes.unshift(message.code)
    if (heldCodes.length > 24) heldCodes.length = 24
  }
  for (const path of message.played || []) {
    if (!path || heldPaths.includes(path)) continue
    heldPaths.unshift(path)
  }
  if (heldPaths.length > 48) heldPaths.length = 48
}

/** The clip on screen is often the oldest entry. A short catalog drops it while later posts keep loading. */
function groupProtected(group: readonly Rendition[]): boolean {
  const page = pageShortcode()
  if (page && group.some((item) => item.code === page)) return true
  if (group.some((item) => item.code && heldCodes.includes(item.code))) return true
  const paths = groupPaths(group)
  if (playedPaths.some((path) => paths.has(path))) return true
  if (heldPaths.some((path) => paths.has(path))) return true
  return false
}

function trimCatalog(): void {
  const dropUnprotected = (): boolean => {
    for (const [key, group] of renditionCatalog) {
      if (groupProtected(group)) continue
      renditionCatalog.delete(key)
      return true
    }
    return false
  }
  while (renditionCatalog.size > CATALOG_SOFT_CAP && dropUnprotected()) {
    /* Keep the posts the viewer can still scroll back to. */
  }
  while (renditionCatalog.size > CATALOG_HARD_CAP) {
    const first = renditionCatalog.keys().next().value
    if (first == null) break
    renditionCatalog.delete(first)
  }
}

function storeGroup(group: Rendition[]): Rendition[] | null {
  const remove: string[] = []
  let merged = group
  let before = ""
  for (const [key, existing] of renditionCatalog) {
    if (!sharesUrl(existing, merged)) continue
    before += catalogStamp(existing)
    merged = mergeCatalogEntries(existing, merged)
    remove.push(key)
  }
  if (!remove.length) before = ""
  for (const key of remove) renditionCatalog.delete(key)
  const nextKey = catalogKey(merged)
  if (!nextKey) return null
  const after = catalogStamp(merged)
  renditionCatalog.set(nextKey, merged)
  trimCatalog()
  if (before && before === after) return null
  return merged
}

function absorbRenditions(found: Rendition[][]): void {
  if (!found.length) return
  const batch: Rendition[][] = []
  for (const group of found) {
    const stored = storeGroup(group)
    if (stored) batch.push(stored)
  }
  if (batch.length) publishRenditions(batch)
}

function noteResponse(response: Response): void {
  try {
    const type = (response.headers.get("content-type") || "").toLowerCase()
    notePlayed(response.url, type.startsWith("video/"))
    if (
      type.startsWith("video/") ||
      type.startsWith("audio/") ||
      type.startsWith("image/") ||
      type.includes("octet-stream")
    ) {
      return
    }
    const length = Number(response.headers.get("content-length") || "")
    if (Number.isFinite(length) && length > 32_000_000) return
    const textual =
      type.includes("json") ||
      type.includes("text") ||
      type.includes("javascript") ||
      type.includes("xml") ||
      type.includes("dash")
    const api = /graphql|\/api\/|ajax/i.test(response.url || "")
    if (!textual && !(type === "" && api)) return
    void response
      .clone()
      .text()
      .then((text) => absorbRenditions(groupsFromText(text)))
      .catch(() => undefined)
  } catch {
    /* Opaque responses cannot be read. */
  }
}

function noteXhr(xhr: XMLHttpRequest): void {
  try {
    const type = (xhr.getResponseHeader("content-type") || "").toLowerCase()
    notePlayed(xhr.responseURL || "", type.startsWith("video/"))
    if (type.startsWith("video/") || type.startsWith("audio/") || type.startsWith("image/")) return
    if (xhr.responseType === "json") {
      absorbRenditions(groupsFromValue(xhr.response))
      return
    }
    if (xhr.responseType && xhr.responseType !== "text") return
    if (typeof xhr.responseText === "string") absorbRenditions(groupsFromText(xhr.responseText))
  } catch {
    /* responseText throws when the body is not text. */
  }
}

const PAINT_WAIT_MS = 8000
const REVEAL_HOLD_MS = 1200
const nativePlay = HTMLMediaElement.prototype.play
const nativePause = HTMLMediaElement.prototype.pause
const nativeLoad = HTMLMediaElement.prototype.load

type InlineStyle = { value: string; priority: string }

type QualityHold = {
  video: HTMLVideoElement
  token: string
  url: string
  audioUrl: string
  time: number
  paused: boolean
  ended: boolean
  rate: number
  muted: boolean
  volume: number
  savedSrc: string
  savedObject: MediaProvider | null
  savedCrossOrigin: string | null
  pendingObject: MediaProvider | null
  pendingSrc: string
  played: boolean
  settled: boolean
  timer: number
  observer: MutationObserver | null
  forcedOpacity: boolean
  forcedVisibility: boolean
  savedOpacity: InlineStyle
  savedVisibility: InlineStyle
  onReady: () => void
  onError: () => void
  guarding: boolean
  armedAt: number
  guardTimer: number
  resumeTries: number
  levelTries: number
  onPause: () => void
  onLevel: () => void
  onPlaying: () => void
}

let hold: QualityHold | null = null
let revealEpoch = 0
let lastViewerInput = 0

function noteViewerInput(event: Event): void {
  if (event.isTrusted) lastViewerInput = performance.now()
}

for (const type of ["pointerdown", "keydown"]) {
  window.addEventListener(type, noteViewerInput, { capture: true, passive: true })
}

const mediaSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")
const mediaObject = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject")
const mediaOrigin = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "crossOrigin")

function clearCrossOrigin(video: HTMLVideoElement): void {
  try {
    mediaOrigin?.set?.call(video, null)
  } catch {
    /* The element can reject a cleared origin. */
  }
  Element.prototype.removeAttribute.call(video, "crossorigin")
}

function inlineStyle(video: HTMLVideoElement, name: "opacity" | "visibility"): InlineStyle {
  return { value: video.style.getPropertyValue(name), priority: video.style.getPropertyPriority(name) }
}

function videoForToken(token: string): HTMLVideoElement | null {
  const selector = `[${QUALITY_MARK}="${token}"]`
  const seen = new Set<ParentNode>()
  const walk = (root: ParentNode): HTMLVideoElement | null => {
    if (seen.has(root)) return null
    seen.add(root)
    const found = root.querySelector(selector)
    if (found instanceof HTMLVideoElement) return found
    for (const node of root.querySelectorAll("*")) {
      if (!(node instanceof Element) || !node.shadowRoot) continue
      const nested = walk(node.shadowRoot)
      if (nested) return nested
    }
    return null
  }
  return walk(document)
}

/** Block the page from putting a dead stream back while a chosen file is playing. */
function guardVideo(video: HTMLVideoElement): void {
  if (video.dataset.veeGuard === "1") return
  if (!mediaSrc?.get || !mediaSrc.set || !mediaObject?.get || !mediaObject.set) return
  try {
    Object.defineProperty(video, "src", {
      configurable: true,
      enumerable: true,
      get() {
        return mediaSrc.get!.call(this)
      },
      set(value: string) {
        if (hold?.video === video && typeof value === "string" && (value === "" || value.startsWith("blob:"))) {
          if (value.startsWith("blob:")) hold.pendingSrc = value
          return
        }
        mediaSrc.set!.call(this, value)
      }
    })
    Object.defineProperty(video, "srcObject", {
      configurable: true,
      enumerable: true,
      get() {
        return mediaObject.get!.call(this)
      },
      set(value: MediaProvider | null) {
        if (hold?.video === video) {
          if (value) hold.pendingObject = value
          return
        }
        mediaObject.set!.call(this, value)
      }
    })
    if (mediaOrigin?.get && mediaOrigin.set) {
      Object.defineProperty(video, "crossOrigin", {
        configurable: true,
        enumerable: true,
        get() {
          return mediaOrigin.get!.call(this)
        },
        set(value: string | null) {
          if (hold?.video === video) return
          mediaOrigin.set!.call(this, value)
        }
      })
    }
    video.setAttribute = (name: string, value: string) => {
      const key = name.toLowerCase()
      if (hold?.video === video && key === "crossorigin") return
      if (hold?.video === video && key === "src" && (value === "" || value.startsWith("blob:"))) {
        if (value.startsWith("blob:") && hold) hold.pendingSrc = value
        return
      }
      Element.prototype.setAttribute.call(video, name, value)
    }
    video.removeAttribute = (name: string) => {
      const key = name.toLowerCase()
      if (hold?.video === video && (key === "src" || key === "crossorigin")) return
      Element.prototype.removeAttribute.call(video, name)
    }
    video.dataset.veeGuard = "1"
  } catch {
    /* The player can already own these properties. */
  }
}

function reveal(next: QualityHold): void {
  const video = next.video
  const style = getComputedStyle(video)
  if (Number(style.opacity) === 0) {
    if (!next.forcedOpacity) next.savedOpacity = inlineStyle(video, "opacity")
    next.forcedOpacity = true
    video.style.setProperty("opacity", "1", "important")
  }
  if (style.visibility === "hidden") {
    if (!next.forcedVisibility) next.savedVisibility = inlineStyle(video, "visibility")
    next.forcedVisibility = true
    video.style.setProperty("visibility", "visible", "important")
  }
}

function clearReveal(next: QualityHold): void {
  const video = next.video
  if (next.forcedOpacity) {
    if (next.savedOpacity.value) video.style.setProperty("opacity", next.savedOpacity.value, next.savedOpacity.priority)
    else video.style.removeProperty("opacity")
    next.forcedOpacity = false
  }
  if (next.forcedVisibility) {
    if (next.savedVisibility.value) video.style.setProperty("visibility", next.savedVisibility.value, next.savedVisibility.priority)
    else video.style.removeProperty("visibility")
    next.forcedVisibility = false
  }
}

function watchVisibility(next: QualityHold): void {
  next.observer?.disconnect()
  reveal(next)
  const observer = new MutationObserver(() => {
    if (hold !== next) return
    reveal(next)
    if (next.video.hasAttribute("crossorigin")) clearCrossOrigin(next.video)
  })
  observer.observe(next.video, { attributes: true, attributeFilter: ["style", "class", "crossorigin"] })
  next.observer = observer
}

function stopWatch(next: QualityHold): void {
  next.observer?.disconnect()
  next.observer = null
}

function detachLoad(next: QualityHold): void {
  window.clearTimeout(next.timer)
  next.timer = 0
  next.video.removeEventListener("loadedmetadata", next.onReady)
  next.video.removeEventListener("loadeddata", next.onReady)
  next.video.removeEventListener("resize", next.onReady)
  next.video.removeEventListener("error", next.onError)
}

function placePlayback(next: QualityHold): void {
  const video = next.video
  try {
    if (next.time > 0) {
      const duration = video.duration
      const at =
        Number.isFinite(duration) && duration > 0 ? Math.min(next.time, Math.max(0, duration - 0.05)) : next.time
      video.currentTime = at
    }
  } catch {
    /* The player can reject a seek until the new file is ready. */
  }
  try {
    video.playbackRate = next.rate
  } catch {
    /* Ignore a rate the element rejects. */
  }
  video.muted = next.muted
  try {
    video.volume = next.volume
  } catch {
    /* Ignore a volume the element rejects. */
  }
  if (!next.paused && !next.ended) void nativePlay.call(video).catch(() => undefined)
}

function userPaused(next: QualityHold): boolean {
  return next.video.getAttribute(USER_PAUSE_MARK) === "1"
}

function disarmPlaybackGuard(next: QualityHold): void {
  if (!next.guarding && next.guardTimer === 0) return
  next.guarding = false
  window.clearTimeout(next.guardTimer)
  next.guardTimer = 0
  const video = next.video
  video.removeEventListener("pause", next.onPause)
  video.removeEventListener("volumechange", next.onLevel)
  video.removeEventListener("playing", next.onPlaying)
  if (video.dataset.veePauseGuard === "1") {
    delete video.dataset.veePauseGuard
    Reflect.deleteProperty(video, "pause")
    Reflect.deleteProperty(video, "load")
  }
}

/**
 * Instagram pauses and mutes the element after a source change.
 * Hold the chosen playback until the new file is actually playing.
 */
function armPlaybackGuard(next: QualityHold): void {
  disarmPlaybackGuard(next)
  const video = next.video
  next.guarding = true
  next.armedAt = performance.now()
  next.resumeTries = 0
  next.levelTries = 0
  next.onPause = () => {
    if (!next.guarding || next.paused || next.ended || userPaused(next)) return
    if (next.resumeTries > 8) return
    next.resumeTries += 1
    void nativePlay.call(video).catch(() => undefined)
  }
  next.onLevel = () => {
    if (!next.guarding || performance.now() - next.armedAt > 3000 || next.levelTries > 24) return
    const mutedChanged = video.muted !== next.muted
    const volumeChanged = Math.abs(video.volume - next.volume) > 0.02
    if (!mutedChanged && !volumeChanged) return
    if (lastViewerInput > next.armedAt || (next.muted && !video.muted)) {
      next.muted = video.muted
      next.volume = video.volume
      return
    }
    next.levelTries += 1
    video.muted = next.muted
    try {
      video.volume = next.volume
    } catch {
      /* Ignore a volume the element rejects. */
    }
  }
  next.onPlaying = () => {
    window.setTimeout(() => {
      if (hold === next) disarmPlaybackGuard(next)
    }, 2000)
  }
  video.addEventListener("pause", next.onPause)
  video.addEventListener("volumechange", next.onLevel)
  video.addEventListener("playing", next.onPlaying)
  next.guardTimer = window.setTimeout(() => disarmPlaybackGuard(next), 8000)
  if (video.dataset.veePauseGuard === "1") return
  try {
    video.pause = () => {
      const active = hold?.video === video ? hold : null
      if (active?.guarding && !active.paused && !active.ended && !userPaused(active)) return
      nativePause.call(video)
    }
    video.load = () => {
      const active = hold?.video === video ? hold : null
      if (active?.guarding) return
      nativeLoad.call(video)
    }
    video.dataset.veePauseGuard = "1"
  } catch {
    /* The player can already own these methods. The pause listener still resumes. */
  }
}

function restoreSource(next: QualityHold, preferPending: boolean): void {
  disarmPlaybackGuard(next)
  stopWatch(next)
  if (hold === next) hold = null
  next.video.removeAttribute(QUALITY_MARK)
  const video = next.video
  try {
    if (next.savedCrossOrigin) mediaOrigin?.set?.call(video, next.savedCrossOrigin)
    else clearCrossOrigin(video)
    const progressive = !next.savedObject && Boolean(next.savedSrc) && !next.savedSrc.startsWith("blob:")
    if (preferPending && next.pendingObject) mediaObject?.set?.call(video, next.pendingObject)
    else if (preferPending && next.pendingSrc) mediaSrc?.set?.call(video, next.pendingSrc)
    else if (progressive) mediaSrc?.set?.call(video, next.savedSrc)
    else if (next.pendingObject) mediaObject?.set?.call(video, next.pendingObject)
    else if (next.pendingSrc) mediaSrc?.set?.call(video, next.pendingSrc)
    else if (next.savedObject) mediaObject?.set?.call(video, next.savedObject)
    else if (next.savedSrc) mediaSrc?.set?.call(video, next.savedSrc)
  } catch {
    /* The player can drop a source that is no longer current. */
  }
  if (!next.paused && !next.ended) void nativePlay.call(video).catch(() => undefined)
  const epoch = ++revealEpoch
  window.setTimeout(() => {
    if (epoch !== revealEpoch || hold) return
    clearReveal(next)
  }, REVEAL_HOLD_MS)
}

function fileReady(next: QualityHold): boolean {
  const live = next.video.currentSrc || next.video.src || ""
  return (
    Boolean(live) &&
    mediaPath(live) === mediaPath(next.url) &&
    next.video.videoWidth >= 2 &&
    next.video.videoHeight >= 2
  )
}

/** The page is already showing some other file, so a restore would replace it. */
function pageMovedOn(next: QualityHold): boolean {
  const live = next.video.currentSrc || next.video.src || ""
  if (!live || live.startsWith("blob:") || mediaPath(live) === mediaPath(next.url)) return false
  return next.video.videoWidth >= 2 && next.video.readyState >= 2
}

function settle(next: QualityHold, ok: boolean): void {
  if (hold !== next || next.settled) return
  next.settled = true
  detachLoad(next)
  if (ok && fileReady(next)) {
    next.played = true
    placePlayback(next)
    if (hold !== next) return
    reveal(next)
    postRenditionResult("used", next.token, next.url, next.audioUrl)
    return
  }
  restoreSource(next, false)
  postRenditionResult("failed", next.token, next.url, next.audioUrl)
}

function useRendition(message: RenditionMessage): void {
  const token = message.token || ""
  const url = message.url || ""
  const video = videoForToken(token)
  if (!video || !url) {
    if (token) postRenditionResult("failed", token, url, message.audioUrl || "")
    return
  }
  const audioUrl = message.audioUrl || ""
  if (
    hold?.video === video &&
    !hold.settled &&
    mediaPath(hold.url) === mediaPath(url) &&
    hold.audioUrl === audioUrl
  ) {
    return
  }
  if (hold?.video === video && hold.played && mediaPath(hold.url) === mediaPath(url) && hold.audioUrl === audioUrl) {
    postRenditionResult("used", token, url, audioUrl)
    return
  }
  const previous = hold?.video === video ? hold : null
  if (hold && hold !== previous) {
    hold.settled = true
    detachLoad(hold)
    restoreSource(hold, false)
  }
  if (previous) {
    previous.settled = true
    detachLoad(previous)
    disarmPlaybackGuard(previous)
    stopWatch(previous)
    if (hold === previous) hold = null
  }
  video.removeAttribute(USER_PAUSE_MARK)
  const next: QualityHold = {
    video,
    token,
    url,
    audioUrl,
    time: message.time || 0,
    paused: message.paused === true,
    ended: message.ended === true,
    rate: message.rate || 1,
    muted: message.muted === true,
    volume: typeof message.volume === "number" ? message.volume : 1,
    savedSrc: previous && !previous.played ? previous.savedSrc : video.currentSrc || video.src || "",
    savedObject: previous && !previous.played ? previous.savedObject : video.srcObject,
    savedCrossOrigin: previous ? previous.savedCrossOrigin : video.crossOrigin,
    pendingObject: null,
    pendingSrc: "",
    played: false,
    settled: false,
    timer: 0,
    observer: null,
    forcedOpacity: previous?.forcedOpacity === true,
    forcedVisibility: previous?.forcedVisibility === true,
    savedOpacity: previous?.forcedOpacity ? previous.savedOpacity : inlineStyle(video, "opacity"),
    savedVisibility: previous?.forcedVisibility ? previous.savedVisibility : inlineStyle(video, "visibility"),
    onReady: () => undefined,
    onError: () => undefined,
    guarding: false,
    armedAt: 0,
    guardTimer: 0,
    resumeTries: 0,
    levelTries: 0,
    onPause: () => undefined,
    onLevel: () => undefined,
    onPlaying: () => undefined
  }
  let assigned = false
  next.onReady = () => {
    if (fileReady(next)) settle(next, true)
  }
  next.onError = () => {
    if (!assigned || next.video.error?.code === MediaError.MEDIA_ERR_ABORTED) return
    const live = next.video.currentSrc || next.video.src || ""
    if (live && mediaPath(live) !== mediaPath(next.url)) return
    settle(next, false)
  }
  hold = next
  guardVideo(video)
  watchVisibility(next)
  video.addEventListener("loadedmetadata", next.onReady)
  video.addEventListener("loadeddata", next.onReady)
  video.addEventListener("resize", next.onReady)
  video.addEventListener("error", next.onError)
  next.timer = window.setTimeout(() => settle(next, fileReady(next)), PAINT_WAIT_MS)
  try {
    clearCrossOrigin(video)
    mediaObject?.set?.call(video, null)
    if (next.settled) return
    assigned = true
    if (mediaSrc?.set) mediaSrc.set.call(video, url)
    else video.src = url
    if (!next.paused && !next.ended) void nativePlay.call(video).catch(() => undefined)
    armPlaybackGuard(next)
  } catch {
    settle(next, false)
  }
}

function dropRendition(message: RenditionMessage): void {
  if (!hold || message.token !== hold.token) return
  const next = hold
  next.settled = true
  detachLoad(next)
  const movedOn = pageMovedOn(next)
  if (message.restore === false || movedOn) {
    disarmPlaybackGuard(next)
    stopWatch(next)
    hold = null
    next.video.removeAttribute(QUALITY_MARK)
    if (!movedOn) return
    const epoch = ++revealEpoch
    window.setTimeout(() => {
      if (epoch !== revealEpoch || hold) return
      clearReveal(next)
    }, REVEAL_HOLD_MS)
    return
  }
  restoreSource(next, true)
}

let ytWatchInstalled = false
let ytNativeFetch: typeof window.fetch | null = null
let ytVideoId = ""
let ytTitle = ""
let ytLive = false
let ytTracks: YtTrack[] = []
let ytStamp = ""
let ytRefresh: number[] = []
let ytPendingPlayback: string[] = []
let ytPlayerAsked = ""
let ytPlayerTries = 0
const ytScriptStamps = new Set<string>()

const ANDROID_PLAYER = {
  clientName: "ANDROID",
  clientVersion: "20.10.38",
  androidSdkVersion: 30,
  osName: "Android",
  osVersion: "11"
}

type WatchedXhr = XMLHttpRequest & { __veeYt?: string }

function onYoutubeHost(): boolean {
  const host = location.hostname.replace(/^www\./, "")
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  )
}

function youtubeAdPlaying(): boolean {
  return Boolean(document.querySelector(".ad-showing, .ytp-ad-player-overlay"))
}

function syncYoutubePage(): void {
  const pageId = youtubeVideoId(location.href)
  if (pageId === ytVideoId) return
  ytVideoId = pageId
  ytTitle = ""
  ytLive = false
  ytTracks = []
  ytStamp = ""
  ytPendingPlayback = []
  ytPlayerAsked = ""
  ytPlayerTries = 0
  ytScriptStamps.clear()
  if (!pageId) return
  publishYoutube()
}

function publishYoutube(): void {
  const offer = downloadOffer(ytVideoId, ytTitle, ytLive, ytTracks)
  const stamp = [offer.videoId, offer.live ? "1" : "0", offer.title, offer.combinedUrl, offer.videoUrl, offer.audioUrl].join("|")
  if (stamp === ytStamp) return
  ytStamp = stamp
  if (!offer.videoId) return
  window.postMessage({ source: YT_MEDIA_SOURCE, kind: "offer", ...offer }, "*")
}

function absorbPlayerValue(value: unknown): void {
  syncYoutubePage()
  if (!ytVideoId) return
  let nextTracks = ytTracks
  let nextTitle = ytTitle
  let nextLive = ytLive
  let changed = false
  for (const media of collectPlayers(value)) {
    if (media.videoId !== ytVideoId) continue
    changed = true
    if (media.title) nextTitle = media.title
    if (media.live) nextLive = true
    nextTracks = nextLive ? [] : mergeTracks(nextTracks, media.tracks)
  }
  if (!changed) return
  ytTitle = nextTitle
  ytLive = nextLive
  ytTracks = nextTracks
  if (!ytLive && ytTracks.length && ytPendingPlayback.length) {
    const pending = ytPendingPlayback
    ytPendingPlayback = []
    for (const raw of pending) ytTracks = rememberPlayback(ytTracks, raw).slice()
  }
  publishYoutube()
  void requestPlayerFile()
}

function absorbPlayerText(text: string): void {
  if (!text || text.length > 12_000_000 || !text.includes("streamingData")) return
  try {
    absorbPlayerValue(JSON.parse(text) as unknown)
    return
  } catch {
    /* A script can assign the player object instead of being the object. */
  }
  const assigned = extractAssignedObject(text, "ytInitialPlayerResponse") || extractAssignedObject(text, "playerResponse")
  if (assigned) absorbPlayerValue(assigned)
}

function noteYoutubePlayback(raw: string): void {
  if (!raw.includes("videoplayback") || youtubeAdPlaying()) return
  syncYoutubePage()
  if (!ytVideoId || ytLive) return
  if (!ytTracks.length) {
    ytPendingPlayback.push(raw)
    if (ytPendingPlayback.length > 48) ytPendingPlayback.shift()
    return
  }
  const next = rememberPlayback(ytTracks, raw)
  if (next === ytTracks) return
  ytTracks = next.slice()
  publishYoutube()
}

function isPlayerApi(url: string): boolean {
  return /\/youtubei\/v1\/player(?:\?|$)|reel_item_watch|reel_watch_sequence|get_watch\?/i.test(url)
}

function noteYoutubeResponse(response: Response): void {
  const url = response.url || ""
  if (url.includes("videoplayback")) {
    noteYoutubePlayback(url)
    return
  }
  if (!isPlayerApi(url)) return
  void response
    .clone()
    .text()
    .then((text) => absorbPlayerText(text))
    .catch(() => undefined)
}

function noteYoutubeXhr(xhr: WatchedXhr): void {
  const url = xhr.responseURL || xhr.__veeYt || ""
  if (url.includes("videoplayback")) {
    noteYoutubePlayback(url)
    return
  }
  if (!isPlayerApi(url)) return
  if (xhr.responseType === "json") {
    absorbPlayerValue(xhr.response)
    return
  }
  if (xhr.responseType && xhr.responseType !== "text") return
  if (typeof xhr.responseText === "string") absorbPlayerText(xhr.responseText)
}

function requestHref(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

function readYoutubeGlobals(): void {
  const bag = window as unknown as {
    ytInitialPlayerResponse?: unknown
    ytplayer?: { config?: { args?: { player_response?: string } } }
  }
  if (bag.ytInitialPlayerResponse) absorbPlayerValue(bag.ytInitialPlayerResponse)
  const embedded = bag.ytplayer?.config?.args?.player_response
  if (typeof embedded === "string") absorbPlayerText(embedded)
}

function readYoutubeScripts(): void {
  document.querySelectorAll("script").forEach((node) => {
    const text = node.textContent || ""
    const at = text.indexOf("ytInitialPlayerResponse")
    if (at < 0 || text.length > 8_000_000) return
    const stamp = `${text.length}:${at}:${text.slice(at, at + 40)}`
    if (ytScriptStamps.has(stamp)) return
    ytScriptStamps.add(stamp)
    const assigned = extractAssignedObject(text, "ytInitialPlayerResponse")
    if (assigned) absorbPlayerValue(assigned)
  })
}

function innertubeValue(name: string): string {
  const bag = window as unknown as {
    ytcfg?: { get?: (key: string) => unknown; data_?: Record<string, unknown> }
  }
  const direct = bag.ytcfg?.get?.(name)
  if (typeof direct === "string" && direct) return direct
  const stored = bag.ytcfg?.data_?.[name]
  return typeof stored === "string" ? stored : ""
}

/** The watch-page player lists sizes only. The Android player response still includes a file address. */
function requestPlayerFile(force = false): void {
  if (!ytNativeFetch || !ytVideoId || ytLive) return
  if (!force && ytTracks.some((track) => track.url && !track.played)) return
  if (ytPlayerAsked === ytVideoId || ytPlayerTries >= 3) return
  const key = innertubeValue("INNERTUBE_API_KEY")
  if (!key) return
  const videoId = ytVideoId
  const visitor = innertubeValue("VISITOR_DATA")
  ytPlayerAsked = videoId
  ytPlayerTries += 1
  const body = JSON.stringify({
    videoId,
    context: {
      client: {
        ...ANDROID_PLAYER,
        hl: "en",
        gl: "US",
        visitorData: visitor
      }
    },
    contentCheckOk: true,
    racyCheckOk: true
  })
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (visitor) headers["x-goog-visitor-id"] = visitor
  void ytNativeFetch
    .call(window, `https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=${encodeURIComponent(key)}`, {
      method: "POST",
      credentials: "include",
      headers,
      body
    })
    .then(async (response) => {
      if (ytVideoId !== videoId) return
      absorbPlayerText(await response.text())
      if (ytVideoId === videoId && !ytLive && !ytTracks.some((track) => track.url && !track.played)) ytPlayerAsked = ""
    })
    .catch(() => {
      if (ytVideoId === videoId) ytPlayerAsked = ""
    })
}

function refreshYoutubeSoon(): void {
  for (const timer of ytRefresh) window.clearTimeout(timer)
  ytRefresh = [0, 300, 1000, 2500].map((delay) =>
    window.setTimeout(() => {
      syncYoutubePage()
      readYoutubeGlobals()
      readYoutubeScripts()
      void requestPlayerFile()
    }, delay)
  )
}

function installYoutubeWatch(): void {
  if (ytWatchInstalled || !onYoutubeHost()) return
  ytWatchInstalled = true
  const nativeFetch = window.fetch
  ytNativeFetch = nativeFetch
  window.fetch = function (this: Window, input: RequestInfo | URL, init?: RequestInit) {
    const asked = requestHref(input)
    if (asked.includes("videoplayback")) noteYoutubePlayback(asked)
    return nativeFetch.call(window, input, init).then((response) => {
      try {
        noteYoutubeResponse(response)
      } catch {
        /* The player still receives its response. */
      }
      return response
    })
  }
  const nativeOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: [string, string | URL, boolean?, (string | null)?, (string | null)?]) {
    const url = args[1]
    ;(this as WatchedXhr).__veeYt = String(url)
    if (String(url).includes("videoplayback")) noteYoutubePlayback(String(url))
    return nativeOpen.apply(this, args)
  } as typeof XMLHttpRequest.prototype.open
  const nativeSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener("load", () => {
      try {
        noteYoutubeXhr(this as WatchedXhr)
      } catch {
        /* Ignore unreadable bodies. */
      }
    })
    return nativeSend.call(this, body)
  }
  window.addEventListener("yt-navigate-start", refreshYoutubeSoon)
  window.addEventListener("yt-navigate-finish", refreshYoutubeSoon)
  window.addEventListener("yt-page-data-updated", refreshYoutubeSoon)
  document.addEventListener("DOMContentLoaded", refreshYoutubeSoon)
  refreshYoutubeSoon()
}

async function onYoutubeFetch(data: unknown): Promise<void> {
  const request = readYtFetchRequest(data)
  if (!request || !ytNativeFetch) return
  try {
    const response = await ytNativeFetch.call(window, request.url, { credentials: "omit", referrer: location.href })
    if (!response.ok) throw new Error(String(response.status))
    const length = Number(response.headers.get("content-length") || "")
    if (Number.isFinite(length) && length > 500_000_000) throw new Error("large")
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > 500_000_000) throw new Error("large")
    window.postMessage({ source: YT_MEDIA_SOURCE, kind: "data", token: request.token, ok: true, buffer }, "*")
  } catch {
    window.postMessage({ source: YT_MEDIA_SOURCE, kind: "data", token: request.token, ok: false }, "*")
  }
}

/** Record renditions from responses these pages already load. */
function installRenditionWatch(): void {
  if (renditionWatchInstalled || !onRenditionHost()) return
  renditionWatchInstalled = true
  watchScripts()
  const nativeFetch = window.fetch
  window.fetch = function (this: Window, input: RequestInfo | URL, init?: RequestInit) {
    return nativeFetch.call(window, input, init).then((response) => {
      noteResponse(response)
      return response
    })
  }
  const nativeSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener("load", () => noteXhr(this))
    return nativeSend.call(this, body)
  }
}

installRenditionWatch()
installYoutubeWatch()
watchNativeMirror()
watchSitePlayer()

function watchSitePlayer(): void {
  let timer = 0
  const sample = () => {
    if (document.hidden) return
    document.querySelectorAll("video").forEach((node) => {
      if (node instanceof HTMLVideoElement) publishSitePlayer(node)
    })
  }
  const soon = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(sample, 80)
  }
  window.setInterval(sample, 400)
  document.addEventListener("click", soon, true)
  document.addEventListener("input", soon, true)
  const start = () => sample()
  if (document.documentElement) start()
  else document.addEventListener("DOMContentLoaded", start, { once: true })
}

function watchNativeMirror(): void {
  let mirrorObserver: MutationObserver | null = null
  const drain = () => {
    document.querySelectorAll(`video[${NATIVE_MIRROR_ATTR}]`).forEach((node) => {
      if (node instanceof HTMLVideoElement) applyNativeMirror(node)
    })
  }
  const start = () => {
    if (mirrorObserver || !document.documentElement) return
    mirrorObserver = new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target
        if (node instanceof HTMLVideoElement && node.hasAttribute(NATIVE_MIRROR_ATTR)) {
          applyNativeMirror(node)
        }
      }
    })
    mirrorObserver.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: [NATIVE_MIRROR_ATTR]
    })
    drain()
  }
  if (document.documentElement) start()
  else document.addEventListener("DOMContentLoaded", start, { once: true })
}

function readPendingRendition(): RenditionMessage | null {
  const root = document.documentElement
  if (!root) return null
  const raw = root.getAttribute(RENDITION_PENDING_ATTR)
  if (!raw) return null
  root.removeAttribute(RENDITION_PENDING_ATTR)
  try {
    return readRenditionMessage(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

window.addEventListener(RENDITION_USE_EVENT, () => {
  const message = readPendingRendition()
  if (message?.kind === "use") useRendition(message)
})

window.addEventListener("message", (event) => {
  if (event.source !== window) return
  if (readYtAsk(event.data)) {
    ytStamp = ""
    publishYoutube()
    return
  }
  if (readYtRefresh(event.data)) {
    ytPlayerAsked = ""
    ytPlayerTries = 0
    requestPlayerFile(true)
    return
  }
  if (readYtFetchRequest(event.data)) {
    void onYoutubeFetch(event.data)
    return
  }
  const renditions = readRenditionMessage(event.data)
  if (renditions?.kind === "hold") {
    noteHold(renditions)
    return
  }
  if (renditions?.kind === "ask") {
    publishRenditions([])
    return
  }
  if (renditions?.kind === "use") {
    useRendition(renditions)
    return
  }
  if (renditions?.kind === "drop") {
    dropRendition(renditions)
    return
  }
  if (renditions) return
  const active = readEngineSignal(event.data)
  if (active == null) return
  if (active) install()
  else uninstall()
})
