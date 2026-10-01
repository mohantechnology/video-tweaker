import cssText from "data-text:./overlay.css"
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useEffect, useRef, useState } from "react"

import {
  HOST_ID,
  getActiveVideo,
  repositionDock,
  startVideoBridge,
  type VideoBridge
} from "~lib/bridge"
import { applyPlayback, isVisualIdentity, seekBy, togglePictureInPicture } from "~lib/effects"
import { PRESETS, presetById } from "~lib/presets"
import {
  OPEN_MESSAGE,
  OPEN_REQUEST_KEY,
  loadSiteSettings,
  saveSiteSettings,
  siteStorageKey
} from "~lib/storage"
import {
  defaultSettings,
  settingsEqual,
  type ColorSettings,
  type EffectSettings
} from "~lib/types"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: true,
  run_at: "document_idle"
}

export const getShadowHostId = () => HOST_ID

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText
  return style
}

const COLOR_CONTROLS: {
  key: keyof ColorSettings
  label: string
  min: number
  max: number
  step: number
  format: (value: number) => string
}[] = [
  { key: "brightness", label: "Brightness", min: 0.2, max: 2, step: 0.01, format: percent },
  { key: "contrast", label: "Contrast", min: 0.2, max: 2, step: 0.01, format: percent },
  { key: "saturate", label: "Saturation", min: 0, max: 3, step: 0.01, format: percent },
  { key: "hueRotate", label: "Hue", min: 0, max: 360, step: 1, format: degrees },
  { key: "grayscale", label: "Grayscale", min: 0, max: 1, step: 0.01, format: percent },
  { key: "sepia", label: "Sepia", min: 0, max: 1, step: 0.01, format: percent },
  { key: "invert", label: "Invert", min: 0, max: 1, step: 0.01, format: percent },
  { key: "blur", label: "Blur", min: 0, max: 12, step: 0.1, format: (value) => `${value.toFixed(1)} px` },
  { key: "opacity", label: "Opacity", min: 0.15, max: 1, step: 0.01, format: percent }
]

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function degrees(value: number): string {
  return `${Math.round(value)}°`
}

function percentOf(value: number, min: number, max: number): string {
  return `${((value - min) / (max - min)) * 100}%`
}

function stopEvent(event: { stopPropagation: () => void }): void {
  event.stopPropagation()
}

