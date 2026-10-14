/**
 * The overlay writes the media element from an isolated world.
 * YouTube and Instagram keep their own player state, so those writes do not
 * move the site icons. The page-world hook reads this attribute and calls
 * the player. A newer seq replaces one that is still waiting on the player.
 */
export const NATIVE_MIRROR_ATTR = "data-vee-mirror"

const OURS = "#vee-seek-bar, #vee-csui"
const RATE_EPSILON = 0.02
const RETRY_LIMIT = 4
const RETRY_MS = 80
/** YouTube's speed slider. Rates outside this stay on the video; the slider sits at the near end. */
const YT_SPEED_MIN = 0.25
const YT_SPEED_MAX = 2
/** Clamped player rate we last wrote, so a later read is not treated as a user edit. */
export const YT_ECHO_ATTR = "data-vee-yt-echo"
/** Set while a player write is in progress, so the ratechange is not adopted as a user edit. */
export const YT_HOLD_ATTR = "data-vee-yt-hold"

export type NativeMirrorPatch = {
  volume?: number
  muted?: boolean
  playbackRate?: number
  loop?: boolean
}

type NativeMirror = NativeMirrorPatch & { seq: number }

type YoutubePlayer = HTMLElement & {
  setVolume?: (volume: number) => void
  getVolume?: () => number
  mute?: () => void
  unMute?: () => void
  isMuted?: () => boolean
  setPlaybackRate?: (rate: number) => void
  getPlaybackRate?: () => number
  getAvailablePlaybackRates?: () => number[]
}

const LOOP_PAIRS = [
  ["getLoop", "setLoop"],
  ["getLoopVideo", "setLoopVideo"],
  ["isLoop", "setLoop"],
  ["isLoopVideo", "setLoopVideo"]
] as const

let mirrorSuspended = false
let mirrorSeq = 0
let speedToken = 0
let instagramRates: number[] | null = null
let instagramRatesKnown = false
let instagramRatesPath = ""
const latestSeq = new WeakMap<HTMLVideoElement, number>()
const mirroredLevel = new WeakMap<HTMLVideoElement, string>()
const mirroredRate = new WeakMap<HTMLVideoElement, number>()
const desiredSpeed = new WeakMap<HTMLVideoElement, number>()
let speedLabelVideo: HTMLVideoElement | null = null
let speedLabelListener = false
let speedLabelObserver: MutationObserver | null = null
let speedLabelObserverTimer = 0

export function setNativeMirrorSuspended(suspended: boolean): void {
  mirrorSuspended = suspended
}

export function queueNativeMirror(video: HTMLVideoElement, patch: NativeMirrorPatch): void {
  if (mirrorSuspended || !video.isConnected) return
  if (!hasField(patch)) return
  const payload: NativeMirror = { ...patch, seq: ++mirrorSeq }
  try {
    video.setAttribute(NATIVE_MIRROR_ATTR, JSON.stringify(payload))
  } catch {
    /* The element can already be detached. */
  }
}

function hasField(patch: NativeMirrorPatch): boolean {
  return (
    typeof patch.volume === "number" ||
    typeof patch.muted === "boolean" ||
    typeof patch.playbackRate === "number" ||
    typeof patch.loop === "boolean"
  )
}

export function applyNativeMirror(video: HTMLVideoElement): void {
  const raw = video.getAttribute(NATIVE_MIRROR_ATTR)
  if (!raw) return
  video.removeAttribute(NATIVE_MIRROR_ATTR)
  const patch = readMirror(raw)
  if (!patch) return
  const previous = latestSeq.get(video) ?? 0
  if (patch.seq < previous) return
  latestSeq.set(video, patch.seq)
  if (onYoutube()) applyYoutube(video, patch, 0)
  else if (onInstagram()) applyInstagram(video, patch)
}

function readMirror(raw: string): NativeMirror | null {
  try {
    const value = JSON.parse(raw) as Partial<NativeMirror>
    if (!value || typeof value.seq !== "number") return null
    const patch: NativeMirror = { seq: value.seq }
    if (typeof value.volume === "number" && Number.isFinite(value.volume)) patch.volume = clamp01(value.volume)
    if (typeof value.muted === "boolean") patch.muted = value.muted
    if (typeof value.playbackRate === "number" && Number.isFinite(value.playbackRate)) {
      patch.playbackRate = value.playbackRate
    }
    if (typeof value.loop === "boolean") patch.loop = value.loop
    return hasField(patch) ? patch : null
  } catch {
    return null
  }
}

function stillCurrent(video: HTMLVideoElement, seq: number): boolean {
  return latestSeq.get(video) === seq
}

