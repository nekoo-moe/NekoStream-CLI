import chalk from 'chalk'

export const palette = {
  primary: '#5eead4',
  accent: '#f472b6',
  blue: '#60a5fa',
  violet: '#a78bfa',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#fb7185',
  muted: '#94a3b8',
  border: '#334155',
  text: '#f8fafc'
}

export const uiText = {
  brand: chalk.hex(palette.primary).bold,
  title: chalk.hex(palette.text).bold,
  subtitle: chalk.hex(palette.muted),
  section: chalk.hex(palette.accent).bold,
  label: chalk.hex(palette.blue),
  value: chalk.white,
  muted: chalk.hex(palette.muted),
  success: chalk.hex(palette.success),
  warning: chalk.hex(palette.warning),
  danger: chalk.hex(palette.danger),
  border: chalk.hex(palette.border),
  accent: chalk.hex(palette.accent)
}

export const glyphs = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeLeft: '├',
  teeRight: '┤',
  dot: '•',
  pointer: '›',
  back: '←',
  play: '▶',
  next: '↓',
  prev: '↑'
}
