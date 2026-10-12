import {
  dockContextOf,
  domainIconOrder,
  domainShape,
  domainSkin
} from "./domains"
import { seekBy, togglePictureInPicture } from "./effects"
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
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-chrome-btn,
#${SEEK_BAR_ID}[data-skin="facebook"] .vee-chrome-btn {
  width: 32px;
  height: 32px;
}
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-rate-btn,
#${SEEK_BAR_ID}[data-skin="facebook"] .vee-rate-btn {
  height: 32px;
  font-size: 13px;
}
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-chrome-btn svg,
#${SEEK_BAR_ID}[data-skin="facebook"] .vee-chrome-btn svg {
  width: 22px;
  height: 22px;
}
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-pack[data-edge="bottom"][data-slot="start"] {
  bottom: 128px;
  left: 12px;
}
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-pack[data-lift="true"][data-edge="bottom"][data-slot="start"] {
  bottom: 128px;
}
#${SEEK_BAR_ID}[data-skin="instagram"] .vee-pack[data-edge="top"][data-slot="end"] {
  top: 12px;
  right: 48px;
}
#${SEEK_BAR_ID}[data-skin="facebook"]:not([data-shape="vertical"]) .vee-pack[data-edge="bottom"][data-slot="end"] {
  right: 160px;
  bottom: 12px;
}
#${SEEK_BAR_ID}[data-skin="facebook"][data-shape="vertical"] .vee-pack[data-edge="top"][data-slot="center"] {
  top: 44px;
}
#${SEEK_BAR_ID}[data-skin="facebook"][data-shape="vertical"] .vee-pack[data-edge="right"][data-slot="end"] {
  top: 128px;
  right: 14px;
  bottom: auto;
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
@media (prefers-reduced-motion: reduce) {
  #${SEEK_BAR_ID},
  #${SEEK_BAR_ID} .vee-seek-track,
  #${SEEK_BAR_ID} .vee-seek-tip,
  #${SEEK_BAR_ID} .vee-pop {
    transition: none;
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
let suppressingControls = false

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

function cancelPopClose(which: "volume" | "speed"): void {
  if (which === "volume") window.clearTimeout(volumeCloseTimer)
  else window.clearTimeout(speedCloseTimer)
}

function armPopClose(which: "volume" | "speed"): void {
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
    if (speedDrag) {
      armPopClose("speed")
      return
    }
    if (speedAnchor?.matches(":hover")) return
    if (speedPop) delete speedPop.dataset.open
  }, POP_CLOSE_MS)
  if (which === "volume") volumeCloseTimer = timer
  else speedCloseTimer = timer
}

function closePops(): void {
  cancelPopClose("volume")
  cancelPopClose("speed")
  if (volumePop) delete volumePop.dataset.open
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
  if (!settings) return
  const next = !(pendingLoop ?? settings.loop)
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
  if (act === "loop" || act === "speed-btn" || act === "speed-minus" || act === "speed-plus") {
    return { act, node }
  }
  return null
}

