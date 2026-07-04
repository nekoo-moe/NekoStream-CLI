const ANSI_PATTERN = /\x1B\[[0-9;]*[a-zA-Z]/g

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  )
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    )
  )
}

function charWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0
  if (codePoint === 0) return 0
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0
  if (isCombiningCodePoint(codePoint)) return 0
  return isFullWidthCodePoint(codePoint) ? 2 : 1
}

export function visibleLength(value: string): number {
  return [...stripAnsi(value)].reduce((total, char) => total + charWidth(char), 0)
}

export function terminalWidth(max = 92, min = 56): number {
  const width = process.stdout.columns || 80
  return Math.max(min, Math.min(max, width - 4))
}

export function padRight(value: string, width: number): string {
  const length = visibleLength(value)
  if (length >= width) return value
  return value + ' '.repeat(width - length)
}

export function truncate(value: string, maxLength: number): string {
  if (maxLength <= 3) return value.slice(0, maxLength)
  if (visibleLength(value) <= maxLength) return value
  const plain = stripAnsi(value)
  let output = ''
  let width = 0

  for (const char of plain) {
    const nextWidth = charWidth(char)
    if (width + nextWidth > maxLength - 3) break
    output += char
    width += nextWidth
  }

  return output.trimEnd() + '...'
}

export function cleanInline(value?: string | number | null): string {
  if (value === undefined || value === null || value === '') return '??'
  return String(value).replace(/\s+/g, ' ').trim()
}

export function cleanDescription(value?: string | null): string {
  if (!value) return ''
  return value
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function wrapText(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (visibleLength(word) > width) {
      if (current) {
        lines.push(current)
        current = ''
      }
      lines.push(truncate(word, width))
      continue
    }

    const candidate = current ? `${current} ${word}` : word
    if (visibleLength(candidate) > width && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }

  if (current) lines.push(current)
  return lines
}