function siteHost(): string {
  return location.hostname.replace(/^www\./, "")
}

function onYoutube(): boolean {
  const name = siteHost()
  return (
    name === "youtube.com" ||
    name.endsWith(".youtube.com") ||
    name === "youtube-nocookie.com" ||
    name.endsWith(".youtube-nocookie.com")
  )
}

function onInstagram(): boolean {
  const name = siteHost()
  return name === "instagram.com" || name.endsWith(".instagram.com")
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function nearRate(a: number, b: number): boolean {
  return Math.abs(a - b) <= RATE_EPSILON
}

function youtubePlayer(video: HTMLVideoElement): YoutubePlayer | null {
  let node: HTMLElement | null = video.parentElement
  while (node) {
    const player = node as YoutubePlayer
    if (typeof player.setVolume === "function" && typeof player.mute === "function") return player
    node = node.parentElement
  }
  return null
}

function applyYoutube(video: HTMLVideoElement, patch: NativeMirror, attempt: number): void {
  if (!stillCurrent(video, patch.seq) || !video.isConnected) return
  const player = youtubePlayer(video)
  if (!player) {
    if (attempt < RETRY_LIMIT) window.setTimeout(() => applyYoutube(video, patch, attempt + 1), RETRY_MS)
    return
  }
  noteMirroredPlayer(video, patch)
  const level = youtubeLevel(video, patch)
  if (level) pushYoutubeAudio(player, video, level.volume, level.muted, false)
  if (typeof patch.loop === "boolean") pushYoutubeLoop(player, patch.loop)
  if (typeof patch.playbackRate !== "number" || typeof player.setPlaybackRate !== "function") return
  const requested = patch.playbackRate
  desiredSpeed.set(video, requested)
  speedLabelVideo = video
  ensureYoutubeSpeedLabelListener()
  const bounds = youtubeSpeedBounds(player)
  // Inside 0.25–2 the player accepts steps the old rate list does not name.
  // Outside that, the slider can only sit on the nearest end.
  let match = clampSpeed(requested, bounds)
  const outside = !nearRate(requested, match)
  if (outside) video.setAttribute(YT_ECHO_ATTR, String(match))
  else video.removeAttribute(YT_ECHO_ATTR)
  const pushed = mirroredRate.get(video)
  const live = readPlayerRate(player)
  const already = pushed != null && nearRate(pushed, match) && live != null && nearRate(live, match)
  if (!already) {
    video.setAttribute(YT_HOLD_ATTR, "1")
    try {
      player.setPlaybackRate(match)
    } catch {
      video.removeAttribute(YT_HOLD_ATTR)
      return
    }
    const applied = readPlayerRate(player)
    if (applied != null && !nearRate(applied, match) && !outside) {
      const nearest = nearestRate(readRates(player), match)
      if (nearest != null) {
        try {
          player.setPlaybackRate(nearest)
          match = nearest
        } catch {
          /* The listed rate can be rejected while an ad frame is locked. */
        }
      }
    }
    mirroredRate.set(video, match)
    if (outside) video.setAttribute(YT_ECHO_ATTR, String(match))
    restoreElementRate(video, requested, match)
    video.removeAttribute(YT_HOLD_ATTR)
  } else {
    restoreElementRate(video, requested, match)
  }
  placeYoutubeSpeedSlider(match)
  paintYoutubeSpeedLabels(video)
  // Mute can clear the rate, and a rate change can clear loudness. Put both back.
  const keep = () => {
    if (!stillCurrent(video, patch.seq) || !video.isConnected) return
    if (level && levelDrifted(player, level.volume, level.muted)) {
      pushYoutubeAudio(player, video, level.volume, level.muted, true)
    }
    video.setAttribute(YT_HOLD_ATTR, "1")
    try {
      const now = readPlayerRate(player)
      if (now != null && !nearRate(now, match)) {
        try {
          player.setPlaybackRate?.(match)
          mirroredRate.set(video, match)
        } catch {
          /* The player can reject the rate while an ad frame is locked. */
        }
      }
      restoreElementRate(video, requested, match)
      placeYoutubeSpeedSlider(match)
      paintYoutubeSpeedLabels(video)
    } finally {
      video.removeAttribute(YT_HOLD_ATTR)
    }
  }
  keep()
  queueMicrotask(keep)
  window.setTimeout(keep, 0)
  try {
    requestAnimationFrame(keep)
  } catch {
    /* No animation frame here. The timeout still puts the rate back. */
  }
}

function youtubeLevel(
  video: HTMLVideoElement,
  patch: NativeMirror
): { volume: number; muted: boolean } | null {
  if (typeof patch.volume !== "number" && typeof patch.muted !== "boolean") return null
  return {
    volume: typeof patch.volume === "number" ? patch.volume : video.volume,
    muted: typeof patch.muted === "boolean" ? patch.muted : video.muted
  }
}

function pushYoutubeAudio(
  player: YoutubePlayer,
  video: HTMLVideoElement,
  volume: number,
  muted: boolean,
  force: boolean
): void {
  const percent = Math.round(clamp01(volume) * 100)
  const key = `${percent}:${muted ? 1 : 0}`
  // getVolume can echo the element we just wrote and hide a stale slider. Remember the push instead.
  if (!force && mirroredLevel.get(video) === key) return
  const volumeMatches = volumesMatch(player, percent)
  const muteMatches = muteMatch(player, muted)
  try {
    if (muted) {
      if (!volumeMatches || force) player.setVolume?.(percent)
      if (!muteMatches || force) player.mute?.()
    } else {
      // setVolume can turn sound back on, and unMute can restore an older level.
      if (!muteMatches || force) player.unMute?.()
      if (!volumeMatches || force) player.setVolume?.(percent)
    }
    mirroredLevel.set(video, key)
  } catch {
    /* The player can reject a level while an ad frame is locked. */
  }
}

function levelDrifted(player: YoutubePlayer, volume: number, muted: boolean): boolean {
  const percent = Math.round(clamp01(volume) * 100)
  return !volumesMatch(player, percent) || !muteMatch(player, muted)
}

function volumesMatch(player: YoutubePlayer, percent: number): boolean {
  if (typeof player.getVolume !== "function") return false
  const current = Number(player.getVolume())
  return Number.isFinite(current) && Math.abs(current - percent) <= 0
}

function muteMatch(player: YoutubePlayer, muted: boolean): boolean {
  if (typeof player.isMuted !== "function") return false
  return player.isMuted() === muted
}

function readPlayerRate(player: YoutubePlayer): number | null {
  if (typeof player.getPlaybackRate !== "function") return null
  try {
    const rate = Number(player.getPlaybackRate())
    return Number.isFinite(rate) ? rate : null
  } catch {
    return null
  }
}

function readRates(player: YoutubePlayer): number[] {
  if (typeof player.getAvailablePlaybackRates !== "function") return []
  try {
    const listed = player.getAvailablePlaybackRates()
    if (!Array.isArray(listed)) return []
    return listed.map((rate) => Number(rate)).filter((rate) => Number.isFinite(rate))
  } catch {
    return []
  }
}

function youtubeSpeedSlider(): HTMLInputElement | null {
  const slider = document.querySelector("input.ytp-speedslider")
  return slider instanceof HTMLInputElement ? slider : null
}

function youtubeSpeedBounds(player: YoutubePlayer): { min: number; max: number } {
  const slider = youtubeSpeedSlider()
  if (slider) {
    const min = Number(slider.min)
    const max = Number(slider.max)
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) return { min, max }
  }
  const rates = readRates(player)
  if (rates.length >= 2) return { min: Math.min(...rates), max: Math.max(...rates) }
  return { min: YT_SPEED_MIN, max: YT_SPEED_MAX }
}

