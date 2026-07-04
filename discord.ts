import RPC from 'discord-rpc'
import { loadSettings } from './storage'

const CLIENT_ID = '1490936797541437440' // NekoStream Discord App

let rpcClient: RPC.Client | null = null
let startTimestamp: Date | null = null
let currentDetails: string | undefined
let currentProvider: string | undefined
let currentFeature: string | undefined
let currentAnime: string | undefined
let currentEpisode: string | undefined
let isWatching = false

const COMMON_BUTTONS = [
  { label: 'NekoStream', url: 'https://www.npmjs.com/package/nekostream' },
  { label: 'Tham gia Discord', url: 'https://discord.gg/Y2kq2y26pZ' }
]

const imageCache: Record<string, string> = {}

async function fetchAnimeImage(title: string): Promise<string | undefined> {
  const cleanTitle = title.replace(/(vietsub|thuyết minh|tập.*|phần.*)/gi, '').trim()
  if (imageCache[cleanTitle]) return imageCache[cleanTitle]
  
  try {
    const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(cleanTitle)}&limit=1`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const data = await res.json()
      if (data.data && data.data.length > 0) {
        const imageUrl = data.data[0].images?.jpg?.large_image_url || data.data[0].images?.jpg?.image_url
        if (imageUrl) {
          imageCache[cleanTitle] = imageUrl
          return imageUrl
        }
      }
    }
  } catch (e) {}
  
  return undefined
}

export async function initDiscord() {
  const settings = loadSettings()
  if (settings.discordRpcEnabled === false) return

  if (rpcClient) return // Already initialized

  try {
    RPC.register(CLIENT_ID)
    rpcClient = new RPC.Client({ transport: 'ipc' })
    
    rpcClient.on('ready', () => {
      // Restore presence if it was set before ready
      refreshPresence()
    })
    
    // Catch errors silently to avoid crashing CLI if Discord is closed
    rpcClient.login({ clientId: CLIENT_ID }).catch(() => {})
  } catch (e) {
    // Ignore RPC initialization errors
  }
}

function refreshPresence() {
  if (isWatching && currentAnime && currentEpisode && currentProvider) {
    setWatchingPresence(currentAnime, currentEpisode, currentProvider)
  } else {
    setBrowsingPresence(currentDetails, currentProvider, currentFeature, currentAnime)
  }
}

function safeSetActivity(activity: RPC.Presence) {
  if (!rpcClient) return
  const settings = loadSettings()
  if (settings.discordRpcEnabled === false) return
  
  try {
    rpcClient.setActivity(activity).catch(() => {})
  } catch (e) {}
}

export async function setBrowsingPresence(details?: string, provider?: string, feature?: string, animeTitle?: string) {
  isWatching = false
  currentDetails = details
  currentProvider = provider
  currentFeature = feature
  currentAnime = animeTitle
  currentEpisode = undefined
  
  if (!startTimestamp) startTimestamp = new Date()
  
  const stateStr = provider ? `${provider.toUpperCase()}${feature ? ` | ${feature}` : ''}` : (feature || 'NekoStream CLI')
  
  const largeImageKey = animeTitle ? await fetchAnimeImage(animeTitle) : undefined
  const largeImageText = animeTitle || 'NekoStream'

  safeSetActivity({
    details: details || 'Đang lướt Menu Chính',
    state: stateStr,
    startTimestamp,
    ...(largeImageKey ? { largeImageKey } : {}),
    largeImageText,
    instance: false,
    buttons: COMMON_BUTTONS
  })
}

export async function setWatchingPresence(animeTitle: string, episodeName: string, provider: string) {
  isWatching = true
  currentAnime = animeTitle
  currentEpisode = episodeName
  currentProvider = provider
  
  startTimestamp = new Date() // Reset timer for playback
  const largeImageKey = await fetchAnimeImage(animeTitle)
  
  safeSetActivity({
    details: `Đang xem: ${animeTitle}`,
    state: `${provider.toUpperCase()} | ${episodeName}`,
    startTimestamp,
    ...(largeImageKey ? { largeImageKey } : {}),
    largeImageText: animeTitle,
    smallImageText: 'Playing',
    instance: false,
    buttons: COMMON_BUTTONS
  })
}

export function clearDiscordPresence() {
  if (rpcClient) {
    try {
      rpcClient.clearActivity().catch(() => {})
      rpcClient.destroy().catch(() => {})
    } catch (e) {}
    rpcClient = null
  }
}

export function toggleDiscordPresence(enabled: boolean) {
  if (enabled) {
    initDiscord()
  } else {
    clearDiscordPresence()
  }
}
