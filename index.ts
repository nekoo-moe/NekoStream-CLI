import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import prompts from './prompts-wrapper'
import chalk from 'chalk'
import ora from 'ora'
import { providers, getProvider } from './providers'
import { launchPlayer } from './player'
import { clearScreen, printBanner, drawAnimeCard } from './ui'
import { loadSettings, saveSettings, loadHistory, saveHistoryEntry, clearHistory } from './storage'
import { initDiscord, toggleDiscordPresence, setBrowsingPresence, setWatchingPresence, clearDiscordPresence } from './discord'
import type { AnimeDetail, AnimeSearchResult } from './scrapers/base'
import {
  getAuthStatus,
  logoutProvider,
  loginAnimeVietsubInteractive,
  loginAnime47Interactive,
  fetchAllAnimeVietsubList,
  fetchAnimeVietsubNotifications,
  fetchAllAnime47List,
  fetchAnime47Notifications,
  type UserDataItem
} from './scrapers/auth-service'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function showSettingsMenu() {
  setBrowsingPresence('Đang cài đặt Client', undefined, 'Cài đặt')
  while (true) {
    clearScreen()
    printBanner('Settings', 'Configure your default preferences')

    const settings = loadSettings()

    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'Cấu hình hệ thống (Esc: Thoát)',
      choices: [
        { separator: 'CẤU HÌNH' },
        { title: `Default Provider: ${chalk.green(settings.defaultProvider)}`, value: 'provider' },
        { title: `Default Quality: ${chalk.green(settings.defaultQuality)}`, value: 'quality' },
        { title: `Auto-Play Next: ${settings.autoPlayNext ? chalk.green('ON') : chalk.red('OFF')}`, value: 'autoplay' },
        { title: `Discord RPC: ${settings.discordRpcEnabled ? chalk.green('ON') : chalk.red('OFF')}`, value: 'discord' },
        { title: `Developer Mode (Preserve Logs): ${settings.developerMode ? chalk.green('ON') : chalk.red('OFF')}`, value: 'devmode' },
        { title: `Configure Domains`, value: 'domains' },
        { separator: 'TRỞ VỀ' },
        { title: chalk.gray('🔙 Back to Home'), value: 'back' }
      ]
    })

    if (!action || action === 'back') break

    if (action === 'provider') {
      const { newProvider } = await prompts({
        type: 'select',
        name: 'newProvider',
        message: 'Select Default Provider',
        choices: Object.keys(providers).map((name, idx) => ({ title: `[${idx + 1}] ${name}`, value: name }))
      })
      if (newProvider) saveSettings({ defaultProvider: newProvider })
    }

    if (action === 'quality') {
      const { newQuality } = await prompts({
        type: 'select',
        name: 'newQuality',
        message: 'Select Default Quality',
        choices: ['1080p', '720p', '480p', 'auto'].map((q, idx) => ({ title: `[${idx + 1}] ${q}`, value: q }))
      })
      if (newQuality) saveSettings({ defaultQuality: newQuality })
    }

    if (action === 'autoplay') {
      saveSettings({ autoPlayNext: !settings.autoPlayNext })
    }

    if (action === 'discord') {
      const nextVal = !settings.discordRpcEnabled
      saveSettings({ discordRpcEnabled: nextVal })
      toggleDiscordPresence(nextVal)
    }

    if (action === 'devmode') {
      saveSettings({ developerMode: !settings.developerMode })
    }

    if (action === 'domains') {
      while (true) {
        clearScreen()
        printBanner('Provider Domains', 'Set custom domains to bypass blocks')

        const currentDomains = loadSettings().providerDomains || {}

        const domainChoices = Object.keys(providers).map((name, idx) => {
          const defaultDomain = providers[name].baseUrl
          const currentDomain = currentDomains[name] || defaultDomain
          const isCustom = !!currentDomains[name]

          return {
            title: `[${idx + 1}] ${chalk.bold(name)}: ${isCustom ? chalk.green(currentDomain) : chalk.gray(currentDomain)}`,
            value: name
          }
        })

        domainChoices.push({ title: chalk.red('Reset All to Default'), value: 'reset' } as any)
        domainChoices.push({ title: chalk.gray('Back to Settings'), value: 'back' } as any)

        const { selectedProvider } = await prompts({
          type: 'select',
          name: 'selectedProvider',
          message: 'Select a provider to configure (Press Esc to go back)',
          choices: domainChoices
        })

        if (!selectedProvider || selectedProvider === 'back') break

        if (selectedProvider === 'reset') {
          saveSettings({ providerDomains: {} })
          console.log(chalk.green('All domains reset to default.'))
          await sleep(1000)
          continue
        }

        const { newDomain } = await prompts({
          type: 'text',
          name: 'newDomain',
          message: `Enter new domain for ${selectedProvider} (e.g. animevietsub.tv) - Leave empty to reset:`,
          initial: currentDomains[selectedProvider] || ''
        })

        if (newDomain !== undefined) {
          const newDomains = { ...loadSettings().providerDomains }
          if (newDomain.trim() === '') {
            delete newDomains[selectedProvider]
          } else {
            newDomains[selectedProvider] = newDomain.trim()
          }
          saveSettings({ providerDomains: newDomains })
        }
      }
    }
  }
}

