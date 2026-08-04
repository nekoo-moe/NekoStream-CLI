export const PROVIDER_IDS = ['animevietsub', 'anime47', 'animehay'] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

export const ACCOUNT_PROVIDER_IDS = ['animevietsub', 'anime47'] as const

export type AccountProviderId = (typeof ACCOUNT_PROVIDER_IDS)[number]

export type SettingsAction =
  | 'provider'
  | 'quality'
  | 'autoplay'
  | 'discord'
  | 'debug'
  | 'domains'
  | 'back'

export type DomainAction = ProviderId | 'redetect' | 'reset' | 'back'

export type AnimeVietsubListAction = 'favorites' | 'history'
export type Anime47ListAction =
  | 'favorites'
  | 'history'
  | 'watching'
  | 'completed'
  | 'plan_to_watch'

export type AccountAction =
  | Anime47ListAction
  | 'notifications'
  | 'login'
  | 'logout'
  | 'back'

export type HomeAction =
  | 'search'
  | 'trending'
  | 'latest'
  | 'favorites'
  | 'history_provider'
  | 'watching'
  | 'completed'
  | 'plan_to_watch'
  | 'notifications'
  | 'login'
  | 'logout'
  | 'history'
  | 'settings'
  | 'change_provider'
  | 'exit'

export type HomeListAction = Extract<
  HomeAction,
  'favorites' | 'history_provider' | 'watching' | 'completed' | 'plan_to_watch' | 'notifications'
>

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId)
}

export function isAccountProviderId(value: string): value is AccountProviderId {
  return ACCOUNT_PROVIDER_IDS.includes(value as AccountProviderId)
}

export function isHomeListAction(value: HomeAction): value is HomeListAction {
  return [
    'favorites',
    'history_provider',
    'watching',
    'completed',
    'plan_to_watch',
    'notifications',
  ].includes(value as HomeListAction)
}

export function isAnimeVietsubListAction(value: AccountAction): value is AnimeVietsubListAction {
  return value === 'favorites' || value === 'history'
}