function clampSpeed(rate: number, bounds: { min: number; max: number }): number {
  if (rate < bounds.min) return bounds.min
  if (rate > bounds.max) return bounds.max
  return rate
}

function nearestRate(rates: number[], target: number): number | null {
  let best: number | null = null
  let bestDist = Infinity
  for (const rate of rates) {
    const dist = Math.abs(rate - target)
    if (dist < bestDist) {
      best = rate
      bestDist = dist
    }
  }
  return best
}

/** The video keeps a speed the slider cannot show. The player API itself only accepts the clamped end. */
function restoreElementRate(video: HTMLVideoElement, requested: number, applied: number): void {
  if (nearRate(requested, applied)) return
  try {
    if (!nearRate(video.playbackRate, requested)) video.playbackRate = requested
  } catch {
    /* The element can reject a rate while an ad frame is locked. */
  }
}

function placeYoutubeSpeedSlider(value: number): void {
  const slider = youtubeSpeedSlider()
  if (!slider) return
  const min = Number(slider.min)
  const max = Number(slider.max)
  const lo = Number.isFinite(min) ? min : YT_SPEED_MIN
  const hi = Number.isFinite(max) ? max : YT_SPEED_MAX
  if (!(hi > lo)) return
  const next = Math.min(hi, Math.max(lo, value))
  const text = String(next)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  try {
    if (setter) setter.call(slider, text)
    else slider.value = text
  } catch {
    return
  }
  slider.setAttribute("aria-valuenow", text)
  slider.setAttribute("aria-valuetext", next.toFixed(2))
  slider.style.setProperty("--yt-slider-shape-gradient-percent", `${((next - lo) / (hi - lo)) * 100}%`)
}

