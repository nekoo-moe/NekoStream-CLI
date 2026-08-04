import chalk from 'chalk'
import ora from 'ora'
import prompts, { type PromptChoice } from '../../prompts-wrapper'
import {
  PROVIDER_IDS,
  type DomainAction,
  type ProviderId,
  type SettingsAction,
} from '../../provider-types'
import { clearScreen, printBanner, printHint, printSuccess } from '../../ui'
import { loadSettings, saveSettings } from '../../storage'
import {
  clearDomainCache,
  getProviderDomainInfo,
  resolveAllDomains,
  type ResolvedDomain,
} from '../../scrapers/domain-resolver'
import { setBrowsingPresence, toggleDiscordPresence } from '../../discord'
import { debugLog, debugTrace } from '../../logger'
import { CONFIRM_DELAY_MS, NOTICE_DELAY_MS, formatToggle, sleep } from '../feedback'

const QUALITY_OPTIONS = ['1080p', '720p', '480p', 'auto'] as const

async function chooseDefaultProvider(): Promise<void> {
  const { newProvider } = await prompts<'newProvider', ProviderId>({
    type: 'select',
    name: 'newProvider',
    message: 'Chọn provider mặc định',
    choices: PROVIDER_IDS.map((name) => ({ title: name, value: name })),
  })
  if (newProvider) saveSettings({ defaultProvider: newProvider })
}

async function chooseDefaultQuality(): Promise<void> {
  const { newQuality } = await prompts<'newQuality', string>({
    type: 'select',
    name: 'newQuality',
    message: 'Chọn chất lượng mặc định',
    choices: QUALITY_OPTIONS.map((quality) => ({ title: quality, value: quality })),
  })
  if (newQuality) saveSettings({ defaultQuality: newQuality })
}

async function toggleDebugMode(currentlyEnabled: boolean): Promise<void> {
  const enabled = !currentlyEnabled
  saveSettings({ debugMode: enabled, developerMode: enabled })
  debugLog('debug mode changed', enabled ? 'enabled' : 'disabled')
  printSuccess(
    enabled
      ? 'Debug mode đã bật: log debug/trace sẽ hiển thị và CLI sẽ không tự dọn màn hình.'
      : 'Debug mode đã tắt: CLI sẽ dọn màn hình như bình thường.'
  )
  await sleep(CONFIRM_DELAY_MS)
}

async function editProviderDomain(provider: ProviderId, currentDomain?: string): Promise<void> {
  const { newDomain } = await prompts<'newDomain', string>({
    type: 'text',
    name: 'newDomain',
    message: `Nhập domain mới cho ${provider} (ví dụ animevietsub.tv). Để trống để đặt lại:`,
    initial: currentDomain || '',
  })

  if (newDomain === undefined) return

  const domains = { ...loadSettings().providerDomains }
  if (newDomain.trim() === '') {
    delete domains[provider]
  } else {
    domains[provider] = newDomain.trim()
  }
  saveSettings({ providerDomains: domains })
}

/** Short local timestamp for the "verified at" hint; falls back to nothing. */
function formatVerifiedAt(iso?: string): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Render one provider's domain with its provenance.
 *
 * Showing the source is the visible half of separating manual overrides from
 * probe results: the old menu printed the same green value whether the user had
 * typed it or the retry path had silently written it into settings.
 */
function describeDomain(info: ResolvedDomain): string {
  switch (info.source) {
    case 'manual':
      return `${chalk.green(info.baseUrl)} ${chalk.gray('(thủ công)')}`
    case 'verified': {
      const at = formatVerifiedAt(info.verifiedAt)
      return `${chalk.cyan(info.baseUrl)} ${chalk.gray(at ? `(tự dò ${at})` : '(tự dò)')}`
    }
    case 'seed':
      return `${chalk.gray(info.baseUrl)} ${chalk.gray('(mặc định)')}`
  }
}

