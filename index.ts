import prompts from 'prompts'
import chalk from 'chalk'
import ora from 'ora'
import { providers, getProvider } from './providers'
import { launchPlayer } from './player'
import { clearScreen, printBanner, drawAnimeCard } from './ui'
import { loadSettings, saveSettings, loadHistory, saveHistoryEntry, clearHistory } from './storage'
import type { AnimeDetail, AnimeSearchResult } from './scrapers/base'

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
        { title: chalk.gray('Back to Home'), value: 'back' }
      ]
    })

    if (!action || action === 'back') break

    if (action === 'provider') {
      const { newProvider } = await prompts({
        type: 'select',
        name: 'newProvider',
        message: 'Select Default Provider',
        choices: Object.keys(providers).map(name => ({ title: name, value: name }))
      })
      if (newProvider) saveSettings({ defaultProvider: newProvider })
    }

    if (action === 'quality') {
      const { newQuality } = await prompts({
        type: 'select',
        name: 'newQuality',
        message: 'Select Default Quality',
        choices: ['1080p', '720p', '480p', 'auto'].map(q => ({ title: q, value: q }))
      })
      if (newQuality) saveSettings({ defaultQuality: newQuality })
    }

    if (action === 'autoplay') {
      saveSettings({ autoPlayNext: !settings.autoPlayNext })
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
      title: `${chalk.magenta(item.provider)} | ${chalk.bold.white(item.animeTitle)} - ${chalk.cyan(item.episodeTitle)}`,
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
    
    const { animeId } = await prompts({
      type: 'select',
      name: 'animeId',
      message: 'Select an Anime (Press Esc to go back)',
      choices: list.map(anime => ({
        title: anime.title,
        description: anime.status || anime.year?.toString() || '',
        value: anime.id
      }))
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
    if (provider.getAnimeDetail) {
      selectedAnime = await provider.getAnimeDetail(animeId)
    }
    epsSpinner.stop()
  } catch (e) {
    epsSpinner.stop()
    console.log(chalk.red('\nFailed to fetch episodes: ' + e))
    await sleep(2000)
    return
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

    const { episode } = await prompts({
      type: 'select',
      name: 'episode',
      message: 'Select an Episode (Press Esc to go back)',
      choices: episodes.map(ep => ({
        title: ep.title || `Episode ${ep.number}`,
        value: ep
      }))
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
        choices: servers.map(s => ({
          title: `${s.name} [${s.quality || 'Auto'}] (${s.type})`,
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