function formatMenuRate(rate: number): string {
  const rounded = Math.round(rate * 100) / 100
  return rounded.toFixed(2).replace(/\.?0+$/, "")
}

function formatPanelRate(rate: number): string {
  const rounded = Math.round(rate * 100) / 100
  return `${rounded.toFixed(2)}x`
}

function setLabel(node: Element | null | undefined, text: string): void {
  if (!node || node.textContent === text) return
  node.textContent = text
}

/** Playback-speed text in the gear menu and in the speed panel, when the rate is outside the slider. */
function paintYoutubeSpeedLabels(video: HTMLVideoElement): void {
  const wanted = desiredSpeed.get(video)
  if (typeof wanted !== "number" || !video.isConnected) return
  const player = youtubePlayer(video)
  if (!player) return
  const bounds = youtubeSpeedBounds(player)
  if (wanted >= bounds.min - RATE_EPSILON && wanted <= bounds.max + RATE_EPSILON) return
  const menuText = formatMenuRate(wanted)
  const panelText = formatPanelRate(wanted)
  for (const item of document.querySelectorAll(".ytp-menuitem")) {
    if (!(item instanceof HTMLElement)) continue
    const label = [...item.children].find(
      (node) => node.classList.contains("ytp-menuitem-label") && node.textContent?.trim().toLowerCase() === "playback speed"
    )
    if (!label) continue
    const content = [...item.children].find((node) => node.classList.contains("ytp-menuitem-content"))
    setLabel(content, menuText)
  }
  const display = document.querySelector(".ytp-variable-speed-panel-display")
  if (display) {
    const span = [...display.children].find((node) => node.tagName === "SPAN")
    setLabel(span, panelText)
  }
  setLabel(document.querySelector(".ytp-speedslider-text"), panelText)
}

function activeYoutubeVideo(): HTMLVideoElement | null {
  const main = document.querySelector("#movie_player video, .html5-video-player video")
  if (main instanceof HTMLVideoElement) return main
  return speedLabelVideo?.isConnected ? speedLabelVideo : null
}

function watchOpenSpeedMenu(video: HTMLVideoElement): void {
  const menu = document.querySelector(".ytp-settings-menu")
  if (!(menu instanceof HTMLElement)) return
  speedLabelObserver?.disconnect()
  speedLabelObserver = new MutationObserver(() => paintYoutubeSpeedLabels(video))
  speedLabelObserver.observe(menu, { subtree: true, childList: true, characterData: true })
  window.clearTimeout(speedLabelObserverTimer)
  speedLabelObserverTimer = window.setTimeout(() => {
    speedLabelObserver?.disconnect()
    speedLabelObserver = null
  }, 2000)
}

function refreshYoutubeSpeedLabels(): void {
  const video = speedLabelVideo?.isConnected ? speedLabelVideo : activeYoutubeVideo()
  if (!video) return
  paintYoutubeSpeedLabels(video)
  watchOpenSpeedMenu(video)
}

function ensureYoutubeSpeedLabelListener(): void {
  if (speedLabelListener) return
  speedLabelListener = true
  document.addEventListener(
    "click",
    (event) => {
      if (!onYoutube()) return
      const target = event.target
      if (!(target instanceof Element)) return
      const gear = target.closest(".ytp-settings-button")
      const back = target.closest(".ytp-panel-back-button")
      const row = target.closest(".ytp-menuitem")
      const rowLabel = row
        ? [...row.children].find((node) => node.classList.contains("ytp-menuitem-label"))?.textContent
        : ""
      const speedRow = (rowLabel || "").trim().toLowerCase() === "playback speed"
      if (!gear && !back && !speedRow) return
      refreshYoutubeSpeedLabels()
      window.setTimeout(refreshYoutubeSpeedLabels, 0)
      window.setTimeout(refreshYoutubeSpeedLabels, 50)
      window.setTimeout(refreshYoutubeSpeedLabels, 180)
      window.setTimeout(refreshYoutubeSpeedLabels, 400)
    },
    true
  )
}

