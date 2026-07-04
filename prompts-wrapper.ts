import { confirm, input, select, Separator } from '@inquirer/prompts'
import chalk from 'chalk'
import readline from 'readline'
import { glyphs, uiText } from './cli/theme'
import { padRight, terminalWidth, truncate, visibleLength } from './cli/text'

export { Separator }

type PromptChoice = {
  title?: string
  value?: unknown
  description?: string
  separator?: string
}

type GridChoice = {
  name: string
  value: unknown
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

function formatSeparator(label: string, leadingBreak = true): string {
  const width = terminalWidth(64, 42)
  const text = ` ${label.trim().toUpperCase()} `
  const fill = '─'.repeat(Math.max(0, width - visibleLength(text) - 2))
  return `${leadingBreak ? '\n' : ''}${uiText.section(text)}${uiText.border(fill)}`
}

function promptMessage(message: string): string {
  return `${uiText.title(message)} ${uiText.subtle('(Esc quay lại)')}`
}

function mapChoices(choices: PromptChoice[], includeBack: boolean) {
  const hasBackChoice = choices.some((choice) => {
    const value = String(choice.value ?? '').toLowerCase()
    const title = String(choice.title ?? '').toLowerCase()
    return value === 'back' || value === '__back__' || title.includes('quay lại') || title.includes('back')
  })

  const mapped = choices.map((choice) => {
    if (choice.separator) {
      return new Separator(formatSeparator(choice.separator))
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

function getGridChoices(choices: PromptChoice[]): GridChoice[] {
  return choices
    .filter((choice) => !choice.separator)
    .map((choice) => ({
      name: choice.title || String(choice.value ?? ''),
      value: choice.value
    }))
}

function gridLayout(choices: GridChoice[]) {
  const width = terminalWidth(96, 58)
  const longest = choices.reduce((max, choice) => Math.max(max, visibleLength(choice.name)), 0)
  const columnWidth = Math.max(14, Math.min(28, longest + 2))
  const columns = Math.max(1, Math.min(6, Math.floor(width / (columnWidth + 3)), choices.length))
  const rows = Math.ceil(choices.length / columns)
  return { columnWidth, columns, rows }
}

async function selectGrid(options: any, signal: AbortSignal): Promise<unknown> {
  const choices = getGridChoices(options.choices || [])
  if (choices.length === 0) return undefined

  let selected = 0
  let renderedLines = 0
  const message = normalizeMessage(options.message || 'Chọn')

  const render = () => {
    if (renderedLines > 0) {
      readline.moveCursor(process.stdout, 0, -renderedLines)
      readline.cursorTo(process.stdout, 0)
      readline.clearScreenDown(process.stdout)
    }

    const { columnWidth, columns, rows } = gridLayout(choices)
    const lines: string[] = [
      `${uiText.focus('?')} ${promptMessage(message)}`,
      formatSeparator('DANH SÁCH TẬP', false)
    ]

    for (let row = 0; row < rows; row++) {
      const cells: string[] = []

      for (let col = 0; col < columns; col++) {
        const index = col * rows + row
        if (index >= choices.length) continue

        const prefix = index === selected ? uiText.focus(glyphs.pointer) : ' '
        const label = truncate(choices[index].name, columnWidth - 2)
        const cell = `${prefix} ${index === selected ? uiText.focus(label) : uiText.value(label)}`
        cells.push(padRight(cell, columnWidth))
      }

      lines.push(cells.join(uiText.border(` ${glyphs.vertical} `)))
    }

    lines.push(chalk.gray('↑↓←→ di chuyển · Enter chọn · Esc quay lại'))
    process.stdout.write(`${lines.join('\n')}\n`)
    renderedLines = lines.length
  }

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      process.stdin.off('keypress', onKeypress)
      signal.removeEventListener('abort', onAbort)
      process.stdout.write('\x1B[?25h')
    }

    const done = (value: unknown) => {
      cleanup()
      if (renderedLines > 0) {
        readline.moveCursor(process.stdout, 0, -renderedLines)
        readline.cursorTo(process.stdout, 0)
        readline.clearScreenDown(process.stdout)
      }
      resolve(value)
    }

    const onAbort = () => {
      cleanup()
      reject(new Error('ESC_PRESSED'))
    }

    const onKeypress = (_str: string, key: any) => {
      const { rows } = gridLayout(choices)

      if (key?.name === 'escape') {
        done(undefined)
        return
      }

      if (key?.name === 'return' || key?.name === 'enter') {
        done(choices[selected].value)
        return
      }

      if (key?.name === 'up') selected = Math.max(0, selected - 1)
      if (key?.name === 'down') selected = Math.min(choices.length - 1, selected + 1)
      if (key?.name === 'left') selected = Math.max(0, selected - rows)
      if (key?.name === 'right') selected = Math.min(choices.length - 1, selected + rows)

      render()
    }

    signal.addEventListener('abort', onAbort)
    process.stdin.on('keypress', onKeypress)
    process.stdout.write('\x1B[?25l')
    render()
  })
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

  if (options.type !== 'grid') {
    process.stdin.on('keypress', onKeypress)
  }

  try {
    if (options.type === 'grid') {
      const result = await selectGrid(options, ac.signal)
      return result ? { [options.name]: result } : {}
    }

    if (options.type === 'select') {
      const message = normalizeMessage(options.message || 'Chọn')
      const includeBack = shouldOfferBack(options.message || '')
      const choices = mapChoices(options.choices || [], includeBack)

      const result = await select({
        message: promptMessage(message),
        choices,
        pageSize: options.pageSize || 15,
        loop: false,
        theme: {
          helpMode: 'always',
          prefix: {
            idle: uiText.focus('?'),
            done: uiText.success('>')
          },
          icon: {
            cursor: uiText.focus(glyphs.pointer)
          },
          style: {
            keysHelpTip: () => chalk.gray('↑↓ di chuyển · Enter chọn · Esc quay lại')
          }
        } as any
      }, { signal: ac.signal, clearPromptOnDone: true } as any)

      if (result === '__GOBACK__') return {}
      return { [options.name]: result }
    }

    if (options.type === 'text') {
      const result = await input({
        message: promptMessage(normalizeMessage(options.message || 'Nhập')),
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
    if (options.type !== 'grid') {
      process.stdin.off('keypress', onKeypress)
    }
  }

  return {}
}