function Overlay() {
  const hostname = location.hostname
  const [settings, setSettings] = useState<EffectSettings>(defaultSettings)
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)
  const [pipOn, setPipOn] = useState(false)
  const settingsRef = useRef(settings)
  const readyRef = useRef(false)
  const dirtyRef = useRef(false)
  const bridgeRef = useRef<VideoBridge | null>(null)
  settingsRef.current = settings
  readyRef.current = ready

  useEffect(() => {
    let alive = true
    void loadSiteSettings(hostname).then((loaded) => {
      if (!alive) return
      setSettings(loaded)
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [hostname])

  useEffect(() => {
    if (!ready || !dirtyRef.current) return
    const handle = window.setTimeout(() => {
      void saveSiteSettings(hostname, settingsRef.current)
    }, 160)
    return () => window.clearTimeout(handle)
  }, [settings, ready, hostname])

  useEffect(() => {
    if (!ready) return
    const bridge = startVideoBridge({
      getSettings: () => settingsRef.current,
      onPresence: setHasVideo,
      onVideo: (video) => {
        if (!video || settingsRef.current.playbackTouched) return
        const next = {
          ...settingsRef.current,
          volume: video.volume,
          muted: video.muted,
          playbackRate: video.playbackRate || 1,
          loop: video.loop
        }
        setSettings((current) => (settingsEqual(current, next) ? current : next))
      }
    })
    bridgeRef.current = bridge
    return () => {
      bridge.stop()
      bridgeRef.current = null
    }
  }, [ready])

  useEffect(() => {
    bridgeRef.current?.poke()
    repositionDock()
  }, [settings, open, hasVideo])

  useEffect(() => {
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "local") return
      const stored = changes[siteStorageKey(hostname)]?.newValue as
        | Partial<EffectSettings>
        | undefined
      if (stored) {
        const incoming = { ...defaultSettings(), ...stored }
        setSettings((prev) => (settingsEqual(prev, incoming) ? prev : incoming))
      }
      const request = changes[OPEN_REQUEST_KEY]?.newValue as { hostname?: string } | undefined
      if (request?.hostname === hostname) setOpen(true)
    }

    const onMessage = (
      message: { type?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => {
      if (message?.type === "VEE_STATUS") {
        sendResponse({
          pending: !readyRef.current,
          hostname,
          settings: settingsRef.current
        })
        return false
      }
      if (message?.type === OPEN_MESSAGE) {
        setOpen(true)
        sendResponse({ ok: true })
        return false
      }
      return false
    }

    const onPip = () => {
      setPipOn(document.pictureInPictureElement === getActiveVideo())
    }

    chrome.storage.onChanged.addListener(onStorage)
    chrome.runtime.onMessage.addListener(onMessage)
    document.addEventListener("enterpictureinpicture", onPip)
    document.addEventListener("leavepictureinpicture", onPip)
    return () => {
      chrome.storage.onChanged.removeListener(onStorage)
      chrome.runtime.onMessage.removeListener(onMessage)
      document.removeEventListener("enterpictureinpicture", onPip)
      document.removeEventListener("leavepictureinpicture", onPip)
    }
  }, [hostname])

  const patch = (next: Partial<EffectSettings>, touchPlayback = false) => {
    dirtyRef.current = true
    setSettings((current) => ({
      ...current,
      ...next,
      playbackTouched: touchPlayback ? true : current.playbackTouched
    }))
  }

  const resetEffects = () => {
    const video = getActiveVideo()
    const touched = settingsRef.current.playbackTouched
    dirtyRef.current = true
    const next = defaultSettings()
    setSettings(next)
    if (video && touched) {
      applyPlayback(video, { ...next, playbackTouched: true, volume: video.volume })
    }
  }

  const live = settings.enabled && (!isVisualIdentity(settings) || settings.playbackTouched)

  if (!hasVideo) return null

  return (
    <div
      className="vee-dock"
      onPointerDown={stopEvent}
      onKeyDown={stopEvent}
      onWheel={stopEvent}>
      {open ? (
        <section className={`vee-panel${settings.enabled ? "" : " is-off"}`} aria-label="Video effects">
          <header className="vee-header">
            <div className="vee-title">
              <strong>Video Effects</strong>
              <span>{settings.enabled ? "On this video" : "Effects are off"}</span>
            </div>
            <div className="vee-header-actions">
              <button type="button" className="vee-text-btn" onClick={resetEffects}>
                Reset
              </button>
              <button
                className="vee-switch"
                type="button"
                role="switch"
                aria-checked={settings.enabled}
                aria-label="Toggle effects"
                data-on={String(settings.enabled)}
                onClick={() => patch({ enabled: !settings.enabled })}>
                <i />
              </button>
            </div>
          </header>

          <div className="vee-presets" aria-label="Looks">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="vee-chip"
                data-on={String(settings.presetId === preset.id)}
                onClick={() => {
                  const match = presetById(preset.id)
                  if (!match) return
                  patch({ ...match.color, presetId: preset.id })
                }}>
                {preset.label}
              </button>
            ))}
          </div>

          <div className="vee-body">
            <section className="vee-section">
              <div className="vee-section-head">
                <h2>Color</h2>
              </div>
              {COLOR_CONTROLS.map((control) => (
                <label className="vee-row" key={control.key}>
                  <span className="vee-row-label">
                    <span>{control.label}</span>
                    <b>{control.format(settings[control.key])}</b>
                  </span>
                  <input
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={settings[control.key]}
                    style={{ ["--p" as string]: percentOf(settings[control.key], control.min, control.max) }}
                    onChange={(event) =>
                      patch({
                        [control.key]: Number(event.target.value),
                        presetId: "custom"
                      })
                    }
                  />
                </label>
              ))}
            </section>

            <section className="vee-section">
              <div className="vee-section-head">
                <h2>Geometry</h2>
              </div>
              <div className="vee-toggles">
                <button
                  type="button"
                  className="vee-action"
                  data-on={String(settings.flipH)}
                  aria-pressed={settings.flipH}
                  onClick={() => patch({ flipH: !settings.flipH })}>
                  Flip horizontal
                </button>
                <button
                  type="button"
                  className="vee-action"
                  data-on={String(settings.flipV)}
                  aria-pressed={settings.flipV}
                  onClick={() => patch({ flipV: !settings.flipV })}>
                  Flip vertical
                </button>
              </div>
              <label className="vee-row" style={{ marginTop: 10 }}>
                <span className="vee-row-label">
                  <span>Rotate</span>
                  <b>{degrees(settings.rotate)}</b>
                </span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={settings.rotate}
                  style={{ ["--p" as string]: percentOf(settings.rotate, -180, 180) }}
                  onChange={(event) => patch({ rotate: Number(event.target.value) })}
                />
              </label>
              <label className="vee-row">
                <span className="vee-row-label">
                  <span>Zoom</span>
                  <b>{percent(settings.zoom)}</b>
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.01}
                  value={settings.zoom}
                  style={{ ["--p" as string]: percentOf(settings.zoom, 0.5, 2.5) }}
                  onChange={(event) => patch({ zoom: Number(event.target.value) })}
                />
              </label>
            </section>

            <section className="vee-section">
              <div className="vee-section-head">
                <h2>Playback</h2>
              </div>
              <div className="vee-speeds" aria-label="Playback speed">
                {SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className="vee-speed"
                    data-on={String(Math.abs(settings.playbackRate - speed) < 0.001)}
                    onClick={() => patch({ playbackRate: speed }, true)}>
                    {speed}×
                  </button>
                ))}
              </div>
              <label className="vee-row" style={{ marginTop: 10 }}>
                <span className="vee-row-label">
                  <span>Speed</span>
                  <b>{settings.playbackRate.toFixed(2)}×</b>
                </span>
                <input
                  type="range"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={settings.playbackRate}
                  style={{ ["--p" as string]: percentOf(settings.playbackRate, 0.25, 4) }}
                  onChange={(event) =>
                    patch({ playbackRate: Number(event.target.value) }, true)
                  }
                />
              </label>
              <label className="vee-row">
                <span className="vee-row-label">
                  <span>Volume</span>
                  <b>{percent(settings.volume)}</b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.volume}
                  style={{ ["--p" as string]: percentOf(settings.volume, 0, 1) }}
                  onChange={(event) =>
                    patch({ volume: Number(event.target.value), muted: false }, true)
                  }
                />
              </label>
              <div className="vee-actions">
                <button
                  type="button"
                  className="vee-action"
                  data-on={String(settings.preservePitch)}
                  aria-pressed={settings.preservePitch}
                  onClick={() => patch({ preservePitch: !settings.preservePitch }, true)}>
                  Preserve pitch
                </button>
                <button
                  type="button"
                  className="vee-action"
                  data-on={String(settings.muted)}
                  aria-pressed={settings.muted}
                  onClick={() => patch({ muted: !settings.muted }, true)}>
                  Mute
                </button>
                <button
                  type="button"
                  className="vee-action"
                  data-on={String(settings.loop)}
                  aria-pressed={settings.loop}
                  onClick={() => patch({ loop: !settings.loop }, true)}>
                  Loop
                </button>
                <button
                  type="button"
                  className="vee-action"
                  onClick={() => {
                    const video = getActiveVideo()
                    if (video) seekBy(video, -10)
                  }}>
                  −10s
                </button>
                <button
                  type="button"
                  className="vee-action"
                  onClick={() => {
                    const video = getActiveVideo()
                    if (video) seekBy(video, 10)
                  }}>
                  +10s
                </button>
                {document.pictureInPictureEnabled ? (
                  <button
                    type="button"
                    className="vee-action"
                    data-on={String(pipOn)}
                    onClick={() => {
                      const video = getActiveVideo()
                      if (!video) return
                      void togglePictureInPicture(video).catch(() => undefined)
                    }}>
                    Picture in picture
                  </button>
                ) : null}
              </div>
            </section>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        className="vee-launcher"
        aria-expanded={open}
        aria-label={open ? "Close video effects" : "Open video effects"}
        onClick={() => setOpen((value) => !value)}>
        <SlidersIcon />
        {live ? <span className="vee-launcher-dot" /> : null}
      </button>
    </div>
  )
}

function SlidersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h8M16 7h4M4 12h4M12 12h8M4 17h10M18 17h2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="14" cy="7" r="2.15" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="10" cy="12" r="2.15" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16" cy="17" r="2.15" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export default Overlay
