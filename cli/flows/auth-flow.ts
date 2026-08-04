import chalk from 'chalk'
import type { AccountProviderId } from '../../provider-types'
import {
  loginAnime47Interactive,
  loginAnimeVietsubInteractive,
} from '../../scrapers/auth-service'
import { printSuccess } from '../../ui'
import { NOTICE_DELAY_MS, formatError, sleep } from '../feedback'

/**
 * Run the interactive browser login for a provider and report the outcome.
 * Returns whether the session was established.
 */
export async function loginToProvider(provider: AccountProviderId): Promise<boolean> {
  try {
    const status =
      provider === 'animevietsub'
        ? await loginAnimeVietsubInteractive()
        : await loginAnime47Interactive()

    printSuccess('\nĐăng nhập thành công!')
    if (status.userDisplayName) {
      console.log(chalk.cyan(`   Xin chào, ${status.userDisplayName}!`))
    }
    await sleep(NOTICE_DELAY_MS)
    return true
  } catch (error) {
    // A cancelled login surfaces as a Playwright timeout, which deserves a
    // clearer message than the raw error text.
    if (error instanceof Error && error.name === 'TimeoutError') {
      console.log(chalk.red('\nĐăng nhập thất bại/Đã hủy: Hết thời gian chờ (Timeout).'))
    } else {
      console.log(chalk.red(`\nĐăng nhập thất bại: ${formatError(error)}`))
    }
    await sleep(NOTICE_DELAY_MS)
    return false
  }
}
