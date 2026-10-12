import type { PlasmoCSConfig } from "plasmo"

import { readEngineSignal } from "~lib/engine"
import {
  groupsFromText,
  groupsFromValue,
  postRenditionResult,
  QUALITY_MARK,
  readRenditionMessage,
  RENDITION_SOURCE,
  type Rendition,
  type RenditionMessage
} from "~lib/renditions"
import { fileUrl, mediaPath } from "~lib/media-file"

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
let renditionWatchInstalled = false

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
  if (!text || text.length > 12_000_000) return
  if (
    !text.includes("video_versions") &&
    !text.includes("video_dash_manifest") &&
    !text.includes("dash_manifest") &&
    !text.includes("progressive_url") &&
    !text.includes("browser_native_hd_url") &&
    !text.includes("playable_url_quality_hd") &&
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

function notePlayed(url: string): void {
  const file = fileUrl(url)
  if (!file) return
  const path = mediaPath(file)
  if (!/\.(mp4|webm|m4v|mov)$/i.test(path)) return
  if (playedPaths[0] === path) return
  playedPaths.unshift(path)
  if (playedPaths.length > 16) playedPaths.length = 16
  publishRenditions([])
}

function absorbRenditions(found: Rendition[][]): void {
  if (!found.length) return
  const batch: Rendition[][] = []
  for (const group of found) {
    const key = group
      .map((item) => mediaPath(item.url))
      .sort()
      .join("|")
    if (!key) continue
    const previous = renditionCatalog.get(key)
    if (previous) {
      const richer =
        group.length > previous.length ||
        group.reduce((sum, item) => sum + (item.aliases?.length || 0), 0) >
          previous.reduce((sum, item) => sum + (item.aliases?.length || 0), 0)
      const incomingTitle = group.find((item) => item.title)?.title
      const keptTitle = previous.find((item) => item.title)?.title
      if (richer) {
        if (keptTitle) for (const item of group) if (!item.title) item.title = keptTitle
        renditionCatalog.set(key, group)
        batch.push(group)
      } else if (incomingTitle && !keptTitle) {
        for (const item of previous) if (!item.title) item.title = incomingTitle
        batch.push(previous)
      }
      continue
    }
    renditionCatalog.set(key, group)
    batch.push(group)
    while (renditionCatalog.size > 48) {
      const first = renditionCatalog.keys().next().value
      if (first == null) break
      renditionCatalog.delete(first)
    }
  }
  if (batch.length) publishRenditions(batch)
}

function noteResponse(response: Response): void {
  try {
    notePlayed(response.url)
    const type = (response.headers.get("content-type") || "").toLowerCase()
    if (
      type.startsWith("video/") ||
      type.startsWith("audio/") ||
      type.startsWith("image/") ||
      type.includes("octet-stream")
    ) {
      return
    }
    const length = Number(response.headers.get("content-length") || "")
    if (Number.isFinite(length) && length > 12_000_000) return
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
    notePlayed(xhr.responseURL || "")
    const type = (xhr.getResponseHeader("content-type") || "").toLowerCase()
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

const PAINT_WAIT_MS = 2500
const REVEAL_HOLD_MS = 1200

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
}

let hold: QualityHold | null = null
let revealEpoch = 0

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
  if (!next.paused && !next.ended) void video.play().catch(() => undefined)
}

function restoreSource(next: QualityHold, preferPending: boolean): void {
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
  if (!next.paused && !next.ended) void video.play().catch(() => undefined)
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
    stopWatch(previous)
    if (hold === previous) hold = null
  }
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
    onError: () => undefined
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

window.addEventListener("message", (event) => {
  if (event.source !== window) return
  const renditions = readRenditionMessage(event.data)
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
