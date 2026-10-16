import { COLOR_KEYS, type EffectSettings } from "./types"

/**
 * Sound and speed. When auto-sync for audio is off, an already open tab keeps
 * these until it is refreshed or opened again.
 */
export const AUDIO_OPEN_TAB_KEYS = [
  "volume",
  "muted",
  "audioTouched",
  "basicAudioOn",
  "advancedAudioOn",
  "audioEnabled",
  "playbackRate",
  "preservePitch",
  "loop",
  "playbackTouched",
  "basicPlaybackOn",
  "advancedPlaybackOn",
  "playbackEnabled",
  "holdToSpeed",
  "holdPlaybackRate"
] as const satisfies readonly (keyof EffectSettings)[]

/** Picture. When auto-sync for video is off, an already open tab keeps these. */
export const VIDEO_OPEN_TAB_KEYS: readonly (keyof EffectSettings)[] = [
  ...COLOR_KEYS,
  "flipH",
  "flipV",
  "rotate",
  "zoom",
  "panX",
  "panY",
  "stretchX",
  "stretchY",
  "cropLeft",
  "cropRight",
  "cropTop",
  "cropBottom",
  "linkCropX",
  "linkCropY",
  "basicVideoOn",
  "frameOn",
  "advancedVideoOn",
  "videoEnabled",
  "autoBrightness"
]

function writeKey<K extends keyof EffectSettings>(
  target: EffectSettings,
  source: EffectSettings,
  key: K
): void {
  target[key] = source[key]
}

function writePartial<K extends keyof EffectSettings>(
  target: Partial<EffectSettings>,
  source: EffectSettings,
  key: K
): void {
  target[key] = source[key]
}

export function takeGroup(
  source: EffectSettings,
  keys: readonly (keyof EffectSettings)[]
): Partial<EffectSettings> {
  const next: Partial<EffectSettings> = {}
  for (const key of keys) writePartial(next, source, key)
  return next
}

function copyKeys(
  target: EffectSettings,
  source: EffectSettings,
  keys: readonly (keyof EffectSettings)[]
): void {
  for (const key of keys) writeKey(target, source, key)
}

export function groupDiffers(
  a: EffectSettings,
  b: EffectSettings,
  keys: readonly (keyof EffectSettings)[]
): boolean {
  return keys.some((key) => a[key] !== b[key])
}

export function editsAudioGroup(patch: Partial<EffectSettings>): boolean {
  return AUDIO_OPEN_TAB_KEYS.some((key) => Object.prototype.hasOwnProperty.call(patch, key))
}

export function editsVideoGroup(patch: Partial<EffectSettings>): boolean {
  return VIDEO_OPEN_TAB_KEYS.some((key) => Object.prototype.hasOwnProperty.call(patch, key))
}

/**
 * Settings an already open tab should show after another tab saved.
 * Audio and video each follow their own auto-sync switch.
 * The tab that saved does not use this; it already applied its own edit.
 */
export function adoptOpenTabSettings(current: EffectSettings, incoming: EffectSettings): EffectSettings {
  const next: EffectSettings = { ...incoming }
  const takeAudio = incoming.syncOpenTabsAudio
  const takeVideo = incoming.syncOpenTabsVideo
  if (!takeAudio) copyKeys(next, current, AUDIO_OPEN_TAB_KEYS)
  if (!takeVideo) copyKeys(next, current, VIDEO_OPEN_TAB_KEYS)
  const audioMoved = takeAudio && groupDiffers(current, incoming, AUDIO_OPEN_TAB_KEYS)
  const videoMoved = takeVideo && groupDiffers(current, incoming, VIDEO_OPEN_TAB_KEYS)
  if (!audioMoved && !videoMoved) next.presetId = current.presetId
  return next
}

/**
 * A save from this tab. Groups this tab did not edit stay as last stored,
 * so a brightness change does not write an older volume back over another tab.
 */
export function mergeUneditedGroups(
  local: EffectSettings,
  domain: EffectSettings,
  audioEdited: boolean,
  videoEdited: boolean
): EffectSettings {
  const next: EffectSettings = { ...local }
  if (!audioEdited) copyKeys(next, domain, AUDIO_OPEN_TAB_KEYS)
  if (!videoEdited) copyKeys(next, domain, VIDEO_OPEN_TAB_KEYS)
  if (!audioEdited && !videoEdited) next.presetId = domain.presetId
  return next
}
