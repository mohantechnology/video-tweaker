import { DOWNLOAD_MESSAGE, downloadFilename, fileUrl, SAVE_BYTES_MESSAGE } from "~lib/media-file"
import {
  AD_BLOCK_CANCELLED,
  AD_BLOCK_CHECK,
  AD_BLOCK_DISMISS,
  AD_BLOCK_GRANTED,
  AD_BLOCK_ORIGINS,
  AD_BLOCK_PENDING,
  AD_BLOCK_READY,
  blockInputsChanged,
  clearSkipAdsBlock,
  initiatorDomain,
  persistSkipAdsBlock,
  syncAdBlockRules
} from "~lib/ad-block"

type GrantTarget = {
  host: string
  tabId?: number
  frameId?: number
}

let grantWindowId: number | null = null
let grantHost = ""
let grantTarget: GrantTarget | null = null
let grantSettled = false

void syncAdBlockRules()
void allowPlaybackReferrer()

chrome.runtime.onInstalled.addListener(() => {
  void syncAdBlockRules()
  void allowPlaybackReferrer()
})

chrome.runtime.onStartup.addListener(() => {
  void syncAdBlockRules()
  void allowPlaybackReferrer()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !blockInputsChanged(changes)) return
  void syncAdBlockRules()
})

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId !== grantWindowId) return
  const host = grantHost
  const target = grantTarget
  const settled = grantSettled
  grantWindowId = null
  grantHost = ""
  grantTarget = null
  grantSettled = false
  if (settled || !host) return
  void revertBlock(host, target)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return
  const type = (message as { type?: string }).type
  const host = initiatorDomain(String((message as { host?: string }).host ?? "")) ?? ""
  if (type === AD_BLOCK_PENDING) {
    sendResponse({ host: grantHost })
    return
  }
  if (type === AD_BLOCK_CHECK) {
    void handleCheck(host, sender).then(sendResponse)
    return true
  }
  if (type === AD_BLOCK_GRANTED) {
    void handleGranted(host).then(sendResponse)
    return true
  }
  if (type === AD_BLOCK_CANCELLED) {
    void handleCancelled(host).then(sendResponse)
    return true
  }
  if (type === AD_BLOCK_DISMISS) {
    void handleDismiss(host).then(sendResponse)
    return true
  }
  if (type === DOWNLOAD_MESSAGE) {
    const url = fileUrl(String((message as { url?: string }).url ?? ""))
    const title = String((message as { title?: string }).title ?? "")
    if (!url) {
      sendResponse({ ok: false })
      return
    }
    void allowPlaybackReferrer()
      .then(() => downloadRemote(url, downloadFilename(title, url)))
      .then((ok) => sendResponse({ ok }))
    return true
  }
  if (type === SAVE_BYTES_MESSAGE) {
    const filename = String((message as { filename?: string }).filename ?? "")
    const data = (message as { data?: unknown }).data
    if (typeof data !== "string" || data.length < 12 || data.length > 680_000_000 || !filename) {
      sendResponse({ ok: false })
      return
    }
    chrome.downloads.download(
      { url: `data:video/mp4;base64,${data}`, filename, conflictAction: "uniquify" },
      (id) => {
        sendResponse({ ok: !chrome.runtime.lastError && typeof id === "number" })
      }
    )
    return true
  }
  return
})

const PLAYBACK_REFERRER_RULE = 9001

async function allowPlaybackReferrer(): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [PLAYBACK_REFERRER_RULE],
      addRules: [
        {
          id: PLAYBACK_REFERRER_RULE,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: "referer",
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: "https://www.youtube.com/"
              }
            ]
          },
          condition: {
            urlFilter: "||googlevideo.com/videoplayback",
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.OTHER,
              chrome.declarativeNetRequest.ResourceType.MEDIA,
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST
            ]
          }
        }
      ]
    })
  } catch {
    /* A download can still be fetched by the page. */
  }
}

