import {
  dockContextOf,
  domainAudio,
  domainChrome,
  domainIconOrder,
  domainPlace,
  domainShape,
  domainSkin,
  readVideoTitle
} from "./domains"
import { directMediaUrl, DOWNLOAD_MESSAGE, downloadFilename, fileUrl, mediaPath, SAVE_BYTES_MESSAGE } from "./media-file"
import { isIsoBmff } from "./mp4-mux"
import {
  allowedFetchUrl,
  assembleDownload,
  fullRangeUrl,
  readYtFetchResult,
  readYtOffer,
  youtubeVideoId,
  YT_MEDIA_SOURCE,
  type YtOffer
} from "./youtube-media"
import {
  postRenditionAsk,
  postRenditionDrop,
  postRenditionHold,
  postRenditionUse,
  QUALITY_MARK,
  qualityLabel,
  readRenditionMessage,
  sortRenditions,
  USER_PAUSE_MARK,
  type Rendition,
  type RenditionMessage
} from "./renditions"
import { seekBy, togglePictureInPicture } from "./effects"
import { NATIVE_PLAYER_ATTR, readNativePlayer, YT_ECHO_ATTR, YT_HOLD_ATTR } from "./native-mirror"
import { formatClock } from "./progress"
import { LIGHT_APPLY_DELAY_MS, PLAYER_CHROME_HIDE_MS } from "../settings"
import {
  DOCK_CONTROL_KEYS,
  DOCK_ICON_ORDER,
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  type DockEdge,
  type DockPlaceId,
  type DockPlacement,
  type DockSlot,
  type EffectSettings
} from "./types"

export const SEEK_BAR_ID = "vee-seek-bar"

const STYLE_ID = "vee-seek-bar-style"
const Z_INDEX = 2147483646
const TRACK_HEIGHT_PX = 4
const HIT_HEIGHT_PX = 20
const WRITE_GUARD_MS = 280
const POP_CLOSE_MS = 220
const SPEED_STEP = 0.01
const SPEED_CHIPS = [1, 1.25, 1.5, 2, 3, 4] as const
const FS_SHELL_ID = "vee-fs-shell"
const QUALITY_WAIT_ID = "vee-quality-wait"
const DOCK_HOST_ID = "vee-csui"
const SKIP_SECONDS = 10

export type DockControl =
  | { type: "audio"; volume?: number; muted?: boolean }
  | { type: "rate"; playbackRate: number }
  | { type: "loop"; loop: boolean }

export type DockMedia = {
  volume: number
  muted: boolean
  /** Null while a hold or an ad boost owns the rate, so that speed is not saved. */
  playbackRate: number | null
  loop: boolean
}

export type DockRateSource = "hold" | "ignore" | "live"

const BAR_STYLE = `
#${SEEK_BAR_ID} {
  position: fixed !important;
  inset: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  z-index: ${Z_INDEX};
  box-sizing: border-box;
  pointer-events: none !important;
  display: none;
  font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  color: #fff;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}
#${SEEK_BAR_ID}[data-visible="true"] {
  display: block;
  opacity: 0;
  transition: opacity 220ms ease;
}
#${SEEK_BAR_ID}[data-visible="true"][data-hot="true"],
#${SEEK_BAR_ID}[data-drag="true"] {
  opacity: 1;
}
#${SEEK_BAR_ID}:not([data-hot="true"]) .vee-seek-hit {
  pointer-events: none !important;
}
#${SEEK_BAR_ID} .vee-pack,
#${SEEK_BAR_ID} > .vee-control {
  position: absolute;
  z-index: 2;
  pointer-events: none;
}
#${SEEK_BAR_ID} .vee-pack {
  display: flex;
  align-items: center;
  gap: 2px;
}
#${SEEK_BAR_ID} .vee-control {
  display: flex;
  align-items: center;
  gap: 2px;
  pointer-events: none;
}
#${SEEK_BAR_ID} .vee-pack[data-edge="bottom"][data-slot="start"] { left: 8px; bottom: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-edge="bottom"][data-slot="center"] {
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
}
#${SEEK_BAR_ID} .vee-pack[data-edge="bottom"][data-slot="end"] { right: 8px; bottom: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-edge="top"][data-slot="start"] { left: 8px; top: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-edge="top"][data-slot="center"] {
  left: 50%;
  top: 8px;
  transform: translateX(-50%);
}
#${SEEK_BAR_ID} .vee-pack[data-edge="top"][data-slot="end"] { right: 8px; top: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-edge="left"] { flex-direction: column; left: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-edge="left"][data-slot="start"] { top: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-edge="left"][data-slot="center"] {
  top: 50%;
  transform: translateY(-50%);
}
#${SEEK_BAR_ID} .vee-pack[data-edge="left"][data-slot="end"] { bottom: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-edge="right"] { flex-direction: column; right: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-edge="right"][data-slot="start"] { top: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-edge="right"][data-slot="center"] {
  top: 50%;
  transform: translateY(-50%);
}
#${SEEK_BAR_ID} .vee-pack[data-edge="right"][data-slot="end"] { bottom: 8px; }
#${SEEK_BAR_ID} .vee-pack[data-lift="true"][data-edge="bottom"] { bottom: 22px; }
#${SEEK_BAR_ID} .vee-pack[data-lift="true"][data-edge="top"] { top: 22px; }
#${SEEK_BAR_ID} .vee-pack[data-lift="true"][data-edge="left"] { left: 22px; }
#${SEEK_BAR_ID} .vee-pack[data-lift="true"][data-edge="right"] { right: 22px; }
#${SEEK_BAR_ID}:not([data-hot="true"]):not([data-drag="true"]) .vee-pack,
#${SEEK_BAR_ID}:not([data-hot="true"]):not([data-drag="true"]) .vee-control,
#${SEEK_BAR_ID}:not([data-hot="true"]):not([data-drag="true"]) .vee-pop,
#${SEEK_BAR_ID}:not([data-hot="true"]):not([data-drag="true"]) .vee-chrome-btn,
#${SEEK_BAR_ID}:not([data-hot="true"]):not([data-drag="true"]) .vee-rate-btn,
#${SEEK_BAR_ID}:not([data-hot="true"]):not([data-drag="true"]) .vee-chrome-time {
  pointer-events: none !important;
}
#${SEEK_BAR_ID}:not([data-hot="true"]):not([data-drag="true"]) .vee-pop[data-open="true"],
#${SEEK_BAR_ID}:not([data-hot="true"]):not([data-drag="true"]) .vee-pop[data-open="true"] * ,
#${SEEK_BAR_ID} .vee-pop[data-open="true"],
#${SEEK_BAR_ID} .vee-pop[data-open="true"] * {
  pointer-events: auto !important;
}
#${SEEK_BAR_ID} [hidden] {
  display: none !important;
}
#${SEEK_BAR_ID} .vee-chrome-btn,
#${SEEK_BAR_ID} .vee-rate-btn,
#${SEEK_BAR_ID} .vee-chrome-time,
#${SEEK_BAR_ID} .vee-speed-anchor,
#${SEEK_BAR_ID} .vee-pop-anchor {
  pointer-events: auto;
}
#${SEEK_BAR_ID} .vee-chrome-btn,
#${SEEK_BAR_ID} .vee-rate-btn {
  font: inherit;
  color: inherit;
  cursor: pointer;
}
#${SEEK_BAR_ID} .vee-chrome-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #fff;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
}
#${SEEK_BAR_ID} .vee-rate-btn {
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
}
#${SEEK_BAR_ID} .vee-chrome-btn:hover,
#${SEEK_BAR_ID} .vee-rate-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
#${SEEK_BAR_ID} .vee-chrome-btn[data-on="true"] {
  color: #8d73ff;
}
#${SEEK_BAR_ID} .vee-chrome-btn svg {
  display: block;
}
#${SEEK_BAR_ID} .vee-chrome-time {
  padding: 0 4px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  white-space: nowrap;
}
#${SEEK_BAR_ID} .vee-pop-anchor {
  position: relative;
  display: flex;
  align-items: center;
}
#${SEEK_BAR_ID} .vee-pop-anchor > .vee-chrome-btn,
#${SEEK_BAR_ID} .vee-pop-anchor > .vee-rate-btn {
  position: relative;
  z-index: 6;
}
#${SEEK_BAR_ID} .vee-rate-btn {
  box-sizing: border-box;
  width: 4.75em;
  min-width: 4.75em;
  max-width: 4.75em;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: 0.01em;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
#${SEEK_BAR_ID} .vee-rate-btn[data-on="true"] {
  color: #fff;
  background: rgba(255, 255, 255, 0.28);
}
#${SEEK_BAR_ID} .vee-pop {
  position: absolute;
  z-index: 5;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  background: transparent;
  transition: opacity 120ms ease;
}
#${SEEK_BAR_ID} .vee-pop-anchor[data-out="up"] .vee-pop {
  left: 50%;
  bottom: calc(100% - 16px);
  padding-bottom: 16px;
  transform: translateX(-50%);
}
#${SEEK_BAR_ID} .vee-pop-anchor[data-out="down"] .vee-pop {
  left: 50%;
  top: calc(100% - 16px);
  padding-top: 16px;
  transform: translateX(-50%);
}
#${SEEK_BAR_ID} .vee-pop-anchor[data-out="left"] .vee-pop {
  right: calc(100% - 16px);
  top: 50%;
  padding-right: 16px;
  transform: translateY(-50%);
}
#${SEEK_BAR_ID} .vee-pop-anchor[data-out="right"] .vee-pop {
  left: calc(100% - 16px);
  top: 50%;
  padding-left: 16px;
  transform: translateY(-50%);
}
#${SEEK_BAR_ID} .vee-pop-anchor[data-align="end"][data-out="up"] .vee-pop,
#${SEEK_BAR_ID} .vee-pop-anchor[data-align="end"][data-out="down"] .vee-pop {
  left: auto;
  right: 0;
  transform: none;
}
#${SEEK_BAR_ID} .vee-pop-anchor[data-align="start"][data-out="up"] .vee-pop,
#${SEEK_BAR_ID} .vee-pop-anchor[data-align="start"][data-out="down"] .vee-pop {
  left: 0;
  right: auto;
  transform: none;
}
#${SEEK_BAR_ID} .vee-pop-card {
  border-radius: 16px;
  background: rgba(12, 12, 14, 0.72);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
}
#${SEEK_BAR_ID} .vee-pop[data-open="true"] {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
#${SEEK_BAR_ID} .vee-pop input {
  pointer-events: none;
}
#${SEEK_BAR_ID} .vee-pop[data-open="true"] input,
#${SEEK_BAR_ID} .vee-pop[data-open="true"] button {
  pointer-events: auto;
}
#${SEEK_BAR_ID} .vee-volume-pop .vee-pop-card {
  padding: 10px 8px;
}
#${SEEK_BAR_ID} .vee-volume-pop input[type="range"] {
  writing-mode: vertical-lr;
  direction: rtl;
  width: 22px;
  height: 84px;
  margin: 0;
  accent-color: #fff;
  cursor: pointer;
}
#${SEEK_BAR_ID} .vee-speed-pop .vee-pop-card {
  width: 280px;
  padding: 14px 16px 10px;
  box-sizing: border-box;
}
#${SEEK_BAR_ID} .vee-speed-readout {
  margin: 0 0 8px;
  text-align: center;
  font-size: 22px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
}
#${SEEK_BAR_ID} .vee-speed-adjust {
  display: flex;
  align-items: center;
  gap: 8px;
}
#${SEEK_BAR_ID} .vee-speed-step {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 22px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
}
#${SEEK_BAR_ID} .vee-speed-step:hover {
  background: rgba(255, 255, 255, 0.16);
}
#${SEEK_BAR_ID} .vee-speed-adjust input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 28px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
#${SEEK_BAR_ID} .vee-speed-adjust input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    #fff var(--p, 0%),
    rgba(255, 255, 255, 0.35) var(--p, 0%)
  );
}
#${SEEK_BAR_ID} .vee-speed-adjust input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border: 0;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.28);
}
#${SEEK_BAR_ID} .vee-speed-adjust input[type="range"]::-moz-range-track {
  height: 4px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.35);
}
#${SEEK_BAR_ID} .vee-speed-adjust input[type="range"]::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: #fff;
}
#${SEEK_BAR_ID} .vee-speed-adjust input[type="range"]::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: 999px;
  background: #fff;
}
#${SEEK_BAR_ID} .vee-speed-chips {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}
#${SEEK_BAR_ID} .vee-speed-chips button {
  margin: 0;
  padding: 7px 0;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  cursor: pointer;
}
#${SEEK_BAR_ID} .vee-speed-chips button[data-on="true"] {
  background: rgba(255, 255, 255, 0.34);
  color: #fff;
}
#${SEEK_BAR_ID} .vee-quality-pop .vee-pop-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 92px;
  padding: 8px;
  box-sizing: border-box;
}
#${SEEK_BAR_ID} .vee-quality-pop button {
  margin: 0;
  padding: 7px 10px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
#${SEEK_BAR_ID} .vee-quality-pop button:hover,
#${SEEK_BAR_ID} .vee-quality-pop button[data-on="true"] {
  background: rgba(255, 255, 255, 0.34);
}
#${SEEK_BAR_ID} .vee-quality-pop .vee-quality-pending {
  margin: 0;
  padding: 7px 10px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.2;
  white-space: nowrap;
}
#${SEEK_BAR_ID} .vee-speed-caption {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  min-height: 14px;
  margin: 4px 0 0;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.72);
  text-align: center;
}
#${SEEK_BAR_ID} .vee-seek-hit {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${HIT_HEIGHT_PX}px;
  pointer-events: auto;
  touch-action: none;
  cursor: pointer;
}
#${SEEK_BAR_ID} .vee-seek-track {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${TRACK_HEIGHT_PX}px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.28);
  transition: height 120ms ease;
}
#${SEEK_BAR_ID} .vee-seek-hit[data-axis="y"] .vee-seek-track {
  left: 50%;
  right: auto;
  top: 0;
  bottom: 0;
  width: ${TRACK_HEIGHT_PX}px;
  height: auto;
  transform: translateX(-50%);
}
#${SEEK_BAR_ID} .vee-seek-hit[data-axis="y"] .vee-seek-played,
#${SEEK_BAR_ID} .vee-seek-hit[data-axis="y"] .vee-seek-buffered {
  width: 100%;
  height: 0%;
}
#${SEEK_BAR_ID}:hover .vee-seek-hit[data-axis="x"] .vee-seek-track,
#${SEEK_BAR_ID}[data-hot="true"] .vee-seek-hit[data-axis="x"] .vee-seek-track,
#${SEEK_BAR_ID}[data-drag="true"] .vee-seek-hit[data-axis="x"] .vee-seek-track,
#${SEEK_BAR_ID}:hover .vee-seek-hit:not([data-axis="y"]) .vee-seek-track,
#${SEEK_BAR_ID}[data-hot="true"] .vee-seek-hit:not([data-axis="y"]) .vee-seek-track,
#${SEEK_BAR_ID}[data-drag="true"] .vee-seek-hit:not([data-axis="y"]) .vee-seek-track {
  height: 6px;
}
#${SEEK_BAR_ID}:hover .vee-seek-hit[data-axis="y"] .vee-seek-track,
#${SEEK_BAR_ID}[data-hot="true"] .vee-seek-hit[data-axis="y"] .vee-seek-track,
#${SEEK_BAR_ID}[data-drag="true"] .vee-seek-hit[data-axis="y"] .vee-seek-track {
  width: 6px;
  height: auto;
}
#${SEEK_BAR_ID} .vee-seek-buffered {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}
#${SEEK_BAR_ID} .vee-seek-played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: rgba(141, 115, 255, 0.95);
  pointer-events: none;
}
#${SEEK_BAR_ID} .vee-seek-tip {
  position: absolute;
  bottom: ${HIT_HEIGHT_PX + 4}px;
  left: 0;
  transform: translateX(-50%);
  padding: 3px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  color: #f6f3ff;
  background: rgba(20, 16, 32, 0.92);
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
  white-space: nowrap;
}
#${SEEK_BAR_ID}:hover .vee-seek-tip,
#${SEEK_BAR_ID}[data-drag="true"] .vee-seek-tip {
  opacity: 1;
}
#${FS_SHELL_ID} {
  position: fixed !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: #000 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  z-index: ${Z_INDEX} !important;
  box-sizing: border-box !important;
}
#${FS_SHELL_ID} > video {
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  max-height: 100% !important;
  margin: 0 !important;
  object-fit: contain !important;
  position: relative !important;
  inset: auto !important;
}
#${SEEK_BAR_ID}[data-skin="youtube"] {
  font-family: Roboto, Arial, sans-serif;
}
#${SEEK_BAR_ID}[data-skin="instagram"],
#${SEEK_BAR_ID}[data-skin="facebook"] {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
#${SEEK_BAR_ID}[data-skin="netflix"] {
  font-family: "Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
#${SEEK_BAR_ID}[data-skin="prime"] {
  font-family: "Amazon Ember", "Helvetica Neue", Arial, sans-serif;
}
#${SEEK_BAR_ID}[data-skin="hotstar"] {
  font-family: "Segoe UI", Helvetica, Arial, sans-serif;
}
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-rate-btn,
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-rate-btn,
#${SEEK_BAR_ID}[data-skin="facebook"] .vee-rate-btn,
#${SEEK_BAR_ID}[data-skin="prime"] .vee-rate-btn,
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-rate-btn,
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-rate-btn {
  width: 4.75em;
  min-width: 4.75em;
  max-width: 4.75em;
  padding: 0;
  background: transparent;
  font-weight: 600;
  text-align: center;
}
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-chrome-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-chrome-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="facebook"] .vee-chrome-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="prime"] .vee-chrome-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-chrome-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-chrome-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-rate-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-rate-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="facebook"] .vee-rate-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="prime"] .vee-rate-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-rate-btn[data-on="true"],
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-rate-btn[data-on="true"] {
  color: #fff;
}
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-chrome-btn:hover,
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-rate-btn:hover,
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-chrome-btn:hover,
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-rate-btn:hover,
#${SEEK_BAR_ID}[data-skin="facebook"] .vee-chrome-btn:hover,
#${SEEK_BAR_ID}[data-skin="facebook"] .vee-rate-btn:hover,
#${SEEK_BAR_ID}[data-skin="prime"] .vee-chrome-btn:hover,
#${SEEK_BAR_ID}[data-skin="prime"] .vee-rate-btn:hover,
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-chrome-btn:hover,
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-rate-btn:hover,
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-chrome-btn:hover,
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-rate-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-seek-played { background: #ff0000; }
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-seek-played { background: #e50914; }
#${SEEK_BAR_ID}[data-skin="prime"] .vee-seek-played { background: #00a8e1; }
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-seek-played { background: #ffcc00; }
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-seek-played,
#${SEEK_BAR_ID}[data-skin="facebook"] .vee-seek-played { background: #fff; }
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-chrome-btn {
  width: 36px;
  height: 36px;
}
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-rate-btn {
  height: 36px;
  font-size: 14px;
  font-weight: 500;
}
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-chrome-btn svg {
  width: 24px;
  height: 24px;
}
#${SEEK_BAR_ID}[data-skin="youtube"] .vee-pack[data-edge="bottom"] {
  bottom: 8px;
}
#${SEEK_BAR_ID}[data-skin="youtube"][data-shape="short"] .vee-pack[data-edge="bottom"] {
  bottom: 88px;
}
#${SEEK_BAR_ID}[data-chrome="flat"] .vee-chrome-btn {
  width: var(--vee-icon, 32px);
  height: var(--vee-icon, 32px);
  background: transparent;
  color: #fff;
}
#${SEEK_BAR_ID}[data-chrome="flat"] .vee-rate-btn {
  height: var(--vee-icon, 32px);
  background: transparent;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
#${SEEK_BAR_ID}[data-chrome="flat"] .vee-chrome-btn svg {
  width: 22px;
  height: 22px;
}
#${SEEK_BAR_ID}[data-chrome="flat"] .vee-chrome-btn[data-on="true"],
#${SEEK_BAR_ID}[data-chrome="flat"] .vee-rate-btn[data-on="true"] {
  color: var(--vee-active, #fff);
}
#${SEEK_BAR_ID}[data-chrome="flat"] .vee-chrome-btn:hover,
#${SEEK_BAR_ID}[data-chrome="flat"] .vee-rate-btn:hover {
  background: var(--vee-hover, transparent);
}
#${SEEK_BAR_ID}[data-place="instagram"] .vee-pack[data-edge="bottom"][data-slot="start"] {
  bottom: 16px;
  left: 12px;
}
#${SEEK_BAR_ID}[data-place="instagram"] .vee-pack[data-lift="true"][data-edge="bottom"][data-slot="start"] {
  bottom: 28px;
}
#${SEEK_BAR_ID}[data-place="instagram"] .vee-pack[data-edge="top"][data-slot="end"] {
  top: 12px;
  right: 64px;
}
#${SEEK_BAR_ID}[data-place="facebook-watch"] .vee-pack[data-edge="bottom"][data-slot="end"] {
  right: 188px;
  bottom: 10px;
}
#${SEEK_BAR_ID}[data-place="facebook-reel"] .vee-pack[data-edge="top"][data-slot="center"] {
  top: 56px;
}
#${SEEK_BAR_ID}[data-place="facebook-reel"] .vee-pack[data-edge="right"][data-slot="end"] {
  top: auto;
  right: 12px;
  bottom: 112px;
}
#${SEEK_BAR_ID}[data-skin="prime"] .vee-chrome-btn,
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-chrome-btn,
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-chrome-btn {
  width: 36px;
  height: 36px;
}
#${SEEK_BAR_ID}[data-skin="prime"] .vee-rate-btn,
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-rate-btn,
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-rate-btn {
  height: 36px;
  font-size: 14px;
}
#${SEEK_BAR_ID}[data-skin="prime"] .vee-chrome-btn svg,
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-chrome-btn svg,
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-chrome-btn svg {
  width: 24px;
  height: 24px;
}
#${SEEK_BAR_ID}[data-skin="prime"] .vee-pack[data-edge="top"][data-slot="end"] {
  top: -36px;
  right: 200px;
}
#${SEEK_BAR_ID}[data-skin="netflix"] .vee-pack[data-edge="bottom"][data-slot="end"] {
  right: 252px;
  bottom: -44px;
}
#${SEEK_BAR_ID}[data-skin="hotstar"] .vee-pack[data-edge="bottom"][data-slot="end"] {
  right: 176px;
  bottom: 14px;
}
#${QUALITY_WAIT_ID} {
  position: fixed;
  z-index: ${Z_INDEX - 1};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 0;
  padding: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  pointer-events: none;
  box-sizing: border-box;
}
#${QUALITY_WAIT_ID} .vee-wait-spin {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.28);
  border-top-color: #fff;
  animation: vee-wait-spin 0.7s linear infinite;
}
@keyframes vee-wait-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  #${SEEK_BAR_ID},
  #${SEEK_BAR_ID} .vee-seek-track,
  #${SEEK_BAR_ID} .vee-seek-tip,
  #${SEEK_BAR_ID} .vee-pop {
    transition: none;
  }
  #${QUALITY_WAIT_ID} .vee-wait-spin {
    animation: none;
    border-color: rgba(255, 255, 255, 0.85);
  }
}
`

