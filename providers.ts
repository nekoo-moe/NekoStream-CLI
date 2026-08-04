import { AnimeVietsubProvider } from './scrapers/providers/animevietsub'
import { Anime47Provider } from './scrapers/providers/anime47'
import { AnimehayProvider } from './scrapers/providers/animehay'
import { getProviderBaseUrl } from './scrapers/domain-resolver'
import type { BaseScraper } from './scrapers/base'
import { isProviderId, type ProviderId } from './provider-types'

export const providers: Record<ProviderId, BaseScraper> = {
  animevietsub: new AnimeVietsubProvider(),
  anime47: new Anime47Provider(),
  animehay: new AnimehayProvider()
}

/**
 * Resolve a provider and point it at the base URL currently in effect.
 *
 * The base URL is re-applied on every call because it can change mid-session: a
 * startup probe or a successful retry on an alternate domain updates the
 * resolver, and these provider instances are long-lived singletons.
 *
 * This used to `require('./storage')` lazily inside a try/catch to dodge an
 * import cycle, and swallowed whatever went wrong. Splitting the pure registry
 * from the stateful resolver removes the cycle, so the import is static and
 * failures are no longer hidden.
 */
export function getProvider(name: ProviderId | string): BaseScraper {
  const providerName = name.toLowerCase()
  if (!isProviderId(providerName)) {
    throw new Error(`Provider not found: ${name}`)
  }

  const provider = providers[providerName]
  provider.baseUrl = getProviderBaseUrl(providerName)
  return provider
}
