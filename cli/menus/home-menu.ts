import chalk from 'chalk'
import prompts, { type PromptChoice } from '../../prompts-wrapper'
import { getProvider } from '../../providers'
import {
  PROVIDER_IDS,
  isAccountProviderId,
  isHomeListAction,
  type Anime47ListAction,
  type HomeAction,
  type HomeListAction,
  type ProviderId,
} from '../../provider-types'
import { clearScreen, printBanner, printEmpty, printStatusStrip } from '../../ui'
import { loadSettings } from '../../storage'
import { clearDiscordPresence, setBrowsingPresence } from '../../discord'
import { debugTrace } from '../../logger'
import { getAuthStatus, logoutProvider, type ProviderAuthStatus } from '../../scrapers/auth-service'
import { NOTICE_DELAY_MS, CONFIRM_DELAY_MS, sleep, withSpinner } from '../feedback'
import { showAnimeList } from '../flows/anime-flow'
import { openProviderList, type ProviderListRequest } from '../flows/provider-lists'
import { loginToProvider } from '../flows/auth-flow'
import { showHistoryMenu } from './history-menu'
import { showSettingsMenu } from './settings-menu'

const HOME_LIST_TITLES: Record<HomeListAction, string> = {
  favorites: 'Hộp phim',
  history_provider: 'Lịch sử',
  watching: 'Đang xem',
  completed: 'Hoàn thành',
  plan_to_watch: 'Dự định xem',
  notifications: 'Thông báo',
}

/** AnimeHay has no account features, so it reports a permanently anonymous status. */
function anonymousStatus(provider: ProviderId): ProviderAuthStatus {
  return {
    provider: provider as ProviderAuthStatus['provider'],
    loggedIn: false,
    cookieCount: 0,
    hasAuthLikeCookie: false,
    userDisplayName: undefined,
  }
}

function resolveAuthStatus(provider: ProviderId): ProviderAuthStatus {
  return isAccountProviderId(provider) ? getAuthStatus(provider) : anonymousStatus(provider)
}

function homeListRequest(action: HomeListAction): ProviderListRequest {
  if (action === 'notifications') return { kind: 'notifications' }
  const listType: Anime47ListAction = action === 'history_provider' ? 'history' : action
  return { kind: 'list', listType }
}

function accountChoices(provider: ProviderId, status: ProviderAuthStatus): PromptChoice<HomeAction>[] {
  if (!isAccountProviderId(provider)) return []

  if (!status.loggedIn) {
    const label = provider === 'anime47' ? 'Đăng nhập Anime47' : 'Đăng nhập AnimeVietsub'
    return [{ title: chalk.green(label), value: 'login' }]
  }

  const listActions: HomeListAction[] =
    provider === 'anime47'
      ? ['favorites', 'history_provider', 'watching', 'completed', 'plan_to_watch', 'notifications']
      : ['favorites', 'history_provider', 'notifications']

  return [
    ...listActions.map((action) => ({
      title: action === 'favorites' && provider === 'anime47'
        ? 'Hộp phim / Yêu thích'
        : HOME_LIST_TITLES[action],
      value: action as HomeAction,
    })),
    { title: chalk.yellow('Đăng xuất'), value: 'logout' },
  ]
}

function homeChoices(provider: ProviderId, status: ProviderAuthStatus): PromptChoice<HomeAction>[] {
  const username = status.loggedIn ? status.userDisplayName || 'MEMBER' : 'KHÁCH'

  return [
    { separator: 'KHÁM PHÁ' },
    { title: 'Tìm anime', value: 'search', description: 'Tìm theo tên phim' },
    { title: 'Đang thịnh hành', value: 'trending', description: 'Danh sách nổi bật từ provider' },
    { title: 'Mới cập nhật', value: 'latest', description: 'Các tập/phim vừa được cập nhật' },
    { separator: `TÀI KHOẢN : ${username.toUpperCase()}` },
    ...accountChoices(provider, status),
    { separator: 'HỆ THỐNG' },
    { title: 'Tiếp tục xem (Lịch sử Local)', value: 'history' },
    { title: 'Cài đặt hệ thống', value: 'settings' },
    { title: 'Đổi Provider', value: 'change_provider' },
    { title: chalk.red('Thoát ứng dụng'), value: 'exit' },
  ]
}