function onWindowActDown(event: PointerEvent): void {
  const hit = actFromTarget(event.target)
  if (!hit) return
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
  return settings.playbackRate
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

function paintControls(): void {
  const video = boundVideo
  const settings = readSettings()
  if (!video || !settings || !root) return
  applyChromeSkin(video)
  const pipOn = document.pictureInPictureElement === video
  const fullOn = videoIsFullscreen(video)
  const volumeNow = pendingVolume?.volume ?? settings.volume
  const mutedNow = pendingVolume?.muted ?? settings.muted
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
    const loopOn = pendingLoop ?? settings.loop
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
    case "fullscreen":
      return settings.dockFullscreen
  }
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
  if (skin === "default") delete root.dataset.skin
  else root.dataset.skin = skin
  if (!shape) delete root.dataset.shape
  else root.dataset.shape = shape
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

function pinBottomRightCluster(video: HTMLVideoElement): void {
  const pack = packNodes.get("bottom:end")
  const bar = root?.getBoundingClientRect()
  if (!pack || pack.hidden || !bar) return
  const cluster = rightCluster(nativeControls(video).filter((node) => inBand(node, bar, "bottom")))
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

function reelRightMarks(shell: HTMLElement, bar: DOMRect): HTMLElement[] {
  if (scanFresh(markCache)) return (markCache?.nodes ?? []).filter((node) => node.isConnected)
  const marks: HTMLElement[] = []
  const nodes = shell.querySelectorAll<HTMLElement>("button, [role='button'], span, div")
  for (const node of nodes) {
    if (root?.contains(node)) continue
    const box = node.getBoundingClientRect()
    if (box.width < 8 || box.height < 8 || box.width > 80 || box.height > 64) continue
    if (!inBand(node, bar, "right")) continue
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
  if (lowest) {
    const box = lowest.getBoundingClientRect()
    const nearTop = box.bottom - bar.top < 72
    placePack(stack, {
      top: box.bottom - bar.top + (nearTop ? 72 : 10),
      right: Math.max(8, bar.right - box.right)
    })
    return
  }
  const search = findReelSearch(video)
  if (!search) return
  const box = search.getBoundingClientRect()
  placePack(stack, {
    top: box.bottom - bar.top + 72,
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
    bottom: bar.bottom - box.top + 10,
    left: 12
  })
}

function pinPresetAnchor(video: HTMLVideoElement | null): void {
  for (const node of packNodes.values()) clearPackAnchor(node)
  if (!root || !video) return
  const skin = root.dataset.skin || ""
  const shape = root.dataset.shape || ""
  if (skin === "facebook" && shape === "vertical") {
    pinFacebookReel(video)
    return
  }
  if (skin === "instagram") {
    pinInstagram(video)
    return
  }
  if (skin === "prime") {
    pinPrime(video)
    return
  }
  if (skin === "hotstar" || skin === "netflix" || skin === "facebook") pinBottomRightCluster(video)
}

function layoutControls(settings: EffectSettings): void {
  if (!root) return
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
  if (speedPop?.dataset.open === "true" || speedDrag) {
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
  const video = boundVideo
  const settings = readSettings()
  if (!video || !settings || !onMedia || root?.dataset.visible !== "true") return
  if (volumeDrag || speedDrag || performance.now() < ignoreUntil) return
  if (video.loop === settings.loop) return
  onMedia({
    volume: settings.volume,
    muted: settings.muted,
    playbackRate: null,
    loop: video.loop
  })
}

function reportMedia(): void {
  const video = boundVideo
  if (!video || !onMedia || root?.dataset.visible !== "true") return
  if (volumeDrag || performance.now() < ignoreUntil) return
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

function onTime(): void {
  updateFill()
  const video = boundVideo
  if (!video) return
  paintTime(video)
  if (rateSource?.(video) === "hold") paintControls()
}

function onMediaSignal(): void {
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
    if (video.paused || video.ended) void video.play().catch(() => undefined)
    else video.pause()
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
    const settings = readSettings()
    if (!settings) return
    cancelVolumeApply()
    noteWrite()
    const silent = settings.muted || settings.volume <= 0.001
    if (silent) {
      const volume = settings.volume > 0.001 ? settings.volume : lastAudible > 0.001 ? lastAudible : 1
      onControl?.({ type: "audio", volume, muted: false })
    } else {
      onControl?.({ type: "audio", muted: true })
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
  video.removeEventListener("timeupdate", onTime)
  video.removeEventListener("progress", onTime)
  video.removeEventListener("durationchange", onTime)
  video.removeEventListener("loadedmetadata", onTime)
  video.removeEventListener("emptied", onTime)
  video.removeEventListener("volumechange", onMediaSignal)
  video.removeEventListener("ratechange", onMediaSignal)
  video.removeEventListener("play", onMediaSignal)
  video.removeEventListener("pause", onMediaSignal)
}

function bindVideo(video: HTMLVideoElement): void {
  video.addEventListener("timeupdate", onTime)
  video.addEventListener("progress", onTime)
  video.addEventListener("durationchange", onTime)
  video.addEventListener("loadedmetadata", onTime)
  video.addEventListener("emptied", onTime)
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
  reportLoop()
}

export function suppressDockMedia(ms = WRITE_GUARD_MS): void {
  ignoreUntil = Math.max(ignoreUntil, performance.now() + ms)
}

export function stopSeekBar(): void {
  restorePlayerFullscreen()
  controlsObserver?.disconnect()
  controlsObserver = null
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
  window.clearTimeout(hotTimer)
  cancelPopClose("volume")
  cancelPopClose("speed")
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
  fullBtn = null
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