function readYoutubeSpeed(video: HTMLVideoElement, player: YoutubePlayer): number | null {
  const api = readPlayerRate(player)
  const slider = youtubeSpeedSlider()
  if (!slider) return api
  const value = Number(slider.value)
  if (!Number.isFinite(value)) return api
  const echo = Number(video.getAttribute(YT_ECHO_ATTR))
  // The thumb moved off the end we pinned, so this is the user's rate, not the clamp.
  if (Number.isFinite(echo) && api != null && nearRate(api, echo) && !nearRate(value, echo)) return value
  return api
}

function pushYoutubeLoop(player: YoutubePlayer, loop: boolean): void {
  const record = player as unknown as Record<string, unknown>
  for (const [readName, writeName] of LOOP_PAIRS) {
    const read = record[readName]
    const write = record[writeName]
    if (typeof read !== "function" || typeof write !== "function") continue
    let current: unknown
    try {
      current = (read as () => unknown).call(player)
    } catch {
      continue
    }
    if (typeof current !== "boolean" || current === loop) return
    try {
      ;(write as (value: boolean) => void).call(player, loop)
    } catch {
      /* The video element already carries the loop. The menu can stay as it was. */
    }
    return
  }
}

function applyInstagram(video: HTMLVideoElement, patch: NativeMirror): void {
  noteMirroredPlayer(video, patch)
  if (typeof patch.volume === "number" || typeof patch.muted === "boolean") {
    pushInstagramAudio(video, patch)
  }
  if (typeof patch.playbackRate === "number") pushInstagramSpeed(video, patch.playbackRate, patch.seq)
  if (typeof patch.loop === "boolean") pushInstagramLoop(video, patch.loop)
}

function pushInstagramAudio(video: HTMLVideoElement, patch: NativeMirror): void {
  const muted = typeof patch.muted === "boolean" ? patch.muted : video.muted
  const button = nearestControl(video, (node) => labelMeansMuted(node) !== null)
  const current = button ? labelMeansMuted(button) : null
  const clicked = Boolean(button && current !== null && current !== muted)
  if (clicked && button) button.click()
  const writeSlider = () => {
    if (!video.isConnected) return
    if (typeof patch.volume === "number") {
      const slider = nearestControl(video, (node) => node instanceof HTMLInputElement && isVolumeSlider(node))
      if (slider instanceof HTMLInputElement) setRange(slider, patch.volume)
      // A mute click can put the level back to full. The icon already matches.
      try {
        if (Math.abs(video.volume - patch.volume) > 0.02) video.volume = patch.volume
      } catch {
        /* The element can already be detached. */
      }
    }
    try {
      if (video.muted !== muted) video.muted = muted
    } catch {
      /* The element can already be detached. */
    }
  }
  writeSlider()
  if (clicked) window.setTimeout(writeSlider, 80)
}

function pushInstagramSpeed(video: HTMLVideoElement, rate: number, seq: number): void {
  rememberInstagramPath()
  const button = nearestControl(video, (node) => rateOf(node) != null)
  if (!button) return
  const shown = rateOf(button)
  if (shown != null && nearRate(shown, rate)) return
  // Opening the list just to discover that 1.33x is missing would flash it on every later edit.
  if (instagramRatesKnown && !(instagramRates ?? []).some((item) => nearRate(item, rate))) return
  const token = ++speedToken
  button.click()
  let picked = false
  const look = () => {
    if (picked || token !== speedToken || !stillCurrent(video, seq)) return
    const found = visibleRates(button)
    if (found.length) {
      instagramRates = found
      instagramRatesKnown = true
    }
    const choice = found.some((item) => nearRate(item, rate)) ? findSpeedChoice(rate, button) : null
    if (!choice) return
    picked = true
    choice.click()
  }
  window.setTimeout(look, 40)
  window.setTimeout(() => {
    if (token !== speedToken || !stillCurrent(video, seq)) return
    if (!picked) look()
    if (!instagramRatesKnown) {
      instagramRates = visibleRates(button)
      instagramRatesKnown = true
    }
    if (picked || !speedMenuOpen(button)) return
    // The list has no exact rate. Close it without choosing a different one.
    button.click()
  }, 280)
}

function rememberInstagramPath(): void {
  if (instagramRatesPath === location.pathname) return
  instagramRatesPath = location.pathname
  instagramRates = null
  instagramRatesKnown = false
}

function pushInstagramLoop(video: HTMLVideoElement, loop: boolean): void {
  const button = nearestControl(video, (node) => loopState(node) !== null)
  if (!button) return
  const current = loopState(button)
  if (current === null || current === loop) return
  button.click()
}

function isOurs(node: Element): boolean {
  return Boolean(node.closest(OURS))
}

