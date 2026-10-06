import cssText from "data-text:./overlay.css"
import {
  AudioLines,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Gauge,
  GripHorizontal,
  Layers,
  Link2,
  Maximize2,
  Minus,
  PictureInPicture2,
  Power,
  Repeat,
  RotateCcw,
  Settings2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Unlink2,
  Video,
  Volume2,
  VolumeX,
  X
} from "lucide-react"
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

import {
  HOST_ID,
  getActiveVideo,
  repositionDock,
  startVideoBridge,
  type VideoBridge
} from "~lib/bridge"
import {
  CROP_MAX,
  SECTION_FIELDS,
  STRETCH_MAX,
  STRETCH_MIN,
  effectiveSettings,
  isVisualIdentity,
  releasePlayback,
  seekBy,
  togglePictureInPicture,
  type SectionFlag
} from "~lib/effects"
import {
  PROGRESS_KEY,
  clearProgress,
  deleteProgress,
  formatClock,
  listProgress,
  type SavedProgress
} from "~lib/progress"
import { PRESETS, presetById, snapshotFrom, type UserPreset } from "~lib/presets"
import { HEAVY_APPLY_DELAY_MS, LIGHT_APPLY_DELAY_MS } from "~settings"
import {
  MAX_USER_PRESETS,
  OPEN_MESSAGE,
  OPEN_REQUEST_KEY,
  USER_PRESETS_KEY,
  type DockBox,
  type DockLayout,
  type DockMode,
  type Viewport,
  clampDockBox,
  loadDockLayout,
  loadSiteSettings,
  loadUserPresets,
  normalizeSettings,
  resizeDockBox,
  sanitizeUserPresets,
  saveDockLayout,
  saveSiteSettings,
  saveUserPresets,
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

type ApplyTiming = "now" | "light" | "heavy"
const PANEL_EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]
const BAR_EDGES = ["w", "e"]

const JUMPS: { delta: number; label: string; icon: typeof SkipBack }[] = [
  { delta: -20, label: "Back 20 seconds", icon: SkipBack },
  { delta: -10, label: "Back 10 seconds", icon: ChevronsLeft },
  { delta: -5, label: "Back 5 seconds", icon: ChevronLeft },
  { delta: 5, label: "Forward 5 seconds", icon: ChevronRight },
  { delta: 10, label: "Forward 10 seconds", icon: ChevronsRight },
  { delta: 20, label: "Forward 20 seconds", icon: SkipForward }
]

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
  return { ...current, mode }
}

