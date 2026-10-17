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
  Download,
  FastForward,
  FlipHorizontal2,
  FlipVertical2,
  Gauge,
  Layers,
  RectangleHorizontal,
  PictureInPicture2,
  Play,
  RefreshCw,
  Repeat,
  Link2,
  Maximize2,
  Minus,
  Monitor,
  Power,
  RotateCcw,
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
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type Ref
} from "react"

import { AD_BLOCK_CANCELLED, AD_BLOCK_CHECK, AD_BLOCK_DISMISS, AD_BLOCK_READY } from "~lib/ad-block"
import { audioDownloadMarkup } from "~lib/audio-download-icon"
import {
  EMPTY_BRIGHTNESS_READOUT,
  HISTOGRAM_HEIGHT,
  HISTOGRAM_INSET,
  HISTOGRAM_WIDTH,
  startAutoBrightness,
  type AutoBrightnessReadout
} from "~lib/auto-brightness"
import { paintedVideoBox, type ViewportBox } from "~lib/find-video"
import type { HistogramBins } from "~lib/luminance"
import {
  HOST_ID,
  getActiveVideo,
  parkExtensionHost,
  repositionDock,
  restoreExtensionHost,
  startVideoBridge,
  type VideoBridge
} from "~lib/bridge"
import { postEngineActive } from "~lib/engine"
import {
  dockContextOf,
  domainDockView,
  domainPlacement,
  readPageTitle,
  type DockContext
} from "~lib/domains"
import {
  BLUR_MAX,
  OPACITY_MIN,
  PAN_MAX,
  PAN_MIN,
  SECTION_FIELDS,
  STRETCH_MAX,
  STRETCH_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  cropControlToCss,
  cropCssToControl,
  effectiveSettings,
  isVisualIdentity,
  mediaDrift,
  releaseOwnedMedia,
  seekBy,
  togglePictureInPicture,
  type SectionFlag
} from "~lib/effects"
import {
  PROGRESS_KEY,
  clearProgress,
  deleteProgress,
  deleteProgressForDomain,
  formatClock,
  groupProgress,
  listProgress,
  progressHref,
  type ProgressGroup,
  type SavedProgress
} from "~lib/progress"
import { playerMediaLevel, YT_ECHO_ATTR } from "~lib/native-mirror"
import {
  AUDIO_OPEN_TAB_KEYS,
  VIDEO_OPEN_TAB_KEYS,
  adoptOpenTabSettings,
  editsAudioGroup,
  editsVideoGroup,
  groupDiffers,
  mergeUneditedGroups,
  takeGroup
} from "~lib/open-tab-sync"
import { PRESETS, PRESET_SNAPSHOT_KEYS, builtinSnapshot, exactPresetId, presetById, snapshotFrom, type UserPreset } from "~lib/presets"
import { type DockControl, type DockMedia, suppressDockMedia } from "~lib/seek-bar"
import {
  SITE_POLICY_KEY,
  defaultSitePolicy,
  loadSitePolicy,
  policiesEqual,
  sanitizeSitePolicy,
  siteAllowed,
  type SitePolicy
} from "~lib/sites"
import {
  HEAVY_APPLY_DELAY_MS,
  LIGHT_APPLY_DELAY_MS,
  MINIBAR_HIDE_DELAY_MS,
  NO_VIDEO_NOTICE_DELAY_MS
} from "~settings"
import {
  clipKey,
  emptyTabMedia,
  mergeTabMedia,
  releaseTabMedia,
  releaseTabMediaFromDomain,
  sameClip,
  tabAudioOwned,
  tabLoopOwned,
  tabRateOwned,
  withTabAudio,
  withTabLoop,
  withTabRate,
  type TabMedia
} from "~lib/tab-media"
import {
  GLOBAL_ENABLED_KEY,
  GLOBAL_PRESET_KEY,
  MAX_USER_PRESETS,
  OPEN_MESSAGE,
  OPEN_REQUEST_KEY,
  USER_PRESETS_KEY,
  type DockBox,
  type DockLayout,
  type DockMode,
  type Viewport,
  clampDockBox,
  defaultSettingsFor,
  loadDockLayout,
  loadGlobalEnabled,
  loadGlobalPreset,
  loadStoredSiteSettings,
  loadUserPresets,
  normalizeSettings,
  readGlobalEnabled,
  readGlobalPreset,
  resizeDockBox,
  sanitizeUserPresets,
  saveDockLayout,
  saveSiteSettings,
  saveUserPresets,
  settingsFromGlobalPreset,
  siteStorageKey
} from "~lib/storage"
import {
  COLOR_KEYS,
  HOLD_RATE_MAX,
  HOLD_RATE_MIN,
  HOLD_RATE_STEP,
  DOCK_CONTROL_KEYS,
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  SKIP_SECONDS_MAX,
  SKIP_SECONDS_MIN,
  VOLUME_STEP_MAX,
  VOLUME_STEP_MIN,
  clampHoldPlaybackRate,
  clampSkipSeconds,
  clampVolumeStep,
  customAnchor,
  defaultSettings,
  settingsEqual,
  type ColorSettings,
  type ControlLayout,
  type DockEdge,
  type DockPlaceId,
  type DockPlacement,
  type DockSlot,
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
  className?: string
  title?: string
}[] = [
  { key: "brightness", label: "Brightness", min: 0.2, max: 2, step: 0.01, digits: 2, format: percent },
  { key: "contrast", label: "Contrast", min: 0.2, max: 2, step: 0.01, digits: 2, format: percent },
  { key: "saturate", label: "Saturation", min: 0, max: 3, step: 0.01, digits: 2, format: percent },
  {
    key: "temperature",
    label: "Temperature",
    min: TEMPERATURE_MIN,
    max: TEMPERATURE_MAX,
    step: 1,
    digits: 0,
    format: formatTemperature,
    className: "vee-temp",
    title: "Cool on the left, warm on the right"
  },
  { key: "hueRotate", label: "Hue", min: 0, max: 360, step: 1, digits: 0, format: degrees, advanced: true },
  { key: "grayscale", label: "Grayscale", min: 0, max: 1, step: 0.01, digits: 2, format: percent, advanced: true },
  { key: "sepia", label: "Sepia", min: 0, max: 1, step: 0.01, digits: 2, format: percent, advanced: true },
  { key: "invert", label: "Invert", min: 0, max: 1, step: 0.01, digits: 2, format: percent, advanced: true },
  {
    key: "blur",
    label: "Blur",
    min: 0,
    max: BLUR_MAX,
    step: 0.1,
    digits: 1,
    format: (value) => `${(Math.round(value * 10) / 10).toFixed(1)} px`,
    advanced: true
  },
  {
    key: "opacity",
    label: "Opacity",
    min: OPACITY_MIN,
    max: 1,
    step: 0.01,
    digits: 2,
    format: percent,
    advanced: true
  }
]

const SPEEDS = [0.5, 1, 1.5, 2, 3, 4]

type DockGlyph = typeof Play | typeof AudioDownloadIcon

const DOCK_PICKS: {
  key: (typeof DOCK_CONTROL_KEYS)[number] | "dockProgress"
  label: string
  title: string
  icon: DockGlyph
}[] = [
  {
    key: "dockProgress",
    label: "Progress",
    title: "Seek track on the video. The other controls stay when this is off.",
    icon: RectangleHorizontal
  },
  { key: "dockPlay", label: "Play", title: "Play and pause on the video", icon: Play },
  { key: "dockTime", label: "Time", title: "Current time and duration on the video", icon: Clock },
  { key: "dockVolume", label: "Volume", title: "Mute and volume on the video", icon: Volume2 },
  { key: "dockSpeed", label: "Speed", title: "Playback speed on the video", icon: Gauge },
  { key: "dockLoop", label: "Loop", title: "Loop on the video", icon: Repeat },
  {
    key: "dockPip",
    label: "PiP",
    title: "Picture in picture on the video",
    icon: PictureInPicture2
  },
  { key: "dockFullscreen", label: "Full", title: "Full screen on the video", icon: Maximize2 },
  {
    key: "dockDownload",
    label: "Download",
    title: "Save the video when its address is a normal file link",
    icon: Download
  },
  {
    key: "dockAudio",
    label: "Audio",
    title: "Save only the sound of this video as an M4A file",
    icon: AudioDownloadIcon
  },
  {
    key: "dockQuality",
    label: "Resolution",
    title: "Choose a resolution when the page already lists more than one",
    icon: Monitor
  },
  { key: "dockSkip", label: "Skip", title: "Skip back and forward on the video", icon: ChevronsRight }
]

type DockPickKey = (typeof DOCK_PICKS)[number]["key"]

const DOCK_PLACE_BY_KEY: Record<DockPickKey, DockPlaceId> = {
  dockProgress: "progress",
  dockPlay: "play",
  dockTime: "time",
  dockVolume: "volume",
  dockSpeed: "speed",
  dockLoop: "loop",
  dockPip: "pip",
  dockFullscreen: "fullscreen",
  dockDownload: "download",
  dockAudio: "audio",
  dockQuality: "quality",
  dockSkip: "skip"
}

const DOCK_SIDES: { edge: DockEdge; label: string }[] = [
  { edge: "top", label: "Top" },
  { edge: "right", label: "Right" },
  { edge: "bottom", label: "Bottom" },
  { edge: "left", label: "Left" }
]

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

function formatTemperature(value: number): string {
  const rounded = Math.round(value)
  if (rounded === 0) return "Neutral"
  if (rounded > 0) return `Warm ${rounded}`
  return `Cool ${-rounded}`
}

function AudioDownloadIcon({
  size = 16,
  strokeWidth = 1.75
}: {
  size?: number | string
  strokeWidth?: number | string
}) {
  const stroke = Number(strokeWidth)
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: audioDownloadMarkup(Number.isFinite(stroke) ? stroke : 1.75) }}
    />
  )
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

function tabFlag(tab: PanelTab): "videoEnabled" | "audioEnabled" | "playbackEnabled" {
  if (tab === "video") return "videoEnabled"
  if (tab === "audio") return "audioEnabled"
  return "playbackEnabled"
}

