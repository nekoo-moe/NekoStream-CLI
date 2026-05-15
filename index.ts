import prompts from './prompts-wrapper'
import chalk from 'chalk'
import ora from 'ora'
import { providers, getProvider } from './providers'
import { launchPlayer } from './player'
import { clearScreen, printBanner, drawAnimeCard } from './ui'
import { loadSettings, saveSettings, loadHistory, saveHistoryEntry, clearHistory } from './storage'
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
  while (true) {
    clearScreen()
    printBanner('Settings', 'Configure your default preferences')
    
    const settings = loadSettings()
    
    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'Settings Menu (Press Esc to go back)',
      choices: [
        { title: `Default Provider: ${chalk.green(settings.defaultProvider)}`, value: 'provider' },
        { title: `Default Quality: ${chalk.green(settings.defaultQuality)}`, value: 'quality' },
        { title: `Auto-Play Next Episode: ${settings.autoPlayNext ? chalk.green('ON') : chalk.red('OFF')}`, value: 'autoplay' },
        { title: `Configure Provider Domains`, value: 'domains' },
        { title: chalk.gray('Back to Home'), value: 'back' }
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
  while (true) {
    clearScreen()
    printBanner('Continue Watching', 'Resume from where you left off')
    
    const history = loadHistory()
    
    if (history.length === 0) {
      console.log(chalk.yellow('Your history is empty.'))
      await sleep(2000)
      break
    }

    const choices = history.map((item, index) => ({
      title: `[${index + 1}] ${chalk.magenta(item.provider)} | ${chalk.bold.white(item.animeTitle)} - ${chalk.cyan(item.episodeTitle)}`,
      description: `Watched on: ${new Date(item.timestamp).toLocaleString()}`,
      value: index
    }))

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
  while (true) {
    clearScreen()
    printBanner(`Provider: ${providerName.toUpperCase()}`, title.toUpperCase())
    
    // Fix for prompts Windows bug: Flush any leftover escape sequences or buffered keys 
    // that might corrupt the next prompt's raw mode and cause the ^[[B bug.
    if (process.stdin.isTTY) {
      process.stdin.resume()
      while (process.stdin.read() !== null) {}
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
    console.log(chalk.red('\nFailed to fetch episodes: ' + e))
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
    clearScreen()
    printBanner(`Provider: ${providerName.toUpperCase()}`, selectedAnime ? selectedAnime.title : animeId)
    if (selectedAnime) drawAnimeCard(selectedAnime)

    if (process.stdin.isTTY) {
      process.stdin.resume()
      while (process.stdin.read() !== null) {}
    }

    const { episode } = await prompts({
      type: 'select',
      name: 'episode',
      message: 'Select an Episode (Press Esc to go back)',
      choices: episodes.map((ep, idx) => {
        const cleanTitle = (ep.title || `Episode ${ep.number}`).replace(/\r?\n|\r/g, ' ').trim()
        return {
          title: `[${idx + 1}] ${cleanTitle}`,
          value: ep
        }
      })
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
        console.log(chalk.red('\nFailed to fetch servers: ' + e))
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
        console.log(chalk.red('\nFailed to extract stream: ' + e))
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
        await launchPlayer(streamInfo)
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
        console.log(chalk.red(`\n❌ Đăng nhập thất bại: ${e}`))
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
      console.log(chalk.red(`\n❌ Lỗi: ${e}`))
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

async function main() {
  let settings = loadSettings()
  let currentProviderName = settings.defaultProvider

  while (true) {
    clearScreen()
    printBanner(`Provider: ${currentProviderName.toUpperCase()}`, 'Home Dashboard')

    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'Home Dashboard (Press Esc to Exit)',
      choices: [
        { title: 'Search Anime', value: 'search' },
        { title: 'Trending Now', value: 'trending' },
        { title: 'Recently Added', value: 'latest' },
        { title: 'Continue Watching (History)', value: 'history' },
        { title: '👤 Account', value: 'account' },
        { title: 'Settings', value: 'settings' },
        { title: 'Change Provider', value: 'change_provider' },
        { title: chalk.red('Exit'), value: 'exit' }
      ]
    })

    if (!action || action === 'exit') {
      clearScreen()
      console.log(chalk.magenta('\nThanks for using NekoStream CLI! 🎬\n'))
      process.exit(0)
    }

    const provider = getProvider(currentProviderName)

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
        await showAnimeList(currentProviderName, `Search Results: ${keyword}`, results)
      } catch (e) {
        searchSpinner.stop()
        console.log(chalk.red('\nSearch failed: ' + e))
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
        await showAnimeList(currentProviderName, action === 'trending' ? '🔥 Trending Now' : '🆕 Recently Added', results)
      } catch (e) {
        spinner.stop()
        console.log(chalk.red(`\nFailed to fetch ${action} anime: ` + e))
        await sleep(2000)
      }
    }

    if (action === 'history') {
      await showHistoryMenu()
    }

    if (action === 'account') {
      await showAccountMenu()
    }

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
  console.log(chalk.magenta('\nThanks for using NekoStream CLI! 🎬\n'))
  process.exit(0)
})

main().catch(e => {
  console.error(chalk.red('Fatal Error:'), e)
})