async function showHistoryMenu() {
  setBrowsingPresence('Đang xem Lịch Sử', undefined, 'Lịch sử Toàn cục')
  while (true) {
    clearScreen()
    printBanner('Continue Watching', 'Resume from where you left off')

    const history = loadHistory()

    if (history.length === 0) {
      console.log(chalk.yellow('Your history is empty.'))
      await sleep(2000)
      break
    }

    const choices: any[] = [{ separator: 'LỊCH SỬ LOCAL' }]
    history.forEach((item, index) => {
      choices.push({
        title: `[${index + 1}] ${chalk.magenta(item.provider)} | ${chalk.bold.white(item.animeTitle)} - ${chalk.cyan(item.episodeTitle)}`,
        description: `Watched on: ${new Date(item.timestamp).toLocaleString()}`,
        value: index
      })
    })

    choices.push({ title: chalk.red('Clear History'), description: '', value: -2 as any })
    choices.push({ title: chalk.gray('Back to Home'), description: '', value: -1 as any })

    const { selectedIndex } = await prompts({
      type: 'select',
      name: 'selectedIndex',
      message: 'Select an episode to resume (Press Esc to go back)',
      choices
    })

    if (selectedIndex === undefined || selectedIndex === -1) break

    if (selectedIndex === -2) {
      const { confirm } = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to clear your history?'
      })
      if (confirm) {
        clearHistory()
        console.log(chalk.green('History cleared.'))
        await sleep(1000)
      }
      continue
    }

    const item = history[selectedIndex]
    await openAnimeMenu(item.provider, item.animeId)
  }
}

async function showAnimeList(providerName: string, title: string, list: AnimeSearchResult[]) {
  setBrowsingPresence(`Danh sách: ${title}`, providerName, title)
  while (true) {
    clearScreen()
    printBanner(`Provider: ${providerName.toUpperCase()}`, title.toUpperCase())

    // Fix for prompts Windows bug: Flush any leftover escape sequences or buffered keys 
    // that might corrupt the next prompt's raw mode and cause the ^[[B bug.
    if (process.stdin.isTTY) {
      process.stdin.resume()
      while (process.stdin.read() !== null) { }
    }

    const { animeId } = await prompts({
      type: 'select',
      name: 'animeId',
      message: 'Select an Anime (Press Esc to go back)',
      choices: list.map((anime, idx) => {
        const desc = anime.status || anime.year?.toString() || ''
        const cleanTitle = anime.title.replace(/\r?\n|\r/g, ' ').trim()
        const cleanDesc = desc.replace(/\r?\n|\r/g, ' ').trim()
        return {
          title: `[${idx + 1}] ${cleanTitle}${cleanDesc ? ` - ${cleanDesc}` : ''}`,
          value: anime.id
        }
      })
    })

    if (!animeId) break

    await openAnimeMenu(providerName, animeId)
  }
}