function sectionTouchesMedia(flag: SectionFlag): boolean {
  return flag === "basicAudioOn" || flag === "basicPlaybackOn"
}

function touchesAudio(next: Partial<EffectSettings>): boolean {
  return "volume" in next || "muted" in next
}

const VIDEO_RESET_KEYS = [
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
  "presetId",
  "videoEnabled",
  "autoBrightness"
] as const satisfies readonly (keyof EffectSettings)[]

const AUDIO_RESET_KEYS = [
  "volume",
  "muted",
  "basicAudioOn",
  "advancedAudioOn",
  "audioEnabled"
] as const satisfies readonly (keyof EffectSettings)[]

const PLAYBACK_RESET_KEYS = [
  "playbackRate",
  "preservePitch",
  "loop",
  "holdToSpeed",
  "holdPlaybackRate",
  "basicPlaybackOn",
  "advancedPlaybackOn",
  "rememberProgress",
  "showNativeControls",
  "dockEnabled",
  "dockProgress",
  "dockAlign",
  "dockLayout",
  "dockLayoutAuto",
  "dockFlagsAuto",
  "resumeLeadSeconds",
  "skipSeconds",
  "skipArrowKeys",
  "volumeArrowKeys",
  "volumeStepPercent",
  ...DOCK_CONTROL_KEYS,
  "skipAdsEnabled",
  "skipAds",
  "skipAdsSpeed",
  "skipAdsSeek",
  "skipAdsBlock",
  "playbackEnabled"
] as const satisfies readonly (keyof EffectSettings)[]

function resetKeys(tab: PanelTab): readonly (keyof EffectSettings)[] {
  if (tab === "video") return VIDEO_RESET_KEYS
  if (tab === "audio") return AUDIO_RESET_KEYS
  return PLAYBACK_RESET_KEYS
}

function tabActions(
  tab: PanelTab,
  enabled: boolean
): { toggle: string; toggleTitle: string; reset: string; resetTitle: string } {
  if (tab === "video") {
    return {
      toggle: enabled ? "Disable video effects" : "Enable video effects",
      toggleTitle: enabled
        ? "Turn off color, frame, and filter changes on the Video tab. Audio and playback stay as they are."
        : "Turn color, frame, and filter changes back on for the Video tab.",
      reset: "Reset video settings",
      resetTitle: "Restore the Video tab to its defaults. Audio and playback stay as they are."
    }
  }
  if (tab === "audio") {
    return {
      toggle: enabled ? "Disable audio effects" : "Enable audio effects",
      toggleTitle: enabled
        ? "Turn off volume and mute changes on the Audio tab. Video and playback stay as they are."
        : "Turn volume and mute changes back on for the Audio tab.",
      reset: "Reset audio settings",
      resetTitle: "Restore volume and mute on the Audio tab to their defaults."
    }
  }
  return {
    toggle: enabled ? "Disable playback effects" : "Enable playback effects",
    toggleTitle: enabled
      ? "Turn off speed, loop, and pitch changes on the Playback tab. Video and audio stay as they are."
      : "Turn speed, loop, and pitch changes back on for the Playback tab.",
    reset: "Reset playback settings",
    resetTitle: "Restore speed, hold speed, loop, pitch, resume, skip ads, and the on-video controls on the Playback tab. Saved resume points stay."
  }
}

function sectionIsVisual(flag: SectionFlag): boolean {
  return flag === "basicVideoOn" || flag === "frameOn" || flag === "advancedVideoOn"
}

function hostsMatch(messageHost: string | undefined, pageHost: string): boolean {
  return (messageHost ?? "").trim().toLowerCase() === pageHost.trim().toLowerCase()
}

type SeenMedia = {
  volume: number
  muted: boolean
  playbackRate: number | null
  loop: boolean
}

const SEEN_VOLUME_EPS = 0.005
const SEEN_RATE_EPS = 0.001

function echoedPlayerRate(video: HTMLVideoElement, rate: number): boolean {
  const echo = Number(video.getAttribute(YT_ECHO_ATTR))
  return Number.isFinite(echo) && Math.abs(rate - echo) <= SEEN_RATE_EPS
}

