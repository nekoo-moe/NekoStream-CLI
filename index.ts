import chalk from 'chalk'
import { clearDiscordPresence } from './discord'
import { runApplication } from './cli/application'
import { clearScreen } from './ui'

function shutdown(): void {
  clearScreen()
  clearDiscordPresence()
  console.log(chalk.magenta('\nCảm ơn bạn đã dùng NekoStream CLI.\n'))
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})

runApplication().catch((error: unknown) => {
  console.error(chalk.red('Lỗi nghiêm trọng:'), error)
  process.exitCode = 1
})