const ICON_PLAY =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8.2 5.2v13.6c0 .8.9 1.3 1.6.9l10.2-6.8c.6-.4.6-1.3 0-1.7L9.8 4.3c-.7-.4-1.6.1-1.6.9z"/></svg>'
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6.5 5h3.4c.3 0 .6.3.6.6v12.8c0 .3-.3.6-.6.6H6.5c-.3 0-.6-.3-.6-.6V5.6c0-.3.3-.6.6-.6zm7.6 0h3.4c.3 0 .6.3.6.6v12.8c0 .3-.3.6-.6.6h-3.4c-.3 0-.6-.3-.6-.6V5.6c0-.3.3-.6.6-.6z"/></svg>'
const ICON_BACK =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>'
const ICON_FORWARD =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 17 5-5-5-5"/><path d="m6 17 5-5-5-5"/></svg>'
const ICON_BACK_10 =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M8.4 7.1A6.3 6.3 0 1 1 6.6 14.6"/><path fill="currentColor" d="M6.1 4.6v4.5h4.3z"/><text x="13.1" y="15.15" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" font-family="Roboto,Arial,sans-serif">10</text></svg>'
const ICON_FORWARD_10 =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M15.6 7.1A6.3 6.3 0 1 0 17.4 14.6"/><path fill="currentColor" d="M17.9 4.6v4.5h-4.3z"/><text x="10.9" y="15.15" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" font-family="Roboto,Arial,sans-serif">10</text></svg>'
const ICON_VOLUME =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
const ICON_VOLUME_LOW =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>'
const ICON_MUTED =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>'
const ICON_LOOP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
const ICON_LOOP_OFF =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M5 19 19 5"/></svg>'
const ICON_PIP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>'
const ICON_FULL =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'
const ICON_EXIT_FULL =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>'
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>'
const ICON_QUALITY =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/></svg>'

type Timeline = {
  start: number
  end: number
  seekable: boolean
}

let root: HTMLDivElement | null = null
let hit: HTMLDivElement | null = null
let bufferedEl: HTMLDivElement | null = null
let playedEl: HTMLDivElement | null = null
let tipEl: HTMLDivElement | null = null
let playBtn: HTMLButtonElement | null = null
let timeEl: HTMLSpanElement | null = null
let backBtn: HTMLButtonElement | null = null
let forwardBtn: HTMLButtonElement | null = null
let speedAnchor: HTMLDivElement | null = null
let speedBtn: HTMLButtonElement | null = null
let speedPop: HTMLDivElement | null = null
let speedReadout: HTMLDivElement | null = null
let speedCaption: HTMLDivElement | null = null
let speedInput: HTMLInputElement | null = null
let speedChips: HTMLButtonElement[] = []
let volumeAnchor: HTMLDivElement | null = null
let muteBtn: HTMLButtonElement | null = null
let volumePop: HTMLDivElement | null = null
let volumeInput: HTMLInputElement | null = null
let loopBtn: HTMLButtonElement | null = null
let pipBtn: HTMLButtonElement | null = null
let downloadBtn: HTMLButtonElement | null = null
let qualityAnchor: HTMLDivElement | null = null
let qualityBtn: HTMLButtonElement | null = null
let qualityPop: HTMLDivElement | null = null
let qualityList: HTMLDivElement | null = null
let fullBtn: HTMLButtonElement | null = null
const controlNodes = new Map<DockPlaceId, HTMLDivElement>()
const packNodes = new Map<string, HTMLDivElement>()

let boundVideo: HTMLVideoElement | null = null
let dragging = false
let dragPointerId = -1
let volumeDrag = false
let speedDrag = false
let volumeCloseTimer = 0
let speedCloseTimer = 0
let qualityCloseTimer = 0
let volumeApplyTimer = 0
let speedApplyTimer = 0
let pendingVolume: { volume: number; muted: boolean } | null = null
let pendingRate: number | null = null
let pendingLoop: boolean | null = null
let heldRate: number | null = null
let heldRateUntil = 0
let rateCorrected = false
let rateCheckTimer = 0
let actPointer: { id: number; act: string; node: HTMLElement } | null = null
let actHandledAt = 0
let hotTimer = 0
let ignoreUntil = 0
let lastAudible = 1
let pointerInside = false
let fullscreenHooked = false
let fsOpening = false
let fsEntered = false
let controlsBeforeFullscreen: boolean | null = null
let controlsObserver: MutationObserver | null = null
let playerObserver: MutationObserver | null = null
let suppressingControls = false
let downloadBusy = false
let ytOffer: YtOffer | null = null
const pendingYoutubeFetch = new Map<string, (bytes: Uint8Array | null) => void>()
let layoutStamp = ""
let shownMediaStamp = ""
let shownPlayerMark = ""
let qualityToken = 0
let qualityNonce = ""
let qualityStamp = ""
const rememberedSrc = new WeakMap<HTMLVideoElement, string>()
const rememberedCode = new WeakMap<HTMLVideoElement, string>()
const pinnedGroup = new WeakMap<HTMLVideoElement, Rendition[]>()
const pinnedCode = new WeakMap<HTMLVideoElement, string>()
const startedPath = new WeakMap<HTMLVideoElement, string>()
const sidecars = new WeakMap<HTMLVideoElement, HTMLAudioElement>()
let renditionGroups: Rendition[][] = []
let playedPaths: string[] = []
let latestBatch: Rendition[][] = []
let latestAt = 0
let heldStamp = ""
let qualitySearchAt = 0
let qualitySearchKey = ""
let qualityAskAt = 0
let qualityBind = 0
let catalogSeen = false
const QUALITY_SHOW_DELAY_MS = 900
const QUALITY_SEARCH_MS = 12_000
const QUALITY_ASK_GAP_MS = 1500
let lockedVideo: HTMLVideoElement | null = null
let lockedUrl = ""
let lockedAudio = ""
let lockedCode = ""
let applyingQuality = false
let historyHooked = false
let audioEpoch = 0
let audioClean: (() => void) | null = null
let soundtrackLevel = { muted: false, volume: 1 }
let soundtrackSince = 0
let lastViewerInput = 0
let siteMuteClickAt = 0
let muteLock = false
let hoverSampleTimers: number[] = []
let hoverWatch = 0
let soundtrackReady = true
let waitEpoch = 0
let waitFrame = 0
let waitTimer = 0
let waitClose: (() => void) | null = null
let waitClean: (() => void) | null = null

type FsSession = {
  video: HTMLVideoElement
  mark: Comment
  shell: HTMLDivElement
}

let fsSession: FsSession | null = null
let getSettings: (() => EffectSettings) | null = null
let getUiSettings: (() => EffectSettings) | null = null
let onControl: ((control: DockControl) => void) | null = null
let onMedia: ((media: DockMedia) => void) | null = null
let rateSource: ((video: HTMLVideoElement) => DockRateSource) | null = null

function ensureStyle(): void {
  let node = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!node) {
    node = document.createElement("style")
    node.id = STYLE_ID
    ;(document.head ?? document.documentElement).appendChild(node)
  }
  if (node.textContent !== BAR_STYLE) node.textContent = BAR_STYLE
}

function readSettings(): EffectSettings | null {
  const read = getUiSettings ?? getSettings
  if (!read) return null
  try {
    return read()
  } catch {
    return null
  }
}

function formatRate(value: number): string {
  const rounded = Math.round(value * 100) / 100
  const text = rounded.toFixed(2)
  if (root?.dataset.skin && root.dataset.skin !== "default") return `${text.replace(/\.?0+$/, "")}x`
  return `${text}x`
}

function formatChip(value: number): string {
  return value.toFixed(value === 1.25 ? 2 : 1)
}

function noteWrite(): void {
  ignoreUntil = performance.now() + WRITE_GUARD_MS
}

function flushVolume(): void {
  const next = pendingVolume
  pendingVolume = null
  window.clearTimeout(volumeApplyTimer)
  volumeApplyTimer = 0
  if (!next) return
  noteWrite()
  onControl?.({ type: "audio", volume: next.volume, muted: next.muted })
}

function scheduleVolume(volume: number, muted: boolean): void {
  pendingVolume = { volume, muted }
  window.clearTimeout(volumeApplyTimer)
  volumeApplyTimer = window.setTimeout(() => {
    volumeApplyTimer = 0
    flushVolume()
  }, LIGHT_APPLY_DELAY_MS)
}

function cancelVolumeApply(): void {
  window.clearTimeout(volumeApplyTimer)
  volumeApplyTimer = 0
  pendingVolume = null
}

function flushSpeed(): void {
  const next = pendingRate
  pendingRate = null
  window.clearTimeout(speedApplyTimer)
  speedApplyTimer = 0
  if (next === null) return
  noteWrite()
  heldRate = next
  heldRateUntil = performance.now() + WRITE_GUARD_MS + 520
  rateCorrected = false
  onControl?.({ type: "rate", playbackRate: next })
  armRateCheck()
}

function armRateCheck(): void {
  window.clearTimeout(rateCheckTimer)
  rateCheckTimer = window.setTimeout(() => {
    rateCheckTimer = 0
    const video = boundVideo
    const chosen = heldRate
    if (!video || chosen === null || rateCorrected || performance.now() > heldRateUntil) return
    if (rateSource?.(video) === "hold") return
    const live = video.playbackRate || 1
    if (Math.abs(live - chosen) <= 0.02) return
    rateCorrected = true
    noteWrite()
    onControl?.({ type: "rate", playbackRate: chosen })
  }, WRITE_GUARD_MS + 40)
}

function scheduleSpeed(rate: number): void {
  pendingRate = rate
  window.clearTimeout(speedApplyTimer)
  speedApplyTimer = window.setTimeout(() => {
    speedApplyTimer = 0
    flushSpeed()
  }, LIGHT_APPLY_DELAY_MS)
}

function cancelPopClose(which: "volume" | "speed" | "quality"): void {
  if (which === "volume") window.clearTimeout(volumeCloseTimer)
  else if (which === "quality") window.clearTimeout(qualityCloseTimer)
  else window.clearTimeout(speedCloseTimer)
}

function armPopClose(which: "volume" | "speed" | "quality"): void {
  cancelPopClose(which)
  const timer = window.setTimeout(() => {
    if (which === "volume") {
      if (volumeDrag) {
        armPopClose("volume")
        return
      }
      if (volumeAnchor?.matches(":hover")) return
      if (volumePop) delete volumePop.dataset.open
      return
    }
    if (which === "quality") {
      if (qualityAnchor?.matches(":hover")) return
      if (qualityPop) delete qualityPop.dataset.open
      return
    }
    if (speedDrag) {
      armPopClose("speed")
      return
    }
    if (speedAnchor?.matches(":hover")) return
    if (speedPop) delete speedPop.dataset.open
  }, POP_CLOSE_MS)
  if (which === "volume") volumeCloseTimer = timer
  else if (which === "quality") qualityCloseTimer = timer
  else speedCloseTimer = timer
}

function closePops(): void {
  cancelPopClose("volume")
  cancelPopClose("speed")
  cancelPopClose("quality")
  if (volumePop) delete volumePop.dataset.open
  if (qualityPop) delete qualityPop.dataset.open
  if (speedDrag) return
  if (speedPop) delete speedPop.dataset.open
}

function armChromeHide(): void {
  window.clearTimeout(hotTimer)
  hotTimer = window.setTimeout(hideChromeIfIdle, PLAYER_CHROME_HIDE_MS)
}

function hideChromeIfIdle(): void {
  if (!root) return
  if (dragging || volumeDrag || speedDrag || root.matches(":hover")) {
    armChromeHide()
    return
  }
  delete root.dataset.hot
  closePops()
}

function showChrome(): void {
  if (!root) return
  root.dataset.hot = "true"
  armChromeHide()
}

function pointerOverVideo(event: Pick<PointerEvent, "clientX" | "clientY">): boolean {
  const video = boundVideo
  if (!video) return false
  const rect = video.getBoundingClientRect()
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

function onDocumentHover(event: PointerEvent): void {
  if (!root || root.dataset.visible !== "true" || dragging) return
  if (event.pointerType === "touch") return
  const target = event.target
  const inside = pointerOverVideo(event) || (target instanceof Node && root.contains(target))
  if (!inside) {
    pointerInside = false
    return
  }
  pointerInside = true
  showChrome()
}

function onDockEnter(): void {
  showChrome()
}

function onDockLeave(event: PointerEvent): void {
  if (pointerOverVideo(event)) return
  const next = event.relatedTarget
  if (next instanceof Node && root?.contains(next)) return
  pointerInside = false
}

function onDocPointerDown(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node && root?.contains(target))) closePops()
  if (event.pointerType === "touch" && pointerOverVideo(event)) showChrome()
}

function stopAct(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

function recentAct(): boolean {
  return performance.now() - actHandledAt < 400
}

function markAct(): void {
  actHandledAt = performance.now()
}

function alignSpeedCard(): void {
  if (!speedAnchor || !speedBtn || !root) return
  const bar = root.getBoundingClientRect()
  const btn = speedBtn.getBoundingClientRect()
  if (bar.width <= 0) return
  const mid = btn.left + btn.width / 2
  if (mid > bar.left + bar.width * (2 / 3)) speedAnchor.dataset.align = "end"
  else delete speedAnchor.dataset.align
}

function editRate(video: HTMLVideoElement, settings: EffectSettings): number {
  if (pendingRate !== null) return pendingRate
  if (heldRate !== null && performance.now() < heldRateUntil) return heldRate
  return shownRate(video, settings)
}

function stepSpeed(delta: number): void {
  const settings = readSettings()
  const video = boundVideo
  if (!settings || !video) return
  setPlaybackRate(editRate(video, settings) + delta)
}

function toggleLoop(): void {
  const settings = readSettings()
  const video = boundVideo
  if (!settings || !video) return
  const next = !shownLoop(video, settings)
  pendingLoop = next
  noteWrite()
  onControl?.({ type: "loop", loop: next })
  paintControls()
  pendingLoop = null
}

function applySpeedFromPointer(event: PointerEvent): void {
  if (!speedInput) return
  const rect = speedInput.getBoundingClientRect()
  if (rect.width <= 0) return
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  setPlaybackRate(PLAYBACK_RATE_MIN + ratio * (PLAYBACK_RATE_MAX - PLAYBACK_RATE_MIN))
}

function actFromTarget(target: EventTarget | null): { act: string; node: HTMLElement } | null {
  if (!(target instanceof Element) || !root?.contains(target)) return null
  const range = target.closest(".vee-speed-adjust input")
  if (range instanceof HTMLElement) return { act: "speed-range", node: range }
  const chip = target.closest(".vee-speed-chips button")
  if (chip instanceof HTMLElement) return { act: "speed-chip", node: chip }
  const node = target.closest("[data-act]")
  if (!(node instanceof HTMLElement)) return null
  const act = node.dataset.act || ""
  if (act === "loop" || act === "speed-btn" || act === "speed-minus" || act === "speed-plus" || act === "download") {
    return { act, node }
  }
  return null
}

function onWindowActDown(event: PointerEvent): void {
  const hit = actFromTarget(event.target)
  if (!hit) return
  if (hit.act === "download") {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    showChrome()
    void downloadCurrent()
    return
  }
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  actPointer = { id: event.pointerId, act: hit.act, node: hit.node }
  if (hit.act !== "loop") {
    cancelPopClose("speed")
    if (speedPop) speedPop.dataset.open = "true"
    alignSpeedCard()
    showChrome()
  }
  if (hit.act === "speed-range") {
    speedDrag = true
    applySpeedFromPointer(event)
  }
}

function onWindowActMove(event: PointerEvent): void {
  if (!actPointer || actPointer.id !== event.pointerId || actPointer.act !== "speed-range") return
  event.preventDefault()
  event.stopPropagation()
  applySpeedFromPointer(event)
}

function onWindowActUp(event: PointerEvent): void {
  const pending = actPointer
  if (!pending || pending.id !== event.pointerId) return
  actPointer = null
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  if (pending.act === "speed-range") {
    endSpeedDrag()
    return
  }
  const released = actFromTarget(event.target) ?? actFromTarget(document.elementFromPoint(event.clientX, event.clientY))
  if (!released || released.node !== pending.node) return
  markAct()
  if (pending.act === "loop") toggleLoop()
  else if (pending.act === "speed-minus") stepSpeed(-SPEED_STEP)
  else if (pending.act === "speed-plus") stepSpeed(SPEED_STEP)
  else if (pending.act === "speed-chip") setPlaybackRate(Number(released.node.dataset.rate))
  else if (pending.act === "speed-btn") {
    alignSpeedCard()
    if (speedPop) speedPop.dataset.open = "true"
    showChrome()
  }
}

function shownRate(video: HTMLVideoElement, settings: EffectSettings): number {
  if (rateSource?.(video) === "hold") return video.playbackRate || settings.playbackRate
  if (settings.playbackTouched) return settings.playbackRate
  const published = readNativePlayer(video)
  const live = video.playbackRate || 1
  const echo = Number(video.getAttribute(YT_ECHO_ATTR))
  const publishedIsEcho =
    Number.isFinite(echo) &&
    typeof published?.playbackRate === "number" &&
    Math.abs(published.playbackRate - echo) < 0.02
  if (
    !publishedIsEcho &&
    typeof published?.playbackRate === "number" &&
    Math.abs(published.playbackRate - live) >= 0.02
  ) {
    return published.playbackRate
  }
  return live
}

function shownLoop(video: HTMLVideoElement, settings: EffectSettings): boolean {
  if (pendingLoop !== null) return pendingLoop
  if (settings.playbackTouched) return settings.loop
  const published = readNativePlayer(video)
  if (typeof published?.loop === "boolean") return published.loop
  return video.loop
}

function videoIsFullscreen(video: HTMLVideoElement): boolean {
  const current = document.fullscreenElement
  if (!current) return false
  return current === video || current.contains(video)
}

type VideoFullscreen = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
}

type ElementFullscreen = HTMLElement & {
  webkitRequestFullscreen?: () => void
}

function ensureShell(): HTMLDivElement {
  const existing = document.getElementById(FS_SHELL_ID)
  if (existing instanceof HTMLDivElement) return existing
  ensureStyle()
  const shell = document.createElement("div")
  shell.id = FS_SHELL_ID
  return shell
}

function requestElementFullscreen(element: HTMLElement): Promise<void> {
  const vendor = element as ElementFullscreen
  if (typeof element.requestFullscreen === "function") {
    return element.requestFullscreen({ navigationUI: "hide" })
  }
  if (typeof vendor.webkitRequestFullscreen === "function") {
    vendor.webkitRequestFullscreen()
    return Promise.resolve()
  }
  return Promise.reject(new Error("fullscreen unavailable"))
}

