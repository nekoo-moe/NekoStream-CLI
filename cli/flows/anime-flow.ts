import chalk from 'chalk'
import prompts, { type PromptChoice } from '../../prompts-wrapper'
import { getProvider } from '../../providers'
import type { ProviderId } from '../../provider-types'
import { launchPlayer } from '../../player'
import {
  clearScreen,
  drawAnimeCard,
  drawAnimeInfoCard,
  printBanner,
  printEmpty,
  printSuccess,
} from '../../ui'
import { saveHistoryEntry } from '../../storage'
import { setBrowsingPresence, setWatchingPresence } from '../../discord'
import type {
  AnimeDetail,
  AnimeSearchResult,
  Episode,
  StreamInfo,
  VideoServer,
} from '../../scrapers/base'
import type { UserDataItem } from '../../scrapers/auth-service'
import {
  NOTICE_DELAY_MS,
  flushStdin,
  reportEmpty,
  reportFailure,
  sleep,
  withSpinner,
} from '../feedback'

const USER_LIST_PAGE_SIZE = 20

function episodeLabel(episode: Episode): string {
  return episode.title || `Episode ${episode.number}`
}

function singleLine(value: string): string {
  return value.replace(/\r?\n|\r/g, ' ').trim()
}

/** Placeholder detail used when a provider cannot serve its detail page. */
function fallbackDetail(
  providerName: ProviderId,
  animeId: string,
  episodes: Episode[]
): AnimeDetail {
  const firstTitle = episodes.length > 0 ? episodes[0].title : undefined
  return {
    id: animeId,
    source: providerName,
    title: firstTitle ? firstTitle.split(' - ')[0] : animeId,
    genres: [],
  }
}

async function selectEpisode(
  anime: AnimeDetail,
  episodes: Episode[]
): Promise<Episode | undefined> {
  clearScreen()
  printBanner(`Provider: ${anime.source.toUpperCase()}`, anime.title)
  drawAnimeCard(anime)

  flushStdin()

  const choices: PromptChoice<Episode>[] = episodes.map((episode, index) => ({
    title: `${chalk.bold(String(index + 1).padStart(2))}. ${singleLine(episodeLabel(episode))}`,
    value: episode,
  }))

  const { episode } = await prompts<'episode', Episode>({
    type: 'grid',
    name: 'episode',
    message: 'Chọn tập phim (Esc: quay lại)',
    choices,
  })

  return episode
}

async function selectServer(
  providerName: ProviderId,
  servers: VideoServer[]
): Promise<VideoServer | undefined> {
  const { server } = await prompts<'server', VideoServer>({
    type: 'select',
    name: 'server',
    message: 'Chọn server phát (Esc: quay lại)',
    choices: servers.map((entry, index) => {
      const quality = chalk.gray(`[${entry.quality || 'Auto'}]`)
      const detail =
        providerName === 'animevietsub'
          ? quality
          : chalk.gray(`[${entry.quality || 'Auto'}] (${entry.type || 'stream'})`)

      return {
        title: `${chalk.bold(`${index + 1}.`)} ${entry.name} ${detail}`,
        value: entry,
      }
    }),
  })

  return server
}

async function playEpisode(
  providerName: ProviderId,
  anime: AnimeDetail,
  episode: Episode,
  streamInfo: StreamInfo
): Promise<void> {
  printSuccess('\nSẵn sàng phát. Đang mở player...')

  saveHistoryEntry({
    provider: providerName,
    animeId: anime.id,
    animeTitle: anime.title,
    episodeId: episode.id,
    episodeTitle: episodeLabel(episode),
  })

  try {
    setWatchingPresence(anime.title, episodeLabel(episode), providerName)
    await launchPlayer(streamInfo)
    setBrowsingPresence('Đang xem thông tin phim', providerName, 'Thông tin Phim', anime.title)
    printSuccess('\nTrình phát đã đóng.')
    await sleep(500)
  } catch (error) {
    await reportFailure('Lỗi player', error)
  }
}

/**
 * Server selection and playback for one episode. Returns when the user backs
 * out or a playback attempt finishes.
 */
async function runEpisodeSession(
  providerName: ProviderId,
  anime: AnimeDetail,
  episode: Episode
): Promise<void> {
  const provider = getProvider(providerName)

  while (true) {
    clearScreen()
    printBanner('Chọn server', anime.title)
    drawAnimeInfoCard(anime, episodeLabel(episode))

    const servers = await withSpinner(
      'Đang tải server phát...',
      'Không tải được server phát',
      () => provider.getVideoServers(episode.href || episode.id)
    )
    if (servers === undefined) return
    if (servers.length === 0) {
      await reportEmpty('Không tìm thấy server phát cho tập này.')
      return
    }

    const server = await selectServer(providerName, servers)
    if (!server) return

    const streamInfo = await withSpinner('Đang lấy stream URL...', 'Không lấy được stream', () =>
      provider.extractStreamUrl(server)
    )
    if (streamInfo === undefined) continue
    if (!streamInfo || !streamInfo.url) {
      await reportEmpty('Không lấy được stream URL.')
      continue
    }

    await playEpisode(providerName, anime, episode, streamInfo)
    return
  }
}