function controlScope(video: HTMLVideoElement): HTMLElement {
  let best: HTMLElement = video
  let node = video.parentElement
  let depth = 0
  while (node && depth < 16 && node !== document.body && node !== document.documentElement) {
    if (isOurs(node)) break
    let count = 0
    for (const item of node.querySelectorAll("video")) {
      if (!(item instanceof HTMLVideoElement)) continue
      count += 1
      if (count > 1) break
    }
    if (count > 1) break
    best = node
    node = node.parentElement
    depth += 1
  }
  return best
}

function searchRoot(video: HTMLVideoElement): ParentNode {
  const scope = controlScope(video)
  const parent = scope.parentElement
  if (parent && parent !== document.body && parent !== document.documentElement) return parent
  return scope
}

function nearestControl(video: HTMLVideoElement, match: (node: HTMLElement) => boolean): HTMLElement | null {
  const box = video.getBoundingClientRect()
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  let best: HTMLElement | null = null
  let bestDist = Infinity
  for (const node of searchRoot(video).querySelectorAll("button, [role='button'], input[type='range']")) {
    if (!(node instanceof HTMLElement) || isOurs(node) || !match(node)) continue
    const rect = node.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const pad = 180
    if (x < box.left - pad || x > box.right + pad || y < box.top - pad || y > box.bottom + pad) continue
    const dist = (x - cx) * (x - cx) + (y - cy) * (y - cy)
    if (dist < bestDist) {
      best = node
      bestDist = dist
    }
  }
  return best
}

function controlLabel(node: HTMLElement): string {
  const svg = node.querySelector("svg[aria-label]")
  const nested = svg?.getAttribute("aria-label") || ""
  return `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""} ${nested}`
}

/** True when the site button is showing a muted picture. Null when the label is not a mute control. */
function labelMeansMuted(node: HTMLElement): boolean | null {
  const text = controlLabel(node).toLowerCase().replace(/\s+/g, " ").trim()
  if (!text || !/mute|unmute|sound|audio/.test(text) || /playlist/.test(text)) return null
  if (
    /\bunmute\b/.test(text) ||
    /turn (?:the )?sound on/.test(text) ||
    /turn (?:the )?audio on/.test(text) ||
    /audio is muted/.test(text) ||
    /sound is off/.test(text) ||
    /audio is off/.test(text)
  ) {
    return true
  }
  if (
    /turn (?:the )?sound off/.test(text) ||
    /turn (?:the )?audio off/.test(text) ||
    /audio is (?:playing|on)/.test(text) ||
    /sound is on/.test(text) ||
    /\bmute\b/.test(text)
  ) {
    return false
  }
  const pressed = node.getAttribute("aria-pressed") ?? node.getAttribute("aria-checked")
  if (pressed === "true") return true
  if (pressed === "false") return false
  return null
}

function isVolumeSlider(node: HTMLElement): boolean {
  if (!(node instanceof HTMLInputElement) || node.type !== "range") return false
  const label = `${controlLabel(node)} ${node.name} ${node.id}`.toLowerCase()
  if (/progress|seek|scrub|timeline/.test(label)) return false
  return /volume|sound|audio/.test(label)
}

function setRange(input: HTMLInputElement, volume: number): void {
  const max = Number(input.max)
  const min = Number(input.min)
  const hi = input.max !== "" && Number.isFinite(max) ? max : 1
  const lo = input.min !== "" && Number.isFinite(min) ? min : 0
  const span = hi - lo
  if (!(span > 0)) return
  const raw = lo + clamp01(volume) * span
  const next = span > 1.5 ? String(Math.round(raw)) : String(Math.round(raw * 100) / 100)
  if (input.value === next) return
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  try {
    if (setter) setter.call(input, next)
    else input.value = next
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  } catch {
    /* The slider can reject a value while it is hidden. */
  }
}

function parseRate(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)[x×]$/i.exec(text.trim().replace(/\s+/g, ""))
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function rateOf(node: HTMLElement): number | null {
  const text = (node.textContent || "").replace(/\s+/g, "")
  if (text.length > 0 && text.length <= 8) {
    const parsed = parseRate(text)
    if (parsed != null) return parsed
  }
  return parseRate(controlLabel(node))
}

const SPEED_MENU = "[role='menu'] *, [role='dialog'] *, [role='listbox'] *, button, [role='button'], [role='menuitem'], [role='option'], [role='menuitemradio']"

function findSpeedChoice(rate: number, button: HTMLElement): HTMLElement | null {
  for (const node of document.querySelectorAll(SPEED_MENU)) {
    if (!(node instanceof HTMLElement) || node === button || isOurs(node)) continue
    const listed = rateOf(node)
    if (listed == null || !nearRate(listed, rate)) continue
    const box = node.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) continue
    return node
  }
  return null
}

