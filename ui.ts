import chalk from 'chalk'
import type { AnimeDetail } from './scrapers/base'

export function clearScreen() {
  process.stdout.write('\x1Bc')
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

  console.log('\n');
  console.log(`${coloredBracket[0]}  ${chalk.bold.white('NekoStream CLI v1.0.0')}`);
  console.log(`${coloredBracket[1]}`);
  
  const line2 = title ? title : '';
  console.log(`${coloredBracket[2]}  ${line2}`);
  
  const line3 = subtitle ? `${chalk.gray(subtitle)}` : '';
  console.log(`${coloredBracket[3]}  ${line3}`);
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
  const width = 64
  const pad = (str: string, len: number) => {
    const visibleLength = str.replace(/\x1B\[\d+m/g, '').length
    if (visibleLength >= len) return str
    return str + ' '.repeat(len - visibleLength)
  }

  console.log(chalk.cyan(' ╭' + '─'.repeat(width) + '╮'))
  
  const title = truncate(anime.title, width - 4)
  console.log(chalk.cyan(' │ ') + pad(chalk.bold.white(title), width - 2) + chalk.cyan(' │'))
  if (anime.titleAlt) {
    console.log(chalk.cyan(' │ ') + pad(chalk.gray(truncate(anime.titleAlt, width - 4)), width - 2) + chalk.cyan(' │'))
  }
  
  console.log(chalk.cyan(' ├' + '─'.repeat(width) + '┤'))

  const row1 = []
  row1.push(chalk.green(`Số tập: `) + chalk.white(anime.episodeCount || '??'))
  row1.push(chalk.green(`Năm SX: `) + chalk.white(anime.year && anime.year > 1900 ? anime.year : '??'))
  
  const genresStr = anime.genres && anime.genres.length > 0 ? anime.genres.slice(0, 2).join(', ') : '??'
  row1.push(chalk.magenta(`Thể loại: `) + chalk.white(genresStr))

  console.log(chalk.cyan(' │ ') + pad(row1.join(chalk.gray(' | ')), width - 2) + chalk.cyan(' │'))
  
  const row2 = []
  row2.push(chalk.green(`Đạo diễn: `) + chalk.white((anime as any).director || '??'))
  row2.push(chalk.green(`Studio: `) + chalk.white((anime as any).studio || '??'))
  row2.push(chalk.green(`Season: `) + chalk.white((anime as any).season || '??'))
  
  console.log(chalk.cyan(' │ ') + pad(row2.join(chalk.gray(' | ')), width - 2) + chalk.cyan(' │'))

  if (anime.description) {
    console.log(chalk.cyan(' │ ') + pad('', width - 2) + chalk.cyan(' │'))
    // Clean HTML from description
    const cleanDesc = anime.description.replace(/<[^>]*>?/gm, '')
    const descLines = wrapText(cleanDesc, width - 4)
    for (let i = 0; i < Math.min(descLines.length, 6); i++) {
      let line = descLines[i]
      if (i === 5 && descLines.length > 6) line = truncate(line, width - 7) + '...'
      console.log(chalk.cyan(' │ ') + pad(chalk.gray(line), width - 2) + chalk.cyan(' │'))
    }
  }

  console.log(chalk.cyan(' ╰' + '─'.repeat(width) + '╯\n'))
}
