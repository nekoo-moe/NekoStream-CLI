import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(__dirname, '.data')
const HISTORY_FILE = path.join(DATA_DIR, 'history.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
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
}

const DEFAULT_SETTINGS: Settings = {
  defaultProvider: 'animevietsub',
  defaultQuality: '1080p',
  autoPlayNext: false
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
