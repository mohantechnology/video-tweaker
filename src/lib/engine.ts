export const ENGINE_SOURCE = "vee-engine"

export type EngineSignal = {
  source: typeof ENGINE_SOURCE
  active: boolean
}

export function postEngineActive(active: boolean): void {
  window.postMessage({ source: ENGINE_SOURCE, active } satisfies EngineSignal, "*")
}

export function readEngineSignal(data: unknown): boolean | null {
  if (!data || typeof data !== "object") return null
  const message = data as Partial<EngineSignal>
  if (message.source !== ENGINE_SOURCE || typeof message.active !== "boolean") return null
  return message.active
}
