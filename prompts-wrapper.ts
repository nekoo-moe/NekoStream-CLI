import { confirm, input, search, select, Separator } from '@inquirer/prompts'
import chalk from 'chalk'
import readline from 'readline'
import { glyphs, uiText } from './cli/theme'
import { padRight, terminalWidth, truncate, visibleLength } from './cli/text'
import { isDebugModeEnabled } from './logger'

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

function clearPromptLines(renderedLines: number): boolean {
  if (renderedLines <= 0 || isDebugModeEnabled()) return false
  readline.moveCursor(process.stdout, 0, -renderedLines)
  readline.cursorTo(process.stdout, 0)
  readline.clearScreenDown(process.stdout)
  return true
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

function normalized(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function gridLayout(choices: GridChoice[]) {
  const width = terminalWidth(96, 58)
  const longest = choices.reduce((max, choice) => Math.max(max, visibleLength(choice.name)), 0)
  const columnWidth = Math.max(14, Math.min(28, longest + 2))
  const columns = Math.max(1, Math.min(6, Math.floor(width / (columnWidth + 3)), choices.length))
  const maxRows = Math.max(6, Math.min(12, (process.stdout.rows || 30) - 12))
  const rows = Math.max(1, Math.min(maxRows, Math.ceil(choices.length / columns)))
  const pageSize = columns * rows
  return { columnWidth, columns, rows, pageSize }
}

function filterGridChoices(choices: GridChoice[], query: string): GridChoice[] {
  const term = normalized(query.trim())
  if (!term) return choices

  return choices.filter((choice, index) => {
    const haystack = normalized(`${index + 1} ${choice.name} ${String((choice.value as any)?.number ?? '')}`)
    return haystack.includes(term)
  })
}

function findNumericChoice(choices: GridChoice[], query: string): GridChoice | undefined {
  const raw = query.trim()
  if (!/^\d+$/.test(raw)) return undefined
  const target = Number(raw)

  return choices.find((choice, index) => {
    const valueNumber = Number((choice.value as any)?.number)
    if (Number.isFinite(valueNumber) && valueNumber === target) return true
    if (index + 1 === target) return true
    return new RegExp(`\\b0*${target}\\b`).test(choice.name)
  })
}

async function selectGrid(options: any, signal: AbortSignal): Promise<unknown> {
  const choices = getGridChoices(options.choices || [])
  if (choices.length === 0) return undefined

  let selected = 0
  let page = 0
  let query = ''
  let renderedLines = 0
  const message = normalizeMessage(options.message || 'Chọn')

  const render = () => {
    clearPromptLines(renderedLines)

    const filtered = filterGridChoices(choices, query)
    const { columnWidth, columns, rows, pageSize } = gridLayout(filtered)
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
    page = Math.max(0, Math.min(page, pageCount - 1))
    selected = Math.max(0, Math.min(selected, Math.max(0, filtered.length - 1)))
    const pageStart = page * pageSize
    const pageChoices = filtered.slice(pageStart, pageStart + pageSize)
    const selectedOnPage = selected - pageStart

    const lines: string[] = [
      `${uiText.focus('?')} ${promptMessage(message)}`,
      `${uiText.label('Search')} ${uiText.value(query || '')}${uiText.subtle(query ? '' : 'Gõ số tập/tên để lọc')}`,
      formatSeparator('DANH SÁCH TẬP', false)
    ]

    for (let row = 0; row < rows; row++) {
      const cells: string[] = []

      for (let col = 0; col < columns; col++) {
        const index = col * rows + row
        if (index >= pageChoices.length) continue

        const prefix = index === selectedOnPage ? uiText.focus(glyphs.pointer) : ' '
        const label = truncate(pageChoices[index].name, columnWidth - 2)
        const cell = `${prefix} ${index === selectedOnPage ? uiText.focus(label) : uiText.value(label)}`
        cells.push(padRight(cell, columnWidth))
      }

      lines.push(cells.join(uiText.border(` ${glyphs.vertical} `)))
    }

    const pageLabel = filtered.length > pageSize ? ` · Trang ${page + 1}/${pageCount}` : ''
    lines.push(chalk.gray(`↑↓←→ di chuyển · PgUp/PgDn trang · Enter chọn · Esc quay lại${pageLabel}`))
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
      clearPromptLines(renderedLines)
      resolve(value)
    }

    const onAbort = () => {
      cleanup()
      reject(new Error('ESC_PRESSED'))
    }

    const onKeypress = (_str: string, key: any) => {
      const filtered = filterGridChoices(choices, query)
      const { rows, pageSize } = gridLayout(filtered)
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))

      if (key?.name === 'escape') {
        done(undefined)
        return
      }

      if (key?.name === 'backspace') {
        query = query.slice(0, -1)
        selected = 0
        page = 0
        render()
        return
      }

      if (key?.name === 'return' || key?.name === 'enter') {
        const numericChoice = findNumericChoice(choices, query)
        if (numericChoice) {
          done(numericChoice.value)
          return
        }
        if (filtered[selected]) {
          done(filtered[selected].value)
        } else {
          render()
        }
        return
      }

      if (_str && _str >= ' ' && !key?.ctrl && !key?.meta && key?.name !== 'return') {
        query += _str
        selected = 0
        page = 0
        render()
        return
      }

      if (key?.name === 'pageup') {
        page = Math.max(0, page - 1)
        selected = page * pageSize
        render()
        return
      }

      if (key?.name === 'pagedown') {
        page = Math.min(pageCount - 1, page + 1)
        selected = page * pageSize
        render()
        return
      }

      if (key?.name === 'up') selected = Math.max(0, selected - 1)
      if (key?.name === 'down') selected = Math.min(filtered.length - 1, selected + 1)
      if (key?.name === 'left') selected = Math.max(0, selected - rows)
      if (key?.name === 'right') selected = Math.min(filtered.length - 1, selected + rows)
      page = Math.floor(selected / pageSize)

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

    if (options.type === 'search') {
      const message = normalizeMessage(options.message || 'Tìm')
      const includeBack = shouldOfferBack(options.message || '')
      const baseChoices = mapChoices(options.choices || [], includeBack).filter((choice: any) => !(choice instanceof Separator))

      const result = await search({
        message: promptMessage(message),
        pageSize: options.pageSize || 15,
        source: async (term?: string) => {
          const query = normalized(term || '')
          if (!query) return baseChoices
          return baseChoices.filter((choice: any, index: number) => {
            const haystack = normalized(`${index + 1} ${choice.name || ''} ${choice.description || ''}`)
            return haystack.includes(query)
          }).slice(0, options.searchLimit || 50)
        },
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
            keysHelpTip: () => chalk.gray('Gõ tên/số · Enter chọn · Esc quay lại')
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
