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
  { label: 'NekoStreamCLI', url: 'https://www.npmjs.com/package/nekostream-cli' },
  { label: 'Tham gia Discord', url: 'https://discord.gg/Y2kq2y26pZ' }
]

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
    setBrowsingPresence(currentDetails, currentProvider, currentFeature)
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

export function setBrowsingPresence(details?: string, provider?: string, feature?: string) {
  isWatching = false
  currentDetails = details
  currentProvider = provider
  currentFeature = feature
  currentAnime = undefined
  currentEpisode = undefined
  
  if (!startTimestamp) startTimestamp = new Date()
  
  const stateStr = provider ? `${provider.toUpperCase()}${feature ? ` | ${feature}` : ''}` : (feature || 'NekoStream CLI')

  safeSetActivity({
    details: details || 'Đang lướt Menu Chính',
    state: stateStr,
    startTimestamp,
    largeImageKey: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/15.1.0/72x72/1f4fa.png',
    largeImageText: 'NekoStream',
    instance: false,
    buttons: COMMON_BUTTONS
  })
}

export function setWatchingPresence(animeTitle: string, episodeName: string, provider: string) {
  isWatching = true
  currentAnime = animeTitle
  currentEpisode = episodeName
  currentProvider = provider
  
  startTimestamp = new Date() // Reset timer for playback
  safeSetActivity({
    details: `Đang xem: ${animeTitle}`,
    state: `${provider.toUpperCase()} | ${episodeName}`,
    startTimestamp,
    largeImageKey: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/15.1.0/72x72/1f4fa.png',
    largeImageText: 'NekoStream',
    smallImageKey: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/15.1.0/72x72/25b6.png',
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
