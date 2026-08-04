import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import { isProviderId, type ProviderId } from './provider-types'
// Registry only — it is pure and imports nothing from here, so this direction is
// safe. The resolver (which does read settings) must not be imported from this
// file or the cycle comes back.
import { seedBaseUrl } from './scrapers/domain-registry'

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
  provider: ProviderId
  animeId: string
  animeTitle: string
  episodeId: string
  episodeTitle: string
  timestamp: number
}

export interface Settings {
  defaultProvider: ProviderId
  defaultQuality: string
  autoPlayNext: boolean
  debugMode?: boolean
  developerMode?: boolean
  /**
   * Manual domain overrides — written by the user in Settings and by nothing
   * else. The domain prober keeps its findings in `domain-cache.json` precisely
   * so that it cannot overwrite a choice made here; an entry in this map wins
   * over any probe result. See scrapers/domain-resolver.ts.
   */
  providerDomains?: Partial<Record<ProviderId, string>>
  discordRpcEnabled?: boolean
}

const DEFAULT_SETTINGS: Settings = {
  defaultProvider: 'animevietsub',
  defaultQuality: '1080p',
  autoPlayNext: false,
  debugMode: false,
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

/**
 * Fallback domains used when nothing has been probed yet.
 *
 * The two probed providers derive theirs from the domain registry so there is
 * exactly one place that names a domain — this file and the provider classes
 * used to disagree with each other (animehay.ink here vs animehay01.site in the
 * provider). AnimeHay is not probed, so its value stays literal.
 *
 * Resolution itself lives in scrapers/domain-resolver.ts; this is only the
 * starting point. Nothing in this file writes providerDomains.
 */
export const PROVIDER_DEFAULT_DOMAINS: Record<ProviderId, string> = {
  animevietsub: seedBaseUrl('animevietsub'),
  anime47: seedBaseUrl('anime47'),
  animehay: 'https://animehay.ink'
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
  provider: ProviderId
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

type AuthSessionsMap = Partial<Record<ProviderId, AuthSession>>

/**
 * Derive a stable 32-byte encryption key from machine identity.
 *
 * This is obfuscation-at-rest, not a secret: anyone who can run code as this
 * user can re-derive the key. Its only job is to stop session cookies from
 * being readable by a casual file browse, a backup tool or a support log.
 * Anything stronger needs an OS keychain, which is tracked as future work.
 */
function deriveEncryptionKey(): Buffer {
  const seed = `nekostream-cli:${os.hostname()}:${os.userInfo().username}:auth-v1`
  return crypto.createHash('sha256').update(seed).digest()
}

/**
 * AES-256-GCM: the authentication tag makes tampering detectable. The previous
 * format was AES-256-CBC with no tag, so a modified ciphertext decrypted into
 * attacker-influenced plaintext that then went straight into JSON.parse and out
 * as cookies. Payloads are prefixed so old records stay readable (see decrypt).
 */
const GCM_PREFIX = 'gcm1:'

function encryptPayload(raw: string): string {
  // Deliberately unguarded: a crypto failure must surface, not silently
  // downgrade the payload to plaintext.
  const key = deriveEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return (
    GCM_PREFIX +
    iv.toString('hex') +
    ':' +
    tag.toString('hex') +
    ':' +
    encrypted.toString('base64')
  )
}

function decryptPayload(encoded: string): string | null {
  const key = deriveEncryptionKey()

  if (encoded.startsWith(GCM_PREFIX)) {
    try {
      const [ivHex, tagHex, encryptedB64] = encoded.slice(GCM_PREFIX.length).split(':')
      if (!ivHex || !tagHex || !encryptedB64) return null
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(encryptedB64, 'base64')),
        decipher.final()
      ])
      return plaintext.toString('utf8')
    } catch {
      // final() throws when the tag does not verify — treat as no session
      // rather than trusting the bytes.
      return null
    }
  }

  // Legacy AES-256-CBC records written before the GCM migration. Read-only:
  // they are re-encrypted as GCM the next time the session is saved. The old
  // `plain:` base64 escape hatch is intentionally *not* accepted — honouring it
  // let anyone downgrade a session file to unauthenticated plaintext.
  try {
    const [ivHex, encryptedB64] = encoded.split(':')
    if (!ivHex || !encryptedB64) return null
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, 'base64')),
      decipher.final()
    ]).toString('utf8')
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
        if (!isProviderId(provider)) continue
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
  // 0600: the file holds live session cookies, so other local users have no
  // business reading it. Ignored by Windows ACLs, honoured everywhere else.
  fs.writeFileSync(AUTH_SESSIONS_FILE, JSON.stringify(encoded, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
  try {
    fs.chmodSync(AUTH_SESSIONS_FILE, 0o600)
  } catch {
    // Pre-existing file on a filesystem without POSIX modes; nothing to do.
  }
}

export function loadAuthSession(provider: ProviderId): AuthSession | null {
  const sessions = loadAuthSessionsRaw()
  return sessions[provider] ?? null
}

export function saveAuthSession(provider: ProviderId, session: AuthSession): void {
  const sessions = loadAuthSessionsRaw()
  sessions[provider] = { ...session, provider }
  saveAuthSessionsRaw(sessions)
}

export function clearAuthSession(provider: ProviderId): void {
  const sessions = loadAuthSessionsRaw()
  delete sessions[provider]
  saveAuthSessionsRaw(sessions)
}

/**
 * Build Cookie header string from stored session.
 * Filters out expired cookies.
 */
export function getProviderCookieHeader(provider: ProviderId): string | null {
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
export function getProviderToken(provider: ProviderId): string | null {
  const session = loadAuthSession(provider)
  return session?.accessToken ?? null
}