async function openAnimeMenu(providerName: string, animeId: string) {
  setBrowsingPresence(`Đang tải dữ liệu: ${animeId}...`, providerName, 'Tải dữ liệu')
  const provider = getProvider(providerName)

  // Fetch details & episodes
  const epsSpinner = ora('Fetching details and episodes...').start()
  let episodes = []
  let selectedAnime: AnimeDetail | null = null

  try {
    episodes = await provider.getEpisodes(animeId)
    epsSpinner.stop()
  } catch (e) {
    epsSpinner.stop()
    console.error(chalk.red('\nFailed to fetch episodes:'), e)
    await sleep(2000)
    return
  }

  // Detail is non-fatal — 401 on detail page shouldn't block episode viewing
  if (provider.getAnimeDetail) {
    try {
      selectedAnime = await provider.getAnimeDetail(animeId)
    } catch {
      // silently skip — detail unavailable but episodes still work
    }
  }

  if (!episodes || episodes.length === 0) {
    console.log(chalk.yellow('\nNo episodes found.'))
    await sleep(2000)
    return
  }

  // Fallback if no detail is available
  if (!selectedAnime) {
    selectedAnime = {
      id: animeId,
      source: providerName,
      title: episodes.length > 0 && episodes[0].title ? episodes[0].title.split(' - ')[0] : animeId,
      genres: []
    }
  }

  while (true) {
    setBrowsingPresence(`Đang xem thông tin: ${selectedAnime ? selectedAnime.title : animeId}`, providerName, 'Thông tin Phim')
    clearScreen()
    printBanner(`Provider: ${providerName.toUpperCase()}`, selectedAnime ? selectedAnime.title : animeId)
    if (selectedAnime) drawAnimeCard(selectedAnime)

    if (process.stdin.isTTY) {
      process.stdin.resume()
      while (process.stdin.read() !== null) { }
    }

    const episodeChoices: any[] = [{ separator: 'DANH SÁCH TẬP' }]
    episodes.forEach((ep, idx) => {
      const cleanTitle = (ep.title || `Episode ${ep.number}`).replace(/\r?\n|\r/g, ' ').trim()
      episodeChoices.push({
        title: `[${idx + 1}] ▶️ ${cleanTitle}`,
        value: ep
      })
    })

    const { episode } = await prompts({
      type: 'select',
      name: 'episode',
      message: 'Select an Episode (Esc: Thoát)',
      choices: episodeChoices
    })

    if (!episode) break

    while (true) {
      clearScreen()
      printBanner(`Provider: ${providerName.toUpperCase()}`, selectedAnime ? selectedAnime.title : animeId)
      if (selectedAnime) drawAnimeCard(selectedAnime)
      console.log(chalk.blue(`▶️ Selected: `) + chalk.bold.white(episode.title || `Episode ${episode.number}`) + '\n')

      const serversSpinner = ora('Fetching video servers...').start()
      let servers = []
      try {
        const episodeIdentifier = (episode as any).href || episode.id
        servers = await provider.getVideoServers(episodeIdentifier)
        serversSpinner.stop()
      } catch (e) {
        serversSpinner.stop()
        console.error(chalk.red('\nFailed to fetch servers:'), e)
        await sleep(2000)
        break
      }

      if (!servers || servers.length === 0) {
        console.log(chalk.red('\nNo video servers found for this episode.'))
        await sleep(2000)
        break
      }

      const { server } = await prompts({
        type: 'select',
        name: 'server',
        message: 'Select a Server (Press Esc to go back)',
        choices: servers.map((s, idx) => ({
          title: `[${idx + 1}] ${s.name} [${s.quality || 'Auto'}] (${s.type})`,
          value: s
        }))
      })

      if (!server) break

      const streamSpinner = ora('Extracting stream URL...').start()
      let streamInfo = null
      try {
        streamInfo = await provider.extractStreamUrl(server)
        streamSpinner.stop()
      } catch (e) {
        streamSpinner.stop()
        console.error(chalk.red('\nFailed to extract stream:'), e)
        await sleep(2000)
        continue
      }

      if (!streamInfo || !streamInfo.url) {
        console.log(chalk.red('\nFailed to extract stream URL.'))
        await sleep(2000)
        continue
      }

      console.log(chalk.green(`\n✅ Ready to play! Opening Player...`))

      // Save history
      saveHistoryEntry({
        provider: providerName,
        animeId: selectedAnime.id,
        animeTitle: selectedAnime.title,
        episodeId: episode.id,
        episodeTitle: episode.title || `Episode ${episode.number}`
      })

      try {
        setWatchingPresence(selectedAnime.title, episode.title || `Episode ${episode.number}`, providerName)
        await launchPlayer(streamInfo)
        setBrowsingPresence(`Đang xem thông tin: ${selectedAnime.title}`, providerName, 'Thông tin Phim')
        console.log(chalk.green('\nPlayer closed.'))
        await sleep(500)
      } catch (e) {
        console.error(chalk.red('\nPlayer error:'), e)
        await sleep(2000)
      }

      break // Go back to Select Episode!
    }
  }
}

