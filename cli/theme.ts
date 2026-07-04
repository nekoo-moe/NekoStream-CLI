import chalk from 'chalk'

export const palette = {
  primary: '#58a6ff',
  accent: '#db61a2',
  cyan: '#39c5cf',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  text: '#f0f6fc',
  muted: '#8b949e',
  subtle: '#6e7681',
  border: '#30363d',
  borderActive: '#3b82f6'
}

export const uiText = {
  brand: chalk.hex(palette.primary).bold,
  title: chalk.hex(palette.text).bold,
  subtitle: chalk.hex(palette.muted),
  section: chalk.hex(palette.accent).bold,
  label: chalk.hex(palette.primary).bold,
  value: chalk.white,
  quietValue: chalk.hex(palette.text),
  muted: chalk.hex(palette.muted),
  subtle: chalk.hex(palette.subtle),
  success: chalk.hex(palette.green),
  warning: chalk.hex(palette.yellow),
  danger: chalk.hex(palette.red),
  border: chalk.hex(palette.border),
  activeBorder: chalk.hex(palette.borderActive),
  accent: chalk.hex(palette.accent),
  focus: chalk.hex(palette.cyan).bold
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
  cross: '┼',
  dot: '·',
  pointer: '›',
  back: '←',
  play: '▶',
  next: '↓',
  prev: '↑'
}
