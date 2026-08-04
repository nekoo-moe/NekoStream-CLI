import chalk from 'chalk'
import prompts, { type PromptChoice } from '../../prompts-wrapper'
import { providers } from '../../providers'
import {
  PROVIDER_IDS,
  type DomainAction,
  type ProviderId,
  type SettingsAction,
} from '../../provider-types'
import { clearScreen, printBanner, printSuccess } from '../../ui'
import { loadSettings, saveSettings } from '../../storage'
import { setBrowsingPresence, toggleDiscordPresence } from '../../discord'
import { debugLog, debugTrace } from '../../logger'
import { CONFIRM_DELAY_MS, formatToggle, sleep } from '../feedback'

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

async function showDomainMenu(): Promise<void> {
  while (true) {
    clearScreen()
    printBanner('Domain provider', 'Đổi domain khi provider bị chặn hoặc đổi địa chỉ')

    const currentDomains = loadSettings().providerDomains || {}

    const choices: PromptChoice<DomainAction>[] = PROVIDER_IDS.map((name) => {
      const custom = currentDomains[name]
      const domain = custom || providers[name].baseUrl
      return {
        title: `${chalk.bold(name)}: ${custom ? chalk.green(domain) : chalk.gray(domain)}`,
        value: name,
      }
    })

    choices.push({ title: chalk.red('Đặt lại tất cả domain mặc định'), value: 'reset' })
    choices.push({ title: chalk.gray('Quay lại Cài đặt'), value: 'back' })

    const { selectedProvider } = await prompts<'selectedProvider', DomainAction>({
      type: 'select',
      name: 'selectedProvider',
      message: 'Chọn provider cần cấu hình (Esc: quay lại)',
      choices,
    })

    if (!selectedProvider || selectedProvider === 'back') return

    if (selectedProvider === 'reset') {
      saveSettings({ providerDomains: {} })
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