function visibleRates(button: HTMLElement): number[] {
  const found: number[] = []
  for (const node of document.querySelectorAll(SPEED_MENU)) {
    if (!(node instanceof HTMLElement) || node === button || isOurs(node)) continue
    const listed = rateOf(node)
    if (listed == null) continue
    const box = node.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) continue
    found.push(listed)
  }
  return found
}

function speedMenuOpen(button: HTMLElement): boolean {
  return visibleRates(button).length > 0
}

function readYoutubeLoop(player: YoutubePlayer): boolean | null {
  const record = player as unknown as Record<string, unknown>
  for (const [readName] of LOOP_PAIRS) {
    const read = record[readName]
    if (typeof read !== "function") continue
    try {
      const current = (read as () => unknown).call(player)
      if (typeof current === "boolean") return current
      if (current === 1 || current === 0) return current === 1
    } catch {
      continue
    }
  }
  return null
}

function readYoutubeControls(video: HTMLVideoElement): NativeMirrorPatch | null {
  const player = youtubePlayer(video)
  if (!player) return null
  const patch: NativeMirrorPatch = {}
  try {
    if (typeof player.getVolume === "function") {
      const percent = Number(player.getVolume())
      if (Number.isFinite(percent)) patch.volume = clamp01(percent / 100)
    }
  } catch {
    /* The player can reject a read while an ad frame is locked. */
  }
  try {
    if (typeof player.isMuted === "function") patch.muted = Boolean(player.isMuted())
  } catch {
    /* The player can reject a read while an ad frame is locked. */
  }
  const rate = readYoutubeSpeed(video, player)
  if (rate != null) patch.playbackRate = rate
  let loop = readYoutubeLoop(player)
  if (loop === null) {
    const button = nearestControl(video, (node) => loopState(node) !== null)
    if (button) loop = loopState(button)
  }
  if (loop !== null) patch.loop = loop
  return hasField(patch) ? patch : null
}

function readRangeVolume(input: HTMLInputElement): number | null {
  const max = Number(input.max)
  const min = Number(input.min)
  const hi = input.max !== "" && Number.isFinite(max) ? max : 1
  const lo = input.min !== "" && Number.isFinite(min) ? min : 0
  const span = hi - lo
  if (!(span > 0)) return null
  const raw = Number(input.value)
  if (!Number.isFinite(raw)) return null
  return clamp01((raw - lo) / span)
}

function readInstagramControls(video: HTMLVideoElement): NativeMirrorPatch | null {
  const patch: NativeMirrorPatch = {}
  const muteButton = nearestControl(video, (node) => labelMeansMuted(node) !== null)
  if (muteButton) {
    const muted = labelMeansMuted(muteButton)
    if (muted !== null) patch.muted = muted
  }
  const slider = nearestControl(video, (node) => node instanceof HTMLInputElement && isVolumeSlider(node))
  if (slider instanceof HTMLInputElement) {
    const volume = readRangeVolume(slider)
    if (volume !== null) patch.volume = volume
  }
  const speedButton = nearestControl(video, (node) => rateOf(node) != null)
  if (speedButton && !speedMenuOpen(speedButton)) {
    const rate = rateOf(speedButton)
    if (rate != null) patch.playbackRate = rate
  }
  const loopButton = nearestControl(video, (node) => loopState(node) !== null)
  if (loopButton) {
    const loop = loopState(loopButton)
    if (loop !== null) patch.loop = loop
  }
  return hasField(patch) ? patch : null
}

function readSiteControls(video: HTMLVideoElement): NativeMirrorPatch | null {
  if (onYoutube()) return readYoutubeControls(video)
  if (onInstagram()) return readInstagramControls(video)
  return null
}

export const NATIVE_PLAYER_ATTR = "data-vee-player"

const PLAYER_QUIET_MS = 450
const pushedPlayer = new WeakMap<HTMLVideoElement, NativeMirrorPatch>()
const quietUntil = new WeakMap<HTMLVideoElement, number>()
let publishSeq = 0

export function nativePlayerSeq(video: HTMLVideoElement): number {
  const raw = video.getAttribute(NATIVE_PLAYER_ATTR)
  if (!raw) return 0
  try {
    const value = JSON.parse(raw) as { seq?: unknown }
    return typeof value.seq === "number" ? value.seq : 0
  } catch {
    return 0
  }
}

