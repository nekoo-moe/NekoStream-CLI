import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'

const OLD_DATA_DIR = path.join(__dirname, '.data')
const DATA_DIR = path.join(os.homedir(), '.nekostream-cli')
const HISTORY_FILE = path.join(DATA_DIR, 'history.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const AUTH_SESSIONS_FILE = path.join(DATA_DIR, 'auth-sessions.json')

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  // Migrate data from old directory if it exists
  if (fs.existsSync(OLD_DATA_DIR)) {
    try {
      fs.cpSync(OLD_DATA_DIR, DATA_DIR, { recursive: true })
    } catch (e) {}
  }
}

export interface HistoryEntry {
  provider: string
  animeId: string
  animeTitle: string
  episodeId: string
  episodeTitle: string
  timestamp: number
}

export interface Settings {
  defaultProvider: string
  defaultQuality: string
  autoPlayNext: boolean
  developerMode?: boolean
  providerDomains?: Record<string, string>
  discordRpcEnabled?: boolean
}

const DEFAULT_SETTINGS: Settings = {
  defaultProvider: 'animevietsub',
  defaultQuality: '1080p',
  autoPlayNext: false,
  developerMode: false,
  providerDomains: {},
  discordRpcEnabled: true
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function loadSettings(): Settings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8')
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
    }
  } catch (e) {
    console.warn('Failed to load settings', e)
  }
  return DEFAULT_SETTINGS
}

export function saveSettings(settings: Partial<Settings>) {
  const current = loadSettings()
  const updated = { ...current, ...settings }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8')
}

const PROVIDER_DEFAULT_DOMAINS: Record<string, string> = {
  animevietsub: 'https://animevietsub.site',
  anime47: 'https://anime47.best',
  animehay: 'https://animehay.ink'
}

/**
 * Returns the base URL for a provider, respecting custom domain settings.
 * Mirrors the domain injection logic in providers.ts getProvider().
 */
export function getProviderBaseUrl(providerName: string): string {
  const settings = loadSettings()
  const custom = settings.providerDomains?.[providerName]
  if (custom && custom.trim()) {
    const d = custom.trim()
    return (d.startsWith('http') ? d : 'https://' + d).replace(/\/$/, '')
  }
  return PROVIDER_DEFAULT_DOMAINS[providerName] ?? `https://${providerName}.com`
}

// ── History ──────────────────────────────────────────────────────────────────

export function loadHistory(): HistoryEntry[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (e) {
    console.warn('Failed to load history', e)
  }
  return []
}

export function saveHistoryEntry(entry: Omit<HistoryEntry, 'timestamp'>) {
  const history = loadHistory()
  const newEntry: HistoryEntry = { ...entry, timestamp: Date.now() }
  
  // Remove duplicate entry for the same anime
  const filtered = history.filter(h => h.animeId !== entry.animeId || h.provider !== entry.provider)
  
  filtered.unshift(newEntry) // Add to top
  
  // Keep last 100 entries
  if (filtered.length > 100) filtered.pop()
  
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(filtered, null, 2), 'utf-8')
}

export function clearHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    fs.unlinkSync(HISTORY_FILE)
  }
}

// ── Auth Sessions ─────────────────────────────────────────────────────────────

export interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  expirationDate?: number
}

export interface AuthSession {
  provider: string
  cookies: StoredCookie[]
  capturedAt: string
  source: 'interactive-login' | 'manual'
  authConfirmed?: boolean
  userDisplayName?: string
  userAvatarUrl?: string
  // Anime47-specific
  userId?: string | number
  accessToken?: string
  /** Full localStorage snapshot from the browser at login time (for SPA auth restore) */
  localStorageState?: Record<string, string>
}

type AuthSessionsMap = Record<string, AuthSession>

/**
 * Derive a stable 32-byte encryption key from machine identity.
 * Not cryptographically robust against local admin access,
 * but sufficient to prevent casual reading of the JSON file.
 */
function deriveEncryptionKey(): Buffer {
  const seed = `nekostream-cli:${os.hostname()}:${os.userInfo().username}:auth-v1`
  return crypto.createHash('sha256').update(seed).digest()
}

function encryptPayload(raw: string): string {
  try {
    const key = deriveEncryptionKey()
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
    return iv.toString('hex') + ':' + encrypted.toString('base64')
  } catch {
    // Fallback: plain base64 if crypto fails
    return 'plain:' + Buffer.from(raw, 'utf8').toString('base64')
  }
}

function decryptPayload(encoded: string): string | null {
  try {
    if (encoded.startsWith('plain:')) {
      return Buffer.from(encoded.slice(6), 'base64').toString('utf8')
    }
    const [ivHex, encryptedB64] = encoded.split(':')
    if (!ivHex || !encryptedB64) return null
    const key = deriveEncryptionKey()
    const iv = Buffer.from(ivHex, 'hex')
    const encrypted = Buffer.from(encryptedB64, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

function loadAuthSessionsRaw(): AuthSessionsMap {
  try {
    if (fs.existsSync(AUTH_SESSIONS_FILE)) {
      const raw = fs.readFileSync(AUTH_SESSIONS_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, string>
      const result: AuthSessionsMap = {}
      for (const [provider, encoded] of Object.entries(parsed)) {
        const decrypted = decryptPayload(encoded)
        if (!decrypted) continue
        result[provider] = JSON.parse(decrypted) as AuthSession
      }
      return result
    }
  } catch (e) {
    console.warn('[Auth] Failed to load auth sessions:', e)
  }
  return {}
}

function saveAuthSessionsRaw(sessions: AuthSessionsMap): void {
  const encoded: Record<string, string> = {}
  for (const [provider, session] of Object.entries(sessions)) {
    encoded[provider] = encryptPayload(JSON.stringify(session))
  }
  fs.writeFileSync(AUTH_SESSIONS_FILE, JSON.stringify(encoded, null, 2), 'utf-8')
}

export function loadAuthSession(provider: string): AuthSession | null {
  const sessions = loadAuthSessionsRaw()
  return sessions[provider] ?? null
}

export function saveAuthSession(provider: string, session: AuthSession): void {
  const sessions = loadAuthSessionsRaw()
  sessions[provider] = { ...session, provider }
  saveAuthSessionsRaw(sessions)
}

export function clearAuthSession(provider: string): void {
  const sessions = loadAuthSessionsRaw()
  delete sessions[provider]
  saveAuthSessionsRaw(sessions)
}

/**
 * Build Cookie header string from stored session.
 * Filters out expired cookies.
 */
export function getProviderCookieHeader(provider: string): string | null {
  const session = loadAuthSession(provider)
  if (!session) return null

  const nowEpoch = Date.now() / 1000
  const validCookies = session.cookies.filter(cookie => {
    if (!cookie.expirationDate) return true
    return cookie.expirationDate > nowEpoch
  })

  if (validCookies.length === 0) return null
  return validCookies.map(c => `${c.name}=${c.value}`).join('; ')
}

/**
 * Returns stored JWT access token for providers that use Bearer auth (e.g. Anime47).
 */
export function getProviderToken(provider: string): string | null {
  const session = loadAuthSession(provider)
  return session?.accessToken ?? null
}
