import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: true,
  run_at: "document_start",
  world: "MAIN"
}

const MARK = "data-vee-shadow"
const patchedFlag = "__veeAttachShadow"

type Patched = typeof Element.prototype.attachShadow & { [patchedFlag]?: boolean }

const current = Element.prototype.attachShadow as Patched
if (!current[patchedFlag]) {
  const original = current
  const patched: Patched = function (this: Element, init: ShadowRootInit) {
    const root = original.call(this, { ...init, mode: "open" })
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

const YOUTUBE_SKIP =
  ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-overlay-close-button"
const PRESS = "data-vee-press"

new MutationObserver((records) => {
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
}).observe(document, { subtree: true, attributes: true, attributeFilter: [PRESS] })
