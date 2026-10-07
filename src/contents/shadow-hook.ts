import type { PlasmoCSConfig } from "plasmo"

import { readEngineSignal } from "~lib/engine"

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

window.addEventListener("message", (event) => {
  if (event.source !== window) return
  const active = readEngineSignal(event.data)
  if (active == null) return
  if (active) install()
  else uninstall()
})
