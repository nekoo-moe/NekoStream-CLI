import chalk from 'chalk'
import prompts from '../../prompts-wrapper'
import {
  ACCOUNT_PROVIDER_IDS,
  isAccountProviderId,
  type AccountAction,
  type AccountProviderId,
  type Anime47ListAction,
} from '../../provider-types'
import { clearScreen, printBanner } from '../../ui'
import { setBrowsingPresence } from '../../discord'
import { getAuthStatus, logoutProvider, type ProviderAuthStatus } from '../../scrapers/auth-service'
import { CONFIRM_DELAY_MS, sleep } from '../feedback'
import {
  PROVIDER_LABELS,
  listTitle,
  openProviderList,
  type ProviderListRequest,
} from '../flows/provider-lists'
import { loginToProvider } from '../flows/auth-flow'

const ANIME47_ONLY_ACTIONS: Anime47ListAction[] = ['watching', 'completed', 'plan_to_watch']

export function describeAuthStatus(status: ProviderAuthStatus, withCookies = false): string {
  if (!status.loggedIn) return chalk.red('Chưa đăng nhập')
  const name = status.userDisplayName || 'Đã đăng nhập'
  return withCookies ? chalk.green(`${name} (${status.cookieCount || 0} cookies)`) : chalk.green(name)
}

function accountActionToRequest(action: AccountAction): ProviderListRequest | null {
  if (action === 'notifications') return { kind: 'notifications' }
  if (action === 'login' || action === 'logout' || action === 'back') return null
  return { kind: 'list', listType: action }
}

function accountChoices(provider: AccountProviderId, loggedIn: boolean) {
  if (!loggedIn) {
    return [
      { title: chalk.cyan('Đăng nhập'), value: 'login' as AccountAction },
      { title: chalk.gray('Quay lại'), value: 'back' as AccountAction },
    ]
  }

  const listTitles: Record<Anime47ListAction, string> = {
    favorites: 'Hộp phim / Yêu thích',
    history: 'Lịch sử xem',
    watching: 'Đang xem',
    completed: 'Hoàn thành',
    plan_to_watch: 'Dự định xem',
  }

  const actions: Anime47ListAction[] = [
    'favorites',
    'history',
    ...(provider === 'animevietsub' ? [] : ANIME47_ONLY_ACTIONS),
  ]

  return [
    ...actions.map((action) => ({ title: listTitles[action], value: action as AccountAction })),
    { title: 'Thông báo', value: 'notifications' as AccountAction },
    { title: chalk.red('Đăng xuất'), value: 'logout' as AccountAction },
    { title: chalk.gray('Quay lại'), value: 'back' as AccountAction },
  ]
}

async function showProviderAccountMenu(provider: AccountProviderId): Promise<void> {
  const label = PROVIDER_LABELS[provider]

  while (true) {
    setBrowsingPresence('Quản lý Tài khoản', provider, 'Tài khoản')
    clearScreen()

    const status = getAuthStatus(provider)
    printBanner(`${label} — Tài khoản`, describeAuthStatus(status, true))

    const { action } = await prompts<'action', AccountAction>({
      type: 'select',
      name: 'action',
      message: `${label} — Chọn hành động`,
      choices: accountChoices(provider, status.loggedIn),
    })

    if (!action || action === 'back') return

    if (action === 'login') {
      await loginToProvider(provider)
      continue
    }

    if (action === 'logout') {
      logoutProvider(provider)
      console.log(chalk.yellow(`\nĐã đăng xuất khỏi ${label}.`))
      await sleep(CONFIRM_DELAY_MS)
      return
    }

    const request = accountActionToRequest(action)
    if (request) {
      await openProviderList(provider, request, `${listTitle(provider, request)} — ${label}`)
    }
  }
}

/** Top-level account menu: pick a provider, then manage its session. */
export async function showAccountMenu(): Promise<void> {
  while (true) {
    clearScreen()
    printBanner('Tài khoản', 'Quản lý đăng nhập theo từng provider')

    const choices = ACCOUNT_PROVIDER_IDS.map((provider) => ({
      title: `${PROVIDER_LABELS[provider]} — ${describeAuthStatus(getAuthStatus(provider))}`,
      value: provider as AccountProviderId | 'back',
    }))
    choices.push({ title: chalk.gray('Quay lại Home'), value: 'back' })

    const { provider } = await prompts<'provider', AccountProviderId | 'back'>({
      type: 'select',
      name: 'provider',
      message: 'Chọn nhà cung cấp',
      choices,
    })

    if (!provider || provider === 'back') return
    if (isAccountProviderId(provider)) await showProviderAccountMenu(provider)
  }
}
