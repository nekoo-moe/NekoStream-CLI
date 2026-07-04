export function isDeveloperLoggingEnabled(): boolean {
  if (process.env.NEKOSTREAM_DEBUG === '1') return true
  return process.env.NEKOSTREAM_PRESERVE_LOGS === '1'
}

export function debugLog(...args: unknown[]) {
  if (isDeveloperLoggingEnabled()) console.log(...args)
}

export function debugWarn(...args: unknown[]) {
  if (isDeveloperLoggingEnabled()) console.warn(...args)
}

export function debugError(...args: unknown[]) {
  if (isDeveloperLoggingEnabled()) console.error(...args)
}