/** Display a paginated interactive list of UserDataItems — user can select to watch */
async function showUserDataList(title: string, items: UserDataItem[], providerName: string): Promise<void> {
  setBrowsingPresence(`Đang xem ${title}`, providerName, title)
  if (items.length === 0) {
    console.log(chalk.yellow('\n  (Danh sách trống)'))
    await sleep(1500)
    return
  }

  const PAGE_SIZE = 20
  let offset = 0

  while (true) {
    clearScreen()
    printBanner(title, `${items.length} anime`)

    const page = items.slice(offset, offset + PAGE_SIZE)
    const choices = page.map((item, i) => {
      const ep = item.episodeNumber ? chalk.gray(` [Tập ${item.episodeNumber}]`) : ''
      const status = item.status ? chalk.cyan(` (${item.status})`) : ''
      return {
        title: `${chalk.bold(String(offset + i + 1).padStart(3))}. ${item.title}${ep}${status}`,
        value: item.animeId
      }
    })

    if (offset + PAGE_SIZE < items.length)
      choices.push({ title: chalk.yellow(`▼ Xem thêm (${items.length - offset - PAGE_SIZE} còn lại)`), value: '__next__' })
    if (offset > 0)
      choices.push({ title: chalk.yellow('▲ Trang trước'), value: '__prev__' })
    choices.push({ title: chalk.gray('← Quay lại'), value: '__back__' })

    const { animeId } = await prompts({
      type: 'select',
      name: 'animeId',
      message: 'Chọn anime để xem (Esc để quay lại)',
      choices
    })

    if (!animeId || animeId === '__back__') break
    if (animeId === '__next__') { offset = Math.min(offset + PAGE_SIZE, items.length - 1); continue }
    if (animeId === '__prev__') { offset = Math.max(0, offset - PAGE_SIZE); continue }

    // Open anime detail & episode selection
    await openAnimeMenu(providerName, animeId)
  }
}

