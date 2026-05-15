// Base scraper interface for all anime sources

export interface AnimeSearchResult {
  id: string
  source: string
  title: string
  titleAlt?: string
  thumbnail?: string
  cover?: string
  banner?: string  // AniList bannerImage 1900x400
  year?: number
  status?: string
  rating?: number
  imdbScore?: number
  totalEpisodes?: number
  tags?: string[]
  airingTime?: string
  airingDelay?: string
  airingInSeconds?: number
}

export interface DailySchedule {
  day: string
  animes: AnimeSearchResult[]
  fetchedAt?: number  // Unix ms timestamp when this was scraped
}

export interface AnimeDetail {
  id: string
  source: string
  title: string
  titleAlt?: string
  thumbnail?: string
  cover?: string
  banner?: string  // AniList bannerImage 1900x400 - landscape background for spotlight
  description?: string
  descriptionVi?: string
  descriptionEn?: string
  genres: string[]
  tags?: string[]
  status?: string
  year?: number
  rating?: number
  imdbScore?: number
  episodeCount?: number
  relatedAnime?: Array<{
    id: string
    title: string
    thumbnail?: string
    href?: string
  }>
}

export interface Episode {
  id: string
  animeId: string
  number: number
  title?: string
  thumbnail?: string
  source?: string
  // Additional metadata
  dataHash?: string
  href?: string
}

export interface VideoServer {
  name: string
  embedUrl: string
  quality?: string
  type?: string  // 'iframe', 'hls', 'api', 'embed', etc.
  source?: string
}

export interface StreamInfo {
  url: string
  type: 'hls' | 'mp4' | 'dash' | 'iframe'
  quality: string
  provider?: string
  headers?: Record<string, string>
  qualities?: Array<{
    url: string
    quality: string
    bandwidth?: number
  }>
  /** localStorage snapshot for SPA auth injection (used by iframe player) */
  localStorageState?: Record<string, string>
}

export abstract class BaseScraper {
  abstract name: string
  abstract baseUrl: string

  abstract search(query: string): Promise<AnimeSearchResult[]>
  abstract getAnimeDetail(id: string): Promise<AnimeDetail | null>
  abstract getEpisodes(animeId: string): Promise<Episode[]>
  abstract getVideoServers(episodeId: string): Promise<VideoServer[]>
  abstract extractStreamUrl(server: VideoServer): Promise<StreamInfo | null>

  async getHomeCards(_section: 'trending' | 'latest' = 'trending'): Promise<AnimeSearchResult[]> {
    return []
  }

  async getSchedule(): Promise<DailySchedule[]> {
    return []
  }

  // Helper to build full URL
  protected buildUrl(path: string): string {
    if (path.startsWith('http')) return path
    return `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`
  }

  // Helper to sleep (for rate limiting)
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Parse generic ID from URL
  protected parseIdFromUrl(url: string): string {
    // Handle various URL formats:
    // /phim/anime-name-a123/ -> anime-name-a123
    // /phim/anime-name-r2-a123/tap-001-10032.html -> anime-name-r2-a123
    // /xem-phim/anime-name.html -> anime-name
    
    // Remove trailing slash and .html
    let cleanUrl = url.replace(/\.html$/, '').replace(/\/$/, '')
    
    // Extract the path component
    const pathMatch = cleanUrl.match(/\/phim\/([^/]+)/)
    if (pathMatch) return pathMatch[1]
    
    const watchMatch = cleanUrl.match(/\/xem-phim\/([^/]+)/)
    if (watchMatch) return watchMatch[1]
    
    const lastSegment = cleanUrl.match(/\/([^/]+)$/)
    return lastSegment ? lastSegment[1] : url
  }
}
