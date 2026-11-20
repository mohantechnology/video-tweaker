import { NEW_BADGE_BLINK_MS } from "../settings"
import { type NewBadgePlace } from "./types"

const STYLE_ID = "vee-youtube-new-badge"

/**
 * Regular watch thumbnails and Shorts shelves draw the New label on
 * different elements. Duration and other marks use neither of these.
 */
const NEW_BADGE = [
  'yt-thumbnail-overlay-badge-view-model:has(badge-shape[aria-label="New" i])',
  'ytd-thumbnail-overlay-badge-renderer:has([aria-label="New" i])',
  'yt-badge-view-model.shortsLockupViewModelHostBadge:has(badge-shape[aria-label="New" i])',
  'ytm-shorts-lockup-view-model yt-badge-view-model:has(badge-shape[aria-label="New" i])'
].join(",\n")

/** Long-video thumbnails. Their duration chip sits in the bottom-right corner. */
const WATCH_BADGE = [
  'yt-thumbnail-overlay-badge-view-model:has(badge-shape[aria-label="New" i])',
  'ytd-thumbnail-overlay-badge-renderer:has([aria-label="New" i])'
].join(",\n")

const CORNER: Record<Exclude<NewBadgePlace, "default" | "hide">, string> = {
  "top-right": "top:0!important;right:0!important;bottom:auto!important;left:auto!important;",
  "bottom-right": "top:auto!important;right:0!important;bottom:0!important;left:auto!important;",
  "bottom-left": "top:auto!important;right:auto!important;bottom:0!important;left:0!important;"
}

function cssFor(place: NewBadgePlace, blink: boolean): string {
  if (place === "hide") return `${NEW_BADGE}{display:none!important;}`

  const rules: string[] = []
  if (place !== "default") {
    rules.push(`${NEW_BADGE}{${CORNER[place]}z-index:3!important;}`)
    if (place === "bottom-right") {
      rules.push(`${WATCH_BADGE}{bottom:28px!important;}`)
    }
  }
  if (blink) {
    // Name includes the duration so a settings.ts change starts a fresh animation
    // instead of leaving the previous cycle running.
    const ms = Math.max(200, Math.round(NEW_BADGE_BLINK_MS))
    const name = `vee-new-badge-blink-${ms}`
    rules.push(`@keyframes ${name}{0%,100%{opacity:1}50%{opacity:0}}`)
    rules.push(
      `${NEW_BADGE}{animation:${name} ${ms}ms ease-in-out infinite!important;}`
    )
  }
  return rules.join("\n")
}

export function isYoutubePage(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  )
}

/** Move, hide, or pulse the New label. Default with blink off removes the override. */
export function applyYoutubeNewBadge(place: NewBadgePlace, blink = false): void {
  const css = cssFor(place, blink)
  const existing = document.getElementById(STYLE_ID)
  // Drop the old node so Chrome does not keep the previous animation duration.
  existing?.remove()
  if (!css) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = css
  ;(document.head || document.documentElement).appendChild(style)
}
