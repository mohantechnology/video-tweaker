import type { PlasmoCSConfig } from "plasmo"

import { readEngineSignal } from "~lib/engine"
import { groupsFromText, groupsFromValue, readRenditionMessage, RENDITION_SOURCE, type Rendition } from "~lib/renditions"
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
  const active = readEngineSignal(event.data)
  if (active == null) return
  if (active) install()
  else uninstall()
})