function renderHome(provider: ProviderId, status: ProviderAuthStatus): void {
  clearScreen()

  const usernameDisplay = status.loggedIn
    ? chalk.green(`${status.userDisplayName || 'Đã đăng nhập'} (${status.cookieCount || 0} cookies)`)
    : chalk.red('Chưa đăng nhập')

  printBanner(`Provider: ${provider.toUpperCase()}`, 'Trang chủ')
  printStatusStrip([
    { label: 'Tài khoản', value: usernameDisplay },
    { label: 'Provider', value: chalk.green(provider) },
  ])
  debugTrace('home rendered', { provider, loggedIn: status.loggedIn })
}

async function runSearch(provider: ProviderId): Promise<void> {
  const { keyword } = await prompts<'keyword', string>({
    type: 'text',
    name: 'keyword',
    message: 'Nhập tên anime cần tìm (Esc: quay lại)',
  })
  if (!keyword) return

  const results = await withSpinner(
    `Đang tìm "${keyword}" trên ${provider}...`,
    'Tìm kiếm thất bại',
    () => getProvider(provider).search(keyword)
  )
  if (results === undefined) return

  if (results.length === 0) {
    printEmpty('\nKhông tìm thấy kết quả phù hợp.')
    await sleep(NOTICE_DELAY_MS)
    return
  }

  setBrowsingPresence(`Đang Tìm kiếm: ${keyword}`, provider, 'Tìm kiếm')
  await showAnimeList(provider, `Kết quả tìm kiếm: ${keyword}`, results)
}

async function runHomeRail(provider: ProviderId, rail: 'trending' | 'latest'): Promise<void> {
  const label = rail === 'trending' ? 'thịnh hành' : 'mới cập nhật'

  const results = await withSpinner(
    `Đang tải danh sách ${label}...`,
    `Không tải được danh sách ${label}`,
    () => getProvider(provider).getHomeCards(rail)
  )
  if (results === undefined) return

  if (results.length === 0) {
    printEmpty(`\nProvider này chưa có danh sách ${label}.`)
    await sleep(NOTICE_DELAY_MS)
    return
  }

  const title = rail === 'trending' ? 'Đang thịnh hành' : 'Mới cập nhật'
  setBrowsingPresence(
    `Đang Xem ${rail === 'trending' ? 'Xu hướng' : 'Cập nhật gần đây'}`,
    provider,
    title
  )
  await showAnimeList(provider, title, results)
}

async function changeProvider(current: ProviderId): Promise<ProviderId> {
  const { newProvider } = await prompts<'newProvider', ProviderId>({
    type: 'select',
    name: 'newProvider',
    message: 'Chọn provider',
    choices: PROVIDER_IDS.map((name) => ({ title: name, value: name })),
  })
  return newProvider ?? current
}

function exitApplication(): never {
  clearScreen()
  clearDiscordPresence()
  console.log(chalk.magenta('\nCảm ơn bạn đã dùng NekoStream CLI.\n'))
  process.exit(0)
}

/** The main home loop. Runs until the user chooses to exit. */
export async function showHomeMenu(): Promise<void> {
  let currentProvider = loadSettings().defaultProvider

  while (true) {
    setBrowsingPresence('Đang lướt Menu Chính')

    const status = resolveAuthStatus(currentProvider)
    renderHome(currentProvider, status)

    const { action } = await prompts<'action', HomeAction>({
      type: 'select',
      name: 'action',
      message: 'Trang chủ',
      choices: homeChoices(currentProvider, status),
    })

    if (!action || action === 'exit') exitApplication()

    if (isHomeListAction(action)) {
      if (isAccountProviderId(currentProvider)) {
        const request = homeListRequest(action)
        await openProviderList(currentProvider, request, HOME_LIST_TITLES[action])
      }
      continue
    }

    switch (action) {
      case 'login':
        if (isAccountProviderId(currentProvider)) await loginToProvider(currentProvider)
        break

      case 'logout':
        if (isAccountProviderId(currentProvider)) logoutProvider(currentProvider)
        console.log(chalk.yellow('\nĐã đăng xuất.'))
        await sleep(CONFIRM_DELAY_MS)
        break

      case 'search':
        await runSearch(currentProvider)
        break

      case 'trending':
      case 'latest':
        await runHomeRail(currentProvider, action)
        break

      case 'history':
        await showHistoryMenu()
        break

      case 'settings':
        await showSettingsMenu()
        // The default provider may have changed inside the settings menu.
        currentProvider = loadSettings().defaultProvider
        break

      case 'change_provider':
        currentProvider = await changeProvider(currentProvider)
        break
    }
  }
}