async function showProviderAccountMenu(provider: 'animevietsub' | 'anime47'): Promise<void> {
  const label = provider === 'animevietsub' ? 'AnimeVietsub' : 'Anime47'

  while (true) {
    setBrowsingPresence('Quản lý Tài khoản', provider, 'Tài khoản')
    clearScreen()
    const status = getAuthStatus(provider)
    const loginLabel = status.loggedIn
      ? chalk.green(`✅ ${status.userDisplayName || 'Đã đăng nhập'} (${status.cookieCount} cookies)`)
      : chalk.red('❌ Chưa đăng nhập')

    printBanner(`${label} — Account`, loginLabel)

    const choices = status.loggedIn
      ? [
        { title: 'Hộp phim / Yêu thích', value: 'favorites' },
        { title: 'Lịch sử xem', value: 'history' },
        ...(provider === 'animevietsub' ? [] : [
          { title: 'Đang xem', value: 'watching' },
          { title: 'Hoàn thành', value: 'completed' },
          { title: 'Dự định xem', value: 'plan_to_watch' },
        ]),
        { title: 'Thông báo', value: 'notifications' },
        { title: chalk.red('Đăng xuất'), value: 'logout' },
        { title: chalk.gray('Quay lại'), value: 'back' }
      ]
      : [
        { title: chalk.cyan('🔑 Đăng nhập'), value: 'login' },
        { title: chalk.gray('Quay lại'), value: 'back' }
      ]

    const { action } = await prompts({ type: 'select', name: 'action', message: `${label} — Chọn hành động`, choices })
    if (!action || action === 'back') break

    if (action === 'login') {
      try {
        const result = provider === 'animevietsub'
          ? await loginAnimeVietsubInteractive()
          : await loginAnime47Interactive()
        console.log(chalk.green(`\n✅ Đăng nhập thành công!`))
        if (result.userDisplayName) console.log(chalk.cyan(`   Xin chào, ${result.userDisplayName}!`))
      } catch (e) {
        console.error(chalk.red(`\n❌ Đăng nhập thất bại:`), e)
      }
      await sleep(2000)
      continue
    }

    if (action === 'logout') {
      logoutProvider(provider)
      console.log(chalk.yellow(`\n👋 Đã đăng xuất khỏi ${label}.`))
      await sleep(1500)
      break
    }

    // Data fetching actions
    const spinner = ora(`Đang tải dữ liệu từ ${label}...`).start()
    try {
      if (provider === 'animevietsub') {
        if (action === 'notifications') {
          const res = await fetchAnimeVietsubNotifications()
          spinner.stop()
          await showUserDataList('Thông báo — AnimeVietsub', res.items, provider)
        } else {
          const listType = action as 'favorites' | 'history'
          const res = await fetchAllAnimeVietsubList(listType)
          spinner.stop()
          const titleMap = { favorites: 'Hộp phim / Yêu thích', history: 'Lịch sử xem' }
          if (!res.success) {
            console.log(chalk.red(`\n❌ ${res.error}`))
            await sleep(2000)
          } else {
            await showUserDataList(`${titleMap[listType]} — AnimeVietsub`, res.items, provider)
          }
        }
      } else {
        if (action === 'notifications') {
          const res = await fetchAnime47Notifications()
          spinner.stop()
          await showUserDataList('Thông báo — Anime47', res.notifications?.map(n => ({
            animeId: n.animeId || '', title: n.title, url: n.url, thumbnail: n.thumbnail
          })) || [], provider)
        } else {
          const { fetchAllAnime47List: fetchList } = await import('./scrapers/auth-service')
          const res = await fetchList(action as any)
          spinner.stop()
          const titleMap: Record<string, string> = {
            favorites: 'Yêu thích', history: 'Lịch sử xem',
            watching: 'Đang xem', completed: 'Hoàn thành', plan_to_watch: 'Dự định xem'
          }
          if (!res.success) {
            console.log(chalk.red(`\n❌ ${res.error}`))
            await sleep(2000)
          } else {
            await showUserDataList(`${titleMap[action] || action} — Anime47`, res.items, provider)
          }
        }
      }
    } catch (e) {
      spinner.stop()
      console.error(chalk.red(`\n❌ Lỗi:`), e)
      await sleep(2000)
    }
  }
}

