import cssText from "data-text:./overlay.css"
import {
  AudioLines,
  Gauge,
  Clock,
  GripHorizontal,
  Maximize2,
  Minus,
  PictureInPicture2,
  Repeat,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Video,
  Volume2,
  VolumeX,
  X
} from "lucide-react"
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

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
  type DockLayout,
  type DockMode,
  type DockPoint,
  clampDockPoint,
  loadDockLayout,
  loadSiteSettings,
  saveDockLayout,
  saveSiteSettings,
  siteStorageKey
} from "~lib/storage"
import {
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
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

type PanelTab = "video" | "audio" | "playback"

const COLOR_CONTROLS: {
  key: keyof ColorSettings
  label: string
  min: number
  max: number
  step: number
  digits: number
  format: (value: number) => string
  advanced?: boolean
}[] = [
  { key: "brightness", label: "Brightness", min: 0.2, max: 2, step: 0.01, digits: 2, format: percent },
  { key: "contrast", label: "Contrast", min: 0.2, max: 2, step: 0.01, digits: 2, format: percent },
  { key: "saturate", label: "Saturation", min: 0, max: 3, step: 0.01, digits: 2, format: percent },
  { key: "hueRotate", label: "Hue", min: 0, max: 360, step: 1, digits: 0, format: degrees, advanced: true },
  { key: "grayscale", label: "Grayscale", min: 0, max: 1, step: 0.01, digits: 2, format: percent, advanced: true },
  { key: "sepia", label: "Sepia", min: 0, max: 1, step: 0.01, digits: 2, format: percent, advanced: true },
  { key: "invert", label: "Invert", min: 0, max: 1, step: 0.01, digits: 2, format: percent, advanced: true },
  {
    key: "blur",
    label: "Blur",
    min: 0,
    max: 12,
    step: 0.1,
    digits: 1,
    format: (value) => `${value.toFixed(1)} px`,
    advanced: true
  },
  { key: "opacity", label: "Opacity", min: 0.15, max: 1, step: 0.01, digits: 2, format: percent, advanced: true }
]

const SPEEDS = [0.5, 1, 1.5, 2, 3, 4]

const TABS: { id: PanelTab; label: string; icon: typeof Video }[] = [
  { id: "video", label: "Video", icon: Video },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "playback", label: "Playback", icon: Gauge }
]

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function degrees(value: number): string {
  return `${Math.round(value)}°`
}

function formatRate(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return `${rounded.toFixed(2).replace(/\.?0+$/, "")}×`
}

function percentOf(value: number, min: number, max: number): string {
  return `${((value - min) / (max - min)) * 100}%`
}

