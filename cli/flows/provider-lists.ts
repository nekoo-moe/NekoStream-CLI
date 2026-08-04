import type {
  AccountProviderId,
  Anime47ListAction,
  AnimeVietsubListAction,
} from '../../provider-types'
import {
  fetchAllAnime47List,
  fetchAllAnimeVietsubList,
  fetchAnime47Notifications,
  fetchAnimeVietsubNotifications,
  type UserDataItem,
  type UserDataResult,
} from '../../scrapers/auth-service'
import { reportFailure, withSilentSpinner } from '../feedback'
import { showUserDataList } from './anime-flow'

export const PROVIDER_LABELS: Record<AccountProviderId, string> = {
  animevietsub: 'AnimeVietsub',
  anime47: 'Anime47',
}

const ANIME47_LIST_TITLES: Record<Anime47ListAction, string> = {
  favorites: 'Yêu thích',
  history: 'Lịch sử xem',
  watching: 'Đang xem',
  completed: 'Hoàn thành',
  plan_to_watch: 'Dự định xem',
}

const ANIMEVIETSUB_LIST_TITLES: Record<AnimeVietsubListAction, string> = {
  favorites: 'Hộp phim / Yêu thích',
  history: 'Lịch sử xem',
}

/** A list the user can open from either the home menu or the account menu. */
export type ProviderListRequest =
  | { kind: 'notifications' }
  | { kind: 'list'; listType: Anime47ListAction }

export function listTitle(provider: AccountProviderId, request: ProviderListRequest): string {
  if (request.kind === 'notifications') return 'Thông báo'
  if (provider === 'animevietsub') {
    const action: AnimeVietsubListAction =
      request.listType === 'history' ? 'history' : 'favorites'
    return ANIMEVIETSUB_LIST_TITLES[action]
  }
  return ANIME47_LIST_TITLES[request.listType]
}

function notificationsToItems(result: UserDataResult): UserDataItem[] {
  if (result.notifications) {
    return result.notifications.map((entry) => ({
      animeId: entry.animeId || '',
      title: entry.title,
      url: entry.url,
      thumbnail: entry.thumbnail,
    }))
  }
  return result.items
}

function fetchProviderData(
  provider: AccountProviderId,
  request: ProviderListRequest
): Promise<UserDataResult> {
  if (provider === 'animevietsub') {
    if (request.kind === 'notifications') return fetchAnimeVietsubNotifications()
    const listType: AnimeVietsubListAction =
      request.listType === 'history' ? 'history' : 'favorites'
    return fetchAllAnimeVietsubList(listType)
  }

  if (request.kind === 'notifications') return fetchAnime47Notifications()
  return fetchAllAnime47List(request.listType === 'favorites' ? 'favorite' : request.listType)
}

/**
 * Fetch a provider-side list behind a spinner and hand it to the interactive
 * list view. Titles can be overridden for menus that use shorter labels.
 */
export async function openProviderList(
  provider: AccountProviderId,
  request: ProviderListRequest,
  title = listTitle(provider, request)
): Promise<void> {
  const outcome = await withSilentSpinner(
    `Đang tải dữ liệu từ ${PROVIDER_LABELS[provider]}...`,
    () => fetchProviderData(provider, request)
  )

  if (!outcome.ok) {
    await reportFailure('Lỗi', outcome.error)
    return
  }

  const result = outcome.value
  if (!result.success) {
    await reportFailure(result.error || 'Không tải được dữ liệu.')
    return
  }

  const items = request.kind === 'notifications' ? notificationsToItems(result) : result.items
  await showUserDataList(title, items, provider)
}