async function showAccountMenu(): Promise<void> {
  while (true) {
    clearScreen()
    const avsStatus = getAuthStatus('animevietsub')
    const a47Status = getAuthStatus('anime47')

    const avsLabel = avsStatus.loggedIn
      ? chalk.green(`✅ ${avsStatus.userDisplayName || 'Đã đăng nhập'}`)
      : chalk.red('❌ Chưa đăng nhập')
    const a47Label = a47Status.loggedIn
      ? chalk.green(`✅ ${a47Status.userDisplayName || 'Đã đăng nhập'}`)
      : chalk.red('❌ Chưa đăng nhập')

    printBanner('👤 Account', 'Quản lý tài khoản theo nhà cung cấp')

    const { provider } = await prompts({
      type: 'select',
      name: 'provider',
      message: 'Chọn nhà cung cấp',
      choices: [
        { title: `AnimeVietsub — ${avsLabel}`, value: 'animevietsub' },
        { title: `Anime47 — ${a47Label}`, value: 'anime47' },
        { title: chalk.gray('Quay lại Home'), value: 'back' }
      ]
    })

    if (!provider || provider === 'back') break
    await showProviderAccountMenu(provider as 'animevietsub' | 'anime47')
  }
}

async function checkUpdate() {
  try {
    const isCompiled = __dirname.endsWith('dist') || __dirname.endsWith('dist\\') || __dirname.endsWith('dist/')
    const basePath = isCompiled ? path.join(__dirname, '..') : __dirname
    const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'package.json'), 'utf-8'))
    const currentVersion = pkg.version

    const res = await fetch('https://registry.npmjs.org/nekostream-cli/latest', { signal: AbortSignal.timeout(2000) })
    const data = await res.json()
    const latestVersion = data.version

    if (latestVersion && latestVersion !== currentVersion) {
      clearScreen()
      console.log(chalk.yellow('╭─────────────────────────────────────────────────────────────╮'))
      console.log(chalk.yellow('│                                                             │'))
      console.log(chalk.yellow(`│  NEKOSTREAM ĐÃ CÓ CẬP NHẬT MỚI ! ${chalk.red(currentVersion)} → ${chalk.green(latestVersion)}                  │`))
      console.log(chalk.yellow('│  Vui lòng cập nhật ứng dụng CLI để tiếp tục sử dụng ứng dụng.  │'))
      console.log(chalk.yellow('│                                                             │'))
      console.log(chalk.yellow('╰─────────────────────────────────────────────────────────────╯\n'))

      const { update } = await prompts({
        type: 'confirm',
        name: 'update',
        message: 'Bạn có muốn tự động cập nhật ngay bây giờ?',
        initial: true
      })

      if (update) {
        const spinner = ora('Đang cập nhật (npm i -g nekostream-cli@latest)...').start()
        try {
          execSync('npm i -g nekostream-cli@latest', { stdio: 'ignore' })
          spinner.succeed(chalk.green('Đã cập nhật thành công! Vui lòng chạy lại lệnh để sử dụng bản mới.'))
        } catch (e) {
          spinner.fail(chalk.red('Cập nhật thất bại. Vui lòng chạy thủ công: npm i -g nekostream-cli@latest'))
        }
        process.exit(0)
      } else {
        console.log(chalk.red('\nVui lòng chạy `npm i -g nekostream-cli@latest` để cập nhật thủ công.'))
        process.exit(0)
      }
    }
  } catch (e) {
    // Ignore network/fetch errors to not block startup
  }
}

