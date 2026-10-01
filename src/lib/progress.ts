import type { EffectSettings } from "./types"

const PROGRESS_KEY = "veeProgress"
const MAX_ENTRIES = 240
const SAVE_EVERY_MS = 3000
const MIN_TIME = 3
const END_MARGIN = 12

type ProgressEntry = {
  time: number
  duration: number
  updated: number
}

type ProgressMap = Record<string, ProgressEntry>

let cache: ProgressMap | null = null
let chain: Promise<void> = Promise.resolve()

function remember(task: () => Promise<void>): void {
  const run = chain.then(task, task)
  chain = run.then(
    () => undefined,
    () => undefined
  )
}

async function readMap(): Promise<ProgressMap> {
  if (cache) return cache
  const bag = await chrome.storage.local.get(PROGRESS_KEY)
  cache = { ...((bag[PROGRESS_KEY] as ProgressMap | undefined) ?? {}) }
  return cache
}

function pageIdentity(): string {
  const url = new URL(location.href)
  const host = url.hostname.replace(/^www\./, "")
  const youtube =
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0]
    if (id) return `youtube:${id}`
  }

  if (youtube) {
    const watch = url.searchParams.get("v")
    if (watch) return `youtube:${watch}`
    const parts = url.pathname.split("/").filter(Boolean)
    const marker = parts.findIndex(
      (part) => part === "shorts" || part === "embed" || part === "live" || part === "v"
    )
    if (marker >= 0 && parts[marker + 1]) return `youtube:${parts[marker + 1]}`
  }

  const tracking = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "si",
    "feature",
    "ref",
    "ref_src"
  ])
  for (const key of [...url.searchParams.keys()]) {
    if (tracking.has(key)) url.searchParams.delete(key)
  }
  url.searchParams.sort()
  return `${host}${url.pathname}${url.search}`
}

export function progressStorageKey(video: HTMLVideoElement): string {
  const page = pageIdentity()
  if (page.startsWith("youtube:")) return page

  const src = video.currentSrc || video.src || ""
  if (!src || src.startsWith("blob:") || src.startsWith("data:")) {
    const label = video.getAttribute("title") || video.getAttribute("aria-label") || ""
    return label ? `${page}|${label.slice(0, 80)}` : page
  }

  try {
    const media = new URL(src)
    return `${page}|${media.hostname}${media.pathname}`
  } catch {
    return page
  }
}

function isLikelyAd(video: HTMLVideoElement): boolean {
  const player = video.closest(".html5-video-player")
  if (player?.classList.contains("ad-showing") || player?.classList.contains("ad-interrupting")) {
    return true
  }
  return Boolean(video.closest(".ad-showing, .ytp-ad-player-overlay"))
}

function loadEntry(key: string): Promise<ProgressEntry | null> {
  return new Promise((resolve) => {
    remember(async () => {
      try {
        const map = await readMap()
        resolve(map[key] ?? null)
      } catch {
        resolve(null)
      }
    })
  })
}

function saveEntry(key: string, time: number, duration: number): void {
  remember(async () => {
    const map = { ...(await readMap()) }
    map[key] = {
      time: Math.round(time * 10) / 10,
      duration: Number.isFinite(duration) ? duration : 0,
      updated: Date.now()
    }
    const keys = Object.keys(map)
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => map[a].updated - map[b].updated)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((stale) => {
          delete map[stale]
        })
    }
    cache = map
    await chrome.storage.local.set({ [PROGRESS_KEY]: map })
  })
}

function clearEntry(key: string): void {
  remember(async () => {
    const map = { ...(await readMap()) }
    if (!map[key]) return
    delete map[key]
    cache = map
    await chrome.storage.local.set({ [PROGRESS_KEY]: map })
  })
}

function startRestore(video: HTMLVideoElement, time: number, onDone: () => void): () => void {
  let tries = 0
  let waits = 0
  let stopped = false
  let guardUntil = 0
  let timer = 0

  const stop = () => {
    if (stopped) return
    stopped = true
    window.clearInterval(timer)
    onDone()
  }

  const apply = () => {
    if (stopped || isLikelyAd(video)) return
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    if (time < MIN_TIME || time > duration - 0.4 || duration - time < END_MARGIN) {
      stop()
      return
    }
    if (Math.abs(video.currentTime - time) <= 1.25) {
      if (tries >= 2) stop()
      return
    }
    if (video.currentTime >= 1.5 && tries >= 4) {
      stop()
      return
    }
    guardUntil = performance.now() + 900
    try {
      video.currentTime = Math.min(time, Math.max(0, duration - 0.35))
    } catch {
      stop()
    }
  }

  timer = window.setInterval(() => {
    if (stopped) return
    const durationReady = Number.isFinite(video.duration) && video.duration > 0
    if (!durationReady) {
      waits += 1
      if (waits > 30) stop()
      return
    }
    if (performance.now() < guardUntil) return
    tries += 1
    if (tries > 8) {
      stop()
      return
    }
    apply()
  }, 300)

  if (video.readyState >= 1) apply()
  return stop
}

