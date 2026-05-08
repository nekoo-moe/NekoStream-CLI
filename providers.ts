import { AnimeVietsubProvider } from './scrapers/providers/animevietsub'
import { Anime47Provider } from './scrapers/providers/anime47'
import { AnimehayProvider } from './scrapers/providers/animehay'
import type { BaseScraper } from './scrapers/base'

export const providers: Record<string, BaseScraper> = {
  animevietsub: new AnimeVietsubProvider(),
  anime47: new Anime47Provider(),
  animehay: new AnimehayProvider()
}

export function getProvider(name: string): BaseScraper {
  const provider = providers[name.toLowerCase()]
  if (!provider) {
    throw new Error(`Provider not found: ${name}`)
  }
  return provider
}