function Overlay() {
  const hostname = location.hostname
  const [settings, setSettings] = useState<EffectSettings>(() => ({
    ...defaultSettingsFor(location.hostname),
    presetId: ""
  }))
  const [policy, setPolicy] = useState<SitePolicy>(defaultSitePolicy)
  const [policyReady, setPolicyReady] = useState(false)
  const [globallyEnabled, setGloballyEnabled] = useState<boolean | null>(null)
  const [ready, setReady] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)
  const [forcedOpen, setForcedOpen] = useState(false)
  const [missingNotice, setMissingNotice] = useState(false)
  const [pipOn, setPipOn] = useState(false)
  const [brightnessRead, setBrightnessRead] = useState<AutoBrightnessReadout>(EMPTY_BRIGHTNESS_READOUT)
  const [tab, setTab] = useState<PanelTab>("video")
  const [userPresets, setUserPresets] = useState<UserPreset[]>([])
  const [presetName, setPresetName] = useState("")
  const [presetOpen, setPresetOpen] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [progressRows, setProgressRows] = useState<SavedProgress[]>([])
  const [openDomains, setOpenDomains] = useState<Record<string, boolean>>({})
  const [layout, setLayout] = useState<DockLayout | null>(null)
  const [dragging, setDragging] = useState(false)
  const [barIdle, setBarIdle] = useState(false)
  const [placePick, setPlacePick] = useState<DockPickKey | null>(null)
  const [dockCtx, setDockCtx] = useState<DockContext>(() => dockContextOf(null, location.pathname))
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
  const settingsRef = useRef(settings)
  const domainRef = useRef<EffectSettings | null>(null)
  const domainAheadRef = useRef(false)
  const audioEditedRef = useRef(false)
  const videoEditedRef = useRef(false)
  const tabMediaRef = useRef<TabMedia>(emptyTabMedia())
  const seenMediaRef = useRef<SeenMedia | null>(null)
  const clipRef = useRef("")
  const policyRef = useRef(policy)
  const globallyEnabledRef = useRef(false)
  const appliedRef = useRef(settings)
  const readyRef = useRef(false)
  const dirtyRef = useRef(false)
  const siteOverrideRef = useRef(false)
  const settingsSynced = useRef(false)
  const presetsSynced = useRef(false)
  const saveSeq = useRef(0)
  const adoptedSeq = useRef(0)
  const applyTimer = useRef(0)
  const applyDelayRef = useRef(0)
  const inflightSaves = useRef<EffectSettings[]>([])
  const bridgeRef = useRef<VideoBridge | null>(null)
  const autoRef = useRef<ReturnType<typeof startAutoBrightness> | null>(null)
  const dockBridge = useRef({
    onControl: (_control: DockControl) => undefined,
    onMedia: (_media: DockMedia) => undefined
  })
  const dockRef = useRef<HTMLDivElement>(null)
  const presetMenuRef = useRef<HTMLDivElement>(null)
  const presetButtonRef = useRef<HTMLButtonElement>(null)
  const placePopRef = useRef<HTMLDivElement>(null)
  const placeAnchorRef = useRef<HTMLButtonElement>(null)
  const presetOpenRef = useRef(false)
  const draggingRef = useRef(false)
  const barIdleRef = useRef(false)
  const pointerRef = useRef({ x: -1, y: -1 })
  const layoutRef = useRef<DockLayout | null>(null)
  const pendingOpen = useRef(false)
  const hadVideoRef = useRef(false)
  const swallowClick = useRef(false)
  const dragRef = useRef<null | {
    pointerId: number
    originX: number
    originY: number
    startX: number
    startY: number
    slot: DockMode
    box: DockBox
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
  policyRef.current = policy
  globallyEnabledRef.current = globallyEnabled === true
  readyRef.current = ready
  layoutRef.current = layout
  presetOpenRef.current = presetOpen
  draggingRef.current = dragging

  const commitSiteSettings = (snapshot: EffectSettings) => {
    const seq = ++saveSeq.current
    const domain = domainRef.current
    const outgoing = domain
      ? mergeUneditedGroups(snapshot, domain, audioEditedRef.current, videoEditedRef.current)
      : snapshot
    domainRef.current = outgoing
    inflightSaves.current = [...inflightSaves.current, outgoing]
    dirtyRef.current = false
    void saveSiteSettings(hostname, outgoing).then(() => {
      if (seq >= adoptedSeq.current) return
      const latestDomain = domainRef.current
      const latest = settingsRef.current
      const again = latestDomain
        ? mergeUneditedGroups(latest, latestDomain, audioEditedRef.current, videoEditedRef.current)
        : latest
      domainRef.current = again
      inflightSaves.current = [...inflightSaves.current, again]
      void saveSiteSettings(hostname, again)
    })
  }

  useEffect(() => {
    let alive = true
    void loadGlobalEnabled().then((enabled) => {
      if (!alive) return
      globallyEnabledRef.current = enabled
      setGloballyEnabled(enabled)
    })
    void loadSitePolicy()
      .then((loaded) => {
        if (!alive) return
        policyRef.current = loaded
        setPolicy(loaded)
        setPolicyReady(true)
      })
      .catch(() => {
        if (!alive) return
        setPolicyReady(true)
      })
    void Promise.all([
      loadStoredSiteSettings(hostname),
      loadGlobalPreset(),
      loadUserPresets()
    ]).then(([stored, globalPreset, presets]) => {
      if (!alive) return
      if (!presetsSynced.current) {
        presetsSynced.current = true
        setUserPresets(presets)
      }
      if (!settingsSynced.current) {
        settingsSynced.current = true
        const loaded = stored ?? settingsFromGlobalPreset(globalPreset, hostname)
        siteOverrideRef.current = stored != null
        domainRef.current = loaded
        domainAheadRef.current = false
        audioEditedRef.current = false
        videoEditedRef.current = false
        settingsRef.current = loaded
        appliedRef.current = loaded
        setSettings(loaded)
      }
      setReady(true)
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
      commitSiteSettings(snapshot)
    }, LIGHT_APPLY_DELAY_MS)
    return () => window.clearTimeout(handle)
  }, [settings, ready, hostname])

  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current) return
      const snapshot = settingsRef.current
      commitSiteSettings(snapshot)
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      window.clearTimeout(applyTimer.current)
    }
  }, [hostname])

  useLayoutEffect(() => {
    if (globallyEnabled === true) {
      restoreExtensionHost()
      postEngineActive(true)
      return
    }
    bridgeRef.current?.stop()
    bridgeRef.current = null
    parkExtensionHost()
    if (globallyEnabled === false) postEngineActive(false)
  }, [globallyEnabled])

  useEffect(() => {
    if (!ready || !policyReady || !globallyEnabled) return
    const adoptClip = () => {
      const video = getActiveVideo()
      const key = clipKey(video)
      if (sameClip(clipRef.current, key)) {
        if (key.length > clipRef.current.length) clipRef.current = key
        return
      }
      clipRef.current = key
      tabMediaRef.current = emptyTabMedia()
      seenMediaRef.current = null
      if (video) releaseOwnedMedia(video)
      // Ignore the player's own reset while this clip's saved panel values are applied.
      suppressDockMedia(600)
    }
    const bridge = startVideoBridge({
      getSettings: () => mergeTabMedia(effectiveSettings(appliedRef.current), tabMediaRef.current),
      getUiSettings: () =>
        mergeTabMedia(
          domainDockView(settingsRef.current, location.hostname, dockContextOf(getActiveVideo())),
          tabMediaRef.current
        ),
      isAllowed: () => siteAllowed(hostname, policyRef.current),
      onPresence: setHasVideo,
      onControl: (control) => dockBridge.current.onControl(control),
      onMedia: (media) => dockBridge.current.onMedia(media),
      onClip: () => adoptClip(),
      onVideo: () => adoptClip()
    })
    bridgeRef.current = bridge
    const auto = startAutoBrightness({
      getSettings: () => mergeTabMedia(effectiveSettings(appliedRef.current), tabMediaRef.current),
      getVideo: getActiveVideo,
      onSample: setBrightnessRead
    })
    autoRef.current = auto
    return () => {
      auto.stop()
      autoRef.current = null
      bridge.stop()
      bridgeRef.current = null
    }
  }, [ready, policyReady, globallyEnabled, hostname])

  useEffect(() => {
    if (!policyReady || !globallyEnabled) return
    bridgeRef.current?.applyNow()
  }, [policy, policyReady, globallyEnabled])

  useEffect(() => {
    if (!hasVideo && hadVideoRef.current) {
      const mode = layoutRef.current?.mode
      if (mode === "min" || mode === "max") setForcedOpen(true)
    }
    hadVideoRef.current = hasVideo
  }, [hasVideo])

  useEffect(() => {
    if (hasVideo) {
      setMissingNotice(false)
      return
    }
    const timer = window.setTimeout(() => setMissingNotice(true), NO_VIDEO_NOTICE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [hasVideo])

  useEffect(() => {
    if (!globallyEnabled) return
    repositionDock()
  }, [layout?.mode, hasVideo, globallyEnabled])

  useEffect(() => {
    const read = () => {
      const next = dockContextOf(getActiveVideo())
      setDockCtx((current) =>
        current.pathname === next.pathname &&
        current.videoWidth === next.videoWidth &&
        current.videoHeight === next.videoHeight &&
        current.boxWidth === next.boxWidth &&
        current.boxHeight === next.boxHeight
          ? current
          : next
      )
    }
    read()
    const timer = window.setInterval(read, 500)
    window.addEventListener("popstate", read)
    window.addEventListener("yt-navigate-finish", read)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("popstate", read)
      window.removeEventListener("yt-navigate-finish", read)
    }
  }, [hasVideo, hostname])

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
      setForcedOpen(true)
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
      if (changes[GLOBAL_ENABLED_KEY]) {
        const enabled = readGlobalEnabled(changes[GLOBAL_ENABLED_KEY].newValue)
        globallyEnabledRef.current = enabled
        setGloballyEnabled(enabled)
      }
      const noteEcho = (incoming: EffectSettings) => {
        if (!groupDiffers(settingsRef.current, incoming, AUDIO_OPEN_TAB_KEYS)) {
          audioEditedRef.current = false
        }
        if (!groupDiffers(settingsRef.current, incoming, VIDEO_OPEN_TAB_KEYS)) {
          videoEditedRef.current = false
        }
      }
      const adoptExternal = (incoming: EffectSettings) => {
        const current = settingsRef.current
        const next = adoptOpenTabSettings(current, incoming)
        if (!groupDiffers(next, incoming, AUDIO_OPEN_TAB_KEYS)) audioEditedRef.current = false
        if (!groupDiffers(next, incoming, VIDEO_OPEN_TAB_KEYS)) videoEditedRef.current = false
        if (next.syncCustomController !== current.syncCustomController) seenMediaRef.current = null
        if (settingsEqual(current, next)) return
        const holding = audioEditedRef.current || videoEditedRef.current
        tabMediaRef.current = releaseTabMediaFromDomain(tabMediaRef.current, current, next)
        if (!holding) {
          adoptedSeq.current = saveSeq.current + 1
          dirtyRef.current = false
          window.clearTimeout(applyTimer.current)
          applyTimer.current = 0
          applyDelayRef.current = 0
        }
        settingsRef.current = next
        appliedRef.current = next
        setSettings(next)
        // The bar reports the video's current loop before playback is written.
        // Hold that report so this domain update is not copied back as a local edit.
        suppressDockMedia(LIGHT_APPLY_DELAY_MS + 280)
        if (globallyEnabledRef.current) bridgeRef.current?.applyNow()
      }
      const takeSiteSettings = (incoming: EffectSettings) => {
        const pending = inflightSaves.current
        const index = pending.findIndex((item) => settingsEqual(item, incoming))
        if (index >= 0) {
          inflightSaves.current = pending.slice(index + 1)
          if (!domainAheadRef.current) domainRef.current = incoming
          if (inflightSaves.current.length === 0) domainAheadRef.current = false
          noteEcho(incoming)
          return
        }
        if (inflightSaves.current.length > 0) domainAheadRef.current = true
        domainRef.current = incoming
        if (!settingsEqual(settingsRef.current, incoming)) adoptExternal(incoming)
      }
      const siteChange = changes[siteStorageKey(hostname)]
      if (siteChange?.newValue != null) {
        settingsSynced.current = true
        siteOverrideRef.current = true
        takeSiteSettings(normalizeSettings(siteChange.newValue, hostname))
      } else if (
        Object.prototype.hasOwnProperty.call(changes, GLOBAL_PRESET_KEY) &&
        !siteOverrideRef.current
      ) {
        settingsSynced.current = true
        takeSiteSettings(
          settingsFromGlobalPreset(readGlobalPreset(changes[GLOBAL_PRESET_KEY].newValue), hostname)
        )
      }
      if (changes[SITE_POLICY_KEY]) {
        const incoming = sanitizeSitePolicy(changes[SITE_POLICY_KEY].newValue)
        setPolicy((current) => (policiesEqual(current, incoming) ? current : incoming))
      }
      if (changes[USER_PRESETS_KEY]) {
        presetsSynced.current = true
        setUserPresets(sanitizeUserPresets(changes[USER_PRESETS_KEY].newValue))
      }
      if (changes[PROGRESS_KEY]) void listProgress().then(setProgressRows)
      const request = changes[OPEN_REQUEST_KEY]?.newValue as { hostname?: string } | undefined
      if (request?.hostname === hostname && globallyEnabledRef.current) reveal()
    }

    const onMessage = (
      message: { type?: string; host?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => {
      if (message?.type === AD_BLOCK_READY && hostsMatch(message.host, hostname)) {
        if (!settingsRef.current.skipAdsBlock) patch({ skipAdsBlock: true })
        sendResponse({ ok: true })
        return false
      }
      if (message?.type === AD_BLOCK_CANCELLED && hostsMatch(message.host, hostname)) {
        if (settingsRef.current.skipAdsBlock) patch({ skipAdsBlock: false })
        sendResponse({ ok: true })
        return false
      }
      if (message?.type === "VEE_STATUS") {
        sendResponse({
          pending: !readyRef.current,
          hostname,
          settings: settingsRef.current
        })
        return false
      }
      if (message?.type === OPEN_MESSAGE) {
        if (globallyEnabledRef.current) reveal()
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

  useEffect(() => {
    if (tab !== "playback" || openSections["playback-player"] === false || layout?.mode !== "max") {
      setPlacePick(null)
    }
  }, [tab, openSections, layout?.mode])

  useLayoutEffect(() => {
    if (!placePick) return
    const pin = () => {
      const anchor = placeAnchorRef.current
      const dock = dockRef.current
      const pop = placePopRef.current
      if (!anchor || !dock || !pop) return
      const dockRect = dock.getBoundingClientRect()
      const icon = anchor.getBoundingClientRect()
      const width = pop.offsetWidth
      const height = pop.offsetHeight
      const gap = 8
      let top = icon.bottom - dockRect.top + gap
      const above = icon.top - dockRect.top - height - gap
      if (top + height > dockRect.height - 8 && above < top) top = above
      let left = icon.left - dockRect.left + (icon.width - width) / 2
      const maxLeft = Math.max(8, dockRect.width - width - 8)
      left = Math.min(Math.max(8, left), maxLeft)
      pop.style.top = `${Math.round(top)}px`
      pop.style.left = `${Math.round(left)}px`
      const body = dock.querySelector(".vee-body")
      const bodyRect = body?.getBoundingClientRect()
      const visible =
        !bodyRect || (icon.bottom > bodyRect.top + 4 && icon.top < bodyRect.bottom - 4)
      pop.dataset.ready = visible ? "true" : "false"
    }
    pin()
    const body = dockRef.current?.querySelector(".vee-body")
    body?.addEventListener("scroll", pin, { passive: true })
    window.addEventListener("resize", pin)
    return () => {
      body?.removeEventListener("scroll", pin)
      window.removeEventListener("resize", pin)
    }
  }, [placePick, settings.dockLayout, settings.dockLayoutAuto, dockCtx, viewport])

  useEffect(() => {
    if (!placePick) return
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath()
      if (placePopRef.current && path.includes(placePopRef.current)) return
      if (placeAnchorRef.current && path.includes(placeAnchorRef.current)) return
      setPlacePick(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlacePick(null)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [placePick])

  useEffect(() => {
    if (layout?.mode !== "min") {
      barIdleRef.current = false
      setBarIdle(false)
      return
    }
    let timer = 0
    const pointerOverDock = () => {
      const dock = dockRef.current
      if (!dock) return false
      if (dock.matches(":hover")) return true
      const box = dock.getBoundingClientRect()
      const { x, y } = pointerRef.current
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
    }
    const arm = () => {
      window.clearTimeout(timer)
      if (barIdleRef.current) {
        barIdleRef.current = false
        setBarIdle(false)
      }
      timer = window.setTimeout(() => {
        if (presetOpenRef.current || draggingRef.current || pointerOverDock()) return
        barIdleRef.current = true
        setBarIdle(true)
      }, MINIBAR_HIDE_DELAY_MS)
    }
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
      arm()
    }
    arm()
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("pointermove", onPointerMove)
    }
  }, [layout?.mode, presetOpen, dragging])

  const patch = (next: Partial<EffectSettings>, touchPlayback = false, timing: ApplyTiming = "now") => {
    const snapshotChanged = PRESET_SNAPSHOT_KEYS.some(
      (key) => key in next && next[key] !== settingsRef.current[key]
    )
    const applyingPreset =
      typeof next.presetId === "string" && next.presetId !== "" && next.presetId !== "custom"
    const resolved: Partial<EffectSettings> =
      snapshotChanged && !applyingPreset ? { ...next, presetId: "" } : next
    const touchAudio = touchesAudio(resolved)
    if (editsAudioGroup(resolved)) audioEditedRef.current = true
    if (editsVideoGroup(resolved)) videoEditedRef.current = true
    tabMediaRef.current = releaseTabMedia(tabMediaRef.current, resolved)
    if (
      "volume" in resolved ||
      "muted" in resolved ||
      "playbackRate" in resolved ||
      "loop" in resolved
    ) {
      suppressDockMedia(LIGHT_APPLY_DELAY_MS + 280)
    }
    dirtyRef.current = true
    const playbackTouched =
      typeof resolved.playbackTouched === "boolean"
        ? resolved.playbackTouched
        : touchPlayback
          ? true
          : settingsRef.current.playbackTouched
    const audioTouched =
      typeof resolved.audioTouched === "boolean"
        ? resolved.audioTouched
        : touchAudio
          ? true
          : settingsRef.current.audioTouched
    const merged: EffectSettings = {
      ...settingsRef.current,
      ...resolved,
      playbackTouched,
      audioTouched
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
        ...resolved,
        playbackTouched,
        audioTouched
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

  const rememberSeen = (sample: Partial<SeenMedia>) => {
    const panel = settingsRef.current
    const prev = seenMediaRef.current
    seenMediaRef.current = {
      volume: sample.volume ?? prev?.volume ?? panel.volume,
      muted: sample.muted ?? prev?.muted ?? panel.muted,
      playbackRate:
        sample.playbackRate !== undefined ? sample.playbackRate : (prev?.playbackRate ?? panel.playbackRate),
      loop: sample.loop ?? prev?.loop ?? panel.loop
    }
  }

  const seedSeenFromVideo = () => {
    const video = getActiveVideo()
    const panel = settingsRef.current
    if (!video) {
      seenMediaRef.current = null
      return
    }
    const rate = video.playbackRate || 1
    const level = playerMediaLevel(video)
    seenMediaRef.current = {
      volume: level.volume,
      muted: level.muted,
      playbackRate: rate <= PLAYBACK_RATE_MAX && !echoedPlayerRate(video, rate) ? rate : panel.playbackRate,
      loop: video.loop
    }
  }

  const toggleCustomSync = () => {
    const current = settingsRef.current
    if (current.syncCustomController) {
      seenMediaRef.current = null
      patch({ syncCustomController: false })
      return
    }
    const tab = tabMediaRef.current
    const merged = mergeTabMedia(current, tab)
    const next: Partial<EffectSettings> = { syncCustomController: true }
    let touchPlayback = false
    if (tabAudioOwned(tab)) {
      next.volume = merged.volume
      next.muted = merged.muted
    }
    if (tabRateOwned(tab)) {
      next.playbackRate = merged.playbackRate
      touchPlayback = true
    }
    if (tabLoopOwned(tab)) {
      next.loop = merged.loop
      touchPlayback = true
    }
    patch(next, touchPlayback, "now")
    seedSeenFromVideo()
  }

  const setOpenTabSync = (flag: "syncOpenTabsAudio" | "syncOpenTabsVideo") => {
    const current = settingsRef.current
    if (current[flag]) {
      patch({ [flag]: false })
      return
    }
    const domain = domainRef.current
    if (!domain) {
      patch({ [flag]: true })
      return
    }
    const keys = flag === "syncOpenTabsAudio" ? AUDIO_OPEN_TAB_KEYS : VIDEO_OPEN_TAB_KEYS
    patch({ [flag]: true, presetId: domain.presetId, ...takeGroup(domain, keys) }, false, "now")
    if (flag === "syncOpenTabsAudio") audioEditedRef.current = false
    else videoEditedRef.current = false
  }

  dockBridge.current.onControl = (control) => {
    if (control.type === "hold") {
      patch({ holdPlaybackRate: clampHoldPlaybackRate(control.holdPlaybackRate) })
      return
    }
    if (settingsRef.current.syncCustomController) {
      if (control.type === "audio") {
        const next: Partial<EffectSettings> = {}
        if (typeof control.volume === "number") next.volume = control.volume
        if (typeof control.muted === "boolean") next.muted = control.muted
        if (!("volume" in next) && !("muted" in next)) return
        rememberSeen(next)
        patch(next, false, "now")
        return
      }
      if (control.type === "rate") {
        rememberSeen({ playbackRate: control.playbackRate })
        patch({ playbackRate: control.playbackRate }, true, "now")
        return
      }
      rememberSeen({ loop: control.loop })
      patch({ loop: control.loop }, true, "now")
      return
    }
    const video = getActiveVideo()
    const panel = settingsRef.current
    let next = tabMediaRef.current
    if (control.type === "audio") {
      next = withTabAudio(next, control.volume, control.muted)
      if (video && !panel.audioTouched) {
        const level = playerMediaLevel(video)
        if (next.volume == null) next = withTabAudio(next, level.volume, undefined)
        if (next.muted == null) next = withTabAudio(next, undefined, level.muted)
      }
    } else if (control.type === "rate") {
      next = withTabRate(next, control.playbackRate)
    } else {
      next = withTabLoop(next, control.loop)
      const liveRate = video?.playbackRate || 1
      if (video && !panel.playbackTouched && next.playbackRate == null && liveRate <= PLAYBACK_RATE_MAX) {
        next = withTabRate(next, liveRate)
      }
    }
    tabMediaRef.current = next
    bridgeRef.current?.applyNow()
  }

  dockBridge.current.onMedia = (media) => {
    const video = getActiveVideo()
    if (!video) return
    const drift = mediaDrift(video, {
      volume: media.volume,
      muted: media.muted,
      ...(media.playbackRate !== null ? { playbackRate: media.playbackRate } : {}),
      loop: media.loop
    })
    const panel = settingsRef.current
    if (panel.syncCustomController) {
      const elementRate =
        media.playbackRate !== null &&
        media.playbackRate <= PLAYBACK_RATE_MAX &&
        !echoedPlayerRate(video, media.playbackRate)
          ? media.playbackRate
          : null
      const sample: SeenMedia = {
        volume: typeof drift?.volume === "number" ? drift.volume : media.volume,
        muted: typeof drift?.muted === "boolean" ? drift.muted : media.muted,
        playbackRate: typeof drift?.playbackRate === "number" ? drift.playbackRate : elementRate,
        loop: typeof drift?.loop === "boolean" ? drift.loop : media.loop
      }
      const seen = seenMediaRef.current
      if (!seen) {
        seenMediaRef.current = sample
        return
      }
      const next: Partial<EffectSettings> = {}
      let touchPlayback = false
      const volumeMoved =
        Math.abs(seen.volume - sample.volume) >= SEEN_VOLUME_EPS || seen.muted !== sample.muted
      if (
        volumeMoved &&
        (Math.abs(panel.volume - sample.volume) >= SEEN_VOLUME_EPS || panel.muted !== sample.muted)
      ) {
        next.volume = sample.volume
        next.muted = sample.muted
      }
      const rateMoved =
        sample.playbackRate !== null &&
        (seen.playbackRate === null || Math.abs(seen.playbackRate - sample.playbackRate) >= SEEN_RATE_EPS)
      if (rateMoved && sample.playbackRate !== null && Math.abs(panel.playbackRate - sample.playbackRate) >= SEEN_RATE_EPS) {
        next.playbackRate = sample.playbackRate
        touchPlayback = true
        if (!panel.playbackTouched && !("loop" in next)) next.loop = sample.loop
      }
      const loopMoved = seen.loop !== sample.loop
      if (
        loopMoved &&
        panel.loop !== sample.loop &&
        (sample.playbackRate !== null || panel.playbackTouched || typeof drift?.loop === "boolean")
      ) {
        next.loop = sample.loop
        touchPlayback = true
      }
      seenMediaRef.current = {
        volume: sample.volume,
        muted: sample.muted,
        playbackRate: sample.playbackRate !== null ? sample.playbackRate : seen.playbackRate,
        loop: sample.loop
      }
      if (!("volume" in next) && !("muted" in next) && !("playbackRate" in next) && !("loop" in next)) return
      patch(next, touchPlayback, "now")
      return
    }
    if (!drift) return
    let next = tabMediaRef.current
    if (typeof drift.volume === "number" || typeof drift.muted === "boolean") {
      next = withTabAudio(next, drift.volume, drift.muted)
      if (!panel.audioTouched) {
        const level = playerMediaLevel(video)
        if (next.volume == null) next = withTabAudio(next, level.volume, undefined)
        if (next.muted == null) next = withTabAudio(next, undefined, level.muted)
      }
    }
    if (typeof drift.playbackRate === "number") next = withTabRate(next, drift.playbackRate)
    if (typeof drift.loop === "boolean" && (media.playbackRate !== null || panel.playbackTouched)) {
      next = withTabLoop(next, drift.loop)
      if (!panel.playbackTouched && next.playbackRate == null && media.playbackRate !== null) {
        next = withTabRate(next, media.playbackRate)
      }
    }
    tabMediaRef.current = next
    suppressDockMedia()
    bridgeRef.current?.applyNow()
  }

  const resetCurrentTab = () => {
    const defaults = defaultSettingsFor(hostname)
    const next: Partial<EffectSettings> = {}
    for (const key of resetKeys(tab)) next[key] = defaults[key] as never
    next.presetId = ""
    patch(next, tab === "playback", tab === "video" ? "heavy" : "light")
  }

  const resetAllTabs = () => {
    const defaults = defaultSettingsFor(hostname)
    const next: Partial<EffectSettings> = {}
    for (const key of [...VIDEO_RESET_KEYS, ...AUDIO_RESET_KEYS, ...PLAYBACK_RESET_KEYS]) {
      next[key] = defaults[key] as never
    }
    next.presetId = ""
    patch(next, true, "heavy")
  }

  const liveDock = () => domainDockView(settingsRef.current, hostname, dockContextOf(getActiveVideo()))

  const toggleDockFlag = (key: DockPickKey) => {
    const view = liveDock()
    const flags: Partial<EffectSettings> = { dockFlagsAuto: false, dockProgress: view.dockProgress }
    for (const flag of DOCK_CONTROL_KEYS) flags[flag] = view[flag]
    flags[key] = !view[key]
    patch(flags)
  }

  const moveDock = (id: DockPlaceId, change: Partial<DockPlacement>) => {
    const view = liveDock()
    patch({
      dockLayoutAuto: false,
      dockLayout: nextPlacement(view.dockLayout, id, change)
    })
  }

  const resetDockPlace = (id: DockPlaceId) => {
    const ctx = dockContextOf(getActiveVideo())
    const view = domainDockView(settingsRef.current, hostname, ctx)
    patch({
      dockLayoutAuto: false,
      dockLayout: { ...view.dockLayout, [id]: domainPlacement(hostname, ctx, id) }
    })
  }

  const resetDockPositions = () => {
    patch({ dockLayoutAuto: true })
  }

  const sectionOpen = (id: string) => openSections[id] !== false

  const toggleSection = (id: string) => {
    setOpenSections((current) => ({ ...current, [id]: current[id] === false }))
  }

  const resetSection = (flag: SectionFlag) => {
    const defaults = defaultSettings()
    const next: Partial<EffectSettings> = { [flag]: true, presetId: "" }
    for (const key of SECTION_FIELDS[flag]) next[key] = defaults[key] as never
    if (flag === "basicVideoOn") next.autoBrightness = false
    const media = sectionTouchesMedia(flag)
    patch(next, flag === "basicPlaybackOn", sectionIsVisual(flag) ? "heavy" : media ? "light" : "now")
  }

  const toggleSectionApply = (flag: SectionFlag) => {
    const media = sectionTouchesMedia(flag)
    patch(
      { [flag]: !settingsRef.current[flag] },
      flag === "basicPlaybackOn",
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
    if (settingsRef.current.presetId === id) patch({ presetId: "" })
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
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest("button, input, textarea, a, label")) return
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
    rememberLayout(drag.slot, drag.latest)
  }

  const dragHandlers = {
    onPointerDown: onDragStart,
    onPointerMove: onPointerMove,
    onPointerUp: onPointerUp,
    onPointerCancel: onPointerUp
  }

  const allowed = siteAllowed(hostname, policy)
  const painted = effectiveSettings(settings)
  const autoPicture =
    settings.autoBrightness &&
    settings.basicVideoOn &&
    settings.videoEnabled &&
    brightnessRead.live != null &&
    !brightnessRead.blocked
  const live =
    settings.enabled &&
    ((settings.videoEnabled && (!isVisualIdentity(painted) || autoPicture)) ||
      (settings.audioTouched && settings.audioEnabled) ||
      (settings.playbackTouched && settings.playbackEnabled))
  const rate = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, settings.playbackRate))
  const holdSpeed = clampHoldPlaybackRate(settings.holdPlaybackRate)

  const histogram =
    settings.autoBrightness && settings.enabled && settings.videoEnabled ? (
      <FrameHistogram bins={brightnessRead.bins} />
    ) : null

  if (!globallyEnabled || !allowed) return null
  if (!layout || layout.mode === "closed" || (!hasVideo && !forcedOpen)) return histogram

  const activePresetId = exactPresetId(settings, userPresets)

  const box = clampDockBox(layout[layout.mode], viewport)
  const tabOn = settings[tabFlag(tab)]
  const actions = tabActions(tab, tabOn)
  const miniIdle = layout.mode === "min" && barIdle
  const dockView = domainDockView(settings, hostname, dockCtx)
  const placeChoice = placePick ? (DOCK_PICKS.find((item) => item.key === placePick) ?? null) : null
  const placeId = placeChoice ? DOCK_PLACE_BY_KEY[placeChoice.key] : null

  return (
    <>
    {histogram}
    <div
      ref={dockRef}
      className="vee-dock"
      data-dragging={dragging ? "true" : "false"}
      data-idle={miniIdle ? "true" : "false"}
      aria-hidden={miniIdle ? true : undefined}
      style={{
        left: `${box.x}px`,
        bottom: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`
      }}
      onPointerDown={stopEvent}
      onKeyDown={stopEvent}
      onWheel={stopEvent}>
      {layout.mode === "min" ? (
        <div className="vee-minibar" aria-label="Video effects minimized" {...dragHandlers}>
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
          <div className="vee-mini-copy">
            <strong>Video Effects</strong>
            <span className="vee-status">
              <span
                data-hide={missingNotice ? "true" : undefined}
                aria-hidden={missingNotice ? true : undefined}>
                {settings.enabled ? "Effects on" : "Effects off"}
              </span>
              <span
                data-hide={missingNotice ? undefined : "true"}
                data-warn="true"
                aria-hidden={missingNotice ? undefined : true}>
                No video detected
              </span>
            </span>
          </div>
          {live ? <span className="vee-mini-dot" /> : null}
          <button
            ref={presetButtonRef}
            type="button"
            className="vee-icon-btn"
            aria-label="Presets"
            aria-expanded={presetOpen}
            title="Presets"
            data-on={String(activePresetId !== "")}
            onClick={() => setPresetOpen((open) => !open)}>
            <Layers size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="vee-icon-btn"
            aria-label="Reset all settings"
            title="Reset video, audio, and playback to their defaults. Saved resume points stay."
            onClick={resetAllTabs}>
            <RotateCcw size={15} strokeWidth={1.75} />
          </button>
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
            aria-label="Hide video effects"
            title="Hide"
            onClick={() => {
              setPresetOpen(false)
              setMode("closed")
            }}>
            <X size={15} strokeWidth={1.75} />
          </button>
          {presetOpen ? (
            <PresetMenu
              menuRef={presetMenuRef}
              drop={box.y < 220 ? "up" : "down"}
              presets={userPresets}
              activeId={activePresetId}
              name={presetName}
              onName={setPresetName}
              onClose={() => setPresetOpen(false)}
              onApply={applyUserPreset}
              onDelete={removePreset}
              onSave={savePreset}
            />
          ) : null}
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
              <span className="vee-status">
                <span
                  data-hide={missingNotice ? "true" : undefined}
                  aria-hidden={missingNotice ? true : undefined}>
                  {hasVideo
                    ? settings.enabled
                      ? "On this video"
                      : "Effects are off"
                    : settings.enabled
                      ? "Effects on"
                      : "Effects off"}
                </span>
                <span
                  data-hide={missingNotice ? undefined : "true"}
                  data-warn="true"
                  aria-hidden={missingNotice ? undefined : true}>
                  No video detected
                </span>
              </span>
            </div>
            <div className="vee-header-actions">
              <button
                ref={presetButtonRef}
                type="button"
                className="vee-icon-btn"
                aria-label="Presets"
                aria-expanded={presetOpen}
                title="Presets"
                data-on={String(activePresetId !== "")}
                onClick={() => setPresetOpen((open) => !open)}>
                <Layers size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="vee-icon-btn"
                aria-label="Reset all settings"
                title="Reset video, audio, and playback to their defaults. Saved resume points stay."
                onClick={resetAllTabs}>
                <RotateCcw size={15} strokeWidth={1.75} />
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
                aria-label="Hide video effects"
                title="Hide"
                onClick={() => {
                  setPresetOpen(false)
                  setMode("closed")
                }}>
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
            {presetOpen ? (
              <PresetMenu
                menuRef={presetMenuRef}
                presets={userPresets}
                activeId={activePresetId}
                name={presetName}
                onName={setPresetName}
                onClose={() => setPresetOpen(false)}
                onApply={applyUserPreset}
                onDelete={removePreset}
                onSave={savePreset}
              />
            ) : null}
          </header>

          <p
            className={`vee-video-warning${missingNotice ? " is-on" : ""}`}
            role={missingNotice ? "status" : undefined}
            aria-hidden={missingNotice ? undefined : true}>
            <span>No video detected</span>
          </p>

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
                        data-on={String(activePresetId === preset.id)}
                        onClick={() => {
                          const match = presetById(preset.id)
                          if (!match) return
                          patch({ ...builtinSnapshot(match), presetId: preset.id }, true)
                        }}>
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="vee-auto-brightness">
                    <button
                      type="button"
                      className="vee-chip"
                      data-on={String(settings.autoBrightness)}
                      aria-pressed={settings.autoBrightness}
                      title={
                        settings.autoBrightness && brightnessRead.blocked
                          ? "This player hides the picture"
                          : "Sample the painted frame and set brightness from its luminance"
                      }
                      onClick={() => {
                        patch({ autoBrightness: !settings.autoBrightness })
                        autoRef.current?.poke()
                      }}>
                      Auto brightness
                    </button>
                    {settings.autoBrightness ? (
                      <p
                        className="vee-auto-note"
                        data-blocked={brightnessRead.blocked ? "true" : "false"}
                        role="status">
                        {!settings.basicVideoOn
                          ? "Turn Basic on to adjust brightness"
                          : brightnessRead.blocked
                            ? "This player hides the picture"
                            : brightnessRead.live == null
                              ? "Reading the picture"
                              : `Live ${percent(brightnessRead.live)}`}
                      </p>
                    ) : null}
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
                      className={control.className}
                      title={control.title}
                      onChange={(value) => {
                        const nextValue = readRange(String(value), control.digits)
                        if (control.key === "brightness" && settingsRef.current.autoBrightness) {
                          patch({ brightness: nextValue, autoBrightness: false }, false, "now")
                          autoRef.current?.poke()
                          return
                        }
                        patch({ [control.key]: nextValue }, false, "heavy")
                      }}
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
                        patch({ stretchX: readRange(String(value), 2) }, false, "heavy")
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
                        patch({ stretchY: readRange(String(value), 2) }, false, "heavy")
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
                            cropRight: settings.cropLeft
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
                        { cropLeft: value, cropRight: value },
                        false,
                        "heavy"
                      )
                    }
                    onStart={(value) =>
                      patch({ cropLeft: value }, false, "heavy")
                    }
                    onEnd={(value) =>
                      patch({ cropRight: value }, false, "heavy")
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
                            cropBottom: settings.cropTop
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
                        { cropTop: value, cropBottom: value },
                        false,
                        "heavy"
                      )
                    }
                    onStart={(value) =>
                      patch({ cropTop: value }, false, "heavy")
                    }
                    onEnd={(value) =>
                      patch({ cropBottom: value }, false, "heavy")
                    }
                  />
                  </div>
                  <Slider
                    label="Zoom"
                    min={ZOOM_MIN}
                    max={ZOOM_MAX}
                    step={0.01}
                    value={settings.zoom}
                    display={percent(settings.zoom)}
                    onChange={(value) =>
                      patch({ zoom: readRange(String(value), 2) }, false, "heavy")
                    }
                  />
                  <div className="vee-frame-block">
                    <h4 className="vee-subhead">Position</h4>
                    <Slider
                      label="X-axis"
                      min={PAN_MIN}
                      max={PAN_MAX}
                      step={1}
                      value={settings.panX}
                      display={percent(settings.panX / 100)}
                      onChange={(value) =>
                        patch({ panX: readRange(String(value), 0) }, false, "heavy")
                      }
                    />
                    <Slider
                      label="Y-axis"
                      min={PAN_MIN}
                      max={PAN_MAX}
                      step={1}
                      value={settings.panY}
                      display={percent(settings.panY / 100)}
                      onChange={(value) =>
                        patch({ panY: readRange(String(value), 0) }, false, "heavy")
                      }
                    />
                  </div>
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
                          onClick={() => patch({ flipH: !settings.flipH })}>
                          <FlipHorizontal2 size={14} strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          className="vee-icon-btn"
                          data-on={String(settings.flipV)}
                          aria-pressed={settings.flipV}
                          aria-label="Flip vertical"
                          title="Flip vertical"
                          onClick={() => patch({ flipV: !settings.flipV })}>
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
                          { rotate: readRange(event.target.value, 0) },
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
                            [control.key]: readRange(String(value), control.digits)
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
                      patch({ volume: readRange(String(value), 2), muted: false }, false, "light")
                    }
                  />
                  <div className="vee-actions">
                    <button
                      type="button"
                      className="vee-action"
                      data-on={String(settings.muted)}
                      aria-pressed={settings.muted}
                      onClick={() => patch({ muted: !settings.muted })}>
                      {settings.muted ? (
                        <VolumeX size={14} strokeWidth={1.75} />
                      ) : (
                        <Volume2 size={14} strokeWidth={1.75} />
                      )}
                      {settings.muted ? "Muted" : "Mute"}
                    </button>
                  </div>
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
                    step={0.01}
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
                </Group>
                <div className="vee-switch-row vee-switch-solo">
                  <div>
                    <span>Sync with custom controller</span>
                    <small>
                      On saves speed, volume, mute, and playback speed from the on-video bar and the site
                      player into this panel. Off keeps those changes on this tab.
                    </small>
                  </div>
                  <button
                    className="vee-switch"
                    type="button"
                    role="switch"
                    aria-checked={settings.syncCustomController}
                    aria-label="Sync with custom controller"
                    title="On saves speed, volume, mute, and playback speed from the on-video bar and the site player into this panel. Off keeps those changes on this tab."
                    data-on={String(settings.syncCustomController)}
                    onClick={toggleCustomSync}>
                    <i />
                  </button>
                </div>
                <Group
                  id="playback-open-tabs"
                  title="Auto-sync already open tab"
                  icon={RefreshCw}
                  open={sectionOpen("playback-open-tabs")}
                  onToggle={() => toggleSection("playback-open-tabs")}>
                  <p className="vee-hint">
                    On sends that kind of change to every open tab on this site. Off leaves tabs that are
                    already open unchanged. A new tab or a refresh uses the saved change.
                  </p>
                  <SwitchRow
                    icon={AudioLines}
                    label="Audio"
                    detail="Speed, volume, mute, and playback speed."
                    checked={settings.syncOpenTabsAudio}
                    onClick={() => setOpenTabSync("syncOpenTabsAudio")}
                  />
                  <SwitchRow
                    icon={Video}
                    label="Video"
                    detail="Color, frame, position, and the other picture effects."
                    checked={settings.syncOpenTabsVideo}
                    onClick={() => setOpenTabSync("syncOpenTabsVideo")}
                  />
                </Group>
                <Group
                  id="playback-hold"
                  title="Hold"
                  icon={FastForward}
                  open={sectionOpen("playback-hold")}
                  onToggle={() => toggleSection("playback-hold")}>
                  <SwitchRow
                    label={`Hold for ${formatRate(holdSpeed)}`}
                    detail={`Press and hold the video to play at ${formatRate(holdSpeed)}. Release to return to the previous speed.`}
                    checked={settings.holdToSpeed}
                    onClick={() => patch({ holdToSpeed: !settings.holdToSpeed })}
                  />
                  <Slider
                    label="Hold speed"
                    min={HOLD_RATE_MIN}
                    max={HOLD_RATE_MAX}
                    step={HOLD_RATE_STEP}
                    value={holdSpeed}
                    display={formatRate(holdSpeed)}
                    onChange={(value) =>
                      patch({
                        holdPlaybackRate: clampHoldPlaybackRate(readRange(String(value), 2))
                      })
                    }
                  />
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
                <div className="vee-switch-row vee-switch-solo">
                  <div>
                    <span>Preserve speech</span>
                    <small>Keeps voices natural when playbackspeed is different than 1×.</small>
                  </div>
                  <button
                    className="vee-switch"
                    type="button"
                    role="switch"
                    aria-checked={settings.preservePitch}
                    aria-label="Preserve speech"
                    title="Keeps voices natural when playback speed is different than 1×"
                    data-on={String(settings.preservePitch)}
                    onClick={() => patch({ preservePitch: !settings.preservePitch }, true)}>
                    <i />
                  </button>
                </div>
                <Group
                  id="playback-skip"
                  title="Skip Advertisement"
                  icon={SkipForward}
                  open={sectionOpen("playback-skip")}
                  onToggle={() => toggleSection("playback-skip")}
                  applied={settings.skipAdsEnabled}
                  tools={
                    <button
                      className="vee-switch"
                      type="button"
                      role="switch"
                      aria-checked={settings.skipAdsEnabled}
                      aria-label="Skip advertisement"
                      title="Turns skip advertisement on or off. The four methods below keep their own settings."
                      data-on={String(settings.skipAdsEnabled)}
                      onClick={() => patch({ skipAdsEnabled: !settings.skipAdsEnabled })}>
                      <i />
                    </button>
                  }>
                  <p className="vee-hint">
                    Turn this on to skip ads. Each method runs only when its own switch is on.
                    Turning this off keeps those four settings.
                  </p>
                  <SwitchRow
                    label="Click Skip ad"
                    detail="Clicks the site's Skip ad or Close ad button when it appears."
                    checked={settings.skipAds}
                    onClick={() => patch({ skipAds: !settings.skipAds })}
                  />
                  <SwitchRow
                    label="Speed up the ad"
                    detail="Plays the ad at 16× until it ends. The speed slider stays where you set it."
                    checked={settings.skipAdsSpeed}
                    onClick={() => patch({ skipAdsSpeed: !settings.skipAdsSpeed })}
                  />
                  <SwitchRow
                    label="Jump to the end of the ad"
                    detail="Moves the ad timeline to the end while an ad is showing."
                    checked={settings.skipAdsSeek}
                    onClick={() => patch({ skipAdsSeek: !settings.skipAdsSeek })}
                  />
                  <SwitchRow
                    label="Block ad requests"
                    detail="Blocks known ad addresses on this site. The video stream is left alone."
                    checked={settings.skipAdsBlock}
                    onClick={() => {
                      if (settings.skipAdsBlock) {
                        patch({ skipAdsBlock: false })
                        void chrome.runtime.sendMessage({ type: AD_BLOCK_DISMISS, host: hostname }).catch(() => undefined)
                        return
                      }
                      patch({ skipAdsBlock: true })
                      void chrome.runtime
                        .sendMessage({ type: AD_BLOCK_CHECK, host: hostname })
                        .then((response: { ok?: boolean; pending?: boolean } | undefined) => {
                          if (!response || response.ok || response.pending) return
                          if (settingsRef.current.skipAdsBlock) patch({ skipAdsBlock: false })
                        })
                        .catch(() => undefined)
                    }}
                  />
                </Group>
                <div className="vee-switch-row vee-switch-solo">
                  <div>
                    <span>Loop</span>
                    <small>Plays this video again when it ends.</small>
                  </div>
                  <button
                    className="vee-switch"
                    type="button"
                    role="switch"
                    aria-checked={settings.loop}
                    aria-label="Loop"
                    title="Plays this video again when it ends"
                    data-on={String(settings.loop)}
                    onClick={() => patch({ loop: !settings.loop }, true)}>
                    <i />
                  </button>
                </div>
                {document.pictureInPictureEnabled ? (
                  <div className="vee-switch-row vee-switch-solo">
                    <div>
                      <span>Picture in picture</span>
                      <small>Opens the video in a floating window.</small>
                    </div>
                    <button
                      className="vee-switch"
                      type="button"
                      role="switch"
                      aria-checked={pipOn}
                      aria-label="Picture in picture"
                      title="Opens the video in a floating window"
                      data-on={String(pipOn)}
                      onClick={() => {
                        const video = getActiveVideo()
                        if (!video) return
                        void togglePictureInPicture(video).catch(() => undefined)
                      }}>
                      <i />
                    </button>
                  </div>
                ) : null}
                <Group
                  id="playback-resume"
                  title="Resume where you left off"
                  icon={Clock}
                  open={sectionOpen("playback-resume")}
                  onToggle={() => toggleSection("playback-resume")}
                  tools={
                    <>
                      {progressRows.length > 0 ? (
                        <button
                          type="button"
                          className="vee-icon-btn vee-section-btn vee-trash"
                          aria-label="Clear all saved positions"
                          title="Clear all saved positions"
                          onClick={() => clearProgress()}>
                          <Trash2 size={13} strokeWidth={1.75} />
                        </button>
                      ) : null}
                      <button
                        className="vee-switch"
                        type="button"
                        role="switch"
                        aria-checked={settings.rememberProgress}
                        aria-label="Resume where you left off"
                        title="Save this video every few seconds and continue from that moment later"
                        data-on={String(settings.rememberProgress)}
                        onClick={() => patch({ rememberProgress: !settings.rememberProgress })}>
                        <i />
                      </button>
                    </>
                  }>
                  <p className="vee-hint">
                    Saves each video and continues from that moment after you close the browser.
                    Newest sites are listed first.
                  </p>
                  <ProgressList
                    groups={groupProgress(progressRows)}
                    openDomains={openDomains}
                    onToggle={(domain, open) =>
                      setOpenDomains((current) => ({ ...current, [domain]: !open }))
                    }
                    onDelete={deleteProgress}
                    onDeleteDomain={deleteProgressForDomain}
                  />
                </Group>
                <Group
                  id="playback-player"
                  title="Video player controls"
                  icon={SlidersHorizontal}
                  open={sectionOpen("playback-player")}
                  onToggle={() => toggleSection("playback-player")}
                  tools={
                    <button
                      className="vee-switch"
                      type="button"
                      role="switch"
                      aria-checked={settings.dockEnabled}
                      aria-label="Video player controls"
                      title="Turns the controls on the video on or off. Each control keeps its own setting."
                      data-on={String(settings.dockEnabled)}
                      onClick={() => patch({ dockEnabled: !settings.dockEnabled })}>
                      <i />
                    </button>
                  }>
                  <p className="vee-hint">
                    Turn this on to show the controls on the video. Click an icon to turn that
                    control on and choose where it sits. Controls that share a side line up together.
                  </p>
                  <div className="vee-dock-picks" role="group" aria-label="Controls on the video">
                    {DOCK_PICKS.map((pick) => {
                      const Icon = pick.icon
                      const on = dockView[pick.key]
                      const open = placePick === pick.key
                      return (
                        <button
                          key={pick.key}
                          ref={open ? placeAnchorRef : undefined}
                          type="button"
                          className="vee-dock-pick"
                          aria-pressed={on}
                          aria-expanded={open}
                          data-on={String(on)}
                          title={pick.title}
                          onClick={() =>
                            setPlacePick((current) => (current === pick.key ? null : pick.key))
                          }>
                          <Icon size={15} strokeWidth={1.75} />
                          <span>{pick.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    className="vee-reset"
                    title="Put the on-video controls back on this site's default places"
                    onClick={resetDockPositions}>
                    Reset positions
                  </button>
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
              title={actions.toggleTitle}
              onClick={() => patch({ [tabFlag(tab)]: !tabOn })}>
              {actions.toggle}
            </button>
            <button
              type="button"
              className="vee-reset"
              title={actions.resetTitle}
              onClick={resetCurrentTab}>
              {actions.reset}
            </button>
          </div>
        </section>
      ) : null}

      {placeChoice &&
      placeId &&
      layout.mode === "max" &&
      tab === "playback" &&
      sectionOpen("playback-player") ? (
        <div
          className="vee-place-pop"
          ref={placePopRef}
          role="dialog"
          aria-label={`${placeChoice.label} placement`}
          onPointerDown={stopEvent}>
          <PlaceCard
            id={placeId}
            label={placeChoice.label}
            icon={placeChoice.icon}
            place={dockView.dockLayout[placeId]}
            enabled={dockView[placeChoice.key]}
            onEnabled={() => toggleDockFlag(placeChoice.key)}
            onReset={() => resetDockPlace(placeId)}
            onChange={(change) => moveDock(placeId, change)}
            tools={
              placeId === "skip" ? (
                <>
                  <StepField
                    label="Skip length"
                    detail="Seconds each skip button moves."
                    value={settings.skipSeconds}
                    min={SKIP_SECONDS_MIN}
                    max={SKIP_SECONDS_MAX}
                    unit="sec"
                    onChange={(value) => patch({ skipSeconds: clampSkipSeconds(value) })}
                  />
                  <SwitchRow
                    label="Left and right keys"
                    detail="Jump by this amount instead of the player's arrow keys."
                    checked={settings.skipArrowKeys}
                    onClick={() => patch({ skipArrowKeys: !settings.skipArrowKeys })}
                  />
                </>
              ) : placeId === "volume" ? (
                <>
                  <SwitchRow
                    label="Up and down keys"
                    detail="Change volume by the step below instead of the player's arrow keys."
                    checked={settings.volumeArrowKeys}
                    onClick={() => patch({ volumeArrowKeys: !settings.volumeArrowKeys })}
                  />
                  <StepField
                    label="Volume step"
                    detail="Percent each arrow press changes the volume."
                    value={settings.volumeStepPercent}
                    min={VOLUME_STEP_MIN}
                    max={VOLUME_STEP_MAX}
                    unit="%"
                    onChange={(value) => patch({ volumeStepPercent: clampVolumeStep(value) })}
                  />
                </>
              ) : null
            }
          />
        </div>
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
    </>
  )
}

function placeHistogram(box: ViewportBox): { left: number; top: number } {
  const left = Math.round(
    Math.min(
      Math.max(8, window.innerWidth - HISTOGRAM_WIDTH - 8),
      Math.max(8, box.left + box.width - HISTOGRAM_INSET - HISTOGRAM_WIDTH)
    )
  )
  const top = Math.round(
    Math.min(
      Math.max(8, window.innerHeight - HISTOGRAM_HEIGHT - 8),
      Math.max(8, box.top + HISTOGRAM_INSET)
    )
  )
  return { left, top }
}

function paintHistogram(canvas: HTMLCanvasElement, bins: HistogramBins | null): void {
  const cssWidth = canvas.clientWidth || HISTOGRAM_WIDTH - 12
  const cssHeight = canvas.clientHeight || HISTOGRAM_HEIGHT - 12
  const scale = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(cssWidth * scale))
  const height = Math.max(1, Math.round(cssHeight * scale))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const context = canvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, width, height)
  if (!bins) return
  const channels = [
    { values: bins.r, color: "rgba(255, 96, 96, 0.55)" },
    { values: bins.g, color: "rgba(72, 220, 140, 0.5)" },
    { values: bins.b, color: "rgba(96, 150, 255, 0.55)" }
  ]
  for (const channel of channels) {
    let peak = 1
    for (const value of channel.values) peak = Math.max(peak, value)
    context.beginPath()
    context.moveTo(0, height)
    const last = channel.values.length - 1
    channel.values.forEach((count, index) => {
      const x = last === 0 ? 0 : (index / last) * width
      const y = height - (count / peak) * (height - 2)
      context.lineTo(x, y)
    })
    context.lineTo(width, height)
    context.closePath()
    context.fillStyle = channel.color
    context.fill()
  }
}

function FrameHistogram({ bins }: { bins: HistogramBins | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const update = () => {
      const video = getActiveVideo()
      const box = video ? paintedVideoBox(video) : null
      if (!box) {
        setPlace((current) => (current == null ? current : null))
        return
      }
      const next = placeHistogram(box)
      setPlace((current) =>
        current && current.left === next.left && current.top === next.top ? current : next
      )
    }
    update()
    const timer = window.setInterval(update, 200)
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    document.addEventListener("fullscreenchange", update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
      document.removeEventListener("fullscreenchange", update)
    }
  }, [])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    paintHistogram(canvas, bins)
  }, [bins, place])

  if (!place) return null
  return (
    <div
      className="vee-histogram"
      style={{ left: `${place.left}px`, top: `${place.top}px` }}
      aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}

function progressRowTitle(domain: string, label: string): string {
  if (domain === "youtube.com" && !label.startsWith("/")) return `youtube.com/watch?v=${label}`
  if (label.startsWith("/")) return `${domain}${label}`
  return `${domain} · ${label}`
}

function progressMatchesPage(row: SavedProgress): boolean {
  const href = progressHref(row)
  if (!href) return false
  try {
    const current = new URL(location.href)
    const target = new URL(href)
    const host = (value: string) => value.toLowerCase().replace(/^www\./, "")
    if (host(current.hostname) !== host(target.hostname)) return false
    const id = (url: URL) => {
      const watch = url.searchParams.get("v")
      if (watch) return watch
      const parts = url.pathname.split("/").filter(Boolean)
      const marker = parts.findIndex(
        (part) => part === "shorts" || part === "embed" || part === "live" || part === "v"
      )
      if (marker >= 0 && parts[marker + 1]) return parts[marker + 1]
      if (host(url.hostname) === "youtu.be") return parts[0] || ""
      return ""
    }
    const currentId = id(current)
    const targetId = id(target)
    if (currentId && targetId) return currentId === targetId
    return current.pathname === target.pathname
  } catch {
    return false
  }
}

function progressDisplayTitle(row: SavedProgress): string {
  if (progressMatchesPage(row)) {
    const live = readPageTitle()
    if (live) return live
  }
  return row.title || row.label
}

function ProgressList({
  groups,
  openDomains,
  onToggle,
  onDelete,
  onDeleteDomain
}: {
  groups: ProgressGroup[]
  openDomains: Record<string, boolean>
  onToggle: (domain: string, open: boolean) => void
  onDelete: (key: string) => void
  onDeleteDomain: (domain: string) => void
}) {
  if (groups.length === 0) return <p className="vee-hint">No saved videos yet.</p>
  const latest = groups[0]?.domain
  return (
    <div className="vee-progress-list">
      {groups.map((group) => {
        const open = openDomains[group.domain] ?? group.domain === latest
        return (
          <section key={group.domain} className={`vee-domain${open ? "" : " is-collapsed"}`}>
            <div className="vee-domain-head">
              <button
                type="button"
                className="vee-domain-toggle"
                aria-expanded={open}
                onClick={() => onToggle(group.domain, open)}>
                <ChevronDown className="vee-chevron" size={14} strokeWidth={1.75} />
                <strong>
                  {group.domain} ({group.rows.length})
                </strong>
              </button>
              <button
                type="button"
                className="vee-icon-btn vee-section-btn vee-trash"
                aria-label={`Delete saved positions for ${group.domain}`}
                title={`Delete ${group.domain}`}
                onClick={() => onDeleteDomain(group.domain)}>
                <Trash2 size={13} strokeWidth={1.75} />
              </button>
            </div>
            {open ? (
              <div className="vee-domain-body">
                {group.rows.map((row) => {
                  const href = progressHref(row)
                  const title = progressDisplayTitle(row)
                  return (
                    <div key={row.key} className="vee-progress-row">
                      {href ? (
                        <a
                          className="vee-progress-link"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={href}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            window.open(href, "_blank", "noopener,noreferrer")
                          }}>
                          {title}
                        </a>
                      ) : (
                        <span className="vee-progress-link" title={progressRowTitle(group.domain, row.label)}>
                          {title}
                        </span>
                      )}
                      <small className="vee-progress-time">{formatClock(row.time)}</small>
                      <button
                        type="button"
                        className="vee-icon-btn vee-trash vee-icon-quiet"
                        aria-label={`Delete ${title}`}
                        title="Delete"
                        onClick={() => onDelete(row.key)}>
                        <Trash2 size={13} strokeWidth={1.75} />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function slotChoices(edge: DockEdge): { slot: DockSlot; label: string }[] {
  const vertical = edge === "left" || edge === "right"
  return [
    { slot: "start", label: vertical ? "Top" : "Left" },
    { slot: "center", label: "Center" },
    { slot: "end", label: vertical ? "Bottom" : "Right" },
    { slot: "custom", label: "Custom" }
  ]
}

function nextPlacement(
  layout: ControlLayout,
  id: DockPlaceId,
  change: Partial<DockPlacement>
): ControlLayout {
  const current = layout[id]
  let next: DockPlacement = { ...current, ...change }
  if (change.slot === "custom" && current.slot !== "custom") {
    next = { ...next, slot: "custom", ...customAnchor(id, current.edge, current.slot) }
  } else if (change.edge && change.edge !== current.edge && next.slot === "custom") {
    const along: DockSlot = change.edge === "left" || change.edge === "right" ? "center" : "start"
    next = { ...next, edge: change.edge, ...customAnchor(id, change.edge, along) }
  }
  return { ...layout, [id]: next }
}

function PlaceCard({
  id,
  label,
  icon: Icon,
  place,
  enabled,
  onEnabled,
  onReset,
  onChange,
  tools
}: {
  id: DockPlaceId
  label: string
  icon: DockGlyph
  place: DockPlacement
  enabled: boolean
  onEnabled: () => void
  onReset: () => void
  onChange: (change: Partial<DockPlacement>) => void
  tools?: React.ReactNode
}) {
  return (
    <div className="vee-place-card" data-place={id}>
      <h4>
        <Icon size={14} strokeWidth={1.75} />
        {label}
      </h4>
      <div className="vee-switch-row">
        <div>
          <span>Show on video</span>
        </div>
        <button
          className="vee-switch"
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`Show ${label} on the video`}
          title={enabled ? `${label} is on the video` : `${label} is off`}
          data-on={String(enabled)}
          onClick={onEnabled}>
          <i />
        </button>
      </div>
      {tools}
      <p className="vee-place-label">Side</p>
      <div className="vee-seg" role="group" aria-label={`${label} side`}>
        {DOCK_SIDES.map((side) => (
          <button
            key={side.edge}
            type="button"
            aria-pressed={place.edge === side.edge}
            data-on={String(place.edge === side.edge)}
            onClick={() => onChange({ edge: side.edge })}>
            {side.label}
          </button>
        ))}
      </div>
      <p className="vee-place-label">Align</p>
      <div className="vee-seg" role="group" aria-label={`${label} align`}>
        {slotChoices(place.edge).map((choice) => (
          <button
            key={choice.slot}
            type="button"
            aria-pressed={place.slot === choice.slot}
            data-on={String(place.slot === choice.slot)}
            onClick={() => onChange({ slot: choice.slot })}>
            {choice.label}
          </button>
        ))}
      </div>
      {place.slot === "custom" ? (
        <>
          <Slider
            label="Horizontal"
            min={0}
            max={100}
            step={1}
            value={place.x}
            display={`${place.x}%`}
            onChange={(value) => onChange({ x: readRange(String(value), 0) })}
          />
          <Slider
            label="Vertical"
            min={0}
            max={100}
            step={1}
            value={place.y}
            display={`${place.y}%`}
            onChange={(value) => onChange({ y: readRange(String(value), 0) })}
          />
        </>
      ) : null}
      <button
        type="button"
        className="vee-reset vee-place-reset"
        title="Reset this control to its default place"
        onClick={onReset}>
        Reset
      </button>
    </div>
  )
}

function StepField({
  label,
  detail,
  value,
  min,
  max,
  unit,
  onChange
}: {
  label: string
  detail: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <label className="vee-step-field">
      <span>
        {label}
        <small>{detail}</small>
      </span>
      <span className="vee-step-value">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-label={label}
          title={`${min} to ${max}`}
          onChange={(event) => {
            const raw = event.target.value.trim()
            if (!raw) return
            const parsed = Number(raw)
            if (!Number.isFinite(parsed)) return
            onChange(parsed)
          }}
        />
        <b>{unit}</b>
      </span>
    </label>
  )
}

function SwitchRow({
  label,
  detail,
  checked,
  onClick,
  icon: Icon
}: {
  label: string
  detail: string
  checked: boolean
  onClick: () => void
  icon?: typeof Video
}) {
  return (
    <div className="vee-switch-row">
      <div>
        <span>
          {Icon ? <Icon size={14} strokeWidth={1.75} /> : null}
          {label}
        </span>
        <small>{detail}</small>
      </div>
      <button
        className="vee-switch"
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={detail}
        data-on={String(checked)}
        onClick={onClick}>
        <i />
      </button>
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
  tools,
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
  tools?: React.ReactNode
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
        {tools || onReset || onApply ? (
          <div className="vee-group-tools">
            {tools}
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
  const read = (value: number) => cropControlToCss(readRange(String(value), 0))
  const controlStart = cropCssToControl(start)
  const controlEnd = cropCssToControl(end)
  return (
    <div className="vee-crop">
      <div className="vee-crop-head">
        <span>{title}</span>
        <span className="vee-crop-tools">
          {linked ? <b>{cropCssToControl(start)}%</b> : null}
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
          max={100}
          step={1}
          value={controlStart}
          display={`${controlStart}%`}
          onChange={(value) => onPair(read(value))}
        />
      ) : (
        <>
          <Slider
            label={startLabel}
            min={0}
            max={100}
            step={1}
            value={controlStart}
            display={`${controlStart}%`}
            onChange={(value) => onStart(read(value))}
          />
          <Slider
            label={endLabel}
            min={0}
            max={100}
            step={1}
            value={controlEnd}
            display={`${controlEnd}%`}
            onChange={(value) => onEnd(read(value))}
          />
        </>
      )}
    </div>
  )
}

function PresetMenu({
  menuRef,
  drop,
  presets,
  activeId,
  name,
  onName,
  onClose,
  onApply,
  onDelete,
  onSave
}: {
  menuRef: Ref<HTMLDivElement>
  drop?: "up" | "down"
  presets: UserPreset[]
  activeId: string
  name: string
  onName: (value: string) => void
  onClose: () => void
  onApply: (preset: UserPreset) => void
  onDelete: (id: string) => void
  onSave: () => void
}) {
  return (
    <div className="vee-preset-menu" data-drop={drop} ref={menuRef} onPointerDown={stopEvent}>
      <div className="vee-preset-menu-head">
        <strong>Presets</strong>
        <button
          type="button"
          className="vee-icon-btn vee-section-btn"
          aria-label="Close presets"
          title="Close"
          onClick={onClose}>
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>
      {presets.length === 0 ? (
        <p className="vee-preset-empty">No saved presets yet.</p>
      ) : (
        <div className="vee-preset-list" role="listbox" aria-label="Saved presets">
          {presets.map((preset) => (
            <div key={preset.id} className="vee-preset-item" data-on={String(activeId === preset.id)}>
              <button
                type="button"
                className="vee-preset-apply"
                role="option"
                aria-selected={activeId === preset.id}
                onClick={() => onApply(preset)}>
                {preset.label}
              </button>
              <button
                type="button"
                className="vee-icon-btn vee-preset-delete"
                aria-label={`Delete ${preset.label}`}
                title="Delete preset"
                onClick={() => onDelete(preset.id)}>
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
          value={name}
          onChange={(event) => onName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSave()
          }}
        />
        <button type="button" disabled={!name.trim()} onClick={onSave}>
          Save
        </button>
      </div>
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
  showLabel = true,
  className,
  title
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange: (value: number) => void
  showLabel?: boolean
  className?: string
  title?: string
}) {
  return (
    <label className="vee-row">
      {showLabel ? (
        <span className="vee-row-label">
          <span>{label}</span>
          <b>{display}</b>
        </span>
      ) : null}
      <input
        className={className}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        title={title}
        style={{ ["--p" as string]: percentOf(value, min, max) }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export default Overlay
