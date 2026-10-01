import { useEffect, useState } from "react"

import { presetLabel } from "~lib/presets"
import {
  OPEN_MESSAGE,
  loadSiteSettings,
  requestOpenPanel,
  saveSiteSettings,
  siteStorageKey
} from "~lib/storage"
import { defaultSettings, settingsEqual, type EffectSettings } from "~lib/types"

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

  useEffect(() => {
    let alive = true

    const load = async () => {
      const tab = await readActiveTab()
      if (!alive) return
      if (!tab?.id) {
        setState({ kind: "unsupported" })
        return
      }

      const page = await readPage(tab.id)
      if (!alive) return
      if (!page?.hostname) {
        const url = tab.url ?? ""
        if (url.startsWith("http://") || url.startsWith("https://")) {
          setState({ kind: "missing" })
        } else {
          setState({ kind: "unsupported" })
        }
        return
      }

      const stored = await loadSiteSettings(page.hostname)
      const settings = page.settings ? { ...stored, ...page.settings } : stored
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
      setState((current) => {
        if (current.kind !== "ready") return current
        const stored = changes[siteStorageKey(current.hostname)]?.newValue as
          | Partial<EffectSettings>
          | undefined
        if (!stored) return current
        const settings = { ...defaultSettings(), ...stored }
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

  const toggle = async () => {
    if (state.kind !== "ready") return
    const settings = { ...state.settings, enabled: !state.settings.enabled }
    setState({ ...state, settings })
    await saveSiteSettings(state.hostname, settings)
  }

  const openControls = async () => {
    if (state.kind !== "ready") return
    await requestOpenPanel(state.hostname)
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: OPEN_MESSAGE })
    } catch {
      /* The storage signal still opens the panel in every frame. */
    }
  }

  return (
    <main className="popup">
      <div className="hero">
        <div className="mark" aria-hidden="true">
          <SlidersIcon />
        </div>
        <div>
          <h1>Video Effects</h1>
          <p>{state.kind === "ready" ? state.hostname : "Color, shape, and playback"}</p>
        </div>
      </div>

      {state.kind === "loading" ? <p className="note">Looking at this page…</p> : null}

      {state.kind === "unsupported" ? (
        <p className="note">Open a normal web page with a video, then use the controls there.</p>
      ) : null}

      {state.kind === "missing" ? (
        <p className="note">Refresh this page once so Video Effects can attach to the player.</p>
      ) : null}

      {state.kind === "ready" ? (
        <>
          <section className="card">
            <div className="row">
              <div>
                <span>Effects</span>
                <strong>{state.settings.enabled ? "On" : "Off"}</strong>
              </div>
              <button
                className="switch"
                type="button"
                role="switch"
                aria-checked={state.settings.enabled}
                aria-label="Toggle effects"
                data-on={String(state.settings.enabled)}
                onClick={() => void toggle()}>
                <i />
              </button>
            </div>
            <div className="row">
              <div>
                <span>Look</span>
                <strong>{presetLabel(state.settings.presetId)}</strong>
              </div>
            </div>
          </section>
          <button className="primary" type="button" onClick={() => void openControls()}>
            Open controls
          </button>
          <p className="note">Sliders stay on the video, including while it is fullscreen.</p>
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
