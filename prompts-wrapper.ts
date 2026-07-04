import { confirm, input, select, Separator } from '@inquirer/prompts'
import chalk from 'chalk'
import readline from 'readline'
import { glyphs, uiText } from './cli/theme'

export { Separator }

type PromptChoice = {
  title?: string
  value?: unknown
  description?: string
  separator?: string
}

function shouldOfferBack(message: string): boolean {
  return /esc|back|quay lại|thoát/i.test(message)
}

function normalizeMessage(message: string): string {
  return message
    .replace(/\(Press Esc to go back\)/gi, '')
    .replace(/\(Esc: Thoát\)/gi, '')
    .replace(/\(Esc: quay lại\)/gi, '')
    .replace(/\(Esc để quay lại\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function mapChoices(choices: PromptChoice[], includeBack: boolean) {
  const hasBackChoice = choices.some((choice) => {
    const value = String(choice.value ?? '').toLowerCase()
    const title = String(choice.title ?? '').toLowerCase()
    return value === 'back' || value === '__back__' || title.includes('quay lại') || title.includes('back')
  })

  const mapped = choices.map((choice) => {
    if (choice.separator) {
      return new Separator(uiText.section(`\n ${choice.separator} `))
    }

    return {
      name: choice.title || String(choice.value ?? ''),
      value: choice.value,
      description: choice.description
    }
  })

  if (includeBack && !hasBackChoice) {
    mapped.push({
      name: uiText.muted(`${glyphs.back} Quay lại`),
      value: '__GOBACK__',
      description: 'Trở về màn hình trước'
    })
  }

  return mapped
}

export default async function prompts(options: any): Promise<any> {
  const ac = new AbortController()

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin)
  }

  const onKeypress = (_str: string, key: any) => {
    if (key?.name === 'escape') {
      ac.abort(new Error('ESC_PRESSED'))
    }
  }

  process.stdin.on('keypress', onKeypress)

  try {
    if (options.type === 'select') {
      const message = normalizeMessage(options.message || 'Chọn')
      const includeBack = shouldOfferBack(options.message || '')
      const choices = mapChoices(options.choices || [], includeBack)

      const result = await select({
        message: `${uiText.title(message)} ${uiText.muted('(Esc: quay lại)')}`,
        choices,
        pageSize: options.pageSize || 15,
        loop: false,
        theme: {
          helpMode: 'always',
          style: {
            keysHelpTip: () => chalk.gray('↑↓ di chuyển • Enter chọn • Esc quay lại')
          }
        } as any
      }, { signal: ac.signal, clearPromptOnDone: true } as any)

      if (result === '__GOBACK__') return {}
      return { [options.name]: result }
    }

    if (options.type === 'text') {
      const result = await input({
        message: `${uiText.title(normalizeMessage(options.message || 'Nhập'))} ${uiText.muted('(Esc: quay lại)')}`,
        default: options.initial
      }, { signal: ac.signal, clearPromptOnDone: true } as any)

      return { [options.name]: result }
    }

    if (options.type === 'confirm') {
      const result = await confirm({
        message: uiText.title(options.message || 'Xác nhận?'),
        default: options.initial
      }, { signal: ac.signal, clearPromptOnDone: true } as any)

      return { [options.name]: result }
    }
  } catch (err: any) {
    if (err.name === 'ExitPromptError' || err.name === 'AbortPromptError' || err.message === 'ESC_PRESSED') {
      return {}
    }
    throw err
  } finally {
    process.stdin.off('keypress', onKeypress)
  }

  return {}
}
