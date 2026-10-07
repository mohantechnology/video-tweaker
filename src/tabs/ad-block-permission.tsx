import { useEffect, useState } from "react"

import {
  AD_BLOCK_CANCELLED,
  AD_BLOCK_GRANTED,
  AD_BLOCK_ORIGINS,
  AD_BLOCK_PENDING,
  initiatorDomain
} from "~lib/ad-block"

export default function AdBlockPermission() {
  const param = initiatorDomain(new URLSearchParams(location.search).get("host") ?? "") ?? ""
  const [host, setHost] = useState(param)
  const [error, setError] = useState("")

  useEffect(() => {
    document.title = "Block ad requests"
  }, [])

  useEffect(() => {
    if (param) return
    void chrome.runtime.sendMessage({ type: AD_BLOCK_PENDING }).then((response: { host?: string } | undefined) => {
      const next = initiatorDomain(response?.host ?? "")
      if (next) setHost(next)
    })
  }, [param])

  const allow = () => {
    const pending = chrome.permissions.request({ origins: [...AD_BLOCK_ORIGINS] })
    setError("")
    void pending
      .then(async (granted) => {
        if (!granted) {
          await chrome.runtime.sendMessage({ type: AD_BLOCK_CANCELLED, host })
          window.close()
          return
        }
        await chrome.runtime.sendMessage({ type: AD_BLOCK_GRANTED, host })
        window.close()
      })
      .catch(() => {
        setError("The browser did not show the permission prompt. Close this window and try the switch again.")
      })
  }

  const cancel = () => {
    void chrome.runtime.sendMessage({ type: AD_BLOCK_CANCELLED, host }).finally(() => window.close())
  }

  return (
    <main>
      <style>{css}</style>
      <h1>Block ad requests</h1>
      <p>
        {host
          ? `Allow Video Effects to block known ad addresses while you watch ${host}.`
          : "Allow Video Effects to block known ad addresses on this site."}
      </p>
      <p>
        Chrome will ask for access to ad servers and to YouTube, Hotstar, and JioHotstar. Only
        known ad addresses are blocked. The video stream is left alone.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <div className="actions">
        <button type="button" className="allow" onClick={allow} disabled={!host}>
          Allow
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </main>
  )
}

const css = `
  :root { color-scheme: dark; }
  body {
    margin: 0;
    background: #16141f;
    color: #f6f3ff;
    font: 14px/1.45 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  }
  main { padding: 22px 22px 18px; }
  h1 { margin: 0 0 10px; font-size: 18px; }
  p { margin: 0 0 10px; color: rgba(246, 243, 255, 0.78); }
  .error { color: #ffb4b4; }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button {
    border: 0;
    border-radius: 10px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    cursor: pointer;
  }
  button.allow { background: #5d46e8; color: white; }
  button:disabled { opacity: 0.45; cursor: default; }
`
