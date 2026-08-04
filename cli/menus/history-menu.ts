import chalk from 'chalk'
import prompts, { type PromptChoice } from '../../prompts-wrapper'
import { clearScreen, printBanner, printEmpty, printSuccess } from '../../ui'
import { clearHistory, loadHistory } from '../../storage'
import { setBrowsingPresence } from '../../discord'
import { CONFIRM_DELAY_MS, NOTICE_DELAY_MS, sleep } from '../feedback'
import { openAnimeMenu } from '../flows/anime-flow'

const ACTION_CLEAR = -2
const ACTION_BACK = -1

async function confirmClearHistory(): Promise<void> {
  const { confirm } = await prompts<'confirm', boolean>({
    type: 'confirm',
    name: 'confirm',
    message: 'Bạn có chắc muốn xóa toàn bộ lịch sử?',
  })

  if (!confirm) return

  clearHistory()
  printSuccess('Đã xóa lịch sử.')
  await sleep(CONFIRM_DELAY_MS)
}

/** Local watch history, newest first, selectable to resume playback. */
export async function showHistoryMenu(): Promise<void> {
  setBrowsingPresence('Đang xem Lịch Sử', undefined, 'Lịch sử Toàn cục')

  while (true) {
    clearScreen()
    printBanner('Tiếp tục xem', 'Mở lại bộ phim bạn xem gần đây')

    const history = loadHistory()

    if (history.length === 0) {
      printEmpty('Lịch sử xem đang trống.')
      await sleep(NOTICE_DELAY_MS)
      return
    }

    const choices: PromptChoice<number>[] = [{ separator: 'LỊCH SỬ LOCAL' }]
    history.forEach((item, index) => {
      choices.push({
        title: `${chalk.magenta(item.provider)} | ${chalk.bold.white(item.animeTitle)} - ${chalk.cyan(item.episodeTitle)}`,
        description: `Đã xem: ${new Date(item.timestamp).toLocaleString()}`,
        value: index,
      })
    })

    choices.push({ title: chalk.red('Xóa lịch sử'), description: '', value: ACTION_CLEAR })
    choices.push({ title: chalk.gray('Quay lại Home'), description: '', value: ACTION_BACK })

    const { selectedIndex } = await prompts<'selectedIndex', number>({
      type: 'select',
      name: 'selectedIndex',
      message: 'Chọn tập muốn xem tiếp (Esc: quay lại)',
      choices,
    })

    if (selectedIndex === undefined || selectedIndex === ACTION_BACK) return

    if (selectedIndex === ACTION_CLEAR) {
      await confirmClearHistory()
      continue
    }

    const item = history[selectedIndex]
    await openAnimeMenu(item.provider, item.animeId)
  }
}