/** Re-run the prober on demand, ignoring whatever is cached. */
async function redetectDomains(): Promise<void> {
  const settings = loadSettings()
  const pinned = PROVIDER_IDS.filter((name) => settings.providerDomains?.[name]?.trim())

  // Wiping the cache first is what makes this a real re-detect rather than a
  // re-confirm: otherwise the fast path just re-verifies the cached domain and
  // never reconsiders an earlier TLD that has since come back.
  clearDomainCache()

  const spinner = ora('Đang dò lại domain provider...').start()
  const outcomes = await resolveAllDomains()
  spinner.stop()

  const found = outcomes.filter((outcome) => outcome.status === 'ok')
  const failed = outcomes.filter((outcome) => outcome.status === 'failed')

  for (const outcome of found) {
    printSuccess(`${outcome.provider}: ${outcome.baseUrl}`)
  }
  for (const outcome of failed) {
    printHint(
      `${outcome.provider}: không tìm được domain hợp lệ (đã thử ${outcome.tried}). Giữ ${outcome.baseUrl}.`
    )
  }
  if (pinned.length > 0) {
    printHint(
      `Bỏ qua ${pinned.join(', ')} vì đang đặt domain thủ công — xoá domain thủ công để cho phép tự dò.`
    )
  }

  await sleep(NOTICE_DELAY_MS)
}

async function showDomainMenu(): Promise<void> {
  while (true) {
    clearScreen()
    printBanner('Domain provider', 'Đổi domain khi provider bị chặn hoặc đổi địa chỉ')

    const currentDomains = loadSettings().providerDomains || {}

    const choices: PromptChoice<DomainAction>[] = PROVIDER_IDS.map((name) => ({
      title: `${chalk.bold(name)}: ${describeDomain(getProviderDomainInfo(name))}`,
      value: name,
    }))

    choices.push({ title: chalk.cyan('Dò lại domain ngay'), value: 'redetect' })
    choices.push({ title: chalk.red('Đặt lại tất cả domain mặc định'), value: 'reset' })
    choices.push({ title: chalk.gray('Quay lại Cài đặt'), value: 'back' })

    const { selectedProvider } = await prompts<'selectedProvider', DomainAction>({
      type: 'select',
      name: 'selectedProvider',
      message: 'Chọn provider cần cấu hình (Esc: quay lại)',
      choices,
    })

    if (!selectedProvider || selectedProvider === 'back') return

    if (selectedProvider === 'redetect') {
      await redetectDomains()
      continue
    }

    if (selectedProvider === 'reset') {
      // Clear both stores, otherwise "reset to default" would leave the last
      // probed domain in place and look like it had done nothing.
      saveSettings({ providerDomains: {} })
      clearDomainCache()
      printSuccess('Đã đặt lại tất cả domain về mặc định.')
      await sleep(CONFIRM_DELAY_MS)
      continue
    }

    await editProviderDomain(selectedProvider, currentDomains[selectedProvider])
  }
}

/** Client configuration: provider, quality, playback, presence, and domains. */
export async function showSettingsMenu(): Promise<void> {
  setBrowsingPresence('Đang cài đặt Client', undefined, 'Cài đặt')

  while (true) {
    clearScreen()
    printBanner('Cài đặt', 'Tùy chỉnh trải nghiệm xem và nhà cung cấp')

    const settings = loadSettings()
    const debugEnabled = Boolean(settings.debugMode || settings.developerMode)

    const { action } = await prompts<'action', SettingsAction>({
      type: 'select',
      name: 'action',
      message: 'Cấu hình hệ thống (Esc: Thoát)',
      choices: [
        { separator: 'CẤU HÌNH' },
        {
          title: `Provider mặc định: ${chalk.green(settings.defaultProvider)}`,
          value: 'provider',
        },
        {
          title: `Chất lượng mặc định: ${chalk.green(settings.defaultQuality)}`,
          value: 'quality',
        },
        { title: `Tự phát tập tiếp theo: ${formatToggle(settings.autoPlayNext)}`, value: 'autoplay' },
        { title: `Discord RPC: ${formatToggle(settings.discordRpcEnabled)}`, value: 'discord' },
        { title: `Debug mode: ${formatToggle(debugEnabled)}`, value: 'debug' },
        { title: 'Cấu hình domain provider', value: 'domains' },
        { separator: 'TRỞ VỀ' },
        { title: chalk.gray('Quay lại Home'), value: 'back' },
      ],
    })
    debugTrace('settings action selected', action)

    if (!action || action === 'back') return

    switch (action) {
      case 'provider':
        await chooseDefaultProvider()
        break
      case 'quality':
        await chooseDefaultQuality()
        break
      case 'autoplay':
        saveSettings({ autoPlayNext: !settings.autoPlayNext })
        break
      case 'discord': {
        const enabled = !settings.discordRpcEnabled
        saveSettings({ discordRpcEnabled: enabled })
        toggleDiscordPresence(enabled)
        break
      }
      case 'debug':
        await toggleDebugMode(debugEnabled)
        break
      case 'domains':
        await showDomainMenu()
        break
    }
  }
}
