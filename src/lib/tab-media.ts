import { youtubeVideoId } from "./youtube-media"
import { PLAYBACK_RATE_MAX, PLAYBACK_RATE_MIN, type EffectSettings } from "./types"

/**
 * Loudness, mute, loop, and speed shared by this tab's custom bar and the
 * site player. Kept in memory so it is not stored for the site or the extension.
 */
export type TabMedia = {
  volume: number | null
  muted: boolean | null
  playbackRate: number | null
  loop: boolean | null
}

const VOLUME_EPSILON = 0.005
const RATE_EPSILON = 0.001

export function emptyTabMedia(): TabMedia {
  return { volume: null, muted: null, playbackRate: null, loop: null }
}

export function tabAudioOwned(tab: TabMedia): boolean {
  return tab.volume != null || tab.muted != null
}

export function tabRateOwned(tab: TabMedia): boolean {
  return tab.playbackRate != null
}

export function tabLoopOwned(tab: TabMedia): boolean {
  return tab.loop != null
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value))
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, value))
}

export function withTabAudio(tab: TabMedia, volume?: number, muted?: boolean): TabMedia {
  const next = { ...tab }
  if (typeof volume === "number") next.volume = clampVolume(volume)
  if (typeof muted === "boolean") next.muted = muted
  return next
}

export function withTabRate(tab: TabMedia, playbackRate: number): TabMedia {
  return { ...tab, playbackRate: clampRate(playbackRate) }
}

export function withTabLoop(tab: TabMedia, loop: boolean): TabMedia {
  return { ...tab, loop }
}

/**
 * Values the player and the custom bar should use.
 * The on-page panel keeps the domain settings and does not see this merge.
 */
export function mergeTabMedia(settings: EffectSettings, tab: TabMedia): EffectSettings {
  const audio = tabAudioOwned(tab)
  const playback = tabRateOwned(tab) || tabLoopOwned(tab)
  if (!audio && !playback) return settings
  const next: EffectSettings = { ...settings }
  if (tab.volume != null) next.volume = tab.volume
  if (tab.muted != null) next.muted = tab.muted
  if (audio) {
    next.audioTouched = true
    next.basicAudioOn = true
    next.audioEnabled = true
  }
  if (tab.playbackRate != null) next.playbackRate = tab.playbackRate
  if (tab.loop != null) next.loop = tab.loop
  if (playback) {
    next.playbackTouched = true
    next.basicPlaybackOn = true
    next.playbackEnabled = true
  }
  return next
}

/** An on-page edit replaces the matching tab choice so the domain value is shown. */
export function releaseTabMedia(tab: TabMedia, patch: Partial<EffectSettings>): TabMedia {
  if (!tabAudioOwned(tab) && !tabRateOwned(tab) && !tabLoopOwned(tab)) return tab
  const next = { ...tab }
  if ("volume" in patch) next.volume = null
  if ("muted" in patch) next.muted = null
  if ("playbackRate" in patch) next.playbackRate = null
  if ("loop" in patch) next.loop = null
  return next
}

/** A domain save from another tab replaces only the fields that changed. */
export function releaseTabMediaFromDomain(
  tab: TabMedia,
  previous: EffectSettings,
  incoming: EffectSettings
): TabMedia {
  if (!tabAudioOwned(tab) && !tabRateOwned(tab) && !tabLoopOwned(tab)) return tab
  const next = { ...tab }
  if (Math.abs(previous.volume - incoming.volume) >= VOLUME_EPSILON) next.volume = null
  if (previous.muted !== incoming.muted) next.muted = null
  if (Math.abs(previous.playbackRate - incoming.playbackRate) >= RATE_EPSILON) next.playbackRate = null
  if (previous.loop !== incoming.loop) next.loop = null
  return next
}

/** Identifies the clip playing in this tab. A new clip must not keep the previous tab choice. */
export function clipKey(video: HTMLVideoElement | null): string {
  const yt = youtubeVideoId(location.href)
  if (yt) return `yt:${yt}`
  const host = location.hostname.replace(/^www\./, "")
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const match = location.pathname.match(/^\/(?:reel|reels|p|tv)\/([^/?#]+)/)
    if (match) return `ig:${match[1]}`
  }
  const src = video?.currentSrc || video?.src || ""
  return src ? `${host}${location.pathname}|${src}` : `${host}${location.pathname}`
}

/** True when the source was filled in for the clip already playing. */
export function sameClip(previous: string, next: string): boolean {
  if (previous === next) return true
  if (!previous || !next) return false
  const longer = previous.length > next.length ? previous : next
  const shorter = previous.length > next.length ? next : previous
  return longer.startsWith(`${shorter}|`)
}