function moveToDocument(node: HTMLElement | null): void {
  if (!node || node.parentElement === document.documentElement) return
  document.documentElement.appendChild(node)
}

function evacuateFullscreenShell(shell: HTMLElement): void {
  const host = document.getElementById(DOCK_HOST_ID)
  if (host instanceof HTMLElement && shell.contains(host)) moveToDocument(host)
  if (root && shell.contains(root)) moveToDocument(root)
}

function onFullscreenCapture(): void {
  if (document.fullscreenElement) return
  moveToDocument(root)
  const host = document.getElementById(DOCK_HOST_ID)
  if (host instanceof HTMLElement) moveToDocument(host)
  showChrome()
}

function restorePlayerFullscreen(): void {
  const session = fsSession
  if (!session) return
  fsSession = null
  fsEntered = false
  const { video, mark, shell } = session
  delete video.dataset.veeFs
  evacuateFullscreenShell(shell)
  const parent = mark.parentNode
  if (parent) parent.insertBefore(video, mark)
  mark.remove()
  if (shell.isConnected) shell.remove()
}

async function enterPlayerFullscreen(video: HTMLVideoElement): Promise<void> {
  if (fsSession?.video === video && document.fullscreenElement === fsSession.shell) return
  if (fsSession) restorePlayerFullscreen()
  const parent = video.parentNode
  if (!parent) return
  ensureStyle()
  const shell = ensureShell()
  const mark = document.createComment("vee-fs")
  fsOpening = true
  try {
    parent.insertBefore(mark, video)
    shell.appendChild(video)
    video.dataset.veeFs = "1"
    if (!shell.isConnected) document.documentElement.appendChild(shell)
    void shell.offsetWidth
    fsSession = { video, mark, shell }
    await requestElementFullscreen(shell)
  } catch (error) {
    if (fsSession) restorePlayerFullscreen()
    else {
      delete video.dataset.veeFs
      if (mark.parentNode) mark.parentNode.insertBefore(video, mark)
      mark.remove()
      shell.remove()
    }
    throw error
  } finally {
    fsOpening = false
  }
}

function installFullscreenHook(): void {
  if (fullscreenHooked) return
  fullscreenHooked = true
  const proto = HTMLVideoElement.prototype
  const native = proto.requestFullscreen
  proto.requestFullscreen = function (this: HTMLVideoElement, options?: FullscreenOptions) {
    if (this === boundVideo && root?.dataset.visible === "true") return enterPlayerFullscreen(this)
    return native.call(this, options)
  }
  const vendor = proto as VideoFullscreen
  const enter = vendor.webkitEnterFullscreen
  if (typeof enter !== "function") return
  vendor.webkitEnterFullscreen = function (this: HTMLVideoElement) {
    if (this === boundVideo && root?.dataset.visible === "true") {
      void enterPlayerFullscreen(this).catch(() => undefined)
      return
    }
    return enter.call(this)
  }
}

function suppressNativeControls(video: HTMLVideoElement): void {
  if (video.controls) video.controls = false
  if (!controlsObserver) {
    controlsObserver = new MutationObserver(() => {
      const current = boundVideo
      const fullscreen = document.fullscreenElement
      if (!current || !fullscreen) return
      if (fullscreen !== current && !fullscreen.contains(current)) return
      if (current.controls) current.controls = false
    })
  }
  controlsObserver.disconnect()
  controlsObserver.observe(video, { attributes: true, attributeFilter: ["controls"] })
}

function releaseNativeControls(video: HTMLVideoElement | null): void {
  controlsObserver?.disconnect()
  if (video && controlsBeforeFullscreen !== null) video.controls = controlsBeforeFullscreen
  controlsBeforeFullscreen = null
}

function syncNativeControls(video: HTMLVideoElement): void {
  const fullscreen = document.fullscreenElement
  const covered = !!fullscreen && (fullscreen === video || fullscreen.contains(video))
  if (covered && root?.dataset.visible === "true") {
    if (!suppressingControls) controlsBeforeFullscreen = video.controls
    suppressingControls = true
    suppressNativeControls(video)
    return
  }
  if (suppressingControls) {
    suppressingControls = false
    releaseNativeControls(video)
    return
  }
  if (!fullscreen) controlsBeforeFullscreen = video.controls
}

function paintTime(video: HTMLVideoElement): void {
  if (!timeEl) return
  const current = formatClock(video.currentTime || 0)
  const duration =
    Number.isFinite(video.duration) && video.duration > 0 ? formatClock(video.duration) : ""
  timeEl.textContent = duration ? `${current} / ${duration}` : current
}

function clearHoverSamples(): void {
  for (const id of hoverSampleTimers) window.clearTimeout(id)
  hoverSampleTimers = []
  if (hoverWatch) window.clearInterval(hoverWatch)
  hoverWatch = 0
}

/** Sound Instagram or Facebook starts beside the clip, often on hover. */
function hoverSoundtrack(video: HTMLVideoElement): HTMLAudioElement | null {
  const article = video.closest("article") || video.closest("[role='article']") || video.closest("[role='dialog']")
  const scopes: ParentNode[] = []
  if (article) scopes.push(article)
  if (video.parentElement && video.parentElement !== article) scopes.push(video.parentElement)
  scopes.push(document)
  const seen = new Set<ParentNode>()
  for (const scope of scopes) {
    if (seen.has(scope)) continue
    seen.add(scope)
    for (const node of scope.querySelectorAll("audio")) {
      if (!(node instanceof HTMLAudioElement)) continue
      if (node.getAttribute("data-vee-audio") === "1") continue
      if (!node.isConnected || node.paused || node.ended || node.muted || node.volume <= 0.001) continue
      if (scope === document) {
        const host = node.closest("article") || node.closest("[role='article']") || node.closest("[role='dialog']")
        if (host && (!article || host !== article)) continue
      }
      return node
    }
  }
  return null
}

/** What is actually audible: the soundtrack, a hover clip, or the video itself. */
function liveAudible(video: HTMLVideoElement): { volume: number; muted: boolean } {
  const extra = hoverSoundtrack(video)
  if (extra) return { volume: extra.volume || 1, muted: false }
  if (!video.muted && video.volume > 0.001) return { volume: video.volume, muted: false }
  const side = sidecars.get(video)
  if (
    side &&
    lockedAudio &&
    lockedVideo === video &&
    side.dataset.veeHoldMute !== "1" &&
    side.src &&
    !side.muted &&
    side.volume > 0.001
  ) {
    return { volume: side.volume, muted: false }
  }
  return { volume: video.volume, muted: true }
}

function shownAudio(video: HTMLVideoElement, settings: EffectSettings): { volume: number; muted: boolean } {
  if (pendingVolume) return pendingVolume
  const policy = domainAudio(location.hostname)
  if (settings.audioTouched) return { volume: settings.volume, muted: settings.muted }
  if (policy.followLive) return liveAudible(video)
  const published = readNativePlayer(video)
  let volume = video.volume
  let muted = video.muted
  if (typeof published?.volume === "number" && Math.abs(published.volume - volume) >= 0.01) volume = published.volume
  if (typeof published?.muted === "boolean" && published.muted !== muted) muted = published.muted
  return { volume, muted }
}

function userHoldsMute(): boolean {
  const settings = readSettings()
  const policy = domainAudio(location.hostname)
  if (!policy.holdUserMute || !settings?.audioTouched || !settings.muted) return false
  if (pendingVolume && !pendingVolume.muted) return false
  return performance.now() - siteMuteClickAt >= 800
}

function enforceHeldMute(video: HTMLVideoElement): void {
  if (!userHoldsMute() || muteLock) return
  muteLock = true
  try {
    if (!video.muted) video.muted = true
    const side = sidecars.get(video)
    if (side && !side.muted) side.muted = true
    const extra = hoverSoundtrack(video)
    if (extra) extra.muted = true
  } catch {
    /* The element can already be detached. */
  } finally {
    muteLock = false
  }
}

function paintMute(): void {
  const video = boundVideo
  const settings = readSettings()
  if (!video || !settings || !muteBtn) return
  const level = shownAudio(video, settings)
  const volumeNow = level.volume
  const silent = level.muted || volumeNow <= 0.001
  if (volumeNow > 0.001) lastAudible = volumeNow
  const volumeIcon = silent ? "muted" : volumeNow < 0.5 ? "low" : "high"
  setIcon(muteBtn, volumeIcon, silent ? ICON_MUTED : volumeNow < 0.5 ? ICON_VOLUME_LOW : ICON_VOLUME)
  muteBtn.dataset.on = String(silent)
  muteBtn.setAttribute("aria-label", silent ? "Unmute" : "Mute")
  muteBtn.setAttribute("aria-pressed", String(silent))
  if (volumeInput && !volumeDrag) volumeInput.value = String(volumeNow)
}

function sampleAudioSoon(video: HTMLVideoElement): void {
  for (const id of hoverSampleTimers) window.clearTimeout(id)
  hoverSampleTimers = []
  const run = () => {
    if (boundVideo !== video) return
    enforceHeldMute(video)
    paintMute()
    reportMedia()
  }
  run()
  for (const delay of [80, 280, 640, 1200]) hoverSampleTimers.push(window.setTimeout(run, delay))
}

function onVideoPointer(event: Event): void {
  const video = boundVideo
  if (!video) return
  const policy = domainAudio(location.hostname)
  if (!policy.followLive && !policy.holdUserMute) return
  if (event.type === "pointerleave") {
    if (hoverWatch) window.clearInterval(hoverWatch)
    hoverWatch = 0
    sampleAudioSoon(video)
    return
  }
  sampleAudioSoon(video)
  if (hoverWatch) return
  hoverWatch = window.setInterval(() => {
    if (boundVideo !== video) return
    if (userHoldsMute()) enforceHeldMute(video)
    paintMute()
    reportMedia()
  }, 300)
}

function onSiteAudioClick(event: Event): void {
  if (!event.isTrusted) return
  const target = event.target
  if (!(target instanceof Element) || root?.contains(target)) return
  const control = target.closest("button, [role='button']")
  if (!(control instanceof HTMLElement)) return
  const label = (control.getAttribute("aria-label") || "").toLowerCase()
  if (!/mute|unmute|sound|audio|volume/.test(label)) return
  siteMuteClickAt = performance.now()
}

function onPageAudio(event: Event): void {
  const video = boundVideo
  if (!video) return
  const policy = domainAudio(location.hostname)
  if (!policy.followLive && !policy.holdUserMute) return
  const target = event.target
  if (!(target instanceof HTMLAudioElement) || target.getAttribute("data-vee-audio") === "1") return
  if (userHoldsMute()) enforceHeldMute(video)
  else {
    paintControls()
    reportMedia()
  }
}

function paintControls(): void {
  const video = boundVideo
  const settings = readSettings()
  if (!video || !settings || !root) return
  applyChromeSkin(video)
  const pipOn = document.pictureInPictureElement === video
  const fullOn = videoIsFullscreen(video)
  const level = shownAudio(video, settings)
  const volumeNow = level.volume
  const mutedNow = level.muted
  const silent = mutedNow || volumeNow <= 0.001
  const rate = shownRate(video, settings)
  if (volumeNow > 0.001) lastAudible = volumeNow

  if (playBtn) {
    const paused = video.paused || video.ended
    setIcon(playBtn, paused ? "play" : "pause", paused ? ICON_PLAY : ICON_PAUSE)
    playBtn.setAttribute("aria-label", paused ? "Play" : "Pause")
  }
  if (timeEl) paintTime(video)
  paintSkipIcons()
  paintSpeed(rate)
  if (muteBtn) {
    const volumeIcon = silent ? "muted" : volumeNow < 0.5 ? "low" : "high"
    setIcon(
      muteBtn,
      volumeIcon,
      silent ? ICON_MUTED : volumeNow < 0.5 ? ICON_VOLUME_LOW : ICON_VOLUME
    )
    muteBtn.dataset.on = String(silent)
    muteBtn.setAttribute("aria-label", silent ? "Unmute" : "Mute")
    muteBtn.setAttribute("aria-pressed", String(silent))
  }
  if (volumeInput && !volumeDrag) volumeInput.value = String(volumeNow)
  if (loopBtn) {
    const loopOn = shownLoop(video, settings)
    setIcon(loopBtn, loopOn ? "on" : "off", loopOn ? ICON_LOOP : ICON_LOOP_OFF)
    loopBtn.dataset.on = String(loopOn)
    loopBtn.setAttribute("aria-pressed", String(loopOn))
    loopBtn.setAttribute("aria-label", loopOn ? "Turn loop off" : "Turn loop on")
  }
  if (pipBtn) {
    pipBtn.dataset.on = String(pipOn)
    pipBtn.setAttribute("aria-pressed", String(pipOn))
  }
  if (fullBtn) {
    setIcon(fullBtn, fullOn ? "exit" : "full", fullOn ? ICON_EXIT_FULL : ICON_FULL)
    fullBtn.dataset.on = String(fullOn)
    fullBtn.setAttribute("aria-label", fullOn ? "Exit full screen" : "Full screen")
    fullBtn.setAttribute("aria-pressed", String(fullOn))
  }
  rememberDirect(video)
  noteActiveClip(video)
  paintQuality(video)
  if (!volumeDrag && !speedDrag) applyBarLayout(settings)
}

function hasDockButtons(settings: EffectSettings): boolean {
  return DOCK_CONTROL_KEYS.some((key) => settings[key])
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 1
  const stepped = Math.round(value * 100) / 100
  return Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, stepped))
}

function ratePortion(rate: number): string {
  const span = PLAYBACK_RATE_MAX - PLAYBACK_RATE_MIN
  const portion = span <= 0 ? 0 : (rate - PLAYBACK_RATE_MIN) / span
  return `${Math.min(100, Math.max(0, portion * 100))}%`
}

function paintSpeed(rate: number): void {
  const shown = clampRate(pendingRate ?? rate)
  const label = formatRate(shown)
  if (speedBtn) {
    speedBtn.textContent = label
    speedBtn.dataset.on = String(Math.abs(shown - 1) > 0.001)
    speedBtn.setAttribute("aria-label", `Playback speed ${label}`)
  }
  if (speedReadout) speedReadout.textContent = label
  if (speedCaption) {
    const label = speedCaption.querySelector("span")
    if (label) label.textContent = Math.abs(shown - 1) < 0.001 ? "Normal" : ""
  }
  for (const chip of speedChips) {
    const chipRate = Number(chip.dataset.rate)
    chip.dataset.on = String(Math.abs(shown - chipRate) < 0.005)
  }
  if (!speedInput) return
  speedInput.style.setProperty("--p", ratePortion(shown))
  speedInput.value = String(shown)
}

function controlShown(id: DockPlaceId, settings: EffectSettings): boolean {
  switch (id) {
    case "progress":
      return settings.dockProgress
    case "play":
      return settings.dockPlay
    case "time":
      return settings.dockTime
    case "skip":
      return settings.dockSkip
    case "speed":
      return settings.dockSpeed
    case "volume":
      return settings.dockVolume
    case "loop":
      return settings.dockLoop
    case "pip":
      return settings.dockPip && document.pictureInPictureEnabled
    case "download":
      return settings.dockDownload && fileForDownload(boundVideo) != null
    case "quality":
      return settings.dockQuality && qualityShown(boundVideo)
    case "fullscreen":
      return settings.dockFullscreen
  }
}

function rememberDirect(video: HTMLVideoElement): void {
  const url = directMediaUrl(video)
  if (!url) return
  rememberedSrc.set(video, url)
  if (!instagramPage()) return
  const code = mediaCode(video)
  if (code) rememberedCode.set(video, code)
}

function sizeNear(known: number, live: number): boolean {
  if (known < 2 || live < 2) return false
  return Math.abs(known - live) <= Math.max(8, live * 0.04)
}

function groupContainingPath(path: string): Rendition[] | null {
  const groups = groupsWithPath(path)
  return groups.length ? groups[groups.length - 1] : null
}

function groupsWithPath(path: string): Rendition[][] {
  if (!path) return []
  const name = path.split("/").pop() || ""
  const primary: Rendition[][] = []
  const alias: Rendition[][] = []
  for (let index = renditionGroups.length - 1; index >= 0; index -= 1) {
    const group = renditionGroups[index]
    let kind: "primary" | "alias" | "" = ""
    for (const item of group) {
      const itemPath = mediaPath(item.url)
      if (itemPath === path || (name.length > 12 && (itemPath.endsWith(`/${name}`) || itemPath === name))) kind = "primary"
      else if (
        kind !== "primary" &&
        (item.aliases?.some((alias) => mediaPath(alias) === path || (name.length > 12 && mediaPath(alias).endsWith(`/${name}`))) ||
          (item.audioUrl && mediaPath(item.audioUrl) === path))
      ) {
        kind = "alias"
      }
    }
    if (kind === "primary") primary.push(group)
    else if (kind === "alias") alias.push(group)
  }
  return primary.length ? primary : alias
}

function groupHasPath(group: readonly Rendition[], path: string): boolean {
  if (!path) return false
  const name = path.split("/").pop() || ""
  return group.some((item) => {
    const itemPath = mediaPath(item.url)
    if (itemPath === path) return true
    if (item.aliases?.some((alias) => mediaPath(alias) === path)) return true
    return name.length > 12 && (itemPath.endsWith(`/${name}`) || itemPath === name)
  })
}

function recentPaths(): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const add = (value: string, trusted: boolean) => {
    if (!value || seen.has(value)) return
    const path = value.startsWith("http") ? mediaPath(value) : value
    if (!path.startsWith("/") || seen.has(path)) return
    if (!trusted && !/\.(mp4|webm|m4v|mov)$/i.test(path)) return
    seen.add(value)
    seen.add(path)
    found.push(path)
  }
  for (const path of playedPaths) add(path, true)
  try {
    const entries = performance.getEntriesByType("resource")
    for (let index = entries.length - 1; index >= 0 && found.length < 16; index -= 1) add(entries[index].name, false)
  } catch {
    /* Resource timing can be unavailable in this frame. */
  }
  return found
}

function durationFits(group: readonly Rendition[], video: HTMLVideoElement): boolean {
  const known = group.find((item) => item.duration && item.duration > 0)?.duration
  const live = video.duration
  if (!known || !Number.isFinite(live) || live <= 0) return true
  return Math.abs(known - live) < 1.25
}

function sizeKnown(video: HTMLVideoElement): boolean {
  return video.videoWidth >= 2 && video.videoHeight >= 2
}

function sizeFits(group: readonly Rendition[], video: HTMLVideoElement): boolean {
  if (!sizeKnown(video)) return true
  const measured = group.filter((item) => item.measured !== false)
  if (!measured.length) return true
  return measured.some((item) => sizeNear(item.width, video.videoWidth) && sizeNear(item.height, video.videoHeight))
}

function pinGroup(video: HTMLVideoElement, group: Rendition[]): Rendition[] {
  pinnedGroup.set(video, group)
  const code = groupCode(group) || (instagramPage() ? mediaCode(video) : "")
  if (code) pinnedCode.set(video, code)
  return group
}

function dropPin(video: HTMLVideoElement): void {
  pinnedGroup.delete(video)
  pinnedCode.delete(video)
  startedPath.delete(video)
  qualityStamp = ""
}

const DURATION_SLOP = 1.25

function instagramPage(): boolean {
  const host = location.hostname.replace(/^www\./, "")
  return host === "instagram.com" || host.endsWith(".instagram.com")
}

function groupCode(group: readonly Rendition[] | null | undefined): string {
  if (!group) return ""
  let code = ""
  for (const item of group) {
    if (!item.code) continue
    if (!code) code = item.code
    else if (code !== item.code) return ""
  }
  return code
}

function groupPk(group: readonly Rendition[]): string {
  let pk = ""
  for (const item of group) {
    if (!item.pk) continue
    if (!pk) pk = item.pk
    else if (pk !== item.pk) return ""
  }
  return pk
}

function clipDuration(group: readonly Rendition[]): number {
  return group.find((item) => item.duration && item.duration > 0)?.duration || 0
}

function durationSlop(live: number): number {
  return Math.max(DURATION_SLOP, live * 0.05)
}

function durationConflicts(group: readonly Rendition[], video: HTMLVideoElement): boolean {
  const known = clipDuration(group)
  const live = video.duration
  if (!known || !Number.isFinite(live) || live <= 0) return false
  return Math.abs(known - live) > durationSlop(live)
}

function durationAgrees(group: readonly Rendition[], live: number): boolean {
  const known = clipDuration(group)
  if (!known || !Number.isFinite(live) || live <= 0) return false
  return Math.abs(known - live) <= durationSlop(live)
}

function sameClipGroup(a: readonly Rendition[], b: readonly Rendition[]): boolean {
  const codeA = groupCode(a)
  const codeB = groupCode(b)
  if (!codeA || codeA !== codeB) return false
  const pkA = groupPk(a)
  const pkB = groupPk(b)
  if (pkA && pkB) return pkA === pkB
  const durA = clipDuration(a)
  const durB = clipDuration(b)
  if (durA && durB) return Math.abs(durA - durB) <= durationSlop(Math.max(durA, durB))
  return false
}