function downloadRemote(url: string, filename: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.downloads.download({ url, filename, conflictAction: "uniquify" }, (id) => {
      if (chrome.runtime.lastError || typeof id !== "number") {
        resolve(false)
        return
      }
      const done = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id !== id || !delta.state?.current) return
        if (delta.state.current !== "complete" && delta.state.current !== "interrupted") return
        chrome.downloads.onChanged.removeListener(done)
        resolve(delta.state.current === "complete")
      }
      chrome.downloads.onChanged.addListener(done)
    })
  })
}

async function handleCheck(
  host: string,
  sender: chrome.runtime.MessageSender
): Promise<{ ok: boolean; pending?: boolean }> {
  if (!host) return { ok: false }
  let granted = false
  try {
    granted = await chrome.permissions.contains({ origins: [...AD_BLOCK_ORIGINS] })
  } catch {
    granted = false
  }
  if (granted) {
    await syncAdBlockRules()
    return { ok: true }
  }
  grantTarget = { host, tabId: sender.tab?.id, frameId: sender.frameId }
  try {
    await openGrantWindow(host)
  } catch {
    return { ok: false }
  }
  return { ok: false, pending: true }
}

async function handleGranted(host: string): Promise<{ ok: boolean }> {
  grantSettled = true
  const target = grantTarget?.host === host ? grantTarget : grantTarget
  await persistSkipAdsBlock(host || grantHost)
  if (target?.tabId != null) {
    try {
      await chrome.tabs.sendMessage(
        target.tabId,
        { type: AD_BLOCK_READY, host: host || grantHost },
        target.frameId == null ? undefined : { frameId: target.frameId }
      )
    } catch {
      /* The page already saved the switch, or it closed. */
    }
  }
  return { ok: true }
}

async function handleCancelled(host: string): Promise<{ ok: boolean }> {
  const target = grantTarget && (!host || grantTarget.host === host) ? grantTarget : { host: host || grantHost }
  grantSettled = true
  await revertBlock(host || grantHost, target)
  return { ok: true }
}

async function handleDismiss(host: string): Promise<{ ok: boolean }> {
  if (host && grantHost && grantHost !== host) return { ok: true }
  grantSettled = true
  const windowId = grantWindowId
  grantWindowId = null
  grantHost = ""
  grantTarget = null
  if (windowId != null) {
    try {
      await chrome.windows.remove(windowId)
    } catch {
      /* The prompt is already gone. */
    }
  }
  return { ok: true }
}

async function revertBlock(host: string, target: GrantTarget | null): Promise<void> {
  const delivered = await notify(target, AD_BLOCK_CANCELLED, host)
  if (!delivered) await clearSkipAdsBlock(host)
}

async function notify(target: GrantTarget | null, type: string, host: string): Promise<boolean> {
  if (!target?.tabId) return false
  try {
    const response = await chrome.tabs.sendMessage(
      target.tabId,
      { type, host },
      target.frameId == null ? undefined : { frameId: target.frameId }
    )
    return response?.ok === true
  } catch {
    return false
  }
}

async function openGrantWindow(host: string): Promise<void> {
  grantSettled = false
  if (grantWindowId != null && grantHost === host) {
    try {
      await chrome.windows.update(grantWindowId, { focused: true })
      return
    } catch {
      grantWindowId = null
    }
  }
  if (grantWindowId != null) {
    const previousId = grantWindowId
    const previousHost = grantHost
    const previousTarget = grantTarget
    grantWindowId = null
    grantHost = ""
    grantTarget = null
    grantSettled = true
    try {
      await chrome.windows.remove(previousId)
    } catch {
      /* The previous prompt is already gone. */
    }
    grantSettled = false
    if (previousHost && previousHost !== host) await revertBlock(previousHost, previousTarget)
  }
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL(`tabs/ad-block-permission.html?host=${encodeURIComponent(host)}`),
    type: "popup",
    width: 420,
    height: 340,
    focused: true
  })
  grantWindowId = created.id ?? null
  grantHost = host
}
