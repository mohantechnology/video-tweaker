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

function cssFor(place: NewBadgePlace): string {
  if (place === "default") return ""
  if (place === "hide") return `${NEW_BADGE}{display:none!important;}`
  const rules = [`${NEW_BADGE}{${CORNER[place]}z-index:3!important;}`]
  if (place === "bottom-right") {
    rules.push(`${WATCH_BADGE}{bottom:28px!important;}`)
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

/** Move or hide the New label. Default removes the override. */
export function applyYoutubeNewBadge(place: NewBadgePlace): void {
  const css = cssFor(place)
  const existing = document.getElementById(STYLE_ID)
  if (!css) {
    existing?.remove()
    return
  }
  const style = existing ?? document.createElement("style")
  style.id = STYLE_ID
  style.textContent = css
  if (!style.parentNode) (document.head || document.documentElement).appendChild(style)
}