export function readNativePlayer(video: HTMLVideoElement): NativeMirrorPatch | null {
  const raw = video.getAttribute(NATIVE_PLAYER_ATTR)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<NativeMirrorPatch>
    const patch: NativeMirrorPatch = {}
    if (typeof value.volume === "number" && Number.isFinite(value.volume)) patch.volume = clamp01(value.volume)
    if (typeof value.muted === "boolean") patch.muted = value.muted
    if (typeof value.playbackRate === "number" && Number.isFinite(value.playbackRate)) {
      patch.playbackRate = value.playbackRate
    }
    if (typeof value.loop === "boolean") patch.loop = value.loop
    return hasField(patch) ? patch : null
  } catch {
    return null
  }
}

function playerFieldsEqual(a: NativeMirrorPatch, b: NativeMirrorPatch): boolean {
  const volumeSame =
    typeof a.volume === "number" && typeof b.volume === "number"
      ? Math.abs(a.volume - b.volume) < 0.01
      : a.volume === b.volume
  const rateSame =
    typeof a.playbackRate === "number" && typeof b.playbackRate === "number"
      ? nearRate(a.playbackRate, b.playbackRate)
      : a.playbackRate === b.playbackRate
  return volumeSame && a.muted === b.muted && rateSame && a.loop === b.loop
}

function writePlayerSnapshot(video: HTMLVideoElement, snapshot: NativeMirrorPatch): void {
  if (!hasField(snapshot)) return
  const current = readNativePlayer(video)
  if (current && playerFieldsEqual(current, snapshot)) return
  try {
    video.setAttribute(NATIVE_PLAYER_ATTR, JSON.stringify({ ...snapshot, seq: ++publishSeq }))
  } catch {
    /* The element can already be detached. */
  }
}

/** Remember a value we just pushed so the next read is not treated as a user edit. */
export function noteMirroredPlayer(video: HTMLVideoElement, patch: NativeMirrorPatch): void {
  const prev = pushedPlayer.get(video) ?? {}
  const next: NativeMirrorPatch = { ...prev }
  if (typeof patch.volume === "number") next.volume = clamp01(patch.volume)
  if (typeof patch.muted === "boolean") next.muted = patch.muted
  if (typeof patch.playbackRate === "number") next.playbackRate = patch.playbackRate
  if (typeof patch.loop === "boolean") next.loop = patch.loop
  pushedPlayer.set(video, next)
  quietUntil.set(video, performance.now() + PLAYER_QUIET_MS)
  writePlayerSnapshot(video, { ...(readNativePlayer(video) ?? {}), ...next })
}

function assignLive<T extends number | boolean>(
  next: NativeMirrorPatch,
  key: keyof NativeMirrorPatch,
  live: T | undefined,
  pushed: T | undefined,
  quiet: boolean,
  equal: (a: T, b: T) => boolean
): void {
  if (live === undefined) return
  if (pushed !== undefined && equal(live, pushed)) {
    next[key] = pushed as never
    return
  }
  if (pushed !== undefined && quiet) {
    next[key] = pushed as never
    return
  }
  next[key] = live as never
}

/** Publish the site player's volume, mute, speed, and loop for this tab's custom bar. */
export function publishSitePlayer(video: HTMLVideoElement): void {
  if (!video.isConnected || video.hasAttribute(NATIVE_MIRROR_ATTR)) return
  const live = readSiteControls(video)
  if (!live) return
  const pushed = pushedPlayer.get(video) ?? {}
  const quiet = performance.now() < (quietUntil.get(video) ?? 0)
  const next: NativeMirrorPatch = { ...(readNativePlayer(video) ?? {}) }
  assignLive(next, "volume", live.volume, pushed.volume, quiet, (a, b) => Math.abs(a - b) < 0.01)
  assignLive(next, "muted", live.muted, pushed.muted, quiet, (a, b) => a === b)
  assignLive(next, "playbackRate", live.playbackRate, pushed.playbackRate, quiet, nearRate)
  assignLive(next, "loop", live.loop, pushed.loop, quiet, (a, b) => a === b)
  writePlayerSnapshot(video, next)
}

function loopState(node: HTMLElement): boolean | null {
  const text = controlLabel(node).toLowerCase().replace(/\s+/g, " ").trim()
  if (!text || !/\bloop\b/.test(text) || /playlist/.test(text)) return null
  const pressed = node.getAttribute("aria-pressed") ?? node.getAttribute("aria-checked")
  if (pressed === "true") return true
  if (pressed === "false") return false
  if (/turn loop off|stop loop|looping/.test(text)) return true
  if (/turn loop on/.test(text)) return false
  return null
}
