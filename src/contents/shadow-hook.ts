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