function viewportNow(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

function pointerOnCircleRim(
  event: { clientX: number; clientY: number },
  element: HTMLElement
): boolean {
  const rect = element.getBoundingClientRect()
  const radius = rect.width / 2
  const dist = Math.hypot(event.clientX - (rect.left + radius), event.clientY - (rect.top + radius))
  return radius - dist <= 8
}

function tabFlag(tab: PanelTab): "videoEnabled" | "audioEnabled" | "playbackEnabled" {
  if (tab === "video") return "videoEnabled"
  if (tab === "audio") return "audioEnabled"
  return "playbackEnabled"
}

function tabNoun(tab: PanelTab): string {
  if (tab === "video") return "video"
  if (tab === "audio") return "audio"
  return "playback"
}

function sectionTouchesMedia(flag: SectionFlag): boolean {
  return flag === "basicAudioOn" || flag === "advancedAudioOn" || flag === "basicPlaybackOn"
}

function sectionIsVisual(flag: SectionFlag): boolean {
  return flag === "basicVideoOn" || flag === "frameOn" || flag === "advancedVideoOn"
}

function Overlay() {
  const hostname = location.hostname
  const [settings, setSettings] = useState<EffectSettings>(defaultSettings)
  const [ready, setReady] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)
  const [pipOn, setPipOn] = useState(false)
  const [tab, setTab] = useState<PanelTab>("video")
  const [userPresets, setUserPresets] = useState<UserPreset[]>([])
  const [presetName, setPresetName] = useState("")
  const [presetOpen, setPresetOpen] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [progressRows, setProgressRows] = useState<SavedProgress[]>([])
  const [layout, setLayout] = useState<DockLayout | null>(null)
  const [dragging, setDragging] = useState(false)
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
  const settingsRef = useRef(settings)
  const appliedRef = useRef(settings)
  const readyRef = useRef(false)
  const dirtyRef = useRef(false)
  const applyTimer = useRef(0)
  const applyDelayRef = useRef(0)
  const inflightSaves = useRef<EffectSettings[]>([])
  const bridgeRef = useRef<VideoBridge | null>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const presetMenuRef = useRef<HTMLDivElement>(null)
  const presetButtonRef = useRef<HTMLButtonElement>(null)
  const layoutRef = useRef<DockLayout | null>(null)
  const pendingOpen = useRef(false)
  const swallowClick = useRef(false)
  const dragRef = useRef<null | {
    pointerId: number
    originX: number
    originY: number
    startX: number
    startY: number
    slot: DockMode
    box: DockBox
    fromLauncher: boolean
    moved: boolean
    latest?: DockBox
  }>(null)
  const resizeRef = useRef<null | {
    pointerId: number
    edge: string
    startX: number
    startY: number
    box: DockBox
    slot: DockMode
    moved: boolean
    latest?: DockBox
  }>(null)

  settingsRef.current = settings
  readyRef.current = ready
  layoutRef.current = layout

  useEffect(() => {
    let alive = true
    void loadSiteSettings(hostname).then((loaded) => {
      if (!alive) return
      settingsRef.current = loaded
      appliedRef.current = loaded
      setSettings(loaded)
      setReady(true)
    })
    void loadUserPresets().then((loaded) => {
      if (!alive) return
      setUserPresets(loaded)
    })
    void listProgress().then((rows) => {
      if (!alive) return
      setProgressRows(rows)
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
      const snapshot = settingsRef.current
      inflightSaves.current = [...inflightSaves.current, snapshot]
      dirtyRef.current = false
      void saveSiteSettings(hostname, snapshot)
    }, LIGHT_APPLY_DELAY_MS)
    return () => window.clearTimeout(handle)
  }, [settings, ready, hostname])

  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current) return
      const snapshot = settingsRef.current
      inflightSaves.current = [...inflightSaves.current, snapshot]
      dirtyRef.current = false
      void saveSiteSettings(hostname, snapshot)
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      window.clearTimeout(applyTimer.current)
    }
  }, [hostname])

  useEffect(() => {
    if (!ready) return
    const bridge = startVideoBridge({
      getSettings: () => effectiveSettings(appliedRef.current),
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
        if (settingsEqual(settingsRef.current, next)) return
        settingsRef.current = next
        if (!applyTimer.current) appliedRef.current = next
        setSettings(next)
      }
    })
    bridgeRef.current = bridge
    return () => {
      bridge.stop()
      bridgeRef.current = null
    }
  }, [ready])

  useEffect(() => {
    repositionDock()
  }, [layout?.mode, hasVideo])

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
        const incoming = normalizeSettings(stored)
        const pending = inflightSaves.current
        const index = pending.findIndex((item) => settingsEqual(item, incoming))
        if (index >= 0) {
          inflightSaves.current = pending.slice(index + 1)
        } else if (!dirtyRef.current && !settingsEqual(settingsRef.current, incoming)) {
          window.clearTimeout(applyTimer.current)
          applyTimer.current = 0
          applyDelayRef.current = 0
          settingsRef.current = incoming
          appliedRef.current = incoming
          setSettings(incoming)
          bridgeRef.current?.applyNow()
        }
      }
      if (changes[USER_PRESETS_KEY]) {
        setUserPresets(sanitizeUserPresets(changes[USER_PRESETS_KEY].newValue))
      }
      if (changes[PROGRESS_KEY]) void listProgress().then(setProgressRows)
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

  useEffect(() => {
    if (!presetOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath()
      if (presetMenuRef.current && path.includes(presetMenuRef.current)) return
      if (presetButtonRef.current && path.includes(presetButtonRef.current)) return
      setPresetOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresetOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [presetOpen])

  const patch = (next: Partial<EffectSettings>, touchPlayback = false, timing: ApplyTiming = "now") => {
    dirtyRef.current = true
    const merged: EffectSettings = {
      ...settingsRef.current,
      ...next,
      playbackTouched: touchPlayback ? true : settingsRef.current.playbackTouched
    }
    settingsRef.current = merged
    setSettings(merged)
    const pendingDelay = applyTimer.current !== 0 ? applyDelayRef.current : 0
    window.clearTimeout(applyTimer.current)
    applyTimer.current = 0
    const delay = timing === "heavy" ? HEAVY_APPLY_DELAY_MS : LIGHT_APPLY_DELAY_MS
    if (timing === "now") {
      appliedRef.current = {
        ...appliedRef.current,
        ...next,
        playbackTouched: touchPlayback ? true : appliedRef.current.playbackTouched
      }
      bridgeRef.current?.applyNow()
      if (!pendingDelay) return
    }
    const wait = timing === "now" ? pendingDelay : delay
    applyDelayRef.current = wait
    applyTimer.current = window.setTimeout(() => {
      applyTimer.current = 0
      applyDelayRef.current = 0
      appliedRef.current = settingsRef.current
      bridgeRef.current?.applyNow()
    }, wait)
  }

  const resetEffects = () => {
    const video = getActiveVideo()
    dirtyRef.current = true
    const next = {
      ...defaultSettings(),
      rememberProgress: settingsRef.current.rememberProgress,
      showNativeControls: settingsRef.current.showNativeControls
    }
    window.clearTimeout(applyTimer.current)
    applyTimer.current = 0
    applyDelayRef.current = 0
    settingsRef.current = next
    appliedRef.current = next
    setSettings(next)
    if (video) releasePlayback(video)
    bridgeRef.current?.applyNow()
  }

  const sectionOpen = (id: string) => openSections[id] !== false

  const toggleSection = (id: string) => {
    setOpenSections((current) => ({ ...current, [id]: current[id] === false }))
  }

  const resetSection = (flag: SectionFlag) => {
    const defaults = defaultSettings()
    const next: Partial<EffectSettings> = { [flag]: true, presetId: "custom" }
    for (const key of SECTION_FIELDS[flag]) next[key] = defaults[key] as never
    const media = sectionTouchesMedia(flag)
    patch(next, media, sectionIsVisual(flag) ? "heavy" : media ? "light" : "now")
  }

  const toggleSectionApply = (flag: SectionFlag) => {
    const media = sectionTouchesMedia(flag)
    patch(
      { [flag]: !settingsRef.current[flag] },
      media,
      sectionIsVisual(flag) ? "heavy" : media ? "light" : "now"
    )
  }

  const savePreset = () => {
    const label = presetName.trim().slice(0, 24)
    if (!label) return
    const preset: UserPreset = {
      id: `user:${crypto.randomUUID()}`,
      label,
      snapshot: snapshotFrom(settingsRef.current)
    }
    const next = [...userPresets, preset].slice(-MAX_USER_PRESETS)
    setUserPresets(next)
    setPresetName("")
    void saveUserPresets(next)
    patch({ presetId: preset.id })
  }

  const applyUserPreset = (preset: UserPreset) => {
    patch({ ...preset.snapshot, presetId: preset.id }, true)
    setPresetOpen(false)
  }

  const removePreset = (id: string) => {
    const next = userPresets.filter((preset) => preset.id !== id)
    setUserPresets(next)
    void saveUserPresets(next)
    if (settingsRef.current.presetId === id) patch({ presetId: "custom" })
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

  const rememberLayout = (slot: DockMode, box: DockBox) => {
    setLayout((current) => {
      if (!current) return current
      const next: DockLayout = { ...current, [slot]: box }
      layoutRef.current = next
      void saveDockLayout(next)
      return next
    })
  }

  const previewLayout = (slot: DockMode, box: DockBox) => {
    setLayout((current) => {
      if (!current) return current
      const next: DockLayout = { ...current, [slot]: box }
      layoutRef.current = next
      return next
    })
  }

  const beginResize = (event: ReactPointerEvent<HTMLElement>, edge: string) => {
    if (event.button !== 0) return
    const current = layoutRef.current
    if (!current) return
    const slot = current.mode
    const resolved = clampDockBox(current[slot], viewportNow())
    resizeRef.current = {
      pointerId: event.pointerId,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      box: { ...resolved, pinned: false },
      slot,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.stopPropagation()
  }

  const onDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const current = layoutRef.current
    if (!current) return
    const fromLauncher = event.currentTarget.classList.contains("vee-launcher")
    if (fromLauncher && pointerOnCircleRim(event, event.currentTarget)) {
      beginResize(event, "circle")
      return
    }
    const target = event.target instanceof Element ? event.target : null
    if (!fromLauncher && target?.closest("button, input, textarea, a, label")) {
      return
    }
    const slot = current.mode
    const resolved = clampDockBox(current[slot], viewportNow())
    dragRef.current = {
      pointerId: event.pointerId,
      originX: resolved.x,
      originY: resolved.y,
      startX: event.clientX,
      startY: event.clientY,
      slot,
      box: { ...resolved, pinned: false },
      fromLauncher,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const resize = resizeRef.current
    if (resize && resize.pointerId === event.pointerId) {
      const dx = event.clientX - resize.startX
      const dy = event.clientY - resize.startY
      if (!resize.moved && Math.hypot(dx, dy) < 3) return
      resize.moved = true
      setDragging(true)
      const latest = resizeDockBox(resize.box, resize.edge, dx, dy, resize.slot, viewportNow(), {
        x: event.clientX,
        y: event.clientY
      })
      resize.latest = latest
      previewLayout(resize.slot, latest)
      return
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    setDragging(true)
    const latest = clampDockBox(
      {
        ...drag.box,
        x: drag.originX + dx,
        y: drag.originY - dy,
        pinned: false
      },
      viewportNow()
    )
    drag.latest = latest
    previewLayout(drag.slot, latest)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const resize = resizeRef.current
    if (resize && resize.pointerId === event.pointerId) {
      const moved = resize.moved
      const slot = resize.slot
      const latest = resize.latest
      resizeRef.current = null
      setDragging(false)
      if (moved && slot === "closed") {
        swallowClick.current = true
        window.setTimeout(() => {
          swallowClick.current = false
        }, 0)
      }
      if (moved && latest) rememberLayout(slot, latest)
      return
    }

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
    rememberLayout(drag.slot, drag.latest)
  }

  const dragHandlers = {
    onPointerDown: onDragStart,
    onPointerMove: onPointerMove,
    onPointerUp: onPointerUp,
    onPointerCancel: onPointerUp
  }

  const painted = effectiveSettings(settings)
  const live =
    settings.enabled &&
    ((settings.videoEnabled && !isVisualIdentity(painted)) ||
      (settings.playbackTouched && (settings.audioEnabled || settings.playbackEnabled)))
  const rate = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, settings.playbackRate))

  if (!hasVideo || !layout) return null

  const box = clampDockBox(layout[layout.mode], viewport)
  const tabOn = settings[tabFlag(tab)]
  const noun = tabNoun(tab)

  return (
    <div
      ref={dockRef}
      className="vee-dock"
      data-dragging={dragging ? "true" : "false"}
      style={{
        left: `${box.x}px`,
        bottom: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`
      }}
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

      {layout.mode === "min"
        ? BAR_EDGES.map((edge) => (
            <div
              key={edge}
              className="vee-resize is-bar"
              data-edge={edge}
              onPointerDown={(event) => beginResize(event, edge)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          ))
        : null}

      {layout.mode === "max" ? (
        <section className={`vee-panel${settings.enabled ? "" : " is-off"}`} aria-label="Video effects">
          <header className="vee-header" {...dragHandlers}>
            <GripHorizontal className="vee-grip" size={16} strokeWidth={1.75} />
            <button
              type="button"
              className="vee-icon-btn vee-power"
              role="switch"
              aria-checked={settings.enabled}
              aria-label={settings.enabled ? "Turn effects off" : "Turn effects on"}
              title={settings.enabled ? "Effects on" : "Effects off"}
              data-on={String(settings.enabled)}
              onClick={() => patch({ enabled: !settings.enabled })}>
              <Power size={15} strokeWidth={1.75} />
            </button>
            <div className="vee-title">
              <strong>Video Effects</strong>
              <span>{settings.enabled ? "On this video" : "Effects are off"}</span>
            </div>
            <div className="vee-header-actions">
              <button
                ref={presetButtonRef}
                type="button"
                className="vee-icon-btn"
                aria-label="Presets"
                aria-expanded={presetOpen}
                title="Presets"
                data-on={String(presetOpen)}
                onClick={() => setPresetOpen((open) => !open)}>
                <Layers size={15} strokeWidth={1.75} />
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
            {presetOpen ? (
              <div className="vee-preset-menu" ref={presetMenuRef} onPointerDown={stopEvent}>
                <div className="vee-preset-menu-head">
                  <strong>Presets</strong>
                  <button
                    type="button"
                    className="vee-icon-btn vee-section-btn"
                    aria-label="Close presets"
                    title="Close"
                    onClick={() => setPresetOpen(false)}>
                    <X size={13} strokeWidth={1.75} />
                  </button>
                </div>
                {userPresets.length === 0 ? (
                  <p className="vee-preset-empty">No saved presets yet.</p>
                ) : (
                  <div className="vee-preset-list" role="listbox" aria-label="Saved presets">
                    {userPresets.map((preset) => (
                      <div
                        key={preset.id}
                        className="vee-preset-item"
                        data-on={String(settings.presetId === preset.id)}>
                        <button
                          type="button"
                          className="vee-preset-apply"
                          role="option"
                          aria-selected={settings.presetId === preset.id}
                          onClick={() => applyUserPreset(preset)}>
                          {preset.label}
                        </button>
                        <button
                          type="button"
                          className="vee-icon-btn vee-preset-delete"
                          aria-label={`Delete ${preset.label}`}
                          title="Delete preset"
                          onClick={() => removePreset(preset.id)}>
                          <Trash2 size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="vee-preset-save">
                  <input
                    type="text"
                    maxLength={24}
                    placeholder="Save current as preset"
                    aria-label="Preset name"
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") savePreset()
                    }}
                  />
                  <button type="button" disabled={!presetName.trim()} onClick={savePreset}>
                    Save
                  </button>
                </div>
              </div>
            ) : null}
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

          <div className={`vee-body${tabOn ? "" : " is-bypassed"}`}>
            {tab === "video" ? (
              <>
                <Group
                  id="video-basic"
                  title="Basic"
                  icon={SlidersHorizontal}
                  open={sectionOpen("video-basic")}
                  onToggle={() => toggleSection("video-basic")}
                  applied={settings.basicVideoOn}
                  onApply={() => toggleSectionApply("basicVideoOn")}
                  onReset={() => resetSection("basicVideoOn")}>
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
                        patch(
                          {
                            [control.key]: readRange(String(value), control.digits),
                            presetId: "custom"
                          },
                          false,
                          "heavy"
                        )
                      }
                    />
                  ))}
                </Group>
                <Group
                  id="video-frame"
                  title="Frame"
                  icon={Crop}
                  open={sectionOpen("video-frame")}
                  onToggle={() => toggleSection("video-frame")}
                  applied={settings.frameOn}
                  onApply={() => toggleSectionApply("frameOn")}
                  onReset={() => resetSection("frameOn")}>
                  <div className="vee-frame-block">
                    <h4 className="vee-subhead">Aspect ratio</h4>
                    <Slider
                      label="Stretch width"
                      min={STRETCH_MIN}
                      max={STRETCH_MAX}
                      step={0.01}
                      value={settings.stretchX}
                      display={percent(settings.stretchX)}
                      onChange={(value) =>
                        patch({ stretchX: readRange(String(value), 2), presetId: "custom" }, false, "heavy")
                      }
                    />
                    <Slider
                      label="Stretch height"
                      min={STRETCH_MIN}
                      max={STRETCH_MAX}
                      step={0.01}
                      value={settings.stretchY}
                      display={percent(settings.stretchY)}
                      onChange={(value) =>
                        patch({ stretchY: readRange(String(value), 2), presetId: "custom" }, false, "heavy")
                      }
                    />
                  </div>
                  <div className="vee-frame-block">
                    <h4 className="vee-subhead">Crop</h4>
                  <CropAxis
                    title="Horizontal"
                    linked={settings.linkCropX}
                    onToggleLink={() => {
                      if (settings.linkCropX) patch({ linkCropX: false })
                      else {
                        patch(
                          {
                            linkCropX: true,
                            cropRight: settings.cropLeft,
                            presetId: "custom"
                          },
                          false,
                          "heavy"
                        )
                      }
                    }}
                    pairLabel=""
                    startLabel="Left"
                    endLabel="Right"
                    start={settings.cropLeft}
                    end={settings.cropRight}
                    onPair={(value) =>
                      patch(
                        { cropLeft: value, cropRight: value, presetId: "custom" },
                        false,
                        "heavy"
                      )
                    }
                    onStart={(value) =>
                      patch({ cropLeft: value, presetId: "custom" }, false, "heavy")
                    }
                    onEnd={(value) =>
                      patch({ cropRight: value, presetId: "custom" }, false, "heavy")
                    }
                  />
                  <CropAxis
                    title="Vertical"
                    linked={settings.linkCropY}
                    onToggleLink={() => {
                      if (settings.linkCropY) patch({ linkCropY: false })
                      else {
                        patch(
                          {
                            linkCropY: true,
                            cropBottom: settings.cropTop,
                            presetId: "custom"
                          },
                          false,
                          "heavy"
                        )
                      }
                    }}
                    pairLabel=""
                    startLabel="Top"
                    endLabel="Bottom"
                    start={settings.cropTop}
                    end={settings.cropBottom}
                    onPair={(value) =>
                      patch(
                        { cropTop: value, cropBottom: value, presetId: "custom" },
                        false,
                        "heavy"
                      )
                    }
                    onStart={(value) =>
                      patch({ cropTop: value, presetId: "custom" }, false, "heavy")
                    }
                    onEnd={(value) =>
                      patch({ cropBottom: value, presetId: "custom" }, false, "heavy")
                    }
                  />
                  </div>
                  <Slider
                    label="Zoom"
                    min={0.5}
                    max={2.5}
                    step={0.01}
                    value={settings.zoom}
                    display={percent(settings.zoom)}
                    onChange={(value) =>
                      patch({ zoom: readRange(String(value), 2), presetId: "custom" }, false, "heavy")
                    }
                  />
                  <div className="vee-row">
                    <span className="vee-row-label">
                      <span className="vee-rotate-label">
                        Rotate
                        <button
                          type="button"
                          className="vee-icon-btn"
                          data-on={String(settings.flipH)}
                          aria-pressed={settings.flipH}
                          aria-label="Flip horizontal"
                          title="Flip horizontal"
                          onClick={() => patch({ flipH: !settings.flipH, presetId: "custom" })}>
                          <FlipHorizontal2 size={14} strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          className="vee-icon-btn"
                          data-on={String(settings.flipV)}
                          aria-pressed={settings.flipV}
                          aria-label="Flip vertical"
                          title="Flip vertical"
                          onClick={() => patch({ flipV: !settings.flipV, presetId: "custom" })}>
                          <FlipVertical2 size={14} strokeWidth={1.75} />
                        </button>
                      </span>
                      <b>{degrees(settings.rotate)}</b>
                    </span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={settings.rotate}
                      style={{ ["--p" as string]: percentOf(settings.rotate, -180, 180) }}
                      onChange={(event) =>
                        patch(
                          { rotate: readRange(event.target.value, 0), presetId: "custom" },
                          false,
                          "heavy"
                        )
                      }
                    />
                  </div>
                </Group>
                <Group
                  id="video-advanced"
                  title="Advanced"
                  icon={Sparkles}
                  open={sectionOpen("video-advanced")}
                  onToggle={() => toggleSection("video-advanced")}
                  applied={settings.advancedVideoOn}
                  onApply={() => toggleSectionApply("advancedVideoOn")}
                  onReset={() => resetSection("advancedVideoOn")}>
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
                        patch(
                          {
                            [control.key]: readRange(String(value), control.digits),
                            presetId: "custom"
                          },
                          false,
                          "heavy"
                        )
                      }
                    />
                  ))}
                </Group>
              </>
            ) : null}

            {tab === "audio" ? (
              <>
                <Group
                  id="audio-basic"
                  title="Basic"
                  icon={Volume2}
                  open={sectionOpen("audio-basic")}
                  onToggle={() => toggleSection("audio-basic")}
                  applied={settings.basicAudioOn}
                  onApply={() => toggleSectionApply("basicAudioOn")}
                  onReset={() => resetSection("basicAudioOn")}>
                  <Slider
                    label="Volume"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.volume}
                    display={percent(settings.volume)}
                    onChange={(value) =>
                      patch({ volume: readRange(String(value), 2), muted: false }, true, "light")
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
                <Group
                  id="audio-advanced"
                  title="Advanced"
                  icon={AudioLines}
                  open={sectionOpen("audio-advanced")}
                  onToggle={() => toggleSection("audio-advanced")}
                  applied={settings.advancedAudioOn}
                  onApply={() => toggleSectionApply("advancedAudioOn")}
                  onReset={() => resetSection("advancedAudioOn")}>
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
                <Group
                  id="playback-basic"
                  title="Basic"
                  icon={Gauge}
                  open={sectionOpen("playback-basic")}
                  onToggle={() => toggleSection("playback-basic")}
                  applied={settings.basicPlaybackOn}
                  onApply={() => toggleSectionApply("basicPlaybackOn")}
                  onReset={() => resetSection("basicPlaybackOn")}>
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
                        true,
                        "light"
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
                      data-on={String(settings.loop)}
                      aria-pressed={settings.loop}
                      onClick={() => patch({ loop: !settings.loop }, true)}>
                      <Repeat size={14} strokeWidth={1.75} />
                      Loop
                    </button>
                  </div>
                </Group>
                <Group
                  id="playback-jump"
                  title="Jump"
                  icon={ChevronsRight}
                  open={sectionOpen("playback-jump")}
                  onToggle={() => toggleSection("playback-jump")}>
                  <div className="vee-jumps" aria-label="Jump">
                    {JUMPS.map((jump) => {
                      const Icon = jump.icon
                      return (
                        <button
                          key={jump.delta}
                          type="button"
                          className="vee-jump"
                          title={jump.label}
                          aria-label={jump.label}
                          onClick={() => {
                            const video = getActiveVideo()
                            if (video) seekBy(video, jump.delta)
                          }}>
                          <Icon size={15} strokeWidth={1.75} />
                        </button>
                      )
                    })}
                  </div>
                </Group>
                <Group
                  id="playback-advanced"
                  title="Advanced"
                  icon={Settings2}
                  open={sectionOpen("playback-advanced")}
                  onToggle={() => toggleSection("playback-advanced")}
                  applied={settings.advancedPlaybackOn}
                  onApply={() => toggleSectionApply("advancedPlaybackOn")}
                  onReset={() => resetSection("advancedPlaybackOn")}>
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
                  <div className="vee-progress-list">
                    {progressRows.length === 0 ? (
                      <p className="vee-hint">No saved videos yet.</p>
                    ) : (
                      progressRows.map((row) => (
                        <div key={row.key} className="vee-progress-row">
                          <div>
                            <span title={row.label}>{row.label}</span>
                            <small>{formatClock(row.time)}</small>
                          </div>
                          <button
                            type="button"
                            className="vee-chip-x"
                            aria-label={`Clear ${row.label}`}
                            title="Clear"
                            onClick={() => deleteProgress(row.key)}>
                            <X size={11} strokeWidth={2} />
                          </button>
                        </div>
                      ))
                    )}
                    {progressRows.length > 0 ? (
                      <button type="button" className="vee-action vee-progress-clear" onClick={() => clearProgress()}>
                        Clear all
                      </button>
                    ) : null}
                  </div>
                  <div className="vee-switch-row">
                    <div>
                      <span>Browser progress bar</span>
                      <small>
                        Shows the browser's own timeline on sites that hide it, such as Instagram.
                      </small>
                    </div>
                    <button
                      className="vee-switch"
                      type="button"
                      role="switch"
                      aria-checked={settings.showNativeControls}
                      aria-label="Browser progress bar"
                      data-on={String(settings.showNativeControls)}
                      onClick={() => patch({ showNativeControls: !settings.showNativeControls })}>
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

          </div>
          <div className="vee-footer">
            <button
              type="button"
              className="vee-reset"
              data-on={String(!tabOn)}
              aria-pressed={!tabOn}
              onClick={() => patch({ [tabFlag(tab)]: !tabOn })}>
              {tabOn ? `Disable ${noun}` : `Enable ${noun}`}
            </button>
            <button type="button" className="vee-reset" onClick={resetEffects}>
              Reset all
            </button>
          </div>
        </section>
      ) : null}

      {layout.mode === "max"
        ? PANEL_EDGES.map((edge) => (
            <div
              key={edge}
              className="vee-resize"
              data-edge={edge}
              onPointerDown={(event) => beginResize(event, edge)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          ))
        : null}
    </div>
  )
}

function Group({
  id,
  title,
  icon: Icon,
  open,
  onToggle,
  applied,
  onApply,
  onReset,
  children
}: {
  id: string
  title: string
  icon: typeof Video
  open: boolean
  onToggle: () => void
  applied?: boolean
  onApply?: () => void
  onReset?: () => void
  children: React.ReactNode
}) {
  return (
    <section
      className={`vee-group${open ? "" : " is-collapsed"}${applied === false ? " is-bypassed" : ""}`}
      data-section={id}>
      <div className="vee-group-head">
        <button
          type="button"
          className="vee-group-toggle"
          aria-expanded={open}
          onClick={onToggle}>
          <Icon size={14} strokeWidth={1.75} />
          <h3>{title}</h3>
          <ChevronDown className="vee-chevron" size={14} strokeWidth={1.75} />
        </button>
        {onReset || onApply ? (
          <div className="vee-group-tools">
            {onReset ? (
              <button
                type="button"
                className="vee-icon-btn vee-section-btn"
                aria-label={`Reset ${title}`}
                title={`Reset ${title}`}
                onClick={onReset}>
                <RotateCcw size={13} strokeWidth={1.75} />
              </button>
            ) : null}
            {onApply ? (
              <button
                type="button"
                className="vee-icon-btn vee-section-btn"
                aria-pressed={applied}
                data-on={String(applied === true)}
                aria-label={applied ? `Bypass ${title}` : `Apply ${title}`}
                title={applied ? `${title} is applied` : `${title} is bypassed`}
                onClick={onApply}>
                <Power size={13} strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {open ? <div className="vee-group-body">{children}</div> : null}
    </section>
  )
}

function CropAxis({
  title,
  linked,
  onToggleLink,
  pairLabel,
  startLabel,
  endLabel,
  start,
  end,
  onPair,
  onStart,
  onEnd
}: {
  title: string
  linked: boolean
  onToggleLink: () => void
  pairLabel: string
  startLabel: string
  endLabel: string
  start: number
  end: number
  onPair: (value: number) => void
  onStart: (value: number) => void
  onEnd: (value: number) => void
}) {
  const read = (value: number) => readRange(String(value), 0)
  return (
    <div className="vee-crop">
      <div className="vee-crop-head">
        <span>{title}</span>
        <span className="vee-crop-tools">
          {linked ? <b>{Math.round(start)}%</b> : null}
        <button
          type="button"
          className="vee-icon-btn vee-link"
          data-on={String(linked)}
          aria-pressed={linked}
          aria-label={linked ? `Unlink ${title}` : `Link ${title}`}
          title={linked ? "Both sides move together" : "Change each side separately"}
          onClick={onToggleLink}>
          {linked ? <Link2 size={14} strokeWidth={1.75} /> : <Unlink2 size={14} strokeWidth={1.75} />}
        </button>
        </span>
      </div>
      {linked ? (
        <Slider
          label={pairLabel}
          showLabel={false}
          min={0}
          max={CROP_MAX}
          step={1}
          value={start}
          display={`${Math.round(start)}%`}
          onChange={(value) => onPair(read(value))}
        />
      ) : (
        <>
          <Slider
            label={startLabel}
            min={0}
            max={CROP_MAX}
            step={1}
            value={start}
            display={`${Math.round(start)}%`}
            onChange={(value) => onStart(read(value))}
          />
          <Slider
            label={endLabel}
            min={0}
            max={CROP_MAX}
            step={1}
            value={end}
            display={`${Math.round(end)}%`}
            onChange={(value) => onEnd(read(value))}
          />
        </>
      )}
    </div>
  )
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
  showLabel = true
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange: (value: number) => void
  showLabel?: boolean
}) {
  return (
    <label className="vee-row">
      {showLabel ? (
        <span className="vee-row-label">
          {label ? <span>{label}</span> : null}
          <b>{display}</b>
        </span>
      ) : null}
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
