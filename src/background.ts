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

chrome.runtime.onInstalled.addListener(() => {
  void syncAdBlockRules()
})

chrome.runtime.onStartup.addListener(() => {
  void syncAdBlockRules()
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
  return
})

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
