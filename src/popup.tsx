import { ChevronDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { SitePolicyPanel } from "~components/site-policy-panel"
import { defaultSnapshot, presetLabel, resolvePresetId, type UserPreset } from "~lib/presets"
import {
  SITE_POLICY_KEY,
  defaultSitePolicy,
  hostFromUrl,
  normalizeHost,
  loadSitePolicy,
  sanitizeSitePolicy,
  saveSitePolicy,
  type SitePolicy
} from "~lib/sites"
import {
  GLOBAL_ENABLED_KEY,
  OPEN_MESSAGE,
  USER_PRESETS_KEY,
  loadGlobalEnabled,
  loadSiteSettings,
  loadUserPresets,
  normalizeSettings,
  readGlobalEnabled,
  requestOpenPanel,
  sanitizeUserPresets,
  saveGlobalEnabled,
  saveSiteSettings,
  siteStorageKey
} from "~lib/storage"
import { settingsEqual, type EffectSettings } from "~lib/types"

import "./components/site-policy.css"
import "./popup.css"

type ReadyState = {
  kind: "ready"
  tabId: number
  hostname: string
  settings: EffectSettings
}

type PopupState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "unsupported" }
  | ReadyState

async function readActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function readPage(
  tabId: number
): Promise<{ pending?: boolean; hostname?: string; settings?: EffectSettings } | null> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "VEE_STATUS" })
  } catch {
    return null
  }
}

