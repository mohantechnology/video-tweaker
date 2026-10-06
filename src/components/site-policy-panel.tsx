import { useRef, useState } from "react"

import {
  hostMatches,
  normalizeHost,
  policySummary,
  siteAllowed,
  siteListed,
  type SitePolicy
} from "~lib/sites"

export function SitePolicyPanel({
  hostname,
  policy,
  onChange
}: {
  hostname: string
  policy: SitePolicy
  onChange: (policy: SitePolicy) => void
}) {
  const pageHost = normalizeHost(hostname) ?? ""
  const listed = pageHost ? siteListed(pageHost, policy.sites) : false
  const allowed = pageHost ? siteAllowed(pageHost, policy) : true
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState("")
  const [error, setError] = useState("")
  const ignoreBlur = useRef(false)

  const forgetDraft = (site: string) => {
    setDrafts((current) => {
      if (current[site] === undefined) return current
      const next = { ...current }
      delete next[site]
      return next
    })
  }

  const toggleCurrent = () => {
    if (!pageHost) return
    setError("")
    if (listed) {
      onChange({
        ...policy,
        sites: policy.sites.filter((site) => !hostMatches(pageHost, site))
      })
      return
    }
    if (policy.sites.includes(pageHost)) return
    onChange({ ...policy, sites: [...policy.sites, pageHost] })
  }

  const commitSite = (site: string, raw: string) => {
    if (!raw.trim()) {
      setError("")
      forgetDraft(site)
      onChange({ ...policy, sites: policy.sites.filter((item) => item !== site) })
      return
    }
    const host = normalizeHost(raw)
    if (!host) {
      setError("Use a site like netflix.com")
      forgetDraft(site)
      return
    }
    if (host !== site && policy.sites.includes(host)) {
      setError("Already in the list")
      forgetDraft(site)
      return
    }
    setError("")
    forgetDraft(site)
    if (host === site) return
    onChange({
      ...policy,
      sites: policy.sites.map((item) => (item === site ? host : item))
    })
  }

  const commitAdd = (raw: string) => {
    if (!raw.trim()) {
      setError("")
      setAdding("")
      return
    }
    const host = normalizeHost(raw)
    if (!host) {
      setAdding(raw)
      setError("Use a site like netflix.com")
      return
    }
    setError("")
    setAdding("")
    if (policy.sites.includes(host)) return
    onChange({ ...policy, sites: [...policy.sites, host] })
  }

  return (
    <div className="vee-sites">
      {pageHost ? (
        <div className="vee-sites-current">
          <button
            type="button"
            className="vee-sites-chip"
            aria-pressed={allowed}
            title={allowed ? "Turn effects off for this site" : "Turn effects on for this site"}
            onClick={toggleCurrent}>
            <span aria-hidden="true">{allowed ? "×" : "+"}</span>
            {pageHost}
          </button>
          <p className="vee-sites-status">{allowed ? "Effects on" : "Effects off"}</p>
        </div>
      ) : null}

      <div className="vee-sites-modes" role="radiogroup" aria-label="Where effects run">
        <button
          type="button"
          role="radio"
          aria-checked={policy.mode === "only"}
          data-on={String(policy.mode === "only")}
          title="Effects run on the sites in this list, and nowhere else."
          onClick={() => {
            if (policy.mode === "only") return
            onChange({ ...policy, mode: "only" })
          }}>
          Only listed
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={policy.mode === "except"}
          data-on={String(policy.mode === "except")}
          title="Effects run on every site, except the ones in this list."
          onClick={() => {
            if (policy.mode === "except") return
            onChange({ ...policy, mode: "except" })
          }}>
          All except listed
        </button>
      </div>

      <div className="vee-sites-box">
        {policy.sites.map((site) => (
          <input
            key={site}
            className="vee-sites-line"
            value={drafts[site] ?? site}
            aria-label={site}
            spellCheck={false}
            onChange={(event) => {
              const value = event.target.value
              setDrafts((current) => ({ ...current, [site]: value }))
              if (error) setError("")
            }}
            onBlur={(event) => {
              if (ignoreBlur.current) {
                ignoreBlur.current = false
                return
              }
              commitSite(site, event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === "Escape") {
                ignoreBlur.current = true
                forgetDraft(site)
                setError("")
                event.currentTarget.blur()
              }
            }}
          />
        ))}
        <input
          className="vee-sites-line"
          value={adding}
          placeholder="Add a site"
          aria-label="Add a site"
          spellCheck={false}
          onChange={(event) => {
            setAdding(event.target.value)
            if (error) setError("")
          }}
          onBlur={(event) => {
            if (ignoreBlur.current) {
              ignoreBlur.current = false
              return
            }
            commitAdd(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (event.key === "Escape") {
              ignoreBlur.current = true
              setAdding("")
              setError("")
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      {error ? <p className="vee-sites-error">{error}</p> : null}
      <p className="vee-sites-summary">{policySummary(policy)}</p>
    </div>
  )
}