async function main() {
  await checkUpdate()
  await initDiscord()

  let settings = loadSettings()
  let currentProviderName = settings.defaultProvider

  while (true) {
    setBrowsingPresence('Đang lướt Menu Chính')
    clearScreen()

    const authStatus = await getAuthStatus(currentProviderName as any)
    const usernameDisplay = authStatus.loggedIn
      ? chalk.green(`${authStatus.userDisplayName || 'Đã đăng nhập'} (${authStatus.cookieCount || 0} cookies)`)
      : chalk.red('Chưa đăng nhập')

    printBanner(`Provider: ${currentProviderName.toUpperCase()}`, 'Home Dashboard')
    console.log(chalk.cyan('NekoStream Dashboard | Hôm nay xem gì?'))
    console.log(`Account: ${usernameDisplay}\n`)

    const dynamicChoices: any[] = [
      { separator: 'KHÁM PHÁ' },
      { title: 'Search Anime', value: 'search' },
      { title: 'Trending Now', value: 'trending' },
      { title: 'Recently Added', value: 'latest' }
    ]

    const usernameStr = authStatus.loggedIn ? (authStatus.userDisplayName || 'MEMBER') : 'KHÁCH'
    dynamicChoices.push({ separator: `TÀI KHOẢN : ${usernameStr.toUpperCase()}` })

    if (currentProviderName === 'anime47') {
      if (authStatus.loggedIn) {
        dynamicChoices.push(
          { title: 'Hộp phim / Yêu thích', value: 'favorites' },
          { title: 'Lịch sử xem', value: 'history_provider' },
          { title: 'Đang xem', value: 'watching' },
          { title: 'Hoàn thành', value: 'completed' },
          { title: 'Dự định xem', value: 'plan_to_watch' },
          { title: 'Thông báo', value: 'notifications' },
          { title: chalk.yellow('Đăng xuất'), value: 'logout' }
        )
      } else {
        dynamicChoices.push({ title: chalk.green('Đăng nhập Anime47'), value: 'login' })
      }
    } else if (currentProviderName === 'animevietsub') {
      if (authStatus.loggedIn) {
        dynamicChoices.push(
          { title: 'Hộp phim', value: 'favorites' },
          { title: 'Lịch sử', value: 'history_provider' },
          { title: 'Thông báo', value: 'notifications' },
          { title: chalk.yellow('Đăng xuất'), value: 'logout' }
        )
      } else {
        dynamicChoices.push({ title: chalk.green('Đăng nhập AnimeVietsub'), value: 'login' })
      }
    }

    dynamicChoices.push(
      { separator: 'HỆ THỐNG' },
      { title: 'Tiếp tục xem (Lịch sử Local)', value: 'history' },
      { title: 'Cài đặt hệ thống', value: 'settings' },
      { title: 'Đổi Provider', value: 'change_provider' },
      { title: chalk.red('Thoát ứng dụng'), value: 'exit' }
    )

    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'Home Dashboard (Press Esc to Exit)',
      choices: dynamicChoices
    })

    if (!action || action === 'exit') {
      clearScreen()
      clearDiscordPresence()
      console.log(chalk.magenta('\nThanks for using NekoStream CLI! 🎬\n'))
      process.exit(0)
    }

    const provider = getProvider(currentProviderName)

    if (action === 'login') {
      try {
        if (currentProviderName === 'anime47') await loginAnime47Interactive()
        else if (currentProviderName === 'animevietsub') await loginAnimeVietsubInteractive()
      } catch (e: any) {
        if (e.name === 'TimeoutError') {
          console.log(chalk.red('\nĐăng nhập thất bại/Đã hủy: Hết thời gian chờ (Timeout).'))
        } else {
          console.log(chalk.red(`\nLỗi: ${e.message}`))
        }
        await sleep(2000)
      }
      continue
    }

    if (action === 'logout') {
      logoutProvider(currentProviderName as any)
      console.log(chalk.yellow(`\n👋 Đã đăng xuất.`))
      await sleep(1500)
      continue
    }

    if (['favorites', 'history_provider', 'watching', 'completed', 'plan_to_watch', 'notifications'].includes(action)) {
      const spinner = ora(`Đang tải dữ liệu từ ${currentProviderName}...`).start()
      try {
        if (currentProviderName === 'animevietsub') {
          if (action === 'notifications') {
            const res = await fetchAnimeVietsubNotifications()
            spinner.stop()
            await showUserDataList('Thông báo', res.items, currentProviderName)
          } else {
            const listType = action === 'history_provider' ? 'history' : action
            const res = await fetchAllAnimeVietsubList(listType as 'favorites' | 'history')
            spinner.stop()
            if (!res.success) {
              console.log(chalk.red(`\n❌ ${res.error}`))
              await sleep(2000)
            } else {
              await showUserDataList(listType === 'history' ? 'Lịch sử' : 'Hộp phim', res.items, currentProviderName)
            }
          }
        } else if (currentProviderName === 'anime47') {
          if (action === 'notifications') {
            const res = await fetchAnime47Notifications()
            spinner.stop()
            await showUserDataList('Thông báo', res.notifications?.map(n => ({
              animeId: n.animeId || '', title: n.title, url: n.url, thumbnail: n.thumbnail
            })) || [], currentProviderName)
          } else {
            const listType = action === 'history_provider' ? 'history' : action
            const res = await fetchAllAnime47List(listType as any)
            spinner.stop()
            if (!res.success) {
              console.log(chalk.red(`\n❌ ${res.error}`))
              await sleep(2000)
            } else {
              const titleMap: any = { favorites: 'Yêu thích', history: 'Lịch sử xem', watching: 'Đang xem', completed: 'Hoàn thành', plan_to_watch: 'Dự định xem' }
              await showUserDataList(titleMap[listType] || listType, res.items, currentProviderName)
            }
          }
        }
      } catch (e) {
        spinner.stop()
        console.error(chalk.red(`\nLỗi:`), e)
        await sleep(2000)
      }
      continue
    }
    if (action === 'search') {
      const { keyword } = await prompts({
        type: 'text',
        name: 'keyword',
        message: 'Enter anime name to search (Press Esc to go back)'
      })
      if (!keyword) continue

      const searchSpinner = ora(`Searching for "${keyword}" on ${currentProviderName}...`).start()
      try {
        const results = await provider.search(keyword)
        searchSpinner.stop()
        if (!results || results.length === 0) {
          console.log(chalk.yellow(`\nNo results found.`))
          await sleep(2000)
          continue
        }
        setBrowsingPresence(`Đang Tìm kiếm: ${keyword}`, currentProviderName, 'Tìm kiếm')
        await showAnimeList(currentProviderName, `Search Results: ${keyword}`, results)
      } catch (e) {
        searchSpinner.stop()
        console.error(chalk.red('\nSearch failed:'), e)
        await sleep(2000)
      }
    }

    if (action === 'trending' || action === 'latest') {
      const spinner = ora(`Fetching ${action} anime...`).start()
      try {
        const results = await provider.getHomeCards(action)
        spinner.stop()
        if (!results || results.length === 0) {
          console.log(chalk.yellow(`\nNo ${action} anime found on this provider.`))
          await sleep(2000)
          continue
        }
        setBrowsingPresence(`Đang Xem ${action === 'trending' ? 'Xu hướng' : 'Cập nhật gần đây'}`, currentProviderName, action === 'trending' ? 'Xu hướng' : 'Mới cập nhật')
        await showAnimeList(currentProviderName, action === 'trending' ? '🔥 Trending Now' : '🆕 Recently Added', results)
      } catch (e) {
        spinner.stop()
        console.error(chalk.red(`\nFailed to fetch ${action} anime:`), e)
        await sleep(2000)
      }
    }

    if (action === 'history') {
      await showHistoryMenu()
    }

    // Account logic has been moved to main menu

    if (action === 'settings') {
      await showSettingsMenu()
      // reload settings in case default provider changed
      settings = loadSettings()
      currentProviderName = settings.defaultProvider
    }

    if (action === 'change_provider') {
      const { newProvider } = await prompts({
        type: 'select',
        name: 'newProvider',
        message: 'Select an Anime Provider',
        choices: Object.keys(providers).map(name => ({ title: name, value: name }))
      })
      if (newProvider) {
        currentProviderName = newProvider
      }
    }
  }
}

// Global hook to catch Ctrl+C gracefully
process.on('SIGINT', () => {
  clearScreen()
  clearDiscordPresence()
  console.log(chalk.magenta('\nThanks for using NekoStream CLI! 🎬\n'))
  process.exit(0)
})

main().catch(e => {
  console.error(chalk.red('Fatal Error:'), e)
})