export function createProgressTracker(getSettings: () => EffectSettings): {
  follow: (video: HTMLVideoElement | null) => void
  stop: () => void
} {
  let video: HTMLVideoElement | null = null
  let key = ""
  let appliedKey = ""
  let pendingKey = ""
  let holdSaves = false
  let lastSaved = Number.NaN
  let knownDuration = 0
  let mismatches = 0
  let retryAfter = 0
  let ticketId = 0
  let stopped = false
  let cancelRestore: (() => void) | null = null
  let unbind: (() => void) | null = null

  const clearRestore = () => {
    ticketId += 1
    const cancel = cancelRestore
    cancelRestore = null
    cancel?.()
    holdSaves = false
    pendingKey = ""
  }

  const persist = (force = false) => {
    if (stopped || !video || !key) return
    if (!getSettings().rememberProgress || holdSaves || isLikelyAd(video)) return
    const time = video.currentTime
    const duration = video.duration
    if (!Number.isFinite(time) || time < MIN_TIME || duration === Infinity) return
    if (
      knownDuration >= 90 &&
      Number.isFinite(duration) &&
      duration > 0 &&
      duration < knownDuration * 0.6
    ) {
      return
    }
    if (Number.isFinite(duration) && duration > 0 && duration - time < END_MARGIN) {
      if (duration >= 30 && (knownDuration === 0 || duration >= knownDuration * 0.75)) {
        lastSaved = Number.NaN
        clearEntry(key)
      }
      return
    }
    const slack = force ? 0.2 : 0.75
    if (Number.isFinite(lastSaved) && Math.abs(time - lastSaved) < slack) return
    lastSaved = time
    if (Number.isFinite(duration) && duration >= 30) knownDuration = duration
    saveEntry(key, time, duration)
  }

  const bind = (next: HTMLVideoElement, nextKey: string) => {
    unbind?.()
    key = nextKey
    knownDuration = 0
    mismatches = 0
    lastSaved = Number.NaN
    const onQuiet = () => persist(true)
    const onHide = () => {
      if (document.visibilityState === "hidden") persist(true)
    }
    next.addEventListener("pause", onQuiet)
    next.addEventListener("seeked", onQuiet)
    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("pagehide", onQuiet)
    unbind = () => {
      next.removeEventListener("pause", onQuiet)
      next.removeEventListener("seeked", onQuiet)
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("pagehide", onQuiet)
    }
  }

  const maybeRestore = (next: HTMLVideoElement, nextKey: string) => {
    if (!getSettings().rememberProgress) {
      clearRestore()
      appliedKey = ""
      return
    }
    if (appliedKey === nextKey || pendingKey === nextKey) return
    if (Date.now() < retryAfter) return

    pendingKey = nextKey
    clearRestore()
    pendingKey = nextKey
    const ticket = ticketId
    holdSaves = true

    void loadEntry(nextKey).then((saved) => {
      if (stopped || ticket !== ticketId || video !== next || key !== nextKey) return
      if (!getSettings().rememberProgress || isLikelyAd(next)) {
        holdSaves = false
        pendingKey = ""
        return
      }
      if (!saved || saved.time < MIN_TIME) {
        appliedKey = nextKey
        pendingKey = ""
        holdSaves = false
        return
      }

      const duration = next.duration
      if (
        Number.isFinite(duration) &&
        duration >= 30 &&
        saved.time < duration &&
        duration - saved.time < END_MARGIN
      ) {
        clearEntry(nextKey)
        appliedKey = nextKey
        pendingKey = ""
        holdSaves = false
        return
      }
      if (Number.isFinite(duration) && duration > 1 && saved.time > duration - 0.4) {
        mismatches += 1
        pendingKey = ""
        holdSaves = false
        if (mismatches >= 6) {
          appliedKey = nextKey
          return
        }
        retryAfter = Date.now() + 800
        return
      }

      mismatches = 0
      knownDuration = saved.duration
      appliedKey = nextKey
      pendingKey = ""
      if (next.currentTime > 15 && Math.abs(next.currentTime - saved.time) > 8) {
        holdSaves = false
        return
      }
      cancelRestore = startRestore(next, saved.time, () => {
        if (ticket === ticketId) holdSaves = false
      })
    })
  }

  const timer = window.setInterval(() => persist(false), SAVE_EVERY_MS)

  return {
    follow(next) {
      if (stopped) return
      const nextKey = next ? progressStorageKey(next) : ""
      if (next !== video) {
        if (video && !isLikelyAd(video) && video.currentTime >= MIN_TIME) persist(true)
        clearRestore()
        unbind?.()
        unbind = null
        video = next
        key = ""
        appliedKey = ""
        if (next) bind(next, nextKey)
      } else if (next && nextKey !== key) {
        clearRestore()
        bind(next, nextKey)
        appliedKey = ""
      }

      if (!next) return
      const blocked = isLikelyAd(next) || !getSettings().rememberProgress
      if (blocked) {
        if (appliedKey || pendingKey || cancelRestore) {
          clearRestore()
          appliedKey = ""
        }
        return
      }
      maybeRestore(next, nextKey)
    },
    stop() {
      if (video && !isLikelyAd(video)) persist(true)
      stopped = true
      clearRestore()
      unbind?.()
      unbind = null
      window.clearInterval(timer)
      video = null
    }
  }
}
