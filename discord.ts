import RPC from 'discord-rpc'
import { enrichWithAniList } from './scrapers/anilist'
import { loadSettings } from './storage'

const CLIENT_ID = '1490936797541437440'
const DEFAULT_LARGE_IMAGE = process.env.NEKOSTREAM_RPC_IMAGE_KEY || 'nekostream'
const DEFAULT_SMALL_IMAGE = process.env.NEKOSTREAM_RPC_SMALL_IMAGE_KEY
const DISCORD_TEXT_LIMIT = 120

let rpcClient: RPC.Client | null = null
let startTimestamp: Date | null = null
let currentDetails: string | undefined
let currentProvider: string | undefined
let currentFeature: string | undefined
let currentAnime: string | undefined
let currentEpisode: string | undefined
let isWatching = false
let activityRevision = 0

const COMMON_BUTTONS = [
  { label: 'NekoStream', url: 'https://www.npmjs.com/package/nekostream' },
  { label: 'Discord', url: 'https://discord.gg/Y2kq2y26pZ' },
]

const imageCache = new Map<string, string | undefined>()

function cleanTitleForSearch(title: string): string {
  return title
    .replace(/\s+-\s*Tập\s*\d+.*$/iu, '')
    .replace(/\s+-\s*Episode\s*\d+.*$/iu, '')
    .replace(/\b(VietSub|Thuyết Minh|Lồng Tiếng|Full HD|HD)\b/giu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanPresenceText(text: string | undefined, fallback: string): string {
  const value = (text || fallback)
    .replace(/\s+/g, ' ')
    .trim()

  if (value.length <= DISCORD_TEXT_LIMIT) return value
  return `${value.slice(0, DISCORD_TEXT_LIMIT - 1).trimEnd()}…`
}

function formatProvider(provider?: string): string {
  return provider ? provider.toUpperCase() : 'NEKOSTREAM'
}

function buildBrowsingState(provider?: string, feature?: string, animeTitle?: string): string {
  if (animeTitle) return `${cleanPresenceText(animeTitle, 'Anime')} - ${formatProvider(provider)}`
  if (provider && feature) return `${formatProvider(provider)} - ${feature}`
  if (provider) return formatProvider(provider)
  return feature || 'CLI'
}

async function fetchJikanImage(title: string): Promise<string | undefined> {
  try {
    const response = await fetch(
      `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`,
      { signal: AbortSignal.timeout(3000) }
    )

    if (!response.ok) return undefined

    const data = await response.json() as {
      data?: Array<{
        images?: {
          webp?: { large_image_url?: string; image_url?: string }
          jpg?: { large_image_url?: string; image_url?: string }
        }
      }>
    }

    return data.data?.[0]?.images?.webp?.large_image_url ||
      data.data?.[0]?.images?.jpg?.large_image_url ||
      data.data?.[0]?.images?.webp?.image_url ||
      data.data?.[0]?.images?.jpg?.image_url
  } catch {
    return undefined
  }
}

async function fetchAnimeImage(title: string): Promise<string | undefined> {
  const cleanTitle = cleanTitleForSearch(title)
  if (!cleanTitle) return undefined
  if (imageCache.has(cleanTitle)) return imageCache.get(cleanTitle)

  const anilist = await enrichWithAniList(cleanTitle, 3500)
  const imageUrl = anilist.banner || anilist.cover || await fetchJikanImage(cleanTitle)

  imageCache.set(cleanTitle, imageUrl)
  return imageUrl
}

async function resolveLargeImage(animeTitle?: string): Promise<{ key: string; text: string }> {
  if (!animeTitle) {
    return { key: DEFAULT_LARGE_IMAGE, text: 'NekoStream' }
  }

  const cleanTitle = cleanTitleForSearch(animeTitle)
  const imageUrl = await fetchAnimeImage(cleanTitle)

  return {
    key: imageUrl || DEFAULT_LARGE_IMAGE,
    text: cleanPresenceText(cleanTitle, 'Anime'),
  }
}

function buildBaseActivity(largeImage: { key: string; text: string }): Pick<RPC.Presence, 'largeImageKey' | 'largeImageText' | 'smallImageKey' | 'smallImageText' | 'instance' | 'buttons'> {
  return {
    largeImageKey: largeImage.key,
    largeImageText: largeImage.text,
    ...(DEFAULT_SMALL_IMAGE ? { smallImageKey: DEFAULT_SMALL_IMAGE, smallImageText: 'NekoStream' } : {}),
    instance: false,
    buttons: COMMON_BUTTONS,
  }
}

export async function initDiscord() {
  const settings = loadSettings()
  if (settings.discordRpcEnabled === false) return

  if (rpcClient) return

  try {
    RPC.register(CLIENT_ID)
    rpcClient = new RPC.Client({ transport: 'ipc' })

    rpcClient.on('ready', () => {
      void refreshPresence()
    })

    rpcClient.login({ clientId: CLIENT_ID }).catch(() => {})
  } catch {
    // Discord RPC should never block the CLI.
  }
}

async function refreshPresence() {
  if (isWatching && currentAnime && currentEpisode && currentProvider) {
    await setWatchingPresence(currentAnime, currentEpisode, currentProvider)
  } else {
    await setBrowsingPresence(currentDetails, currentProvider, currentFeature, currentAnime)
  }
}

function safeSetActivity(activity: RPC.Presence) {
  if (!rpcClient) return
  const settings = loadSettings()
  if (settings.discordRpcEnabled === false) return

  try {
    rpcClient.setActivity(activity).catch(() => {})
  } catch {
    // Ignore transient Discord IPC failures.
  }
}

export async function setBrowsingPresence(details?: string, provider?: string, feature?: string, animeTitle?: string) {
  const revision = ++activityRevision
  isWatching = false
  currentDetails = details
  currentProvider = provider
  currentFeature = feature
  currentAnime = animeTitle
  currentEpisode = undefined

  if (!startTimestamp) startTimestamp = new Date()

  const largeImage = await resolveLargeImage(animeTitle)
  if (revision !== activityRevision) return

  safeSetActivity({
    details: cleanPresenceText(details, animeTitle ? 'Đang xem thông tin phim' : 'Đang duyệt NekoStream'),
    state: cleanPresenceText(buildBrowsingState(provider, feature, animeTitle), 'NekoStream CLI'),
    startTimestamp,
    ...buildBaseActivity(largeImage),
  })
}

export async function setWatchingPresence(animeTitle: string, episodeName: string, provider: string) {
  const revision = ++activityRevision
  isWatching = true
  currentAnime = animeTitle
  currentEpisode = episodeName
  currentProvider = provider

  startTimestamp = new Date()

  const largeImage = await resolveLargeImage(animeTitle)
  if (revision !== activityRevision) return

  safeSetActivity({
    details: cleanPresenceText(animeTitle, 'Đang xem anime'),
    state: cleanPresenceText(`${episodeName} - ${formatProvider(provider)}`, 'Đang phát'),
    startTimestamp,
    ...buildBaseActivity(largeImage),
  })
}

export function clearDiscordPresence() {
  activityRevision++
  if (rpcClient) {
    try {
      rpcClient.clearActivity().catch(() => {})
      rpcClient.destroy().catch(() => {})
    } catch {
      // Ignore Discord IPC cleanup failures.
    }
    rpcClient = null
  }
}

export function toggleDiscordPresence(enabled: boolean) {
  if (enabled) {
    void initDiscord()
  } else {
    clearDiscordPresence()
  }
}