/** Detail view for one anime: browse episodes, pick a server, and play. */
export async function openAnimeMenu(providerName: ProviderId, animeId: string): Promise<void> {
  setBrowsingPresence('Đang tải thông tin phim', providerName, 'Tải dữ liệu')
  const provider = getProvider(providerName)

  const episodes = await withSpinner(
    'Đang tải thông tin phim và danh sách tập...',
    'Không tải được danh sách tập',
    () => provider.getEpisodes(animeId)
  )
  if (episodes === undefined) return

  if (episodes.length === 0) {
    printEmpty('\nKhông tìm thấy tập phim nào.')
    await sleep(NOTICE_DELAY_MS)
    return
  }

  // A 401 on the detail page must not block episode playback, so failures here
  // fall back to a synthetic detail record.
  let anime: AnimeDetail | null = null
  if (provider.getAnimeDetail) {
    try {
      anime = await provider.getAnimeDetail(animeId)
    } catch {
      // Detail unavailable — episodes still work.
    }
  }
  const detail = anime ?? fallbackDetail(providerName, animeId, episodes)

  while (true) {
    setBrowsingPresence(
      'Đang xem thông tin phim',
      providerName,
      'Thông tin Phim',
      detail.title
    )

    const episode = await selectEpisode(detail, episodes)
    if (!episode) return

    await runEpisodeSession(providerName, detail, episode)
  }
}

/** Searchable list of anime cards from search results or home rails. */
export async function showAnimeList(
  providerName: ProviderId,
  title: string,
  list: AnimeSearchResult[]
): Promise<void> {
  setBrowsingPresence(`Danh sách: ${title}`, providerName, title)

  while (true) {
    clearScreen()
    printBanner(`Provider: ${providerName.toUpperCase()}`, title.toUpperCase())

    flushStdin()

    const { animeId } = await prompts<'animeId', string>({
      type: 'search',
      name: 'animeId',
      message: 'Chọn anime (Esc: quay lại)',
      pageSize: 15,
      choices: list.map((anime, index) => {
        const meta = singleLine(anime.status || anime.year?.toString() || '')
        return {
          title: `${chalk.bold(String(index + 1).padStart(2))}. ${singleLine(anime.title)}${
            meta ? chalk.gray(` - ${meta}`) : ''
          }`,
          value: anime.id,
        }
      }),
    })

    if (!animeId) return

    await openAnimeMenu(providerName, animeId)
  }
}

/** Paginated list of a signed-in user's saved anime, selectable for playback. */
export async function showUserDataList(
  title: string,
  items: UserDataItem[],
  providerName: ProviderId
): Promise<void> {
  setBrowsingPresence(`Đang xem ${title}`, providerName, title)

  if (items.length === 0) {
    printEmpty('\nDanh sách đang trống.')
    await sleep(1500)
    return
  }

  let offset = 0

  while (true) {
    clearScreen()
    printBanner(title, `${items.length} anime`)

    const page = items.slice(offset, offset + USER_LIST_PAGE_SIZE)
    const choices: PromptChoice<string>[] = page.map((item, index) => {
      const episode = item.episodeNumber ? chalk.gray(` [Tập ${item.episodeNumber}]`) : ''
      const status = item.status ? chalk.cyan(` (${item.status})`) : ''
      return {
        title: `${chalk.bold(String(offset + index + 1).padStart(3))}. ${item.title}${episode}${status}`,
        value: item.animeId,
      }
    })

    const remaining = items.length - offset - USER_LIST_PAGE_SIZE
    if (remaining > 0) {
      choices.push({ title: chalk.yellow(`▼ Xem thêm (${remaining} còn lại)`), value: '__next__' })
    }
    if (offset > 0) {
      choices.push({ title: chalk.yellow('▲ Trang trước'), value: '__prev__' })
    }
    choices.push({ title: chalk.gray('← Quay lại'), value: '__back__' })

    const { animeId } = await prompts<'animeId', string>({
      type: 'search',
      name: 'animeId',
      message: 'Chọn anime để xem (Esc: quay lại)',
      pageSize: USER_LIST_PAGE_SIZE,
      choices,
    })

    if (!animeId || animeId === '__back__') return
    if (animeId === '__next__') {
      offset = Math.min(offset + USER_LIST_PAGE_SIZE, items.length - 1)
      continue
    }
    if (animeId === '__prev__') {
      offset = Math.max(0, offset - USER_LIST_PAGE_SIZE)
      continue
    }

    await openAnimeMenu(providerName, animeId)
  }
}