function readRange(value: string, digits: number): number {
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

function stopEvent(event: { stopPropagation: () => void }): void {
  event.stopPropagation()
}

function withMode(current: DockLayout, mode: DockMode): DockLayout {
  if (current.mode === mode) return current
  if (mode === "max" || current.minPlaced) return { ...current, mode }
  return { ...current, mode, min: current.max }
}

function Overlay() {
  const hostname = location.hostname
  const [settings, setSettings] = useState<EffectSettings>(defaultSettings)
  const [ready, setReady] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)
  const [pipOn, setPipOn] = useState(false)
  const [tab, setTab] = useState<PanelTab>("video")
  const [layout, setLayout] = useState<DockLayout | null>(null)
  const [dragging, setDragging] = useState(false)
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
  const [dockSize, setDockSize] = useState({ width: 332, height: 480 })
  const settingsRef = useRef(settings)
  const readyRef = useRef(false)
  const dirtyRef = useRef(false)
  const bridgeRef = useRef<VideoBridge | null>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<DockLayout | null>(null)
  const pointRef = useRef<DockPoint>({ x: 32, y: 32 })
  const pendingOpen = useRef(false)
  const swallowClick = useRef(false)
  const dragRef = useRef<null | {
    pointerId: number
    originX: number
    originY: number
    startX: number
    startY: number
    slot: "max" | "min"
    fromLauncher: boolean
    moved: boolean
    latest?: DockPoint
  }>(null)

  settingsRef.current = settings
  readyRef.current = ready
  layoutRef.current = layout

  useEffect(() => {
    let alive = true
    void loadSiteSettings(hostname).then((loaded) => {
      if (!alive) return
      setSettings(loaded)
      setReady(true)
    })
    void loadDockLayout().then((loaded) => {
      if (!alive) return
      if (pendingOpen.current) {
        pendingOpen.current = false
        const next = withMode(loaded, "max")
        setLayout(next)
        if (next.mode !== loaded.mode) void saveDockLayout(next)
        return
      }
      setLayout(loaded)
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
  }, [settings, layout?.mode, hasVideo])

  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener("resize", onResize)
    document.addEventListener("fullscreenchange", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      document.removeEventListener("fullscreenchange", onResize)
    }
  }, [])

  useLayoutEffect(() => {
    const node = dockRef.current
    if (!node) return
    const width = node.offsetWidth || 332
    const height = node.offsetHeight || 64
    setDockSize((current) =>
      current.width === width && current.height === height ? current : { width, height }
    )
  }, [layout?.mode, tab, hasVideo, settings.enabled, viewport.width, viewport.height])

  useEffect(() => {
    const reveal = () => {
      setLayout((current) => {
        if (!current) {
          pendingOpen.current = true
          return current
        }
        const next = withMode(current, "max")
        if (next === current) return current
        void saveDockLayout(next)
        return next
      })
    }

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
      if (request?.hostname === hostname) reveal()
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
        reveal()
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
    const next = {
      ...defaultSettings(),
      rememberProgress: settingsRef.current.rememberProgress
    }
    setSettings(next)
    if (video && touched) {
      applyPlayback(video, { ...next, playbackTouched: true, volume: video.volume })
    }
  }

  const setMode = (mode: DockMode) => {
    setLayout((current) => {
      if (!current) return current
      const next = withMode(current, mode)
      if (next === current) return current
      void saveDockLayout(next)
      return next
    })
  }

  const onDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const current = layoutRef.current
    if (!current) return
    const fromLauncher = event.currentTarget.classList.contains("vee-launcher")
    const target = event.target instanceof Element ? event.target : null
    if (!fromLauncher && target?.closest("button, input, textarea, a, label")) {
      return
    }
    const slot = current.mode === "max" ? "max" : "min"
    const origin = pointRef.current
    dragRef.current = {
      pointerId: event.pointerId,
      originX: origin.x,
      originY: origin.y,
      startX: event.clientX,
      startY: event.clientY,
      slot,
      fromLauncher,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    setDragging(true)
    const latest = clampDockPoint(
      { x: drag.originX + dx, y: drag.originY - dy },
      {
        width: window.innerWidth,
        height: window.innerHeight,
        dockWidth: dockRef.current?.offsetWidth ?? dockSize.width,
        dockHeight: dockRef.current?.offsetHeight ?? dockSize.height
      }
    )
    drag.latest = latest
    setLayout((current) => {
      if (!current) return current
      return {
        ...current,
        [drag.slot]: latest,
        minPlaced: drag.slot === "min" ? true : current.minPlaced
      }
    })
  }

  const onDragEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (!drag.moved || !drag.latest) return
    if (drag.fromLauncher) {
      swallowClick.current = true
      window.setTimeout(() => {
        swallowClick.current = false
      }, 0)
    }
    const latest = drag.latest
    const slot = drag.slot
    setLayout((current) => {
      if (!current) return current
      const next: DockLayout = {
        ...current,
        [slot]: latest,
        minPlaced: slot === "min" ? true : current.minPlaced
      }
      void saveDockLayout(next)
      return next
    })
  }

  const dragHandlers = {
    onPointerDown: onDragStart,
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragEnd
  }

  const live = settings.enabled && (!isVisualIdentity(settings) || settings.playbackTouched)
  const rate = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, settings.playbackRate))

  if (!hasVideo || !layout) return null

  const point = clampDockPoint(layout.mode === "max" ? layout.max : layout.min, {
    width: viewport.width,
    height: viewport.height,
    dockWidth: dockSize.width,
    dockHeight: dockSize.height
  })
  pointRef.current = point

  return (
    <div
      ref={dockRef}
      className="vee-dock"
      data-dragging={dragging ? "true" : "false"}
      style={{ left: `${point.x}px`, bottom: `${point.y}px` }}
      onPointerDown={stopEvent}
      onKeyDown={stopEvent}
      onWheel={stopEvent}>
      {layout.mode === "closed" ? (
        <button
          type="button"
          className="vee-launcher"
          aria-label="Open video effects"
          {...dragHandlers}
          onClick={() => {
            if (swallowClick.current) {
              swallowClick.current = false
              return
            }
            setMode("max")
          }}>
          <SlidersHorizontal size={20} strokeWidth={1.75} />
          {live ? <span className="vee-launcher-dot" /> : null}
        </button>
      ) : null}

      {layout.mode === "min" ? (
        <div className="vee-minibar" aria-label="Video effects minimized" {...dragHandlers}>
          <GripHorizontal className="vee-grip" size={16} strokeWidth={1.75} />
          <div className="vee-mini-copy">
            <strong>Video Effects</strong>
            <span>{settings.enabled ? "Effects on" : "Effects off"}</span>
          </div>
          {live ? <span className="vee-mini-dot" /> : null}
          <button
            type="button"
            className="vee-icon-btn"
            aria-label="Maximize"
            title="Maximize"
            onClick={() => setMode("max")}>
            <Maximize2 size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="vee-icon-btn"
            data-kind="close"
            aria-label="Close"
            title="Close"
            onClick={() => setMode("closed")}>
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
      ) : null}

      {layout.mode === "max" ? (
        <section className={`vee-panel${settings.enabled ? "" : " is-off"}`} aria-label="Video effects">
          <header className="vee-header" {...dragHandlers}>
            <GripHorizontal className="vee-grip" size={16} strokeWidth={1.75} />
            <div className="vee-title">
              <strong>Video Effects</strong>
              <span>{settings.enabled ? "On this video" : "Effects are off"}</span>
            </div>
            <div className="vee-header-actions">
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
              <button
                type="button"
                className="vee-icon-btn"
                aria-label="Minimize"
                title="Minimize"
                onClick={() => setMode("min")}>
                <Minus size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="vee-icon-btn"
                data-kind="close"
                aria-label="Close"
                title="Close"
                onClick={() => setMode("closed")}>
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
          </header>

          <div className="vee-tabs" role="tablist" aria-label="Effect groups">
            {TABS.map((item) => {
              const Icon = item.icon
              const selected = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className="vee-tab"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(item.id)}>
                  <Icon size={15} strokeWidth={1.75} />
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="vee-body">
            {tab === "video" ? (
              <>
                <Group title="Basic">
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
                  {COLOR_CONTROLS.filter((control) => !control.advanced).map((control) => (
                    <Slider
                      key={control.key}
                      label={control.label}
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={settings[control.key]}
                      display={control.format(settings[control.key])}
                      onChange={(value) =>
                        patch({
                          [control.key]: readRange(String(value), control.digits),
                          presetId: "custom"
                        })
                      }
                    />
                  ))}
                  <Slider
                    label="Zoom"
                    min={0.5}
                    max={2.5}
                    step={0.01}
                    value={settings.zoom}
                    display={percent(settings.zoom)}
                    onChange={(value) => patch({ zoom: readRange(String(value), 2) })}
                  />
                </Group>
                <Group title="Advanced" advanced>
                  {COLOR_CONTROLS.filter((control) => control.advanced).map((control) => (
                    <Slider
                      key={control.key}
                      label={control.label}
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={settings[control.key]}
                      display={control.format(settings[control.key])}
                      onChange={(value) =>
                        patch({
                          [control.key]: readRange(String(value), control.digits),
                          presetId: "custom"
                        })
                      }
                    />
                  ))}
                  <div className="vee-actions">
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
                  <Slider
                    label="Rotate"
                    min={-180}
                    max={180}
                    step={1}
                    value={settings.rotate}
                    display={degrees(settings.rotate)}
                    onChange={(value) => patch({ rotate: readRange(String(value), 0) })}
                  />
                </Group>
              </>
            ) : null}

            {tab === "audio" ? (
              <>
                <Group title="Basic">
                  <Slider
                    label="Volume"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.volume}
                    display={percent(settings.volume)}
                    onChange={(value) =>
                      patch({ volume: readRange(String(value), 2), muted: false }, true)
                    }
                  />
                  <div className="vee-actions">
                    <button
                      type="button"
                      className="vee-action"
                      data-on={String(settings.muted)}
                      aria-pressed={settings.muted}
                      onClick={() => patch({ muted: !settings.muted }, true)}>
                      {settings.muted ? (
                        <VolumeX size={14} strokeWidth={1.75} />
                      ) : (
                        <Volume2 size={14} strokeWidth={1.75} />
                      )}
                      {settings.muted ? "Muted" : "Mute"}
                    </button>
                  </div>
                </Group>
                <Group title="Advanced" advanced>
                  <button
                    type="button"
                    className="vee-action"
                    data-on={String(settings.preservePitch)}
                    aria-pressed={settings.preservePitch}
                    onClick={() => patch({ preservePitch: !settings.preservePitch }, true)}>
                    <AudioLines size={14} strokeWidth={1.75} />
                    Preserve pitch
                  </button>
                  <p className="vee-hint">Keeps voices natural when the speed is not 1×.</p>
                </Group>
              </>
            ) : null}

            {tab === "playback" ? (
              <>
                <Group title="Basic">
                  <Slider
                    label="Speed"
                    min={PLAYBACK_RATE_MIN}
                    max={PLAYBACK_RATE_MAX}
                    step={0.05}
                    value={rate}
                    display={formatRate(rate)}
                    onChange={(value) =>
                      patch(
                        {
                          playbackRate: Math.min(
                            PLAYBACK_RATE_MAX,
                            Math.max(PLAYBACK_RATE_MIN, readRange(String(value), 2))
                          )
                        },
                        true
                      )
                    }
                  />
                  <div className="vee-scale" aria-hidden="true">
                    <span>{formatRate(PLAYBACK_RATE_MIN)}</span>
                    <span>{formatRate(PLAYBACK_RATE_MAX)}</span>
                  </div>
                  <div className="vee-speeds" aria-label="Playback speed">
                    {SPEEDS.map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        className="vee-speed"
                        data-on={String(Math.abs(rate - speed) < 0.001)}
                        onClick={() => patch({ playbackRate: speed }, true)}>
                        {formatRate(speed)}
                      </button>
                    ))}
                  </div>
                  <div className="vee-actions">
                    <button
                      type="button"
                      className="vee-action"
                      onClick={() => {
                        const video = getActiveVideo()
                        if (video) seekBy(video, -10)
                      }}>
                      <SkipBack size={14} strokeWidth={1.75} />
                      10s
                    </button>
                    <button
                      type="button"
                      className="vee-action"
                      onClick={() => {
                        const video = getActiveVideo()
                        if (video) seekBy(video, 10)
                      }}>
                      <SkipForward size={14} strokeWidth={1.75} />
                      10s
                    </button>
                    <button
                      type="button"
                      className="vee-action"
                      data-on={String(settings.loop)}
                      aria-pressed={settings.loop}
                      onClick={() => patch({ loop: !settings.loop }, true)}>
                      <Repeat size={14} strokeWidth={1.75} />
                      Loop
                    </button>
                  </div>
                </Group>
                <Group title="Advanced" advanced>
                  <div className="vee-switch-row">
                    <div>
                      <span>
                        <Clock size={14} strokeWidth={1.75} />
                        Resume where you left off
                      </span>
                      <small>
                        Saves this video every few seconds and continues from that moment after you
                        close the browser or restart.
                      </small>
                    </div>
                    <button
                      className="vee-switch"
                      type="button"
                      role="switch"
                      aria-checked={settings.rememberProgress}
                      aria-label="Resume where you left off"
                      data-on={String(settings.rememberProgress)}
                      onClick={() => patch({ rememberProgress: !settings.rememberProgress })}>
                      <i />
                    </button>
                  </div>
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
                      <PictureInPicture2 size={14} strokeWidth={1.75} />
                      Picture in picture
                    </button>
                  ) : null}
                </Group>
              </>
            ) : null}

            <button type="button" className="vee-reset" onClick={resetEffects}>
              Reset all
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function Group({
  title,
  advanced = false,
  children
}: {
  title: string
  advanced?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={advanced ? "vee-group is-advanced" : "vee-group"}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange: (value: number) => void
}) {
  return (
    <label className="vee-row">
      <span className="vee-row-label">
        <span>{label}</span>
        <b>{display}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--p" as string]: percentOf(value, min, max) }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export default Overlay