function dedupeChoices(items: Rendition[]): Rendition[] {
  const seen = new Set<string>()
  const next: Rendition[] = []
  for (const item of items) {
    const key = `${item.width}x${item.height}:${mediaPath(item.url)}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }
  return next
}

function uniteClip(seed: Rendition[], pool: Rendition[][]): Rendition[] {
  const related = pool.filter((group) => group === seed || sameClipGroup(seed, group))
  const soundtracks = new Set(
    related.flatMap((group) => group.map((item) => item.soundtrack || item.audioUrl || "")).filter(Boolean)
  )
  const items = dedupeChoices(related.flat())
  if (soundtracks.size === 1) {
    const track = [...soundtracks][0]
    for (const item of items) if (!item.soundtrack) item.soundtrack = track
  }
  return items
}

function playingPath(video: HTMLVideoElement, code = ""): string {
  const direct = directMediaUrl(video)
  if (direct) return mediaPath(direct)
  const remembered = rememberedSrc.get(video)
  if (!remembered) return ""
  if (!instagramPage()) return mediaPath(remembered)
  const live = code || mediaCode(video)
  const marked = rememberedCode.get(video) || ""
  if (live && marked && live !== marked) {
    rememberedSrc.delete(video)
    rememberedCode.delete(video)
    return ""
  }
  return mediaPath(remembered)
}

function strictRecent(video: HTMLVideoElement): Rendition[] | null {
  const live = video.duration
  if (!Number.isFinite(live) || live <= 0) return null
  const hits = renditionGroups.filter((group) => {
    if (!groupCode(group) && group.some((item) => item.code)) return false
    return durationAgrees(group, live) && sizeFits(group, video)
  })
  return hits.length === 1 ? hits[0] : null
}

function sizeMatch(groups: Rendition[][], video: HTMLVideoElement): Rendition[][] {
  if (!sizeKnown(video)) return []
  return groups.filter((group) =>
    group.some((item) => item.measured !== false && sizeNear(item.width, video.videoWidth) && sizeNear(item.height, video.videoHeight))
  )
}

function fullest(groups: Rendition[][]): Rendition[] {
  return groups.reduce((best, group) => (group.length > best.length ? group : best))
}

function pickCoded(groups: Rendition[][], video: HTMLVideoElement, path: string): Rendition[] | null {
  if (!groups.length) return null
  if (path) {
    const hits = groups.filter((group) => groupHasPath(group, path))
    if (hits.length === 1) return hits[0]
    if (hits.length > 1) return fullest(hits)
  }
  if (groups.length === 1) return groups[0]
  const live = video.duration
  let pool = groups
  if (Number.isFinite(live) && live > 0) {
    const close = groups.filter((group) => durationAgrees(group, live))
    if (close.length === 1) return close[0]
    if (close.length > 1) pool = close
    else {
      const sized = sizeMatch(groups, video)
      return sized.length === 1 ? sized[0] : null
    }
  }
  const pks = new Set(pool.map((group) => groupPk(group)).filter(Boolean))
  if (pks.size === 1) return fullest(pool)
  const sized = sizeMatch(pool, video)
  if (sized.length === 1) return sized[0]
  return null
}

/** One multi-file group for this shortcode, when duration cannot separate the slides. */
function uniqueQualityGroup(groups: Rendition[][], video: HTMLVideoElement): Rendition[] | null {
  const multi = groups.filter((group) => group.length > 1 && !durationConflicts(group, video))
  if (multi.length === 1) return multi[0]
  const live = video.duration
  if (!Number.isFinite(live) || live <= 0) return null
  const close = multi.filter((group) => durationAgrees(group, live))
  return close.length === 1 ? close[0] : null
}

/** Join same-post files that share one media id or one duration. */
function mergeOwned(groups: Rendition[][], video: HTMLVideoElement): Rendition[] | null {
  const pool = groups.filter((group) => group.length && !durationConflicts(group, video))
  if (!pool.length) return null
  const multi = pool.filter((group) => group.length > 1)
  if (multi.length > 1) {
    const live = video.duration
    if (!Number.isFinite(live) || live <= 0) return null
    const close = multi.filter((group) => durationAgrees(group, live))
    if (close.length !== 1) return null
    const items = dedupeChoices(uniteClip(close[0], pool))
    return items.length > 1 ? items : null
  }
  const pks = [...new Set(pool.map((group) => groupPk(group)).filter(Boolean))]
  if (pks.length > 1) {
    const live = video.duration
    if (!Number.isFinite(live) || live <= 0) return null
    const close = pool.filter((group) => durationAgrees(group, live))
    const closePks = [...new Set(close.map((group) => groupPk(group)).filter(Boolean))]
    if (closePks.length !== 1) return null
    const seed = close.find((group) => groupPk(group) === closePks[0])
    if (!seed) return null
    const items = dedupeChoices(uniteClip(seed, close))
    return items.length > 1 ? items : null
  }
  const items = dedupeChoices(uniteClip(fullest(pool), pool))
  return items.length > 1 ? items : null
}

function codedChoice(groups: Rendition[][], video: HTMLVideoElement, path: string): Rendition[] | null {
  const strict = pickCoded(groups, video, path)
  const loose = uniqueQualityGroup(groups, video)
  const looseWins =
    !!loose &&
    loose.length > (strict?.length || 0) &&
    (!strict || strict.length < 2) &&
    !durationConflicts(loose, video)
  const seed = looseWins ? loose : strict
  if (seed && seed.length > 1) return uniteClip(seed, groups)
  const merged = mergeOwned(groups, video)
  return merged && merged.length > 1 ? merged : null
}

function groupAllowed(group: readonly Rendition[], code: string): boolean {
  const tagged = groupCode(group)
  if (code && tagged && tagged !== code) return false
  if (code && !tagged && group.some((item) => item.code)) return false
  return true
}

/**
 * Instagram prefetches the next reel into the same catalog. Size and recency
 * are not enough to tell those clips apart, so the post shortcode decides.
 * A shortcode with no tagged files still falls through to the playing URL,
 * because some responses omit the code until the post page is loaded.
 */
function matchInstagram(video: HTMLVideoElement): Rendition[] {
  const code = mediaCode(video)
  const path = playingPath(video, code)
  const marked = pinnedCode.get(video) || ""
  if (code && marked && code !== marked) dropPin(video)

  if (code) {
    const owned = renditionGroups.filter((group) => groupCode(group) === code)
    const picked = codedChoice(owned, video, path)
    if (picked) return pinGroup(video, picked)
  }

  if (path) {
    const groups = groupsWithPath(path).filter((group) => groupAllowed(group, code))
    if (groups.length === 1 && groups[0].length > 1) return pinGroup(video, groups[0])
    if (groups.length > 1) {
      const coded = code ? groups.filter((group) => groupCode(group) === code) : []
      if (coded.length === 1) {
        const united = uniteClip(coded[0], coded)
        if (united.length > 1) return pinGroup(video, united)
      }
      const open = groups.filter((group) => !groupCode(group))
      if (open.length === 1 && open[0].length > 1) return pinGroup(video, open[0])
    }
  }

  const pinned = pinnedGroup.get(video)
  if (pinned && pinned.length > 1 && groupAllowed(pinned, code)) {
    const pinCode = pinnedCode.get(video) || ""
    if (code && pinCode === code) return pinned
    if (!code && !durationConflicts(pinned, video)) return pinned
    if (code && !pinCode && path && groupHasPath(pinned, path) && !durationConflicts(pinned, video)) return pinned
  }

  const strict = strictRecent(video)
  if (strict && strict.length > 1 && groupAllowed(strict, code)) return pinGroup(video, strict)
  if (!code) return matchPlayed(video)
  const owned = renditionGroups.filter((group) => groupCode(group) === code)
  const single = pickCoded(owned, video, path)
  if (single?.length) return pinGroup(video, uniteClip(single, owned))
  if (path) {
    const groups = groupsWithPath(path).filter((group) => groupAllowed(group, code))
    if (groups.length === 1) return pinGroup(video, groups[0])
  }
  return []
}

function matchedGroup(video: HTMLVideoElement | null): Rendition[] {
  if (!video) return []
  if (instagramPage()) return matchInstagram(video)
  return matchPlayed(video)
}

function unlabeledPlayed(groups: Rendition[][]): Rendition[] | null {
  const unlabeled = groups.filter((group) => group.every((item) => item.measured === false))
  if (unlabeled.length < 2) return null
  for (const path of recentPaths()) {
    const hits = unlabeled.filter((group) => groupHasPath(group, path))
    if (hits.length === 1) return hits[0]
  }
  return null
}

function matchPlayed(video: HTMLVideoElement): Rendition[] {
  const src = directMediaUrl(video) || rememberedSrc.get(video) || ""
  if (src) {
    const group = groupContainingPath(mediaPath(src))
    if (group && group.length > 1 && durationFits(group, video)) return pinGroup(video, group)
  }
  const started = startedPath.get(video)
  if (started) {
    const group = groupContainingPath(started)
    const fits = !!group && durationFits(group, video) && (!sizeKnown(video) || sizeFits(group, video))
    if (fits && group && group.length > 1) return pinGroup(video, group)
    if (sizeKnown(video) && !fits) startedPath.delete(video)
  }
  if (sizeKnown(video)) {
    for (const path of recentPaths()) {
      const group = groupContainingPath(path)
      if (!group || group.length < 2 || !durationFits(group, video) || !sizeFits(group, video)) continue
      startedPath.set(video, path)
      return pinGroup(video, group)
    }
  }
  const pinned = pinnedGroup.get(video)
  if (pinned && pinned.length > 1 && durationFits(pinned, video)) return pinned
  if (
    latestBatch.length === 1 &&
    latestBatch[0].length > 1 &&
    performance.now() - latestAt < 8000 &&
    durationFits(latestBatch[0], video) &&
    sizeFits(latestBatch[0], video)
  ) {
    return pinGroup(video, latestBatch[0])
  }
  const multi = renditionGroups.filter(
    (group) => group.length > 1 && durationFits(group, video) && sizeFits(group, video)
  )
  const measured = multi.filter((group) => group.some((item) => item.measured !== false))
  if (sizeKnown(video) && measured.length === 1) return pinGroup(video, measured[0])
  const unlabeled = unlabeledPlayed(multi)
  if (unlabeled) return pinGroup(video, unlabeled)
  if (multi.length === 1) return pinGroup(video, multi[0])
  if (src) {
    const group = groupContainingPath(mediaPath(src))
    if (group && durationFits(group, video)) return pinGroup(video, group)
  }
  if (started) {
    const group = groupContainingPath(started)
    if (group && durationFits(group, video) && (!sizeKnown(video) || sizeFits(group, video))) return pinGroup(video, group)
  }
  return []
}

function qualityReady(video: HTMLVideoElement | null): boolean {
  return collapseSizes(matchedGroup(video)).length > 1
}

function renditionHost(): boolean {
  const host = location.hostname.replace(/^www\./, "")
  return (
    instagramPage() ||
    host === "facebook.com" ||
    host.endsWith(".facebook.com") ||
    host === "fb.com" ||
    host.endsWith(".fb.com") ||
    host === "fb.watch" ||
    host.endsWith(".fb.watch")
  )
}

function clipSearchKey(video: HTMLVideoElement): string {
  const code = instagramPage() ? pageCodeFor(video) || codeInSingleVideoHost(video) : ""
  return `${qualityBind}|${location.pathname}|${code}`
}

function touchQualitySearch(video: HTMLVideoElement): void {
  if (!renditionHost()) return
  const key = clipSearchKey(video)
  if (key === qualitySearchKey) return
  qualitySearchKey = key
  qualitySearchAt = performance.now()
  qualityAskAt = 0
}

function qualityShown(video: HTMLVideoElement | null): boolean {
  if (!video) return false
  if (qualityReady(video)) return true
  if (catalogSeen || !renditionHost() || !qualitySearchAt) return false
  const elapsed = performance.now() - qualitySearchAt
  return elapsed >= QUALITY_SHOW_DELAY_MS && elapsed < QUALITY_SEARCH_MS
}

function betterFile(a: Rendition, b: Rendition): boolean {
  if (!a.audioUrl !== !b.audioUrl) return !a.audioUrl
  return (a.bandwidth || 0) > (b.bandwidth || 0)
}

/** One choice per picture size. Instagram lists several bitrate tiers of the same size. */
function collapseSizes(items: readonly Rendition[]): Rendition[] {
  const bySize = new Map<string, Rendition[]>()
  const next: Rendition[] = []
  for (const item of items) {
    if (item.measured === false) {
      next.push(item)
      continue
    }
    const key = `${item.width}x${item.height}`
    const same = bySize.get(key)
    if (same) same.push(item)
    else {
      bySize.set(key, [item])
      next.push(item)
    }
  }
  return next.map((item) => {
    const same = item.measured === false ? null : bySize.get(`${item.width}x${item.height}`)
    if (!same || same.length < 2) return item
    const best = same.reduce((top, other) => (betterFile(other, top) ? other : top))
    const aliases = new Set(best.aliases || [])
    for (const other of same) {
      if (other === best) continue
      aliases.add(other.url)
      for (const alias of other.aliases || []) aliases.add(alias)
    }
    const bestPath = mediaPath(best.url)
    const kept = [...aliases].filter((alias) => mediaPath(alias) !== bestPath)
    return {
      ...best,
      soundtrack: best.soundtrack || same.find((other) => other.soundtrack)?.soundtrack,
      aliases: kept.length ? kept : undefined
    }
  })
}

function choicesFor(video: HTMLVideoElement): Rendition[] {
  return sortRenditions(collapseSizes(matchedGroup(video)))
}

function mentionsPath(item: Rendition, path: string): boolean {
  if (!path) return false
  if (mediaPath(item.url) === path) return true
  return item.aliases?.some((alias) => mediaPath(alias) === path) === true
}

function activeRendition(video: HTMLVideoElement, choices: readonly Rendition[]): Rendition | undefined {
  const src = directMediaUrl(video) || rememberedSrc.get(video) || ""
  if (src) {
    const hit = choices.find((item) => mentionsPath(item, mediaPath(src)))
    if (hit) return hit
  }
  const started = startedPath.get(video)
  if (started) {
    const hit = choices.find((item) => mentionsPath(item, started))
    if (hit) return hit
  }
  return choices.find(
    (item) => item.measured !== false && sizeNear(item.width, video.videoWidth) && sizeNear(item.height, video.videoHeight)
  )
}

function downloadTitle(video: HTMLVideoElement | null): string {
  if (ytOffer?.title && ytOffer.videoId === youtubeVideoId(location.href)) return ytOffer.title
  const group = video ? matchedGroup(video) : []
  const url = fileForDownload(video)
  const path = url ? mediaPath(url) : ""
  const matched = path ? group.find((item) => mentionsPath(item, path) && item.title) : undefined
  if (matched?.title) return matched.title
  const shared = group.find((item) => item.title)?.title
  if (shared) return shared
  return readVideoTitle(video)
}

function youtubeBlocked(video: HTMLVideoElement | null): boolean {
  if (!video) return false
  try {
    return Boolean(video.mediaKeys)
  } catch {
    return true
  }
}

function youtubeOfferForPage(): YtOffer | null {
  if (domainSkin(location.hostname, location.pathname) !== "youtube") return null
  if (!ytOffer || ytOffer.live || ytOffer.videoId !== youtubeVideoId(location.href)) return null
  if (youtubeBlocked(boundVideo)) return null
  if (!ytOffer.combinedUrl && !(ytOffer.videoUrl && ytOffer.audioUrl)) return null
  return ytOffer
}

function saveRemoteFile(url: string, title: string): Promise<boolean> {
  return chrome.runtime
    .sendMessage({ type: DOWNLOAD_MESSAGE, url, title })
    .then((response) => response?.ok === true)
    .catch(() => false)
}

function refreshPlayerOffer(previousUrl: string): Promise<YtOffer | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage)
      resolve(null)
    }, 8000)
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return
      const offer = readYtOffer(event.data)
      if (!offer || !offer.combinedUrl || offer.combinedUrl === previousUrl) return
      window.clearTimeout(timer)
      window.removeEventListener("message", onMessage)
      resolve(offer)
    }
    window.addEventListener("message", onMessage)
    window.postMessage({ source: YT_MEDIA_SOURCE, kind: "refresh" }, "*")
  })
}

function askYoutubeOffer(): void {
  if (domainSkin(location.hostname, location.pathname) !== "youtube") return
  window.postMessage({ source: YT_MEDIA_SOURCE, kind: "ask" }, "*")
}

function youtubeToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.replace(/[^a-z0-9]/gi, "").slice(0, 32).padEnd(8, "0")
}

function fileForDownload(video: HTMLVideoElement | null): string | null {
  const offer = youtubeOfferForPage()
  if (offer) return offer.combinedUrl || offer.videoUrl
  if (!video) return null
  const direct = directMediaUrl(video)
  if (direct) return direct
  const group = matchedGroup(video)
  if (!group.length) return null
  const active = activeRendition(video, group)
  if (active && !active.audioUrl) return active.url
  const muxed = sortRenditions(group.filter((item) => item.url && !item.audioUrl))
  if (muxed.length) {
    const near = active ? muxed.find((item) => sizeNear(item.height, active.height)) : undefined
    return (near || muxed[0]).url
  }
  if (active?.url) return active.url
  return sortRenditions(group)[0]?.url || null
}

function paintQuality(video: HTMLVideoElement): void {
  const choices = choicesFor(video)
  const active = activeRendition(video, choices)
  const currentPath = active ? mediaPath(active.url) : ""
  const waiting = !catalogSeen && choices.length < 2
  if (qualityBtn) {
    const label = active ? qualityLabel(active, choices) : "Resolution"
    qualityBtn.setAttribute("aria-label", active ? `Resolution ${label}` : "Resolution")
  }
  const stamp = waiting
    ? "waiting"
    : `${choices.map((item) => `${item.height}:${item.width}:${item.url}:${item.audioUrl || ""}:${item.soundtrack || ""}`).join("|")}#${currentPath}`
  if (!qualityList || stamp === qualityStamp) return
  qualityStamp = stamp
  qualityList.replaceChildren()
  if (waiting) {
    const note = document.createElement("p")
    note.className = "vee-quality-pending"
    note.textContent = "Finding resolutions"
    qualityList.appendChild(note)
    return
  }
  for (const item of choices) {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.url = item.url
    const audio = item.audioUrl || item.soundtrack || ""
    if (audio) button.dataset.audio = audio
    button.textContent = qualityLabel(item, choices)
    button.dataset.on = String(mediaPath(item.url) === currentPath)
    qualityList.appendChild(button)
  }
}

const POST_CODE = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/
const RESERVED_CODE = /^(audio|explore|tags|locations|saved|accounts)$/i

function codeFromPath(pathname: string): string {
  const match = pathname.match(POST_CODE)
  if (!match || match[1].length < 5 || RESERVED_CODE.test(match[1])) return ""
  return match[1]
}

function codeFromHref(href: string): string {
  try {
    return codeFromPath(new URL(href, location.href).pathname)
  } catch {
    return ""
  }
}

function codesIn(root: ParentNode): string[] {
  const found = new Set<string>()
  for (const link of root.querySelectorAll("a[href*='/reel/'], a[href*='/reels/'], a[href*='/p/'], a[href*='/tv/']")) {
    if (!(link instanceof HTMLAnchorElement)) continue
    const code = codeFromHref(link.getAttribute("href") || "")
    if (code) found.add(code)
  }
  return [...found]
}

function timedCodeIn(root: ParentNode): string {
  let found = ""
  for (const link of root.querySelectorAll("a[href]")) {
    if (!(link instanceof HTMLAnchorElement) || !link.querySelector("time")) continue
    const code = codeFromHref(link.getAttribute("href") || "")
    if (!code) continue
    if (found && found !== code) return ""
    found = code
  }
  return found
}

/** Post linked from the smallest box that contains this video and no other. */
function codeInSingleVideoHost(video: HTMLVideoElement): string {
  let node: HTMLElement | null = video.parentElement
  for (let depth = 0; node && depth < 16 && node !== document.body && node !== document.documentElement; depth += 1) {
    if (node.querySelectorAll("video").length > 1) break
    const timed = timedCodeIn(node)
    if (timed) return timed
    const codes = codesIn(node)
    if (codes.length === 1) return codes[0]
    node = node.parentElement
  }
  return ""
}

/** Post link drawn on this video, when the reel feed does not wrap each clip. */
function codeOverlapping(video: HTMLVideoElement): string {
  const box = video.getBoundingClientRect()
  if (box.width < 40 || box.height < 40) return ""
  const root = video.closest("[role='dialog']") || video.closest("main") || document.body
  let best = ""
  let bestDistance = Number.POSITIVE_INFINITY
  let timed = ""
  let timedDistance = Number.POSITIVE_INFINITY
  const centerX = box.left + box.width / 2
  const centerY = box.top + box.height / 2
  for (const link of root.querySelectorAll("a[href*='/reel/'], a[href*='/reels/'], a[href*='/p/'], a[href*='/tv/']")) {
    if (!(link instanceof HTMLAnchorElement)) continue
    const code = codeFromHref(link.getAttribute("href") || "")
    if (!code) continue
    const linkBox = link.getBoundingClientRect()
    if (linkBox.width < 2 || linkBox.height < 2) continue
    const linkX = linkBox.left + linkBox.width / 2
    const linkY = linkBox.top + linkBox.height / 2
    const onVideo = linkX >= box.left && linkX <= box.right && linkY >= box.top - 96 && linkY <= box.bottom + 160
    if (!onVideo) continue
    const distance = (linkX - centerX) ** 2 + (linkY - centerY) ** 2
    if (link.querySelector("time") && distance < timedDistance) {
      timedDistance = distance
      timed = code
    }
    if (distance < bestDistance) {
      bestDistance = distance
      best = code
    }
  }
  return timed || best
}

function pageCodeFor(video: HTMLVideoElement): string {
  const code = codeFromPath(location.pathname)
  if (!code) return ""
  const videos = [...document.querySelectorAll("video")].filter((node) => node.isConnected)
  if (videos.length <= 1) return code
  let largest: HTMLVideoElement = video
  let area = 0
  for (const node of videos) {
    const rect = node.getBoundingClientRect()
    const size = Math.max(0, rect.width) * Math.max(0, rect.height)
    if (size > area) {
      area = size
      largest = node
    }
  }
  return largest === video ? code : ""
}

function mediaCode(video: HTMLVideoElement): string {
  if (instagramPage()) return pageCodeFor(video) || codeInSingleVideoHost(video) || codeOverlapping(video)
  return codeFromPath(location.pathname) || codeInSingleVideoHost(video)
}

function sharesClip(left: readonly Rendition[], right: readonly Rendition[]): boolean {
  const paths = new Set<string>()
  for (const item of left) {
    paths.add(mediaPath(item.url))
    for (const alias of item.aliases || []) paths.add(mediaPath(alias))
  }
  return right.some((item) => paths.has(mediaPath(item.url)) || item.aliases?.some((alias) => paths.has(mediaPath(alias))))
}

/** Keep the on-screen clip's files even when a later catalog snapshot dropped them. */
function noteActiveClip(video: HTMLVideoElement): void {
  if (!renditionHost()) return
  touchQualitySearch(video)
  if (instagramPage()) {
    const code = mediaCode(video)
    const path = playingPath(video, code)
    const stamp = `${location.pathname}|${code}|${path}`
    if (stamp !== heldStamp) {
      heldStamp = stamp
      postRenditionHold(code, path)
    }
  }
  if (qualityReady(video) || !qualitySearchAt) return
  if (performance.now() - qualitySearchAt >= QUALITY_SEARCH_MS) return
  const now = performance.now()
  if (qualityAskAt !== 0 && now - qualityAskAt < QUALITY_ASK_GAP_MS) return
  qualityAskAt = now
  postRenditionAsk()
}

function holding(video: HTMLVideoElement): boolean {
  return lockedVideo === video && lockedUrl !== ""
}

function movedAway(video: HTMLVideoElement): boolean {
  if (!lockedCode) return false
  const code = mediaCode(video)
  return code !== "" && code !== lockedCode
}

function releaseQuality(video: HTMLVideoElement | null, restore: boolean): void {
  const was = lockedVideo
  if (video && was && was !== video) return
  const token = qualityNonce
  qualityNonce = ""
  lockedUrl = ""
  lockedAudio = ""
  lockedCode = ""
  lockedVideo = null
  applyingQuality = false
  hideQualityWait()
  clearSidecar(video || was)
  const node = video || was
  if (node) node.removeAttribute(QUALITY_MARK)
  if (token) postRenditionDrop(token, restore)
}

function ensureSidecar(video: HTMLVideoElement): HTMLAudioElement {
  const existing = sidecars.get(video)
  if (existing) return existing
  const audio = document.createElement("audio")
  audio.preload = "auto"
  audio.setAttribute("data-vee-audio", "1")
  audio.setAttribute("aria-hidden", "true")
  audio.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none"
  document.documentElement.appendChild(audio)
  sidecars.set(video, audio)
  const follow = () => {
    if (!lockedAudio || lockedVideo !== video) return
    audio.playbackRate = video.playbackRate || 1
    if (audio.dataset.veeHoldMute === "1") return
    if (userHoldsMute()) {
      audio.muted = true
      return
    }
    audio.muted = video.muted
    audio.volume = video.volume
  }
  video.addEventListener("play", () => {
    follow()
    if (lockedAudio) void audio.play().catch(() => undefined)
  })
  video.addEventListener("pause", () => audio.pause())
  video.addEventListener("volumechange", follow)
  video.addEventListener("ratechange", follow)
  video.addEventListener("seeked", () => {
    if (!lockedAudio || lockedVideo !== video) return
    try {
      audio.currentTime = video.currentTime
    } catch {
      /* The soundtrack can reject a seek until it has metadata. */
    }
  })
  video.addEventListener("ended", () => audio.pause())
  audio.addEventListener("loadedmetadata", () => {
    if (lockedVideo !== video || !lockedAudio) return
    try {
      const at = video.currentTime || 0
      if (at > 0) audio.currentTime = at
    } catch {
      /* The soundtrack can reject a seek until it has metadata. */
    }
  })
  video.addEventListener("waiting", () => {
    if (lockedAudio && lockedVideo === video) audio.pause()
  })
  video.addEventListener("playing", () => {
    if (!lockedAudio || lockedVideo !== video) return
    try {
      audio.currentTime = video.currentTime
    } catch {
      /* The soundtrack can reject a seek until it has metadata. */
    }
    if (audio.paused) void audio.play().catch(() => undefined)
  })
  video.addEventListener("timeupdate", () => {
    if (!lockedAudio || lockedVideo !== video || video.paused) return
    const rate = video.playbackRate || 1
    const drift = (video.currentTime || 0) - (audio.currentTime || 0)
    if (Math.abs(drift) > 0.4) {
      audio.playbackRate = rate
      try {
        audio.currentTime = video.currentTime
      } catch {
        /* Ignore a seek the soundtrack is not ready for. */
      }
      return
    }
    // A seek costs about as much lag as it fixes, so small drift is closed by speed instead.
    audio.playbackRate = Math.abs(drift) > 0.04 ? rate * (1 + Math.max(-0.06, Math.min(0.06, drift))) : rate
  })
  return audio
}

function clearSidecar(video: HTMLVideoElement | null): void {
  audioEpoch += 1
  audioClean?.()
  audioClean = null
  lockedAudio = ""
  if (!video) return
  const audio = sidecars.get(video)
  if (!audio) return
  delete audio.dataset.veeHoldMute
  audio.pause()
  audio.removeAttribute("src")
  try {
    audio.load()
  } catch {
    /* Detaching the soundtrack can throw if the element is gone. */
  }
}

type ProbedVideo = HTMLVideoElement & {
  mozHasAudio?: boolean
  webkitAudioDecodedByteCount?: number
  audioTracks?: { length: number }
}

function onViewerInput(event: Event): void {
  if (event.isTrusted) lastViewerInput = performance.now()
}

/** Level captured at the switch, or the live one once the viewer changed it. */
function soundtrackLevelNow(video: HTMLVideoElement): { muted: boolean; volume: number } {
  const settings = readSettings()
  const policy = domainAudio(location.hostname)
  if (policy.holdUserMute && settings?.audioTouched && settings.muted && performance.now() - siteMuteClickAt >= 800) {
    return { muted: true, volume: settings.volume }
  }
  if (lastViewerInput > soundtrackSince) return { muted: video.muted, volume: video.volume }
  return soundtrackLevel
}

function noteAudioReady(): void {
  soundtrackReady = true
  waitClose?.()
}

/**
 * Instagram's quality files are often video-only. Play the separate soundtrack
 * with the picture, and drop it if this file already contains audio.
 */
function beginSoundtrack(
  video: HTMLVideoElement,
  audioUrl: string,
  wantPlay: boolean,
  at: number,
  muted = video.muted,
  volume = video.volume
): void {
  soundtrackLevel = { muted, volume }
  soundtrackSince = performance.now()
  const audio = ensureSidecar(video)
  const same =
    lockedAudio === audioUrl &&
    Boolean(audio.src) &&
    mediaPath(audio.src) === mediaPath(audioUrl) &&
    audio.dataset.veeHoldMute !== "1"
  lockedAudio = audioUrl
  if (same) {
    try {
      if (at > 0) audio.currentTime = at
    } catch {
      /* Metadata for the soundtrack may arrive after the picture. */
    }
    audio.muted = muted
    audio.volume = volume
    audio.playbackRate = video.playbackRate || 1
    if (wantPlay) void audio.play().catch(() => undefined)
    noteAudioReady()
    return
  }
  const epoch = ++audioEpoch
  soundtrackReady = false
  if (!audio.src || mediaPath(audio.src) !== mediaPath(audioUrl)) audio.src = audioUrl
  audio.playbackRate = video.playbackRate || 1
  audio.volume = volume
  const audible = !muted && volume > 0.001
  audio.muted = !audible
  try {
    if (at > 0) audio.currentTime = at
  } catch {
    /* Metadata for the soundtrack may arrive after the picture. */
  }
  if (wantPlay) void audio.play().catch(() => undefined)
  audio.dataset.veeHoldMute = "1"
  if (audible) {
    queueMicrotask(() => {
      if (epoch !== audioEpoch || audio.dataset.veeHoldMute !== "1") return
      audio.muted = true
    })
  }
  const alive = () => epoch === audioEpoch && lockedVideo === video && lockedAudio === audioUrl
  let baseBytes = 0
  let sawMetadata = false
  let metaEvent = false
  let sawPlaying = false
  const bytes = () => {
    const count = (video as ProbedVideo).webkitAudioDecodedByteCount
    return typeof count === "number" ? count : 0
  }
  const pictureAudio = (): boolean | null => {
    if (!sawMetadata) return null
    if (metaEvent) {
      const moz = (video as ProbedVideo).mozHasAudio
      if (typeof moz === "boolean") return moz
    }
    const tracks = (video as ProbedVideo).audioTracks
    if (tracks && tracks.length > 0) return true
    const now = bytes()
    if (now > baseBytes) return true
    if (baseBytes > 0 && now > 0 && now < baseBytes) return true
    return null
  }
  const finish = (hasPictureAudio: boolean) => {
    if (!alive()) return
    audioEpoch += 1
    cleanup()
    delete audio.dataset.veeHoldMute
    if (hasPictureAudio) {
      clearSidecar(video)
      noteAudioReady()
      return
    }
    const level = soundtrackLevelNow(video)
    if (video.muted !== level.muted) video.muted = level.muted
    try {
      if (Math.abs(video.volume - level.volume) > 0.02) video.volume = level.volume
    } catch {
      /* Ignore a volume the element rejects. */
    }
    audio.muted = level.muted
    audio.volume = level.volume
    try {
      const time = video.currentTime || 0
      if (time > 0) audio.currentTime = time
    } catch {
      /* The soundtrack can reject a seek until it has metadata. */
    }
    if (video.getAttribute(USER_PAUSE_MARK) !== "1" && !video.ended && (wantPlay || !video.paused)) {
      void audio.play().catch(() => undefined)
    }
    noteAudioReady()
  }
  const consider = (force: boolean) => {
    if (!alive()) return
    const known = pictureAudio()
    if (known === true) {
      finish(true)
      return
    }
    const playingNow = !video.paused && !video.ended && video.readyState >= 2
    if (known === false || (force && sawMetadata && (sawPlaying || playingNow))) finish(false)
  }
  const onMeta = () => {
    if (!alive()) return
    const live = video.currentSrc || video.src || ""
    if (lockedUrl && mediaPath(live) !== mediaPath(lockedUrl)) return
    metaEvent = true
    sawMetadata = true
    baseBytes = bytes()
    consider(false)
  }
  let playingTimer = 0
  const onPlaying = () => {
    if (!alive()) return
    sawPlaying = true
    playingTimer = window.setTimeout(() => consider(true), 450)
  }
  const onError = () => {
    if (!alive() || audio.error?.code === MediaError.MEDIA_ERR_ABORTED) return
    clearSidecar(video)
    noteAudioReady()
  }
  let cleaned = false
  const probeTimer = window.setTimeout(() => consider(true), 2500)
  function cleanup(): void {
    if (cleaned) return
    cleaned = true
    window.clearTimeout(probeTimer)
    window.clearTimeout(playingTimer)
    video.removeEventListener("loadedmetadata", onMeta)
    video.removeEventListener("playing", onPlaying)
    audio.removeEventListener("error", onError)
    if (audioClean === cleanup) audioClean = null
  }
  audioClean = cleanup
  video.addEventListener("loadedmetadata", onMeta)
  video.addEventListener("playing", onPlaying)
  audio.addEventListener("error", onError)
  const liveNow = video.currentSrc || video.src || ""
  if (video.readyState >= 1 && (!lockedUrl || mediaPath(liveNow) === mediaPath(lockedUrl))) {
    sawMetadata = true
    baseBytes = bytes()
  }
  if (!video.paused && !video.ended && video.readyState >= 2) {
    sawPlaying = true
    playingTimer = window.setTimeout(() => consider(true), 450)
  }
}

function hideQualityWait(): void {
  waitEpoch += 1
  waitClose = null
  waitClean?.()
  waitClean = null
  if (waitFrame) cancelAnimationFrame(waitFrame)
  waitFrame = 0
  if (waitTimer) window.clearTimeout(waitTimer)
  waitTimer = 0
  document.getElementById(QUALITY_WAIT_ID)?.remove()
}

function showQualityWait(video: HTMLVideoElement, wantPlay: boolean, waitForAudio: boolean): void {
  hideQualityWait()
  if (!waitForAudio) soundtrackReady = true
  const epoch = waitEpoch
  ensureStyle()
  const node = document.createElement("div")
  node.id = QUALITY_WAIT_ID
  node.setAttribute("role", "status")
  node.setAttribute("aria-live", "polite")
  node.setAttribute("aria-label", "Loading")
  node.innerHTML = '<div class="vee-wait-spin"></div><span>Loading</span>'
  document.documentElement.appendChild(node)
  const place = () => {
    if (epoch !== waitEpoch) return
    const overlay = document.getElementById(QUALITY_WAIT_ID)
    if (!overlay || !video.isConnected) {
      hideQualityWait()
      return
    }
    const rect = video.getBoundingClientRect()
    overlay.style.left = `${rect.left}px`
    overlay.style.top = `${rect.top}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
    waitFrame = requestAnimationFrame(place)
  }
  place()
  let pictureReady = false
  const close = () => {
    if (epoch !== waitEpoch || !soundtrackReady || !pictureReady) return
    hideQualityWait()
  }
  waitClose = close
  const markReady = () => {
    if (epoch !== waitEpoch) return
    const live = video.currentSrc || video.src || ""
    if (!lockedUrl || mediaPath(live) !== mediaPath(lockedUrl)) return
    const userPaused = video.getAttribute(USER_PAUSE_MARK) === "1"
    if (video.readyState < 2) return
    if (wantPlay && !userPaused && (video.paused || video.ended)) return
    pictureReady = true
    close()
  }
  video.addEventListener("playing", markReady)
  video.addEventListener("canplay", markReady)
  video.addEventListener("seeked", markReady)
  waitClean = () => {
    video.removeEventListener("playing", markReady)
    video.removeEventListener("canplay", markReady)
    video.removeEventListener("seeked", markReady)
  }
  waitTimer = window.setTimeout(() => {
    if (epoch !== waitEpoch) return
    const audio = sidecars.get(video)
    if (audio?.dataset.veeHoldMute === "1" && lockedAudio) {
      delete audio.dataset.veeHoldMute
      const level = soundtrackLevelNow(video)
      audio.muted = level.muted
      audio.volume = level.volume
      if (wantPlay) void audio.play().catch(() => undefined)
    }
    soundtrackReady = true
    pictureReady = true
    hideQualityWait()
  }, 12000)
  markReady()
}

function hookHistory(): void {
  if (historyHooked) return
  historyHooked = true
  const wrap = (original: typeof history.pushState) =>
    function (this: History, ...args: Parameters<typeof history.pushState>) {
      const before = location.pathname
      const result = original.apply(this, args)
      if (location.pathname !== before) {
        releaseQuality(lockedVideo, true)
        postRenditionAsk()
      }
      return result
    }
  history.pushState = wrap(history.pushState)
  history.replaceState = wrap(history.replaceState)
  window.addEventListener("popstate", () => releaseQuality(lockedVideo, true))
}

function renditionBelongs(video: HTMLVideoElement, url: string): boolean {
  if (!instagramPage()) return true
  const groups = groupsWithPath(mediaPath(url)).filter((group) => !group.some((item) => item.code) || Boolean(groupCode(group)))
  if (!groups.length) return false
  const code = mediaCode(video)
  if (code) return groups.some((group) => groupCode(group) === code)
  return groups.length === 1
}

function applyQuality(video: HTMLVideoElement, url: string, audioUrl = ""): void {
  if (!renditionBelongs(video, url)) return
  const live = video.currentSrc || video.src
  if (live && mediaPath(live) === mediaPath(url) && lockedAudio === audioUrl && lockedVideo === video) return
  const wantPlay = !video.paused && !video.ended
  const time = video.currentTime || 0
  const settings = readSettings()
  const heldMute = domainAudio(location.hostname).holdUserMute && !!settings?.audioTouched && !!settings.muted
  const muted = heldMute ? true : video.muted
  const volume = heldMute && settings ? settings.volume : video.volume
  const rate = video.playbackRate || 1
  const token = String(++qualityToken)
  qualityNonce = token
  video.setAttribute(QUALITY_MARK, token)
  video.removeAttribute(USER_PAUSE_MARK)
  rememberedSrc.set(video, url)
  startedPath.set(video, mediaPath(url))
  lockedVideo = video
  lockedUrl = url
  lockedCode = mediaCode(video)
  applyingQuality = true
  postRenditionUse({
    token,
    url,
    audioUrl,
    time,
    paused: !wantPlay,
    ended: video.ended,
    rate,
    muted,
    volume
  })
  if (wantPlay) void video.play().catch(() => undefined)
  if (audioUrl) beginSoundtrack(video, audioUrl, wantPlay, time, muted, volume)
  else clearSidecar(video)
  showQualityWait(video, wantPlay, Boolean(audioUrl) && wantPlay)
}

function onQualityResult(message: RenditionMessage): void {
  if (!message.token || message.token !== qualityNonce) return
  const video = lockedVideo
  applyingQuality = false
  if (message.kind === "failed") {
    qualityNonce = ""
    if (video) {
      rememberedSrc.delete(video)
      video.removeAttribute(QUALITY_MARK)
    }
    lockedUrl = ""
    lockedAudio = ""
    lockedCode = ""
    lockedVideo = null
    hideQualityWait()
    clearSidecar(video)
    paintControls()
    return
  }
  if (video && message.audioUrl && lockedAudio !== message.audioUrl) {
    beginSoundtrack(video, message.audioUrl, !video.paused && !video.ended, video.currentTime || 0)
  }
  paintControls()
}

async function downloadCurrent(): Promise<void> {
  if (downloadBusy) return
  const offer = youtubeOfferForPage()
  if (offer) {
    if (!downloadBtn) return
    downloadBusy = true
    markAct()
    downloadBtn.title = "Downloading"
    try {
      let current = offer
      let saved = false
      if (current.combinedUrl) {
        saved = await saveRemoteFile(current.combinedUrl, current.title || downloadTitle(boundVideo))
        if (!saved) {
          const next = await refreshPlayerOffer(current.combinedUrl)
          if (next?.combinedUrl) {
            current = next
            saved = await saveRemoteFile(next.combinedUrl, next.title || downloadTitle(boundVideo))
          }
        }
      }
      if (!saved) {
        const bytes = await assembleDownload(current, loadYoutubePlayback)
        saved = await saveDownloadBytes(bytes, downloadFilename(current.title || downloadTitle(boundVideo), "https://example.com/video.mp4"))
      }
      if (downloadBtn) downloadBtn.title = saved ? "Download started" : "Could not save this video"
    } catch {
      if (downloadBtn) downloadBtn.title = "Could not save this video"
    } finally {
      downloadBusy = false
    }
    return
  }
  const url = fileForDownload(boundVideo)
  if (!url || !downloadBtn) return
  downloadBusy = true
  markAct()
  downloadBtn.title = "Downloading"
  try {
    const response = await chrome.runtime.sendMessage({
      type: DOWNLOAD_MESSAGE,
      url,
      title: downloadTitle(boundVideo)
    })
    downloadBtn.title = response?.ok ? "Download started" : "Could not save this video"
  } catch {
    downloadBtn.title = "Could not save this video"
  } finally {
    downloadBusy = false
  }
}

async function loadYoutubePlayback(url: string): Promise<Uint8Array> {
  const ranged = fullRangeUrl(url)
  const candidates = ranged && ranged !== url ? [url, ranged] : [url]
  let last: unknown = new Error("media")
  for (const candidate of candidates) {
    try {
      return await loadYoutubeCandidate(candidate)
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error("media")
}

async function loadYoutubeCandidate(url: string): Promise<Uint8Array> {
  let last: unknown = new Error("media")
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const bytes = await fetchYoutubeFromPage(url)
      if (bytes) return bytes
    } catch (error) {
      last = error
    }
    try {
      return await readYoutubeBody(await fetch(url, { credentials: "omit" }))
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error("media")
}

async function readYoutubeBody(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(String(response.status))
  const length = Number(response.headers.get("content-length") || "")
  if (Number.isFinite(length) && length > 500_000_000) throw new Error("large")
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 500_000_000 || !isIsoBmff(bytes)) throw new Error("media")
  return bytes
}

function fetchYoutubeFromPage(url: string): Promise<Uint8Array | null> {
  const safe = allowedFetchUrl(url)
  if (!safe) return Promise.resolve(null)
  const token = youtubeToken()
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pendingYoutubeFetch.delete(token)
      resolve(null)
    }, 180_000)
    pendingYoutubeFetch.set(token, (bytes) => {
      window.clearTimeout(timer)
      pendingYoutubeFetch.delete(token)
      resolve(bytes)
    })
    window.postMessage({ source: YT_MEDIA_SOURCE, kind: "fetch", token, url: safe }, "*")
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const step = 0x2000
  for (let index = 0; index < bytes.length; index += step) {
    const slice = bytes.subarray(index, index + step)
    binary += String.fromCharCode.apply(null, slice as unknown as number[])
  }
  return btoa(binary)
}

function saveDownloadBytes(bytes: Uint8Array, filename: string): Promise<boolean> {
  return chrome.runtime
    .sendMessage({ type: SAVE_BYTES_MESSAGE, filename, data: bytesToBase64(bytes) })
    .then((response) => response?.ok === true)
    .catch(() => false)
}

function onRenditionMessage(event: MessageEvent): void {
  if (event.source !== window) return
  const fetched = readYtFetchResult(event.data)
  if (fetched) {
    const bytes = fetched.buffer ? new Uint8Array(fetched.buffer) : null
    pendingYoutubeFetch.get(fetched.token)?.(bytes && isIsoBmff(bytes) ? bytes : null)
    return
  }
  const offer = readYtOffer(event.data)
  if (offer) {
    ytOffer = offer
    paintControls()
    return
  }
  const message = readRenditionMessage(event.data)
  if (!message) return
  if (message.kind === "used" || message.kind === "failed") {
    onQualityResult(message)
    return
  }
  if (message.kind !== "list") return
  catalogSeen = true
  const incoming = message.groups ?? []
  const pinned = boundVideo ? pinnedGroup.get(boundVideo) : undefined
  renditionGroups = incoming
  if (pinned && !incoming.some((group) => sharesClip(group, pinned) || sameClipGroup(group, pinned))) {
    renditionGroups = [...incoming, pinned]
  }
  if (message.played && message.played.length > 0) playedPaths = message.played
  if (message.batch && message.batch.length > 0) {
    latestBatch = message.batch
    latestAt = performance.now()
  }
  qualityStamp = ""
  paintControls()
}

function popDirection(place: DockPlacement): "up" | "down" | "left" | "right" {
  if (place.slot === "custom") {
    if (place.x < 22) return "right"
    if (place.x > 78) return "left"
    return place.y < 40 ? "down" : "up"
  }
  if (place.edge === "top") return "down"
  if (place.edge === "left") return "right"
  if (place.edge === "right") return "left"
  return "up"
}

function packFor(edge: DockEdge, slot: DockSlot): HTMLDivElement {
  const key = `${edge}:${slot}`
  let node = packNodes.get(key)
  if (!node) {
    node = document.createElement("div")
    node.className = "vee-pack"
    node.dataset.edge = edge
    node.dataset.slot = slot
    packNodes.set(key, node)
  }
  if (root && node.parentElement !== root) root.appendChild(node)
  return node
}

function clearPin(el: HTMLElement): void {
  el.style.left = ""
  el.style.top = ""
  el.style.right = ""
  el.style.bottom = ""
  el.style.transform = ""
}

function pinCustom(el: HTMLElement, place: DockPlacement): void {
  if (root && el.parentElement !== root) root.appendChild(el)
  el.style.left = `${place.x}%`
  el.style.top = `${place.y}%`
  el.style.right = "auto"
  el.style.bottom = "auto"
  el.style.transform = "translate(-50%, -50%)"
}

function placeTrack(place: DockPlacement, shown: boolean): void {
  if (!hit) return
  hit.hidden = !shown
  if (tipEl) {
    tipEl.hidden = !shown
    if (!shown) tipEl.textContent = ""
  }
  const horizontal = place.edge === "top" || place.edge === "bottom"
  hit.dataset.axis = horizontal ? "x" : "y"
  hit.style.left = "auto"
  hit.style.right = "auto"
  hit.style.top = "auto"
  hit.style.bottom = "auto"
  hit.style.width = ""
  hit.style.height = ""
  hit.style.transform = ""
  if (!shown) return
  const custom = place.slot === "custom"
  if (horizontal) {
    const size = custom ? Math.max(24, 100 - place.x) : 100
    const x = custom ? Math.min(place.x, 100 - size) : 0
    hit.style.left = `${x}%`
    hit.style.width = `${size}%`
    hit.style.height = `${HIT_HEIGHT_PX}px`
    if (place.edge === "bottom") {
      hit.style.top = `${custom ? place.y : 100}%`
      hit.style.transform = "translateY(-100%)"
    } else {
      hit.style.top = `${custom ? place.y : 0}%`
    }
    return
  }
  const size = custom ? Math.max(24, 100 - place.y) : 100
  const y = custom ? Math.min(place.y, 100 - size) : 0
  hit.style.top = `${y}%`
  hit.style.height = `${size}%`
  hit.style.width = `${HIT_HEIGHT_PX}px`
  if (!custom && place.edge === "right") {
    hit.style.left = "auto"
    hit.style.right = "0"
    return
  }
  if (!custom) {
    hit.style.left = "0"
    return
  }
  hit.style.left = `${place.x}%`
  hit.style.transform = "translateX(-50%)"
}

function paintSkipIcons(): void {
  if (!backBtn || !forwardBtn) return
  if (root?.dataset.skin === "youtube") {
    setIcon(backBtn, "back10", ICON_BACK_10)
    setIcon(forwardBtn, "fwd10", ICON_FORWARD_10)
    return
  }
  setIcon(backBtn, "back", ICON_BACK)
  setIcon(forwardBtn, "forward", ICON_FORWARD)
}

function applyChromeSkin(video: HTMLVideoElement | null): void {
  if (!root) return
  const ctx = dockContextOf(video)
  const skin = domainSkin(location.hostname, ctx.pathname)
  const shape = domainShape(location.hostname, ctx)
  const chrome = domainChrome(location.hostname)
  const place = domainPlace(location.hostname, ctx)
  if (skin === "default") delete root.dataset.skin
  else root.dataset.skin = skin
  if (!shape) delete root.dataset.shape
  else root.dataset.shape = shape
  if (!place) delete root.dataset.place
  else root.dataset.place = place
  if (!chrome) {
    delete root.dataset.chrome
    root.style.removeProperty("--vee-icon")
    root.style.removeProperty("--vee-active")
    root.style.removeProperty("--vee-hover")
    return
  }
  root.dataset.chrome = "flat"
  root.style.setProperty("--vee-icon", `${chrome.icon}px`)
  root.style.setProperty("--vee-active", chrome.active)
  root.style.setProperty("--vee-hover", chrome.hover)
}

function clearPackAnchor(node: HTMLElement): void {
  if (node.dataset.anchored !== "true") return
  node.style.top = ""
  node.style.bottom = ""
  node.style.left = ""
  node.style.right = ""
  node.style.transform = ""
  delete node.dataset.anchored
}

function placePack(
  node: HTMLElement,
  box: { top?: number; bottom?: number; left?: number; right?: number; transform?: string }
): void {
  node.style.top = box.top == null ? "auto" : `${Math.round(box.top)}px`
  node.style.bottom = box.bottom == null ? "auto" : `${Math.round(box.bottom)}px`
  node.style.left = box.left == null ? "auto" : `${Math.round(box.left)}px`
  node.style.right = box.right == null ? "auto" : `${Math.round(box.right)}px`
  node.style.transform = box.transform ?? ""
  node.dataset.anchored = "true"
}

let reelSearchCache: { at: number; node: HTMLElement | null } | null = null

/** Facebook reel search control sitting on the right side of the video. */
function findReelSearch(video: HTMLVideoElement): HTMLElement | null {
  const now = performance.now()
  if (reelSearchCache && now - reelSearchCache.at < 400) {
    if (!reelSearchCache.node || reelSearchCache.node.isConnected) return reelSearchCache.node
  }
  const videoBox = video.getBoundingClientRect()
  if (videoBox.width < 40 || videoBox.height < 40) return null
  const nodes = document.querySelectorAll<HTMLElement>("button[aria-label], [role='button'][aria-label], a[aria-label]")
  let best: HTMLElement | null = null
  let bestTop = Infinity
  for (const node of nodes) {
    const label = node.getAttribute("aria-label") || ""
    if (!/^search\b/i.test(label)) continue
    const box = node.getBoundingClientRect()
    if (box.width < 8 || box.height < 8) continue
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    const onVideo =
      cx >= videoBox.left && cx <= videoBox.right && cy >= videoBox.top && cy <= videoBox.bottom
    if (!onVideo || cx < videoBox.left + videoBox.width * 0.55) continue
    if (box.top < bestTop) {
      best = node
      bestTop = box.top
    }
  }
  reelSearchCache = { at: now, node: best }
  return best
}

const CLUSTER_GAP_PX = 36
const ANCHOR_PAD_PX = 8

let nativeCache: { at: number; key: string; nodes: HTMLElement[] } | null = null

function listedControls(scope: ParentNode): HTMLElement[] {
  const found = [...scope.querySelectorAll<HTMLElement>("button, [role='button']")]
  for (const host of scope.querySelectorAll("*")) {
    if (host.id === DOCK_HOST_ID || host.id === SEEK_BAR_ID || host.id === FS_SHELL_ID) continue
    const shadow = host.shadowRoot
    if (!shadow) continue
    found.push(...shadow.querySelectorAll<HTMLElement>("button, [role='button']"))
  }
  return found
}

function playerShell(video: HTMLVideoElement): HTMLElement {
  let best: HTMLElement = video.parentElement instanceof HTMLElement ? video.parentElement : video
  let node: HTMLElement | null = best
  const videoBox = video.getBoundingClientRect()
  for (let depth = 0; depth < 10 && node; depth += 1) {
    if (node === document.body || node === document.documentElement) break
    const box = node.getBoundingClientRect()
    const contains =
      box.width >= videoBox.width - 4 &&
      box.height >= videoBox.height - 4 &&
      box.left <= videoBox.left + 8 &&
      box.top <= videoBox.top + 8
    if (contains) best = node
    node = node.parentElement
  }
  return best
}

function nativeControls(video: HTMLVideoElement): HTMLElement[] {
  const now = performance.now()
  const key = `${location.hostname}${location.pathname}`
  if (nativeCache && nativeCache.key === key && now - nativeCache.at < 400) {
    return nativeCache.nodes.filter((node) => node.isConnected)
  }
  const bar = video.getBoundingClientRect()
  const shell = playerShell(video)
  const nodes = listedControls(shell)
  const found: HTMLElement[] = []
  for (const node of nodes) {
    if (root?.contains(node)) continue
    const box = node.getBoundingClientRect()
    if (box.width < 10 || box.height < 10 || box.width > 180 || box.height > 72) continue
    if (box.right < bar.left - 8 || box.left > bar.right + 8) continue
    if (box.bottom < bar.top - 160 || box.top > bar.bottom + 160) continue
    const style = getComputedStyle(node)
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue
    found.push(node)
  }
  nativeCache = { at: now, key, nodes: found }
  return found
}

function rightCluster(nodes: HTMLElement[]): HTMLElement[] {
  if (nodes.length === 0) return []
  const sorted = [...nodes].sort(
    (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
  )
  const groups: HTMLElement[][] = [[sorted[0]]]
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1].getBoundingClientRect()
    const box = sorted[index].getBoundingClientRect()
    if (box.left - prev.right > CLUSTER_GAP_PX) groups.push([sorted[index]])
    else groups[groups.length - 1].push(sorted[index])
  }
  return groups[groups.length - 1]
}

function inBand(node: HTMLElement, bar: DOMRect, band: "top" | "bottom" | "right"): boolean {
  const box = node.getBoundingClientRect()
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  if (band === "top") {
    return cy >= bar.top - 80 && cy <= bar.top + Math.min(72, bar.height * 0.2) && cx >= bar.left + bar.width * 0.4
  }
  if (band === "bottom") {
    return (
      cy >= bar.bottom - Math.min(96, bar.height * 0.24) &&
      cy <= bar.bottom + 160 &&
      cx >= bar.left + bar.width * 0.58
    )
  }
  return cx >= bar.left + bar.width * 0.72 && cx <= bar.right + 4 && cy >= bar.top && cy <= bar.top + bar.height * 0.55
}

function pinLeftOf(pack: HTMLElement | undefined, anchor: HTMLElement, bar: DOMRect): void {
  if (!pack || pack.hidden) return
  const box = anchor.getBoundingClientRect()
  const height = pack.offsetHeight || 36
  placePack(pack, {
    top: box.top + box.height / 2 - bar.top - height / 2,
    right: bar.right - box.left + ANCHOR_PAD_PX
  })
}

let clockCache: { at: number; key: string; node: HTMLElement | null } | null = null
let copyCache: { at: number; key: string; node: HTMLElement | null } | null = null
let markCache: { at: number; key: string; nodes: HTMLElement[] } | null = null

function scanFresh(cache: { at: number; key: string } | null): boolean {
  return !!cache && cache.key === `${location.hostname}${location.pathname}` && performance.now() - cache.at < 400
}

function findTopClock(shell: HTMLElement, bar: DOMRect): HTMLElement | null {
  if (scanFresh(clockCache) && (!clockCache?.node || clockCache.node.isConnected)) return clockCache?.node ?? null
  const nodes = shell.querySelectorAll<HTMLElement>("span, div, p")
  let best: HTMLElement | null = null
  let bestTop = Infinity
  for (const node of nodes) {
    if (root?.contains(node) || node.childElementCount > 2) continue
    const text = (node.textContent || "").replace(/\s+/g, " ").trim()
    if (!/^\d{1,2}:\d{2}(?:\s*\/\s*\d{1,2}:\d{2})?$/.test(text)) continue
    const box = node.getBoundingClientRect()
    if (box.width < 8 || box.height < 8 || box.width > 160) continue
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    if (cy < bar.top || cy > bar.top + bar.height * 0.22) continue
    if (cx < bar.left + bar.width * 0.28 || cx > bar.left + bar.width * 0.72) continue
    if (box.top < bestTop) {
      best = node
      bestTop = box.top
    }
  }
  clockCache = { at: performance.now(), key: `${location.hostname}${location.pathname}`, node: best }
  return best
}

function findBottomCopy(shell: HTMLElement, bar: DOMRect): HTMLElement | null {
  if (scanFresh(copyCache) && (!copyCache?.node || copyCache.node.isConnected)) return copyCache?.node ?? null
  const nodes = shell.querySelectorAll<HTMLElement>("span, a, div")
  let best: HTMLElement | null = null
  let bestTop = Infinity
  for (const node of nodes) {
    if (root?.contains(node) || node.childElementCount > 3) continue
    const text = (node.textContent || "").trim()
    if (text.length < 2 || text.length > 80) continue
    const box = node.getBoundingClientRect()
    if (box.width < 40 || box.height < 10 || box.height > 48) continue
    if (box.top < bar.top + bar.height * 0.58) continue
    if (box.left > bar.left + bar.width * 0.55) continue
    if (box.top < bestTop) {
      best = node
      bestTop = box.top
    }
  }
  copyCache = { at: performance.now(), key: `${location.hostname}${location.pathname}`, node: best }
  return best
}

function findCornerButton(nodes: HTMLElement[], bar: DOMRect): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const node of nodes) {
    const box = node.getBoundingClientRect()
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    if (cy > bar.top + bar.height * 0.18 || cx < bar.left + bar.width * 0.72) continue
    const score = bar.right - box.right + (box.top - bar.top)
    if (score < bestScore) {
      best = node
      bestScore = score
    }
  }
  return best
}

let pageControlCache: { at: number; key: string; nodes: HTMLElement[] } | null = null

/** Buttons on the page, including a control bar portaled outside the player. */
function pageControls(video: HTMLVideoElement): HTMLElement[] {
  const now = performance.now()
  const key = `${location.hostname}${location.pathname}`
  if (pageControlCache && pageControlCache.key === key && now - pageControlCache.at < 400) {
    return pageControlCache.nodes.filter((node) => node.isConnected)
  }
  const bar = video.getBoundingClientRect()
  const nodes = listedControls(document.body)
  const found: HTMLElement[] = []
  for (const node of nodes) {
    if (root?.contains(node)) continue
    const box = node.getBoundingClientRect()
    if (box.width < 10 || box.height < 10 || box.width > 220 || box.height > 80) continue
    if (box.right < bar.left - 8 || box.left > bar.right + 24) continue
    if (box.bottom < bar.top || box.top > bar.bottom + 80) continue
    const style = getComputedStyle(node)
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue
    found.push(node)
  }
  pageControlCache = { at: now, key, nodes: found }
  return found
}

function pinBottomRightCluster(video: HTMLVideoElement): void {
  const pack = packNodes.get("bottom:end")
  const bar = root?.getBoundingClientRect()
  if (!pack || pack.hidden || !bar) return
  const nodes = root?.dataset.place === "facebook-watch" ? pageControls(video) : nativeControls(video)
  const cluster = rightCluster(nodes.filter((node) => inBand(node, bar, "bottom")))
  const anchor = cluster[0]
  if (!anchor) return
  pinLeftOf(pack, anchor, bar)
}

function pinPrime(video: HTMLVideoElement): void {
  const pack = packNodes.get("top:end")
  const bar = root?.getBoundingClientRect()
  if (!pack || pack.hidden || !bar) return
  const cluster = rightCluster(nativeControls(video).filter((node) => inBand(node, bar, "top")))
  const anchor = cluster[0]
  if (!anchor) return
  pinLeftOf(pack, anchor, bar)
}

function onRightRail(node: HTMLElement, bar: DOMRect): boolean {
  const box = node.getBoundingClientRect()
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  return cx >= bar.left + bar.width * 0.72 && cx <= bar.right + 8 && cy >= bar.top + 8 && cy <= bar.bottom - 8
}

function reelRightMarks(shell: HTMLElement, bar: DOMRect): HTMLElement[] {
  if (scanFresh(markCache)) return (markCache?.nodes ?? []).filter((node) => node.isConnected)
  const marks: HTMLElement[] = []
  const nodes = shell.querySelectorAll<HTMLElement>("button, [role='button'], span, div")
  for (const node of nodes) {
    if (root?.contains(node)) continue
    const box = node.getBoundingClientRect()
    if (box.width < 8 || box.height < 8 || box.width > 80 || box.height > 72) continue
    if (!onRightRail(node, bar)) continue
    const text = (node.textContent || "").trim()
    const rate = /^\d+(\.\d+)?x$/i.test(text)
    const button = node.tagName === "BUTTON" || node.getAttribute("role") === "button"
    if (!rate && !button) continue
    if (!button && node.childElementCount > 1) continue
    marks.push(node)
  }
  markCache = { at: performance.now(), key: `${location.hostname}${location.pathname}`, nodes: marks }
  return marks
}

function pinFacebookReel(video: HTMLVideoElement): void {
  const bar = root?.getBoundingClientRect()
  if (!bar) return
  const shell = playerShell(video)
  const clock = findTopClock(shell, bar)
  const timePack = packNodes.get("top:center")
  if (clock && timePack && !timePack.hidden) {
    const box = clock.getBoundingClientRect()
    placePack(timePack, {
      top: box.bottom - bar.top + 6,
      left: bar.width / 2,
      transform: "translateX(-50%)"
    })
  }
  const stack = packNodes.get("right:end")
  if (!stack || stack.hidden) return
  let lowest: HTMLElement | null = null
  let lowestBottom = -Infinity
  for (const node of reelRightMarks(shell, bar)) {
    const box = node.getBoundingClientRect()
    if (box.bottom > lowestBottom) {
      lowest = node
      lowestBottom = box.bottom
    }
  }
  const copy = findBottomCopy(shell, bar)
  const railRight = lowest ? Math.max(8, bar.right - lowest.getBoundingClientRect().right) : 12
  if (lowest && copy) {
    const lowBox = lowest.getBoundingClientRect()
    const copyBox = copy.getBoundingClientRect()
    const gapTop = lowBox.bottom - bar.top + 10
    const captionTop = copyBox.top - bar.top
    const stackHeight = stack.offsetHeight || 120
    if (gapTop + stackHeight < captionTop - 8) {
      placePack(stack, { top: gapTop, right: railRight })
      return
    }
    placePack(stack, {
      bottom: bar.bottom - copyBox.top + 8,
      right: railRight
    })
    return
  }
  if (lowest) {
    placePack(stack, {
      top: lowest.getBoundingClientRect().bottom - bar.top + 10,
      right: railRight
    })
    return
  }
  const search = findReelSearch(video)
  if (!search) return
  const box = search.getBoundingClientRect()
  placePack(stack, {
    top: box.bottom - bar.top + 10,
    right: Math.max(8, bar.right - box.right)
  })
}

function pinInstagram(video: HTMLVideoElement): void {
  const bar = root?.getBoundingClientRect()
  if (!bar) return
  const shell = playerShell(video)
  const full = packNodes.get("top:end")
  const corner = findCornerButton(nativeControls(video), bar)
  if (corner && full && !full.hidden) {
    const box = corner.getBoundingClientRect()
    placePack(full, {
      top: box.top - bar.top,
      right: bar.right - box.left + ANCHOR_PAD_PX
    })
  }
  const row = packNodes.get("bottom:start")
  const copy = findBottomCopy(shell, bar)
  if (!copy || !row || row.hidden) return
  const box = copy.getBoundingClientRect()
  placePack(row, {
    bottom: bar.bottom - box.top + 8,
    left: 12
  })
}

function pinPresetAnchor(video: HTMLVideoElement | null): void {
  for (const node of packNodes.values()) clearPackAnchor(node)
  if (!root || !video) return
  const place = root.dataset.place || ""
  if (place === "facebook-reel") pinFacebookReel(video)
  else if (place === "instagram") pinInstagram(video)
  else if (place === "prime") pinPrime(video)
  else if (place === "bottom-cluster" || place === "facebook-watch") pinBottomRightCluster(video)
  for (const node of packNodes.values()) {
    if (!node.hidden) keepPackInside(node)
  }
}

function nudgePack(pack: HTMLElement, prop: "top" | "bottom" | "left" | "right", delta: number): void {
  if (!delta) return
  const value = parseFloat(pack.style[prop])
  if (!Number.isFinite(value)) return
  pack.style[prop] = `${Math.round(value + delta)}px`
}

function keepPackInside(pack: HTMLElement): void {
  const bar = root?.getBoundingClientRect()
  if (!bar) return
  const box = pack.getBoundingClientRect()
  const pad = 8
  let shiftX = 0
  let shiftY = 0
  if (box.left < bar.left + pad) shiftX = bar.left + pad - box.left
  else if (box.right > bar.right - pad) shiftX = bar.right - pad - box.right
  if (box.top < bar.top + pad) shiftY = bar.top + pad - box.top
  else if (box.bottom > bar.bottom - pad) shiftY = bar.bottom - pad - box.bottom
  if (!shiftX && !shiftY) return
  nudgePack(pack, "top", shiftY)
  nudgePack(pack, "bottom", -shiftY)
  nudgePack(pack, "left", shiftX)
  nudgePack(pack, "right", -shiftX)
}

function fitQualityPop(): void {
  if (!qualityPop || !qualityAnchor || !root || qualityPop.dataset.open !== "true") return
  const bar = root.getBoundingClientRect()
  const pad = 6
  const box = qualityPop.getBoundingClientRect()
  if (box.left < bar.left + pad && qualityAnchor.dataset.out === "left") qualityAnchor.dataset.out = "down"
  else if (box.right > bar.right - pad && qualityAnchor.dataset.out === "right") qualityAnchor.dataset.out = "down"
  const placed = qualityPop.getBoundingClientRect()
  if (placed.bottom > bar.bottom - pad && qualityAnchor.dataset.out !== "up") qualityAnchor.dataset.out = "up"
  else if (placed.top < bar.top + pad && qualityAnchor.dataset.out !== "down") qualityAnchor.dataset.out = "down"
  const next = qualityPop.getBoundingClientRect()
  if (next.right > bar.right - pad) qualityAnchor.dataset.align = "end"
  else if (next.left < bar.left + pad) qualityAnchor.dataset.align = "start"
}

function layoutSignature(settings: EffectSettings): string {
  const order = domainIconOrder(location.hostname, dockContextOf(boundVideo))
  const parts = [`${location.hostname}${location.pathname}`]
  for (const id of order) {
    const place = settings.dockLayout[id]
    parts.push(`${id}:${controlShown(id, settings) ? 1 : 0}:${place.edge}:${place.slot}:${place.x}:${place.y}`)
  }
  parts.push(settings.dockProgress ? "progress" : "")
  return parts.join("|")
}

function layoutControls(settings: EffectSettings): void {
  if (!root) return
  const signature = layoutSignature(settings)
  if (signature === layoutStamp) return
  layoutStamp = signature
  for (const node of packNodes.values()) node.replaceChildren()
  const progress = settings.dockLayout.progress
  const liftEdge = settings.dockProgress && progress.slot !== "custom" ? progress.edge : ""
  const order = domainIconOrder(location.hostname, dockContextOf(boundVideo))
  for (const id of order) {
    const el = controlNodes.get(id)
    if (!el) continue
    const shown = controlShown(id, settings)
    el.hidden = !shown
    if (!shown) continue
    const place = settings.dockLayout[id]
    const anchor = el.querySelector(".vee-pop-anchor")
    if (anchor instanceof HTMLElement) anchor.dataset.out = popDirection(place)
    if (place.slot === "custom") {
      pinCustom(el, place)
      continue
    }
    clearPin(el)
    packFor(place.edge, place.slot).appendChild(el)
  }
  for (const node of packNodes.values()) {
    const empty = node.childElementCount === 0
    node.hidden = empty
    if (empty) continue
    node.dataset.lift = node.dataset.edge === liftEdge ? "true" : "false"
  }
  placeTrack(progress, settings.dockProgress)
}

function applyBarLayout(settings: EffectSettings): void {
  if (!root) return
  applyChromeSkin(boundVideo)
  root.dataset.progress = settings.dockProgress ? "true" : "false"
  root.dataset.buttons = hasDockButtons(settings) ? "true" : "false"
  if (speedPop?.dataset.open === "true" || speedDrag || qualityPop?.dataset.open === "true") {
    alignSpeedCard()
    return
  }
  layoutControls(settings)
  pinPresetAnchor(boundVideo)
}

function endSpeedDrag(): void {
  flushSpeed()
  speedDrag = false
  if (!speedPop) return
  if (speedAnchor?.matches(":hover") || speedAnchor?.contains(document.activeElement)) return
  armPopClose("speed")
}

function setPlaybackRate(rate: number): void {
  const next = clampRate(rate)
  pendingRate = next
  paintSpeed(next)
  scheduleSpeed(next)
}

function reportLoop(): void {
  reportMedia()
}

function reportMedia(): void {
  const video = boundVideo
  if (!video || !onMedia) return
  if (video.hasAttribute(YT_HOLD_ATTR)) return
  if (volumeDrag || speedDrag || performance.now() < ignoreUntil) return
  const source = rateSource?.(video) ?? "live"
  if (source === "hold") return
  let playbackRate: number | null = source === "live" ? video.playbackRate || 1 : null
  const editing = speedDrag || pendingRate !== null
  const chosen = heldRate
  const holding = chosen !== null && performance.now() < heldRateUntil
  const reverted = holding && chosen !== null && Math.abs((video.playbackRate || 1) - chosen) > 0.02
  if (editing || reverted) playbackRate = null
  if (reverted && !rateCorrected) {
    rateCorrected = true
    noteWrite()
    onControl?.({ type: "rate", playbackRate: chosen })
  }
  onMedia({
    volume: video.volume,
    muted: video.muted,
    playbackRate,
    loop: video.loop
  })
}

function setIcon(button: HTMLButtonElement, name: string, html: string): void {
  if (button.dataset.icon === name) return
  button.dataset.icon = name
  button.innerHTML = html
}

function onEmptied(): void {
  const video = boundVideo
  if (!video || applyingQuality || holding(video)) return
  if (directMediaUrl(video)) return
  const remembered = rememberedSrc.get(video)
  const assigned = video.src || ""
  if (remembered && assigned && mediaPath(assigned) === mediaPath(remembered)) return
  if (instagramPage()) {
    const code = mediaCode(video)
    const marked = pinnedCode.get(video) || rememberedCode.get(video) || ""
    if (code && marked && code !== marked) {
      rememberedSrc.delete(video)
      rememberedCode.delete(video)
      dropPin(video)
      paintControls()
      return
    }
    const pinned = pinnedGroup.get(video)
    if (pinned && (!code || !marked || code === marked) && !durationConflicts(pinned, video)) {
      paintControls()
      return
    }
  }
  rememberedSrc.delete(video)
  rememberedCode.delete(video)
  dropPin(video)
  paintControls()
}

function refreshStarted(video: HTMLVideoElement): void {
  if (holding(video) || applyingQuality) return
  const pinned = pinnedGroup.get(video)
  if (!pinned) return
  if (!instagramPage()) {
    if ((video.currentTime || 0) > 0.45) return
    const existing = startedPath.get(video)
    const newest = recentPaths()[0]
    if (!existing || !newest || newest === existing) return
    const next = groupContainingPath(newest)
    const prev = groupContainingPath(existing)
    if (!next || next === prev) return
    dropPin(video)
    return
  }
  const code = mediaCode(video)
  const marked = pinnedCode.get(video) || ""
  const tagged = groupCode(pinned)
  if ((code && marked && code !== marked) || (code && tagged && tagged !== code)) {
    dropPin(video)
    return
  }
  if (!code && durationConflicts(pinned, video)) {
    dropPin(video)
    return
  }
  const src = directMediaUrl(video)
  if (src && !groupHasPath(pinned, mediaPath(src))) dropPin(video)
}

function onTime(): void {
  updateFill()
  const video = boundVideo
  if (!video) return
  paintTime(video)
  if (holding(video) && movedAway(video)) releaseQuality(video, true)
  else refreshStarted(video)
  if (rateSource?.(video) === "hold" || fileControlsChanged(video)) paintControls()
}

function fileControlsChanged(video: HTMLVideoElement): boolean {
  const settings = readSettings()
  if (!settings) return false
  touchQualitySearch(video)
  const downloadEl = controlNodes.get("download")
  const qualityEl = controlNodes.get("quality")
  const downloadOn = settings.dockDownload && fileForDownload(video) != null
  const qualityOn = settings.dockQuality && qualityShown(video)
  return (!!downloadEl && downloadEl.hidden === downloadOn) || (!!qualityEl && qualityEl.hidden === qualityOn)
}

function onMediaSignal(): void {
  const video = boundVideo
  const siteClick = performance.now() - siteMuteClickAt < 800
  if (video && !siteClick) enforceHeldMute(video)
  reportMedia()
  paintControls()
  updateFill()
}

function ensureBar(): HTMLDivElement {
  if (root) return root
  ensureStyle()
  const node = document.createElement("div")
  node.id = SEEK_BAR_ID
  const chips = SPEED_CHIPS.map(
    (rate) =>
      `<button type="button" data-rate="${rate}" aria-label="${formatChip(rate)} times">${formatChip(rate)}</button>`
  ).join("")
  node.innerHTML = `
    <div class="vee-control" data-place="play">
      <button type="button" class="vee-chrome-btn" data-act="play" aria-label="Play">${ICON_PLAY}</button>
    </div>
    <div class="vee-control" data-place="time">
      <span class="vee-chrome-time" data-act="time"></span>
    </div>
    <div class="vee-control" data-place="skip">
      <button type="button" class="vee-chrome-btn" data-act="back" aria-label="Back 10 seconds">${ICON_BACK}</button>
      <button type="button" class="vee-chrome-btn" data-act="forward" aria-label="Forward 10 seconds">${ICON_FORWARD}</button>
    </div>
    <div class="vee-control" data-place="speed">
      <div class="vee-pop-anchor" data-act="speed" data-out="up">
        <button type="button" class="vee-rate-btn" data-act="speed-btn" aria-label="Playback speed">1.00x</button>
        <div class="vee-pop vee-speed-pop" data-pop="speed">
          <div class="vee-pop-card">
            <div class="vee-speed-readout">1.00x</div>
            <div class="vee-speed-adjust">
              <button type="button" class="vee-speed-step" data-act="speed-minus" aria-label="Slower">−</button>
              <input type="range" min="${PLAYBACK_RATE_MIN}" max="${PLAYBACK_RATE_MAX}" step="0.01" value="1" aria-label="Playback speed" />
              <button type="button" class="vee-speed-step" data-act="speed-plus" aria-label="Faster">+</button>
            </div>
            <div class="vee-speed-chips">${chips}</div>
            <div class="vee-speed-caption"><span>Normal</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="vee-control" data-place="volume">
      <div class="vee-pop-anchor" data-act="volume" data-out="up">
        <button type="button" class="vee-chrome-btn" data-act="mute" aria-label="Mute">${ICON_VOLUME}</button>
        <div class="vee-pop vee-volume-pop" data-pop="volume">
          <div class="vee-pop-card">
            <input type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume" />
          </div>
        </div>
      </div>
    </div>
    <div class="vee-control" data-place="loop">
      <button type="button" class="vee-chrome-btn" data-act="loop" aria-label="Turn loop on" aria-pressed="false">${ICON_LOOP_OFF}</button>
    </div>
    <div class="vee-control" data-place="pip">
      <button type="button" class="vee-chrome-btn" data-act="pip" aria-label="Picture in picture">${ICON_PIP}</button>
    </div>
    <div class="vee-control" data-place="download">
      <button type="button" class="vee-chrome-btn" data-act="download" aria-label="Download">${ICON_DOWNLOAD}</button>
    </div>
    <div class="vee-control" data-place="quality">
      <div class="vee-pop-anchor" data-act="quality" data-out="up">
        <button type="button" class="vee-chrome-btn" data-act="quality-btn" aria-label="Resolution">${ICON_QUALITY}</button>
        <div class="vee-pop vee-quality-pop" data-pop="quality">
          <div class="vee-pop-card" data-act="quality-list"></div>
        </div>
      </div>
    </div>
    <div class="vee-control" data-place="fullscreen">
      <button type="button" class="vee-chrome-btn" data-act="full" aria-label="Full screen">${ICON_FULL}</button>
    </div>
    <div class="vee-seek-hit" data-axis="x" role="slider" aria-label="Video progress">
      <div class="vee-seek-track">
        <div class="vee-seek-buffered"></div>
        <div class="vee-seek-played"></div>
      </div>
      <span class="vee-seek-tip" aria-hidden="true"></span>
    </div>
  `
  hit = node.querySelector(".vee-seek-hit")
  bufferedEl = node.querySelector(".vee-seek-buffered")
  playedEl = node.querySelector(".vee-seek-played")
  tipEl = node.querySelector(".vee-seek-tip")
  playBtn = node.querySelector("[data-act='play']")
  timeEl = node.querySelector("[data-act='time']")
  backBtn = node.querySelector("[data-act='back']")
  forwardBtn = node.querySelector("[data-act='forward']")
  speedAnchor = node.querySelector("[data-act='speed']")
  speedBtn = node.querySelector("[data-act='speed-btn']")
  speedPop = node.querySelector("[data-pop='speed']")
  speedReadout = node.querySelector(".vee-speed-readout")
  speedCaption = node.querySelector(".vee-speed-caption")
  speedInput = node.querySelector(".vee-speed-adjust input")
  speedChips = [...node.querySelectorAll<HTMLButtonElement>(".vee-speed-chips button")]
  volumeAnchor = node.querySelector("[data-act='volume']")
  muteBtn = node.querySelector("[data-act='mute']")
  volumePop = node.querySelector("[data-pop='volume']")
  volumeInput = node.querySelector(".vee-volume-pop input")
  loopBtn = node.querySelector("[data-act='loop']")
  pipBtn = node.querySelector("[data-act='pip']")
  downloadBtn = node.querySelector("[data-act='download']")
  qualityAnchor = node.querySelector("[data-act='quality']")
  qualityBtn = node.querySelector("[data-act='quality-btn']")
  qualityPop = node.querySelector("[data-pop='quality']")
  qualityList = node.querySelector("[data-act='quality-list']")
  fullBtn = node.querySelector("[data-act='full']")
  for (const id of DOCK_ICON_ORDER) {
    const el = node.querySelector(`.vee-control[data-place='${id}']`)
    if (el instanceof HTMLDivElement) controlNodes.set(id, el)
  }

  const openSpeed = () => {
    cancelPopClose("speed")
    if (speedPop) speedPop.dataset.open = "true"
    alignSpeedCard()
    showChrome()
  }
  speedAnchor?.addEventListener("pointerenter", openSpeed)
  speedAnchor?.addEventListener("pointerleave", (event) => {
    const next = event.relatedTarget
    if (next instanceof Node && speedAnchor?.contains(next)) return
    armPopClose("speed")
  })
  speedAnchor?.addEventListener("focusin", openSpeed)
  speedAnchor?.addEventListener("focusout", () => armPopClose("speed"))
  speedBtn?.addEventListener("click", (event) => {
    if (recentAct()) return
    stopAct(event)
    openSpeed()
  })
  node.querySelector("[data-act='speed-minus']")?.addEventListener("click", (event) => {
    if (recentAct()) return
    stopAct(event)
    stepSpeed(-SPEED_STEP)
  })
  node.querySelector("[data-act='speed-plus']")?.addEventListener("click", (event) => {
    if (recentAct()) return
    stopAct(event)
    stepSpeed(SPEED_STEP)
  })
  for (const chip of speedChips) {
    chip.addEventListener("click", (event) => {
      if (recentAct()) return
      stopAct(event)
      setPlaybackRate(Number(chip.dataset.rate))
    })
  }
  speedInput?.addEventListener("pointerdown", (event) => {
    event.stopPropagation()
    speedDrag = true
    openSpeed()
  })
  speedInput?.addEventListener("input", (event) => {
    event.stopPropagation()
    if (!speedInput) return
    speedDrag = true
    setPlaybackRate(Number(speedInput.value))
  })
  speedInput?.addEventListener("change", () => {
    endSpeedDrag()
    paintControls()
  })
  speedInput?.addEventListener("pointerup", () => endSpeedDrag())
  speedInput?.addEventListener("pointercancel", () => endSpeedDrag())
  playBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    if (!video) return
    if (video.paused || video.ended) {
      video.removeAttribute(USER_PAUSE_MARK)
      void video.play().catch(() => undefined)
    } else {
      video.setAttribute(USER_PAUSE_MARK, "1")
      video.pause()
    }
  })
  backBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    if (!video) return
    seekBy(video, -SKIP_SECONDS)
    updateFill()
    paintTime(video)
  })
  forwardBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    if (!video) return
    seekBy(video, SKIP_SECONDS)
    updateFill()
    paintTime(video)
  })
  muteBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    const settings = readSettings()
    if (!video || !settings) return
    cancelVolumeApply()
    noteWrite()
    const level = shownAudio(video, settings)
    const silent = level.muted || level.volume <= 0.001
    if (silent) {
      const volume = level.volume > 0.001 ? level.volume : lastAudible > 0.001 ? lastAudible : 1
      onControl?.({ type: "audio", volume, muted: false })
    } else {
      onControl?.({ type: "audio", volume: level.volume, muted: true })
    }
    paintControls()
  })
  const openVolume = () => {
    cancelPopClose("volume")
    if (volumePop) volumePop.dataset.open = "true"
    showChrome()
  }
  volumeAnchor?.addEventListener("pointerenter", openVolume)
  volumeAnchor?.addEventListener("pointerleave", (event) => {
    const next = event.relatedTarget
    if (next instanceof Node && volumeAnchor?.contains(next)) return
    armPopClose("volume")
  })
  volumeAnchor?.addEventListener("focusin", openVolume)
  volumeAnchor?.addEventListener("focusout", () => armPopClose("volume"))
  volumeInput?.addEventListener("pointerdown", (event) => {
    event.stopPropagation()
    volumeDrag = true
    openVolume()
  })
  volumeInput?.addEventListener("input", () => {
    if (!volumeInput) return
    volumeDrag = true
    const volume = Math.min(1, Math.max(0, Number(volumeInput.value)))
    const muted = volume <= 0.001
    pendingVolume = { volume, muted }
    paintControls()
    scheduleVolume(volume, muted)
  })
  volumeInput?.addEventListener("change", () => {
    flushVolume()
    volumeDrag = false
    paintControls()
  })
  volumeInput?.addEventListener("pointerup", () => {
    flushVolume()
    volumeDrag = false
    if (!volumeAnchor?.matches(":hover")) armPopClose("volume")
  })
  volumeInput?.addEventListener("pointercancel", () => {
    flushVolume()
    volumeDrag = false
    armPopClose("volume")
  })
  loopBtn?.addEventListener("click", (event) => {
    if (recentAct()) return
    stopAct(event)
    toggleLoop()
  })
  pipBtn?.addEventListener("click", (event) => {
    stopAct(event)
    const video = boundVideo
    if (!video) return
    void togglePictureInPicture(video).catch(() => undefined)
  })
  downloadBtn?.addEventListener("click", (event) => {
    stopAct(event)
    if (recentAct()) return
    void downloadCurrent()
  })
  const openQuality = () => {
    cancelPopClose("quality")
    if (qualityPop) qualityPop.dataset.open = "true"
    showChrome()
    requestAnimationFrame(fitQualityPop)
  }
  qualityAnchor?.addEventListener("pointerenter", openQuality)
  qualityAnchor?.addEventListener("pointerleave", (event) => {
    const next = event.relatedTarget
    if (next instanceof Node && qualityAnchor?.contains(next)) return
    armPopClose("quality")
  })
  qualityAnchor?.addEventListener("focusin", openQuality)
  qualityAnchor?.addEventListener("focusout", () => armPopClose("quality"))
  qualityBtn?.addEventListener("click", (event) => {
    stopAct(event)
    openQuality()
  })
  qualityList?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null
    if (!(button instanceof HTMLButtonElement)) return
    stopAct(event)
    const url = button.dataset.url
    const video = boundVideo
    if (!url || !video || !fileUrl(url)) return
    applyQuality(video, url, button.dataset.audio || "")
    if (qualityPop) delete qualityPop.dataset.open
  })
  fullBtn?.addEventListener("click", (event) => {
    event.stopPropagation()
    const video = boundVideo
    if (!video) return
    if (videoIsFullscreen(video)) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    void enterPlayerFullscreen(video).catch(() => undefined)
  })

  hit?.addEventListener("pointerdown", onPointerDown)
  hit?.addEventListener("pointermove", (event) => {
    if (!dragging) updateTip(event.clientX, event.clientY)
  })
  hit?.addEventListener("pointerleave", () => {
    if (!dragging && tipEl) tipEl.textContent = ""
  })
  node.addEventListener("pointerenter", onDockEnter)
  node.addEventListener("pointerleave", onDockLeave)
  root = node
  return node
}

function barParent(video: HTMLVideoElement): HTMLElement {
  const fullscreen = document.fullscreenElement
  if (fullscreen === video) {
    return video.parentElement instanceof HTMLElement ? video.parentElement : document.documentElement
  }
  if (fullscreen instanceof HTMLElement && fullscreen.contains(video)) return fullscreen
  return document.documentElement
}

function viewportClip(rect: DOMRectReadOnly): DOMRectReadOnly {
  const left = Math.max(rect.left, 0)
  const top = Math.max(rect.top, 0)
  const right = Math.min(rect.right, window.innerWidth)
  const bottom = Math.min(rect.bottom, window.innerHeight)
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
}

function timelineRange(video: HTMLVideoElement): Timeline {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return { start: 0, end: video.duration, seekable: true }
  }
  const ranges = video.seekable
  if (ranges.length > 0) {
    const start = ranges.start(0)
    const end = ranges.end(ranges.length - 1)
    if (end > start) return { start, end, seekable: true }
  }
  return { start: 0, end: 0, seekable: false }
}

function fractionAlong(video: HTMLVideoElement, timeline: Timeline): number {
  if (timeline.end <= timeline.start) return 0
  const value = (video.currentTime - timeline.start) / (timeline.end - timeline.start)
  return Math.min(1, Math.max(0, value))
}

function bufferedFraction(video: HTMLVideoElement, timeline: Timeline): number {
  if (timeline.end <= timeline.start) return 0
  const ranges = video.buffered
  let maxEnd = timeline.start
  for (let index = 0; index < ranges.length; index += 1) {
    maxEnd = Math.max(maxEnd, ranges.end(index))
  }
  return Math.min(1, Math.max(0, (maxEnd - timeline.start) / (timeline.end - timeline.start)))
}

function timeFromPointer(video: HTMLVideoElement, clientX: number, clientY: number): number | null {
  if (!hit || hit.hidden || root?.style.display === "none") return null
  const rect = hit.getBoundingClientRect()
  const vertical = hit.dataset.axis === "y"
  const span = vertical ? rect.height : rect.width
  if (span < 1) return null
  const timeline = timelineRange(video)
  if (!timeline.seekable) return null
  const ratio = vertical
    ? (clientY - rect.top) / rect.height
    : (clientX - rect.left) / rect.width
  const clamped = Math.min(1, Math.max(0, ratio))
  return timeline.start + clamped * (timeline.end - timeline.start)
}

function seekVideo(video: HTMLVideoElement, time: number): void {
  const timeline = timelineRange(video)
  if (!timeline.seekable) return
  const next = Math.min(timeline.end, Math.max(timeline.start, time))
  try {
    video.currentTime = next
  } catch {
    /* Player can reject seeks during ads or live edges. */
  }
}

function updateFill(): void {
  const video = boundVideo
  if (!video || !playedEl || !bufferedEl || !hit) return
  const timeline = timelineRange(video)
  const played = fractionAlong(video, timeline)
  const buffered = bufferedFraction(video, timeline)
  const vertical = hit.dataset.axis === "y"
  if (vertical) {
    playedEl.style.bottom = "auto"
    bufferedEl.style.bottom = "auto"
    playedEl.style.width = "100%"
    bufferedEl.style.width = "100%"
    playedEl.style.height = `${played * 100}%`
    bufferedEl.style.height = `${buffered * 100}%`
  } else {
    playedEl.style.bottom = "0"
    bufferedEl.style.bottom = "0"
    playedEl.style.height = "100%"
    bufferedEl.style.height = "100%"
    playedEl.style.width = `${played * 100}%`
    bufferedEl.style.width = `${buffered * 100}%`
  }
  hit.setAttribute("aria-valuemin", String(Math.floor(timeline.start)))
  hit.setAttribute("aria-valuemax", String(Math.floor(timeline.end)))
  hit.setAttribute("aria-valuenow", String(Math.floor(video.currentTime)))
  hit.setAttribute("aria-disabled", timeline.seekable ? "false" : "true")
}

function updateTip(clientX: number, clientY: number): void {
  const video = boundVideo
  if (!video || !tipEl || !hit) return
  const time = timeFromPointer(video, clientX, clientY)
  if (time === null) {
    tipEl.textContent = ""
    return
  }
  tipEl.textContent = formatClock(time)
  const rect = hit.getBoundingClientRect()
  if (hit.dataset.axis === "y") {
    const y = Math.min(rect.height, Math.max(0, clientY - rect.top))
    tipEl.style.top = `${y}px`
    tipEl.style.bottom = "auto"
    tipEl.style.transform = "translateY(-50%)"
    const openLeft = rect.left > (root?.getBoundingClientRect().left ?? 0) + 40
    if (openLeft) {
      tipEl.style.left = "auto"
      tipEl.style.right = `${rect.width + 8}px`
    } else {
      tipEl.style.right = "auto"
      tipEl.style.left = `${rect.width + 8}px`
    }
    return
  }
  const x = Math.min(rect.width, Math.max(0, clientX - rect.left))
  tipEl.style.left = `${x}px`
  tipEl.style.right = "auto"
  tipEl.style.top = "auto"
  tipEl.style.bottom = `${HIT_HEIGHT_PX + 4}px`
  tipEl.style.transform = "translateX(-50%)"
}

function onPointerDown(event: PointerEvent): void {
  const video = boundVideo
  if (!video || !root) return
  const timeline = timelineRange(video)
  if (!timeline.seekable) return
  event.preventDefault()
  event.stopPropagation()
  dragging = true
  dragPointerId = event.pointerId
  root.dataset.drag = "true"
  showChrome()
  hit?.setPointerCapture(event.pointerId)
  const time = timeFromPointer(video, event.clientX, event.clientY)
  if (time !== null) seekVideo(video, time)
  updateTip(event.clientX, event.clientY)
  updateFill()
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging || event.pointerId !== dragPointerId) return
  const video = boundVideo
  if (!video) return
  event.preventDefault()
  const time = timeFromPointer(video, event.clientX, event.clientY)
  if (time !== null) seekVideo(video, time)
  updateTip(event.clientX, event.clientY)
  updateFill()
}

function onPointerUp(event: PointerEvent): void {
  if (volumeDrag) flushVolume()
  volumeDrag = false
  if (speedDrag) endSpeedDrag()
  if (!dragging || event.pointerId !== dragPointerId) return
  dragging = false
  dragPointerId = -1
  if (root) delete root.dataset.drag
  try {
    hit?.releasePointerCapture(event.pointerId)
  } catch {
    /* Pointer already released. */
  }
  if (!pointerOverVideo(event)) pointerInside = false
  showChrome()
}

function onPresentationChange(): void {
  if (fsSession && document.fullscreenElement === fsSession.shell) fsEntered = true
  if (fsSession && document.fullscreenElement !== fsSession.shell && !(fsOpening && !fsEntered)) {
    restorePlayerFullscreen()
  }
  const video = boundVideo
  const settings = readSettings()
  if (video && document.pictureInPictureElement === video) {
    hideBar()
    return
  }
  if (video && settings && shouldShow(settings)) {
    const bar = root ?? ensureBar()
    bar.dataset.visible = "true"
    placeSeekBar(video)
    showChrome()
  }
  if (video) syncNativeControls(video)
  paintControls()
}

function unbindVideo(video: HTMLVideoElement | null): void {
  if (!video) return
  clearHoverSamples()
  if (lockedVideo === video) releaseQuality(video, false)
  dropPin(video)
  video.removeEventListener("pointerenter", onVideoPointer)
  video.removeEventListener("pointerleave", onVideoPointer)
  video.removeEventListener("timeupdate", onTime)
  video.removeEventListener("progress", onTime)
  video.removeEventListener("durationchange", onTime)
  video.removeEventListener("loadedmetadata", onTime)
  video.removeEventListener("emptied", onTime)
  video.removeEventListener("emptied", onEmptied)
  video.removeEventListener("volumechange", onMediaSignal)
  video.removeEventListener("ratechange", onMediaSignal)
  video.removeEventListener("play", onMediaSignal)
  video.removeEventListener("pause", onMediaSignal)
}

function bindVideo(video: HTMLVideoElement): void {
  video.addEventListener("pointerenter", onVideoPointer)
  video.addEventListener("pointerleave", onVideoPointer)
  video.addEventListener("timeupdate", onTime)
  video.addEventListener("progress", onTime)
  video.addEventListener("durationchange", onTime)
  video.addEventListener("loadedmetadata", onTime)
  video.addEventListener("emptied", onTime)
  video.addEventListener("emptied", onEmptied)
  video.addEventListener("volumechange", onMediaSignal)
  video.addEventListener("ratechange", onMediaSignal)
  video.addEventListener("play", onMediaSignal)
  video.addEventListener("pause", onMediaSignal)
}

function shouldShow(settings: EffectSettings): boolean {
  return (
    settings.enabled &&
    settings.playbackEnabled !== false &&
    settings.dockEnabled !== false &&
    (settings.dockProgress || hasDockButtons(settings))
  )
}

function hideBar(): void {
  if (!root) return
  root.dataset.visible = "false"
  delete root.dataset.hot
  root.style.display = "none"
  closePops()
  pointerInside = false
}

function boxHas(node: Element, event: Pick<MouseEvent, "clientX" | "clientY">): boolean {
  const rect = node.getBoundingClientRect()
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

export function seekBarVisible(): boolean {
  return root?.dataset.visible === "true"
}

export function seekBarContains(node: EventTarget | null): boolean {
  if (!(node instanceof Node)) return false
  const bar = document.getElementById(SEEK_BAR_ID)
  return bar instanceof HTMLElement && bar.contains(node)
}

export function seekBarHitTest(event: Pick<MouseEvent, "clientX" | "clientY">): boolean {
  const bar = document.getElementById(SEEK_BAR_ID)
  if (!(bar instanceof HTMLElement) || bar.dataset.visible !== "true") return false
  if (bar.dataset.hot !== "true" && bar.dataset.drag !== "true") return false
  const seek = bar.querySelector(".vee-seek-hit")
  if (seek instanceof HTMLElement && !seek.hidden && boxHas(seek, event)) return true
  if (bar.dataset.hot === "true") {
    for (const control of bar.querySelectorAll(".vee-control")) {
      if (control instanceof HTMLElement && !control.hidden && boxHas(control, event)) return true
    }
  }
  for (const pop of bar.querySelectorAll(".vee-pop[data-open='true']")) {
    if (boxHas(pop, event)) return true
  }
  return false
}

export function placeSeekBar(video: HTMLVideoElement | null, attempt = 0): void {
  if (!video || !root || root.dataset.visible !== "true") return
  if (document.pictureInPictureElement === video) {
    hideBar()
    return
  }
  const clipped = viewportClip(video.getBoundingClientRect())
  if (clipped.width < 40 || clipped.height < 40) {
    if (attempt < 3) {
      requestAnimationFrame(() => {
        if (boundVideo === video && root?.dataset.visible === "true") placeSeekBar(video, attempt + 1)
      })
      return
    }
    hideBar()
    return
  }
  const parent = barParent(video)
  if (root.parentElement !== parent) parent.appendChild(root)
  root.style.setProperty("left", `${clipped.left}px`, "important")
  root.style.setProperty("top", `${clipped.top}px`, "important")
  root.style.setProperty("width", `${clipped.width}px`, "important")
  root.style.setProperty("height", `${clipped.height}px`, "important")
  root.style.display = "block"
  root.dataset.visible = "true"
  updateFill()
  paintControls()
}

export function syncSeekBar(video: HTMLVideoElement | null, settings: EffectSettings): void {
  if (!shouldShow(settings) || !video || !video.isConnected) {
    if (boundVideo) unbindVideo(boundVideo)
    boundVideo = null
    hideBar()
    return
  }
  if (document.pictureInPictureElement === video) {
    if (boundVideo) unbindVideo(boundVideo)
    boundVideo = null
    hideBar()
    return
  }
  const bar = ensureBar()
  if (boundVideo !== video) {
    unbindVideo(boundVideo)
    boundVideo = video
    qualityBind += 1
    heldRate = null
    heldRateUntil = 0
    rateCorrected = false
    window.clearTimeout(rateCheckTimer)
    rateCheckTimer = 0
    bindVideo(video)
  }
  const showing = bar.dataset.visible === "true" && bar.style.display !== "none"
  bar.dataset.visible = "true"
  placeSeekBar(video)
  syncNativeControls(video)
  if (!showing) showChrome()
  const mediaStamp = [
    settings.volume,
    settings.muted,
    settings.playbackRate,
    settings.loop,
    settings.audioTouched,
    settings.playbackTouched
  ].join("|")
  const playerMark = video.getAttribute(NATIVE_PLAYER_ATTR) || ""
  if (mediaStamp !== shownMediaStamp || playerMark !== shownPlayerMark) {
    shownMediaStamp = mediaStamp
    shownPlayerMark = playerMark
    paintControls()
  }
  reportLoop()
}

export function suppressDockMedia(ms = WRITE_GUARD_MS): void {
  ignoreUntil = Math.max(ignoreUntil, performance.now() + ms)
}

export function stopSeekBar(): void {
  restorePlayerFullscreen()
  controlsObserver?.disconnect()
  controlsObserver = null
  playerObserver?.disconnect()
  playerObserver = null
  suppressingControls = false
  document.removeEventListener("pointermove", onPointerMove, true)
  document.removeEventListener("pointermove", onDocumentHover)
  document.removeEventListener("pointerup", onPointerUp, true)
  document.removeEventListener("pointercancel", onPointerUp, true)
  document.removeEventListener("pointerdown", onDocPointerDown, true)
  window.removeEventListener("pointerdown", onWindowActDown, true)
  window.removeEventListener("pointermove", onWindowActMove, true)
  window.removeEventListener("pointerup", onWindowActUp, true)
  window.removeEventListener("pointercancel", onWindowActUp, true)
  document.removeEventListener("enterpictureinpicture", onPresentationChange)
  document.removeEventListener("leavepictureinpicture", onPresentationChange)
  document.removeEventListener("fullscreenchange", onFullscreenCapture, true)
  document.removeEventListener("fullscreenchange", onPresentationChange)
  window.removeEventListener("message", onRenditionMessage)
  window.removeEventListener("pointerdown", onViewerInput, true)
  window.removeEventListener("keydown", onViewerInput, true)
  document.removeEventListener("click", onSiteAudioClick, true)
  document.removeEventListener("play", onPageAudio, true)
  clearHoverSamples()
  window.clearTimeout(hotTimer)
  cancelPopClose("volume")
  cancelPopClose("speed")
  cancelPopClose("quality")
  cancelVolumeApply()
  window.clearTimeout(speedApplyTimer)
  speedApplyTimer = 0
  window.clearTimeout(rateCheckTimer)
  rateCheckTimer = 0
  pendingRate = null
  pendingLoop = null
  heldRate = null
  heldRateUntil = 0
  rateCorrected = false
  actPointer = null
  pointerInside = false
  unbindVideo(boundVideo)
  boundVideo = null
  dragging = false
  volumeDrag = false
  speedDrag = false
  if (root?.isConnected) root.remove()
  root = null
  hit = null
  bufferedEl = null
  playedEl = null
  tipEl = null
  playBtn = null
  timeEl = null
  backBtn = null
  forwardBtn = null
  speedAnchor = null
  speedBtn = null
  speedPop = null
  speedReadout = null
  speedCaption = null
  speedInput = null
  speedChips = []
  volumeAnchor = null
  muteBtn = null
  volumePop = null
  volumeInput = null
  loopBtn = null
  pipBtn = null
  downloadBtn = null
  ytOffer = null
  for (const done of pendingYoutubeFetch.values()) done(null)
  pendingYoutubeFetch.clear()
  qualityAnchor = null
  qualityBtn = null
  qualityPop = null
  qualityList = null
  fullBtn = null
  downloadBusy = false
  layoutStamp = ""
  shownMediaStamp = ""
  shownPlayerMark = ""
  qualityStamp = ""
  catalogSeen = false
  renditionGroups = []
  playedPaths = []
  latestBatch = []
  latestAt = 0
  releaseQuality(lockedVideo, false)
  qualityToken = 0
  controlNodes.clear()
  packNodes.clear()
}

export function startSeekBar(options: {
  getSettings: () => EffectSettings
  getUiSettings?: () => EffectSettings
  onControl?: (control: DockControl) => void
  onMedia?: (media: DockMedia) => void
  rateSource?: (video: HTMLVideoElement) => DockRateSource
}): {
  sync: (video: HTMLVideoElement | null) => void
  place: (video: HTMLVideoElement | null) => void
  stop: () => void
} {
  getSettings = options.getSettings
  getUiSettings = options.getUiSettings ?? null
  onControl = options.onControl ?? null
  onMedia = options.onMedia ?? null
  rateSource = options.rateSource ?? null
  installFullscreenHook()
  ensureBar()
  if (!playerObserver && document.documentElement) {
    playerObserver = new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target
        if (!(node instanceof HTMLVideoElement) || node !== boundVideo) continue
        reportMedia()
        paintControls()
      }
    })
    playerObserver.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: [NATIVE_PLAYER_ATTR]
    })
  }
  document.addEventListener("pointermove", onPointerMove, true)
  document.addEventListener("pointermove", onDocumentHover)
  document.addEventListener("pointerup", onPointerUp, true)
  document.addEventListener("pointercancel", onPointerUp, true)
  document.addEventListener("pointerdown", onDocPointerDown, true)
  window.addEventListener("pointerdown", onWindowActDown, true)
  window.addEventListener("pointermove", onWindowActMove, true)
  window.addEventListener("pointerup", onWindowActUp, true)
  window.addEventListener("pointercancel", onWindowActUp, true)
  document.addEventListener("enterpictureinpicture", onPresentationChange)
  document.addEventListener("leavepictureinpicture", onPresentationChange)
  document.addEventListener("fullscreenchange", onFullscreenCapture, true)
  document.addEventListener("fullscreenchange", onPresentationChange)
  window.addEventListener("message", onRenditionMessage)
  window.addEventListener("yt-navigate-finish", askYoutubeOffer)
  askYoutubeOffer()
  window.addEventListener("pointerdown", onViewerInput, true)
  window.addEventListener("keydown", onViewerInput, true)
  document.addEventListener("click", onSiteAudioClick, true)
  document.addEventListener("play", onPageAudio, true)
  hookHistory()
  postRenditionAsk()
  return {
    sync(video) {
      const read = getUiSettings ?? getSettings
      if (!read) return
      syncSeekBar(video, read())
    },
    place(video) {
      placeSeekBar(video)
    },
    stop() {
      stopSeekBar()
      getSettings = null
      getUiSettings = null
      onControl = null
      onMedia = null
      rateSource = null
    }
  }
}
