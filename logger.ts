import { loadSettings } from './storage'

export function isDebugModeEnabled(): boolean {
  if (process.env.NEKOSTREAM_DEBUG === '1') return true
  if (process.env.NEKOSTREAM_PRESERVE_LOGS === '1') return true

  try {
    const settings = loadSettings()
    return Boolean(settings.debugMode || settings.developerMode)
  } catch {
    return false
  }
}

export function isDeveloperLoggingEnabled(): boolean {
  return isDebugModeEnabled()
}

export function debugLog(...args: unknown[]) {
  if (isDebugModeEnabled()) console.log('[debug]', ...args)
}

export function debugWarn(...args: unknown[]) {
  if (isDebugModeEnabled()) console.warn('[debug]', ...args)
}

export function debugError(...args: unknown[]) {
  if (isDebugModeEnabled()) console.error('[debug]', ...args)
}

export function debugTrace(...args: unknown[]) {
  if (isDebugModeEnabled()) console.trace('[debug:trace]', ...args)
}
