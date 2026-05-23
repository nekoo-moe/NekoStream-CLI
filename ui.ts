import chalk from 'chalk'
import { loadSettings } from './storage'
import type { AnimeDetail } from './scrapers/base'
import * as fs from 'fs'
import * as path from 'path'

export function clearScreen() {
  try {
    const settings = loadSettings();
    if (settings.developerMode) return;
  } catch (e) {} // Fallback in case storage isn't ready yet

  // \x1B[2J clears visible screen, \x1B[3J clears scrollback buffer, \x1B[H moves cursor to top left
  process.stdout.write('\x1B[2J\x1B[3J\x1B[H')
  if (process.stdin.isTTY) {
    try {
      // Force Node.js to re-apply the OS console mode API (fixes Playwright/Chromium corrupting the console on Windows)
      process.stdin.setRawMode(false)
      process.stdin.setRawMode(true)
    } catch (e) {}
  }
}

function interpolateColor(c1: number[], c2: number[], factor: number) {
  const result = c1.slice();
  for (let i = 0; i < 3; i++) {
    result[i] = Math.round(result[i] + factor * (c2[i] - c1[i]));
  }
  return result;
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
}

function applyGradient(text: string, startHex: string, endHex: string) {
  const c1 = hexToRgb(startHex);
  const c2 = hexToRgb(endHex);
  let output = '';
  for (let i = 0; i < text.length; i++) {
    const factor = i / Math.max(text.length - 1, 1);
    const color = interpolateColor(c1, c2, factor);
    output += chalk.rgb(color[0], color[1], color[2])(text[i]);
  }
  return output;
}

export function printBanner(title?: string, subtitle?: string) {
  console.log('\n');
  
  let version = 'unknown'
  try {
    const isCompiled = __dirname.endsWith('dist') || __dirname.endsWith('dist\\') || __dirname.endsWith('dist/')
    const basePath = isCompiled ? path.join(__dirname, '..') : __dirname
    const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'package.json'), 'utf-8'))
    version = pkg.version
  } catch(e) {}

  const bracket = [
    " ▝▜▄   ",
    "   ▝▜▄ ",
    "  ▗▟▀  ",
    " ▝▀    "
  ];
  
  const color1 = hexToRgb('#4285F4');
  const color2 = hexToRgb('#DB2777');
  
  const coloredBracket = bracket.map((line, i) => {
    const factor = i / 3;
    const color = interpolateColor(color1, color2, factor);
    return chalk.rgb(color[0], color[1], color[2]).bold(line);
  });

  console.log(`${coloredBracket[0]}  ${chalk.bold.white(`NekoStream CLI v${version}`)}`);
  console.log(`${coloredBracket[1]}`);
  console.log(`${coloredBracket[2]}  ${chalk.cyan(title ? title : '')}`);
  if (subtitle) {
    console.log(`${coloredBracket[3]}  ${chalk.gray(subtitle)}`);
  } else {
    console.log(`${coloredBracket[3]}`);
  }
  console.log('');
}

function truncate(str: string, maxLength: number) {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if ((currentLine + word).length > maxWidth) {
      if (currentLine) lines.push(currentLine.trim())
      currentLine = word + ' '
    } else {
      currentLine += word + ' '
    }
  }
  if (currentLine) lines.push(currentLine.trim())
  return lines
}

export function drawAnimeCard(anime: AnimeDetail) {
  const width = 76
  const pad = (str: string, len: number) => {
    const visibleLength = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').length
    if (visibleLength >= len) return str
    return str + ' '.repeat(len - visibleLength)
  }

  // Use a gradient for the border? Or just magenta/cyan. Let's use a solid color from the theme.
  const borderColor = chalk.hex('#9b59b6') // Purple border
  const titleColor = chalk.hex('#FF69B4').bold // Pink title
  const labelColor = chalk.hex('#00bcd4') // Cyan labels
  const valueColor = chalk.white

  console.log(borderColor(' ╭' + '─'.repeat(width) + '╮'))
  
  const title = truncate(anime.title, width - 4)
  console.log(borderColor(' │ ') + pad(titleColor(title), width - 2) + borderColor(' │'))
  if (anime.titleAlt) {
    console.log(borderColor(' │ ') + pad(chalk.gray(truncate(anime.titleAlt, width - 4)), width - 2) + borderColor(' │'))
  }
  
  console.log(borderColor(' ├' + '─'.repeat(width) + '┤'))

  const row1 = []
  row1.push(labelColor(`Số tập: `) + valueColor(anime.episodeCount || '??'))
  row1.push(labelColor(`Năm SX: `) + valueColor(anime.year && anime.year > 1900 ? anime.year : '??'))
  
  const genresStr = anime.genres && anime.genres.length > 0 ? anime.genres.slice(0, 2).join(', ') : '??'
  row1.push(chalk.hex('#2980b9')(`Thể loại: `) + valueColor(genresStr))

  console.log(borderColor(' │ ') + pad(row1.join(chalk.gray(' | ')), width - 2) + borderColor(' │'))
  
  const row2 = []
  row2.push(labelColor(`Đạo diễn: `) + valueColor((anime as any).director || '??'))
  row2.push(labelColor(`Studio: `) + valueColor((anime as any).studio || '??'))
  row2.push(labelColor(`Season: `) + valueColor((anime as any).season || '??'))
  
  console.log(borderColor(' │ ') + pad(row2.join(chalk.gray(' | ')), width - 2) + borderColor(' │'))

  if (anime.description) {
    console.log(borderColor(' │ ') + pad('', width - 2) + borderColor(' │'))
    // Clean HTML from description
    const cleanDesc = anime.description.replace(/<[^>]*>?/gm, '')
    const descLines = wrapText(cleanDesc, width - 4)
    for (let i = 0; i < Math.min(descLines.length, 6); i++) {
      let line = descLines[i]
      if (i === 5 && descLines.length > 6) line = truncate(line, width - 7) + '...'
      console.log(borderColor(' │ ') + pad(chalk.gray(line), width - 2) + borderColor(' │'))
    }
  }

  console.log(borderColor(' ╰' + '─'.repeat(width) + '╯\n'))
}
