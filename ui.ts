import chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'
import { isDebugModeEnabled } from './logger'
import type { AnimeDetail } from './scrapers/base'
import { glyphs, palette, uiText } from './cli/theme'
import { cleanDescription, cleanInline, padRight, terminalWidth, truncate, visibleLength, wrapText } from './cli/text'

type StatusItem = {
  label: string
  value?: string | number | null
}

export function clearScreen() {
  if (isDebugModeEnabled()) return

  process.stdout.write('\x1B[2J\x1B[3J\x1B[H')
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false)
      process.stdin.setRawMode(true)
    } catch {
      // Some terminals do not expose raw mode consistently.
    }
  }
}

function getVersion(): string {
  try {
    const isCompiled = __dirname.endsWith('dist') || __dirname.endsWith('dist\\') || __dirname.endsWith('dist/')
    const basePath = isCompiled ? path.join(__dirname, '..') : __dirname
    const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'package.json'), 'utf-8'))
    return pkg.version || 'unknown'
  } catch {
    return 'unknown'
  }
}

function borderLine(width: number, left: string, right: string, active = false): string {
  const color = active ? uiText.activeBorder : uiText.border
  return color(`${left}${glyphs.horizontal.repeat(width - 2)}${right}`)
}

function boxedLine(content: string, width: number, active = false): string {
  const left = active ? uiText.activeBorder(glyphs.vertical) : uiText.border(glyphs.vertical)
  const right = uiText.border(glyphs.vertical)
  return `${left} ${padRight(content, width - 4)} ${right}`
}

function innerRule(label: string, width: number): string {
  const text = label ? ` ${label} ` : ''
  const fill = glyphs.horizontal.repeat(Math.max(0, width - visibleLength(text)))
  return uiText.border(`${text}${fill}`)
}

function renderMeta(label: string, value?: string | number | null) {
  return `${uiText.label(label)} ${uiText.value(cleanInline(value))}`
}

function renderMetadataLines(items: StatusItem[], innerWidth: number): string[] {
  const divider = chalk.hex(palette.border)(` ${glyphs.vertical} `)
  const pieces = items.map((item) => renderMeta(item.label, item.value))
  return wrapText(pieces.join(divider), innerWidth)
}

function printPanelHeader(anime: AnimeDetail, width: number, innerWidth: number) {
  console.log(boxedLine(uiText.accent(truncate(anime.title, innerWidth)), width, true))

  if (anime.titleAlt) {
    console.log(boxedLine(uiText.muted(truncate(anime.titleAlt, innerWidth)), width, true))
  }
}

function animeMetadata(anime: AnimeDetail): StatusItem[] {
  const genres = anime.genres && anime.genres.length > 0 ? anime.genres.join(', ') : undefined
  return [
    { label: 'Tập', value: anime.episodeCount },
    { label: 'Năm', value: anime.year && anime.year > 1900 ? anime.year : undefined },
    { label: 'Trạng thái', value: anime.status },
    { label: 'Thể loại', value: genres }
  ]
}

export function printBanner(title?: string, subtitle?: string) {
  const width = terminalWidth(92, 58)
  const version = getVersion()
  const brand = `${uiText.brand('NekoStream')} ${uiText.subtle(`v${version}`)}`
  const heading = title ? uiText.title(title) : uiText.title('Terminal')
  const sub = subtitle ? uiText.subtitle(subtitle) : uiText.subtitle('Fast anime browsing from your terminal')

  console.log('')
  console.log(borderLine(width, glyphs.topLeft, glyphs.topRight, true))
  console.log(boxedLine(`${brand} ${uiText.subtle(glyphs.dot)} ${heading}`, width, true))
  console.log(boxedLine(sub, width))
  console.log(borderLine(width, glyphs.bottomLeft, glyphs.bottomRight))
  console.log('')
}

export function printUpdateNotice(currentVersion: string, latestVersion: string, packageName: string) {
  const width = terminalWidth(86, 62)
  const innerWidth = width - 4
  const title = `${uiText.warning('Cập nhật mới')} ${uiText.danger(currentVersion)} ${uiText.subtle('->')} ${uiText.success(latestVersion)}`
  const command = `npm i -g ${packageName}@latest`

  console.log('')
  console.log(borderLine(width, glyphs.topLeft, glyphs.topRight, true))
  console.log(boxedLine(`${uiText.brand('NekoStream')} ${uiText.subtle(glyphs.dot)} ${title}`, width, true))
  console.log(borderLine(width, glyphs.teeLeft, glyphs.teeRight))
  for (const line of wrapText('Vui lòng cập nhật CLI để tiếp tục sử dụng ứng dụng.', innerWidth)) {
    console.log(boxedLine(uiText.value(line), width))
  }
  console.log(boxedLine(`${uiText.label('Lệnh')} ${uiText.focus(command)}`, width))
  console.log(`${borderLine(width, glyphs.bottomLeft, glyphs.bottomRight)}\n`)
}

export function printStatusStrip(items: StatusItem[]) {
  const width = terminalWidth(92, 58)
  const innerWidth = width - 4

  console.log(borderLine(width, glyphs.topLeft, glyphs.topRight))
  for (const line of renderMetadataLines(items, innerWidth)) {
    console.log(boxedLine(line, width, true))
  }
  console.log(`${borderLine(width, glyphs.bottomLeft, glyphs.bottomRight)}\n`)
}

export function drawAnimeCard(anime: AnimeDetail) {
  const width = terminalWidth(92, 58)
  const innerWidth = width - 4
  const description = cleanDescription(anime.descriptionVi) ||
    cleanDescription(anime.description) ||
    cleanDescription(anime.descriptionEn)

  console.log(borderLine(width, glyphs.topLeft, glyphs.topRight, true))
  printPanelHeader(anime, width, innerWidth)
  console.log(borderLine(width, glyphs.teeLeft, glyphs.teeRight))

  for (const line of renderMetadataLines(animeMetadata(anime), innerWidth)) {
    console.log(boxedLine(line, width))
  }

  if (description) {
    console.log(boxedLine('', width))
    console.log(boxedLine(innerRule('Mô tả', innerWidth), width))
    for (const line of wrapText(description, innerWidth)) {
      console.log(boxedLine(uiText.muted(line), width))
    }
  }

  console.log(`${borderLine(width, glyphs.bottomLeft, glyphs.bottomRight)}\n`)
}

export function drawAnimeInfoCard(anime: AnimeDetail, selectedEpisode?: string) {
  const width = terminalWidth(92, 58)
  const innerWidth = width - 4

  console.log(borderLine(width, glyphs.topLeft, glyphs.topRight, true))
  printPanelHeader(anime, width, innerWidth)
  console.log(borderLine(width, glyphs.teeLeft, glyphs.teeRight))

  for (const line of renderMetadataLines(animeMetadata(anime), innerWidth)) {
    console.log(boxedLine(line, width))
  }

  if (selectedEpisode) {
    console.log(boxedLine('', width))
    for (const line of wrapText(`${renderMeta('Đang chọn', selectedEpisode)}`, innerWidth)) {
      console.log(boxedLine(line, width))
    }
  }

  console.log(`${borderLine(width, glyphs.bottomLeft, glyphs.bottomRight)}\n`)
}

export function printHint(message: string) {
  console.log(uiText.muted(message))
}

export function printEmpty(message: string) {
  console.log(uiText.warning(message))
}

export function printSuccess(message: string) {
  console.log(uiText.success(message))
}

export function printError(message: string) {
  console.log(uiText.danger(message))
}
