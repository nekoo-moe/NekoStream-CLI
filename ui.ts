import chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'
import { loadSettings } from './storage'
import type { AnimeDetail } from './scrapers/base'
import { glyphs, palette, uiText } from './cli/theme'
import { cleanDescription, cleanInline, padRight, terminalWidth, truncate, wrapText } from './cli/text'

export function clearScreen() {
  try {
    const settings = loadSettings()
    if (settings.developerMode && process.env.NEKOSTREAM_PRESERVE_LOGS === '1') return
  } catch {
    // Storage may not be initialized during early startup.
  }

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

function borderLine(width: number, left: string, right: string): string {
  return uiText.border(`${left}${glyphs.horizontal.repeat(width - 2)}${right}`)
}

function boxedLine(content: string, width: number): string {
  return `${uiText.border(glyphs.vertical)} ${padRight(content, width - 4)} ${uiText.border(glyphs.vertical)}`
}

export function printBanner(title?: string, subtitle?: string) {
  const width = terminalWidth(86, 54)
  const version = getVersion()
  const brand = `${uiText.brand('NekoStream')} ${uiText.muted(`v${version}`)}`
  const heading = title ? uiText.title(title) : uiText.title('CLI')
  const sub = subtitle ? uiText.subtitle(subtitle) : uiText.subtitle('Fast anime browsing from your terminal')

  console.log('')
  console.log(borderLine(width, glyphs.topLeft, glyphs.topRight))
  console.log(boxedLine(`${brand} ${uiText.muted(glyphs.dot)} ${heading}`, width))
  console.log(boxedLine(sub, width))
  console.log(borderLine(width, glyphs.bottomLeft, glyphs.bottomRight))
  console.log('')
}

function renderMeta(label: string, value?: string | number | null) {
  return `${uiText.label(label)} ${uiText.value(cleanInline(value))}`
}

export function drawAnimeCard(anime: AnimeDetail) {
  const width = terminalWidth(88, 56)
  const innerWidth = width - 4
  const description = cleanDescription(anime.descriptionVi) ||
    cleanDescription(anime.description) ||
    cleanDescription(anime.descriptionEn)
  const genres = anime.genres && anime.genres.length > 0 ? anime.genres.join(', ') : undefined
  const metadata = [
    renderMeta('Tập:', anime.episodeCount),
    renderMeta('Năm:', anime.year && anime.year > 1900 ? anime.year : undefined),
    renderMeta('Trạng thái:', anime.status),
    renderMeta('Thể loại:', genres)
  ]

  console.log(borderLine(width, glyphs.topLeft, glyphs.topRight))
  console.log(boxedLine(uiText.accent(truncate(anime.title, innerWidth)), width))

  if (anime.titleAlt) {
    console.log(boxedLine(uiText.muted(truncate(anime.titleAlt, innerWidth)), width))
  }

  console.log(borderLine(width, glyphs.teeLeft, glyphs.teeRight))

  for (const line of wrapText(metadata.join(chalk.hex(palette.border)('  |  ')), innerWidth)) {
    console.log(boxedLine(line, width))
  }

  if (description) {
    console.log(boxedLine('', width))
    const lines = wrapText(description, innerWidth)
    lines.forEach((line) => {
      console.log(boxedLine(uiText.muted(line), width))
    })
  }

  console.log(`${borderLine(width, glyphs.bottomLeft, glyphs.bottomRight)}\n`)
}

export function drawAnimeInfoCard(anime: AnimeDetail, selectedEpisode?: string) {
  const width = terminalWidth(88, 56)
  const innerWidth = width - 4
  const genres = anime.genres && anime.genres.length > 0 ? anime.genres.join(', ') : undefined
  const metadata = [
    renderMeta('Tập:', anime.episodeCount),
    renderMeta('Năm:', anime.year && anime.year > 1900 ? anime.year : undefined),
    renderMeta('Trạng thái:', anime.status),
    renderMeta('Thể loại:', genres)
  ]

  console.log(borderLine(width, glyphs.topLeft, glyphs.topRight))
  console.log(boxedLine(uiText.accent(truncate(anime.title, innerWidth)), width))

  if (anime.titleAlt) {
    console.log(boxedLine(uiText.muted(truncate(anime.titleAlt, innerWidth)), width))
  }

  console.log(borderLine(width, glyphs.teeLeft, glyphs.teeRight))

  for (const line of wrapText(metadata.join(chalk.hex(palette.border)('  |  ')), innerWidth)) {
    console.log(boxedLine(line, width))
  }

  if (selectedEpisode) {
    console.log(boxedLine(`${uiText.label('Đang chọn:')} ${uiText.value(selectedEpisode)}`, width))
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