function Popup() {
  const [state, setState] = useState<PopupState>({ kind: "loading" })
  const [pageHost, setPageHost] = useState("")
  const [policy, setPolicy] = useState<SitePolicy>(defaultSitePolicy)
  const [savedPresets, setSavedPresets] = useState<UserPreset[]>([])
  const [globallyEnabled, setGloballyEnabled] = useState<boolean | null>(null)
  const [presetMenu, setPresetMenu] = useState(false)
  const [pane, setPane] = useState<"general" | "sites">("general")
  const presetRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true

    const load = async () => {
      const [tab, storedPolicy, enabled] = await Promise.all([
        readActiveTab(),
        loadSitePolicy(),
        loadGlobalEnabled()
      ])
      if (!alive) return
      setPolicy(storedPolicy)
      setGloballyEnabled(enabled)
      if (!tab?.id) {
        setPageHost("")
        setState({ kind: "unsupported" })
        return
      }

      const tabHost = tab.url ? hostFromUrl(tab.url) : ""
      const page = await readPage(tab.id)
      if (!alive) return
      if (!page?.hostname) {
        setPageHost(tabHost)
        const url = tab.url ?? ""
        if (url.startsWith("http://") || url.startsWith("https://")) {
          setState({ kind: "missing" })
        } else {
          setState({ kind: "unsupported" })
        }
        return
      }
      setPageHost(page.hostname)

      const [stored, saved] = await Promise.all([
        loadSiteSettings(page.hostname),
        loadUserPresets()
      ])
      if (!alive) return
      setSavedPresets(saved)
      const settings =
        page.settings && page.pending !== true
          ? normalizeSettings({ ...stored, ...page.settings })
          : stored
      if (!alive) return
      setState({
        kind: "ready",
        tabId: tab.id,
        hostname: page.hostname,
        settings
      })
    }

    void load()

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "local") return
      if (changes[GLOBAL_ENABLED_KEY]) {
        setGloballyEnabled(readGlobalEnabled(changes[GLOBAL_ENABLED_KEY].newValue))
      }
      if (changes[SITE_POLICY_KEY]) setPolicy(sanitizeSitePolicy(changes[SITE_POLICY_KEY].newValue))
      if (changes[USER_PRESETS_KEY]) {
        setSavedPresets(sanitizeUserPresets(changes[USER_PRESETS_KEY].newValue))
      }
      setState((current) => {
        if (current.kind !== "ready") return current
        const stored = changes[siteStorageKey(current.hostname)]?.newValue as
          | Partial<EffectSettings>
          | undefined
        if (!stored) return current
        const settings = normalizeSettings(stored)
        if (settingsEqual(current.settings, settings)) return current
        return { ...current, settings }
      })
    }

    chrome.storage.onChanged.addListener(onChanged)
    return () => {
      alive = false
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [])

  useEffect(() => {
    if (!presetMenu) return
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath()
      if (presetRowRef.current && path.includes(presetRowRef.current)) return
      setPresetMenu(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresetMenu(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [presetMenu])

  const toggle = async () => {
    if (globallyEnabled == null) return
    const next = !globallyEnabled
    setGloballyEnabled(next)
    await saveGlobalEnabled(next)
  }

  const applySnapshot = async (presetId: string, snapshot: UserPreset["snapshot"]) => {
    if (state.kind !== "ready") return
    const settings = normalizeSettings({
      ...state.settings,
      ...snapshot,
      presetId,
      playbackTouched: true
    })
    setState({ ...state, settings })
    setPresetMenu(false)
    await saveSiteSettings(state.hostname, settings)
  }

  const applyPreset = (preset: UserPreset) => applySnapshot(preset.id, preset.snapshot)

  const applyDefault = () => applySnapshot("default", defaultSnapshot())

  const updatePolicy = (next: SitePolicy) => {
    setPolicy(next)
    void saveSitePolicy(next)
  }

  const showPane = (next: "general" | "sites") => {
    setPresetMenu(false)
    setPane(next)
  }

  const activePresetId =
    state.kind === "ready" ? resolvePresetId(state.settings, savedPresets) : ""

  const openControls = async () => {
    if (!globallyEnabled || state.kind !== "ready") return
    await requestOpenPanel(state.hostname)
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: OPEN_MESSAGE })
    } catch {
      /* The storage signal still opens the panel in every frame. */
    }
    window.close()
  }

  return (
    <main className="popup">
      <div className="hero">
        <div className="mark" aria-hidden="true">
          <SlidersIcon />
        </div>
        <div>
          <h1>Video Effects</h1>
          <p>
            {state.kind === "ready"
              ? normalizeHost(state.hostname) ?? state.hostname
              : "Color, shape, and playback"}
          </p>
        </div>
      </div>

      <div className="popup-tabs" role="tablist" aria-label="Popup sections">
        <button
          type="button"
          className="popup-tab"
          role="tab"
          aria-selected={pane === "general"}
          onClick={() => showPane("general")}>
          General
        </button>
        <button
          type="button"
          className="popup-tab"
          role="tab"
          aria-selected={pane === "sites"}
          onClick={() => showPane("sites")}>
          Site list
        </button>
      </div>

      {pane === "sites" ? (
        <SitePolicyPanel hostname={pageHost} policy={policy} onChange={updatePolicy} />
      ) : null}

      {pane === "general" ? (
        <>
          <section className="card">
            <div className="row">
              <div>
                <span>Effects</span>
                <strong>{globallyEnabled == null ? "…" : globallyEnabled ? "On" : "Off"}</strong>
              </div>
              <button
                className="switch"
                type="button"
                role="switch"
                aria-checked={globallyEnabled === true}
                aria-label="Toggle effects"
                data-on={String(globallyEnabled === true)}
                disabled={globallyEnabled == null}
                onClick={() => void toggle()}>
                <i />
              </button>
            </div>
            {state.kind === "ready" ? (
              <div className="row preset-row" ref={presetRowRef}>
                <div>
                  <span>All Presets</span>
                  <strong>{presetLabel(activePresetId, savedPresets)}</strong>
                </div>
                <button
                  type="button"
                  className="preset-toggle"
                  aria-label="All presets"
                  aria-expanded={presetMenu}
                  aria-haspopup="listbox"
                  onClick={() => setPresetMenu((open) => !open)}>
                  <ChevronDown size={16} strokeWidth={1.75} />
                </button>
                {presetMenu ? (
                  <div className="preset-menu" role="listbox" aria-label="All presets">
                    <button
                      type="button"
                      role="option"
                      className="preset-option"
                      aria-selected={activePresetId === "default"}
                      data-on={String(activePresetId === "default")}
                      onClick={() => void applyDefault()}>
                      Default
                    </button>
                    {savedPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        role="option"
                        className="preset-option"
                        aria-selected={activePresetId === preset.id}
                        data-on={String(activePresetId === preset.id)}
                        onClick={() => void applyPreset(preset)}>
                        {preset.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
          {state.kind === "loading" ? <p className="note">Looking at this page…</p> : null}
          {state.kind === "unsupported" ? (
            <p className="note">Open a normal web page with a video, then use the controls there.</p>
          ) : null}
          {state.kind === "missing" ? (
            <p className="note">Refresh this page once so Video Effects can attach to the player.</p>
          ) : null}
          {state.kind === "ready" ? (
            <>
              <button
                className="primary"
                type="button"
                disabled={globallyEnabled !== true}
                onClick={() => void openControls()}>
                Open controls
              </button>
              <p className="note">Sliders stay on the video, including while it is fullscreen.</p>
            </>
          ) : null}
        </>
      ) : null}
    </main>
  )
}

function SlidersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

export default Popup
