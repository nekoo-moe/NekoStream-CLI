import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import ora from 'ora'
import prompts from '../prompts-wrapper'
import { clearScreen, printUpdateNotice } from '../ui'

const NPM_PACKAGE_NAME = 'nekostream'
const REGISTRY_TIMEOUT_MS = 2000

function readCurrentVersion(): string | null {
  try {
    // When compiled, this module lives in dist/cli, so package.json sits two
    // levels up rather than beside the source.
    const compiled = /dist([\\/]cli)?[\\/]?$/.test(__dirname)
    const basePath = compiled ? path.join(__dirname, '..', '..') : path.join(__dirname, '..')
    const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'package.json'), 'utf-8'))
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { version?: unknown }
    return typeof data.version === 'string' ? data.version : null
  } catch {
    // Offline or slow registry must never block startup.
    return null
  }
}

function runUpdate(): void {
  const installCommand = `npm i -g ${NPM_PACKAGE_NAME}@latest`
  const spinner = ora(`Đang cập nhật (${installCommand})...`).start()
  try {
    execSync(installCommand, { stdio: 'ignore' })
    spinner.succeed(
      chalk.green('Đã cập nhật thành công! Vui lòng chạy lại lệnh để sử dụng bản mới.')
    )
  } catch {
    spinner.fail(chalk.red(`Cập nhật thất bại. Vui lòng chạy thủ công: ${installCommand}`))
  }
}

/**
 * Compare the installed version against the registry and offer to upgrade.
 * The CLI is version-gated: when an update exists the process exits either way,
 * so the user always runs a current build.
 */
export async function checkUpdate(): Promise<void> {
  const currentVersion = readCurrentVersion()
  if (!currentVersion) return

  const latestVersion = await fetchLatestVersion()
  if (!latestVersion || latestVersion === currentVersion) return

  clearScreen()
  printUpdateNotice(currentVersion, latestVersion, NPM_PACKAGE_NAME)

  const { update } = await prompts<'update', boolean>({
    type: 'confirm',
    name: 'update',
    message: 'Bạn có muốn tự động cập nhật ngay bây giờ?',
    initial: true,
  })

  if (update) {
    runUpdate()
  } else {
    console.log(
      chalk.red(`\nVui lòng chạy \`npm i -g ${NPM_PACKAGE_NAME}@latest\` để cập nhật thủ công.`)
    )
  }

  process.exit(0)
}
