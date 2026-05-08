import * as cheerio from 'cheerio'
import { BaseScraper, AnimeSearchResult, AnimeDetail, Episode, VideoServer, StreamInfo } from '../base'
import { fetchM3U8 } from '../interceptor'
import { enrichWithAniList } from '../anilist'

type AnimeCachePayload = {
  id: string
  source?: string
  title: string
  titleAlt?: string
  thumbnail?: string
  cover?: string
  description?: string
  genres?: string[]
  status?: string
  year?: number
  rating?: number
  episodeCount?: number
}

type EpisodeCachePayload = {
  id: string
  number: number
  title?: string
  thumbnail?: string
}

type Anime47CacheHooks = {
  cacheAnime?: (anime: AnimeCachePayload) => void
  cacheEpisodes?: (animeId: string, episodes: EpisodeCachePayload[]) => void
}

let cacheHooks: Anime47CacheHooks = {}

export function configureAnime47CacheHooks(hooks: Anime47CacheHooks): void {
  cacheHooks = {
    ...cacheHooks,
    ...hooks
  }
}

interface InitialState {
  queryCache?: {
    queries?: Array<{
      state?: {
        data?: any
      }
    }>
  }
}

interface Anime47WatchApiResponse {
  access_mode?: {
    code?: string
    message?: string
  }
  streams?: Array<{
    url?: string
    link?: string
    file?: string
    src?: string
    quality?: string
    server_name?: string
    name?: string
    label?: string
    player_type?: string
    code?: string
  }>
}

export class Anime47Provider extends BaseScraper {
  name = 'anime47'
  baseUrl = 'https://anime47.best'
  private apiBase = 'https://anime47.love/api'

  private headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: 'https://anime47.best/'
  }

  private jsonHeaders = {
    ...this.headers,
    Accept: 'application/json, text/plain, */*'
  }

  private parseHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html)
  }

  private decodeHtml(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .trim()
  }

  private isTimeoutLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const msg = error.message.toLowerCase()
    return error.name === 'AbortError' || msg.includes('timeout') || msg.includes('aborted')
  }

  private createTimeoutController(timeoutMs: number): {
    signal: AbortSignal
    clear: () => void
  } {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    return {
      signal: controller.signal,
      clear: () => clearTimeout(timeout)
    }
  }

  private async fetchHtml(url: string, options: { timeoutMs?: number; retries?: number } = {}): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 25000
    const retries = options.retries ?? 1
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      const timeout = this.createTimeoutController(timeoutMs)
      try {
        const response = await fetch(url, {
          headers: this.headers,
          signal: timeout.signal
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        return await response.text()
      } catch (error) {
        lastError = error
        if (attempt < retries && this.isTimeoutLikeError(error)) {
          await this.sleep(500 * (attempt + 1))
          continue
        }
      } finally {
        timeout.clear()
      }
    }
    if (lastError instanceof Error) throw lastError
    throw new Error('Lỗi kết nối không xác định')
  }

  private async fetchJson<T>(url: string, options: { timeoutMs?: number; retries?: number } = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 25000
    const retries = options.retries ?? 1
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      const timeout = this.createTimeoutController(timeoutMs)
      try {
        const response = await fetch(url, {
          headers: this.jsonHeaders,
          signal: timeout.signal
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        return await response.json() as T
      } catch (error) {
        lastError = error
        if (attempt < retries && this.isTimeoutLikeError(error)) {
          await this.sleep(500 * (attempt + 1))
          continue
        }
      } finally {
        timeout.clear()
      }
    }
    if (lastError instanceof Error) throw lastError
    throw new Error('Lỗi kết nối JSON không xác định')
  }

  private absolutizeUrl(input: string): string {
    const value = String(input || '').trim()
    if (!value) return ''
    if (value.startsWith('http://') || value.startsWith('https://')) return value
    if (value.startsWith('//')) return `https:${value}`
    if (value.startsWith('/')) return `${this.baseUrl}${value}`
    return `${this.baseUrl}/${value.replace(/^\/+/, '')}`
  }

  private extractInitialState(html: string): InitialState | null {
    const marker = 'window.__INITIAL_STATE__='
    const start = html.indexOf(marker)
    if (start < 0) return null
    let i = start + marker.length
    while (i < html.length && html[i] !== '{') i++
    if (i >= html.length) return null

    let depth = 0
    let inString = false
    let escape = false
    for (let j = i; j < html.length; j++) {
      const ch = html[j]
      if (inString) {
        if (escape) escape = false
        else if (ch === '\\') escape = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === '{') depth++
      if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(i, j + 1)) as InitialState
          } catch {
            return null
          }
        }
      }
    }
    return null
  }

  private normalizeAnimeIdFromLink(link: string): string {
    const normalized = this.absolutizeUrl(link)
    const match = normalized.match(/\/phim\/([^/]+)\/m(\d+)\.html/i)
    if (match?.[1] && match[2]) return `${match[1]}-m${match[2]}`
    const fallback = normalized.match(/\/phim\/([^/?#]+)/i)?.[1]
    return fallback?.replace(/\.html$/i, '') || this.parseIdFromUrl(normalized)
  }

  private buildDetailUrl(animeId: string): string {
    if (animeId.startsWith('http://') || animeId.startsWith('https://')) return animeId
    if (animeId.includes('/phim/')) return this.absolutizeUrl(animeId)
    const matched = animeId.match(/^(.*)-m(\d+)$/i)
    if (matched?.[1] && matched[2]) {
      return `${this.baseUrl}/phim/${matched[1]}/m${matched[2]}.html`
    }
    return `${this.baseUrl}/phim/${animeId}`
  }

  private parseEpisodeNumericId(input: string): string | null {
    const value = String(input || '').trim()
    if (!value) return null
    if (/^\d+$/.test(value)) return value
    const fromWatch = value.match(/\/ep-\d+-(\d+)(?:[/?#]|$)/i)?.[1]
    if (fromWatch) return fromWatch
    const fromTail = value.match(/(?:^|\/)(\d+)(?:[/?#]|$)/)?.[1]
    return fromTail || null
  }

  private async fetchWatchDataByApi(episodeIdOrUrl: string): Promise<Anime47WatchApiResponse | null> {
    const numericId = this.parseEpisodeNumericId(episodeIdOrUrl)
    if (!numericId) return null
    const url = `${this.apiBase}/anime/watch/episode/${numericId}?lang=vi`
    try {
      return await this.fetchJson<Anime47WatchApiResponse>(url, { retries: 1 })
    } catch (error) {
      console.warn('[Anime47] watch api failed:', url, error)
      return null
    }
  }

  private inferStreamTypeFromUrl(link: string, playerType?: string): 'hls' | 'mp4' | 'dash' | 'iframe' {
    const lower = link.toLowerCase()
    if (lower.includes('.m3u8')) return 'hls'
    if (lower.includes('.mp4')) return 'mp4'
    if (lower.includes('.mpd')) return 'dash'
    // Anime47 often serves m3u8 via opaque /file/<token> URLs for JWPlayer
    if (lower.includes('/file/') && String(playerType || '').toLowerCase().includes('jwplayer')) return 'hls'
    return 'iframe'
  }

  private extractListsFromState(state: InitialState | null): any[][] {
    const lists: any[][] = []
    const queries = state?.queryCache?.queries || []
    for (const query of queries) {
      const data = query.state?.data
      if (Array.isArray(data) && data.length > 0) {
        lists.push(data)
        continue
      }
      const first = data?.data
      if (Array.isArray(first) && first.length > 0) {
        lists.push(first)
      }
    }
    return lists
  }

  private mapStateAnime(item: any): AnimeSearchResult | null {
    if (!item || typeof item !== 'object') return null
    const link = String(item.link || item.canonical_url || '')
    const id = this.normalizeAnimeIdFromLink(link)
    const title = String(item.title || '').trim()
    if (!id || !title) return null

    const rawPoster = String(item.poster || item.thumbnail || item.image || item.images?.poster || '')
    const rawCover = String(item.cover || '')
    const cover = rawCover.includes('via.placeholder.com') ? rawPoster : rawCover || rawPoster
    const titles = Array.isArray(item.titles) ? item.titles.map((v: any) => String(v?.title || '')).filter(Boolean) : []

    return {
      id,
      source: 'anime47',
      title: this.decodeHtml(title),
      titleAlt: titles.find((t: string) => t && t !== title),
      thumbnail: this.absolutizeUrl(rawPoster || cover),
      cover: this.absolutizeUrl(cover || rawPoster),
      status: String(item.status || item.badgeRating || '').trim() || undefined,
      rating: Number(item.score || item.rating || 0) || undefined,
      year: Number(item.year || 0) || undefined,
      totalEpisodes: Number(item.episodes?.total || item.current_episode?.number || 0) || undefined
    }
  }

  private parseAnimeCardsFromHtml(html: string): AnimeSearchResult[] {
    const $ = this.parseHtml(html)
    const list: AnimeSearchResult[] = []
    const seen = new Set<string>()

    $('a[href*="/phim/"]').each((_, el) => {
      const $a = $(el)
      const href = $a.attr('href') || ''
      if (!/\/phim\/.+\/m\d+\.html/i.test(href)) return
      const id = this.normalizeAnimeIdFromLink(href)
      if (!id || seen.has(id)) return

      const $root = $a.closest('article, li, .item, .card, .swiper-slide, div')
      const $img = $a.find('img').first().length ? $a.find('img').first() : $root.find('img').first()
      const title =
        $a.attr('title')?.trim() ||
        $root.find('h1, h2, h3, .title, .name').first().text().trim() ||
        $img.attr('alt')?.trim() ||
        $a.text().trim()
      if (!title || title.length < 2) return

      seen.add(id)
      list.push({
        id,
        source: 'anime47',
        title: this.decodeHtml(title),
        thumbnail: this.absolutizeUrl($img.attr('data-src') || $img.attr('src') || ''),
        cover: this.absolutizeUrl($img.attr('data-src') || $img.attr('src') || ''),
        status: $root.find('.status, .badge, .episode, .ep').first().text().trim() || undefined
      })
    })

    return list
  }

  private getDetailData(state: InitialState | null): any | null {
    const queries = state?.queryCache?.queries || []
    for (const query of queries) {
      const data = query.state?.data
      if (data && typeof data === 'object' && data.title && (data.canonical_url || data.link)) {
        return data
      }
    }
    return null
  }

  private parseEpisodeLinksFromHtml(html: string, animeId: string): Episode[] {
    const $ = this.parseHtml(html)
    const episodes: Episode[] = []
    $('a[href*="/xem/"][href*="/ep-"]').each((_, el) => {
      const href = this.absolutizeUrl($(el).attr('href') || '')
      const number = Number(href.match(/\/ep-(\d+)-/i)?.[1] || $(el).text().match(/(\d+)/)?.[1] || 0)
      if (!number) return
      episodes.push({
        id: String(href.match(/ep-\d+-(\d+)/i)?.[1] || `${animeId}-ep-${number}`),
        animeId,
        number,
        title: `Tập ${number}`,
        source: 'anime47',
        href
      } as Episode & { href?: string })
    })
    return episodes
  }

  async getHomeCards(section: 'trending' | 'latest' = 'trending'): Promise<AnimeSearchResult[]> {
    try {
      const html = await this.fetchHtml(this.baseUrl, { retries: 2 })
      const state = this.extractInitialState(html)
      const lists = this.extractListsFromState(state)
      const seen = new Set<string>()
      const merged: AnimeSearchResult[] = []
      const addCard = (card: AnimeSearchResult | null) => {
        if (!card || !card.id || seen.has(card.id)) return
        seen.add(card.id)
        merged.push(card)
      }

      // Merge all homepage blocks instead of only the first one
      for (const list of lists) {
        for (const item of list) addCard(this.mapStateAnime(item))
      }
      for (const item of this.parseAnimeCardsFromHtml(html)) addCard(item)

      if (section === 'latest') {
        return merged
          .filter((item) => /tập|ep|episode|\d+/i.test(String(item.status || '')))
          .slice(0, 72)
      }
      return merged.slice(0, 72)
    } catch (error) {
      console.error('[Anime47] getHomeCards error:', error)
      return []
    }
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const q = query.trim()
    if (!q) return []

    const merged: AnimeSearchResult[] = []
    const seen = new Set<string>()
    const addResult = (item: AnimeSearchResult | null) => {
      if (!item || !item.id || seen.has(item.id)) return
      seen.add(item.id)
      merged.push(item)
    }

    // Primary path: real Anime47 API used by site frontend
    try {
      for (let page = 1; page <= 3; page++) {
        const apiUrl = `${this.apiBase}/search/full/?lang=vi&keyword=${encodeURIComponent(q)}&page=${page}`
        const response = await this.fetchJson<{ results?: any[] }>(apiUrl, { retries: 1 })
        const rows = Array.isArray(response?.results) ? response.results : []
        if (rows.length === 0) break
        for (const row of rows) addResult(this.mapStateAnime(row))
      }
    } catch (error) {
      console.warn('[Anime47] search api failed:', error)
    }

    // Secondary fallback: parse page HTML
    const urls = [
      `${this.baseUrl}/tim-kiem/${encodeURIComponent(q)}`,
      `${this.baseUrl}/tim-kiem?q=${encodeURIComponent(q)}`,
      `${this.baseUrl}/filter?keyword=${encodeURIComponent(q)}`
    ]

    for (const url of urls) {
      try {
        const html = await this.fetchHtml(url, { retries: 1 })
        const state = this.extractInitialState(html)
        const stateResults = this.extractListsFromState(state)
          .flat()
          .map((item) => this.mapStateAnime(item))
          .filter((v): v is AnimeSearchResult => Boolean(v))
        const htmlResults = this.parseAnimeCardsFromHtml(html)

        for (const item of [...stateResults, ...htmlResults]) addResult(item)
      } catch (error) {
        console.warn('[Anime47] search url failed:', url, error)
      }
    }

    const lowered = q.toLowerCase()
    const ranked = merged
      .sort((a, b) => {
        const aHit = a.title.toLowerCase().includes(lowered) ? 1 : 0
        const bHit = b.title.toLowerCase().includes(lowered) ? 1 : 0
        return bHit - aHit
      })
      .slice(0, 48)
    return ranked
  }

  async getAnimeDetail(id: string): Promise<AnimeDetail | null> {
    try {
      const detailUrl = this.buildDetailUrl(id)
      const html = await this.fetchHtml(detailUrl, { retries: 2 })
      const data = this.getDetailData(this.extractInitialState(html))
      if (!data) return null

      const canonicalId = this.normalizeAnimeIdFromLink(String(data.canonical_url || detailUrl))
      const title = String(data.title || '').trim() || id
      const titles = Array.isArray(data.titles) ? data.titles.map((v: any) => String(v?.title || '')).filter(Boolean) : []
      const genres = Array.isArray(data.genres) ? data.genres.map((g: any) => String(g?.name || '')).filter(Boolean) : []
      const rawPoster = String(data.poster || data.images?.poster || '')
      const rawCover = String(data.cover || '')
      const cover = rawCover.includes('via.placeholder.com') ? rawPoster : rawCover || rawPoster

      // Extract related anime from HTML
      const relatedAnime: Array<{ id: string; title: string; thumbnail?: string; href?: string }> = []
      try {
        const $ = cheerio.load(html)
        // Try multiple selectors for related anime/seasons
        const relatedSelectors = [
          '.anime-collection a[href*="/anime/"]',
          '.season-list a[href*="/anime/"]',
          '.related-anime a[href*="/anime/"]',
          'a[href*="/anime/"][class*="season"]',
          'a[href*="/anime/"][class*="part"]'
        ]
        
        for (const selector of relatedSelectors) {
          $(selector).each((_, el) => {
            const href = $(el).attr('href')
            const relTitle = $(el).text().trim() || $(el).find('img').attr('alt') || ''
            const thumb = $(el).find('img').attr('src') || $(el).find('img').attr('data-src')
            
            if (href && relTitle) {
              const relId = this.normalizeAnimeIdFromLink(href)
              if (relId && relId !== canonicalId) {
                relatedAnime.push({
                  id: relId,
                  title: this.decodeHtml(relTitle),
                  thumbnail: thumb ? this.absolutizeUrl(thumb) : undefined,
                  href: this.absolutizeUrl(href)
                })
              }
            }
          })
          
          if (relatedAnime.length > 0) break // Stop after finding any related anime
        }
      } catch (relError) {
        console.warn('[Anime47] Related anime extraction failed:', relError)
      }

      const detail: AnimeDetail = {
        id: canonicalId,
        source: 'anime47',
        title: this.decodeHtml(title),
        titleAlt: titles.find((v: string) => v && v !== title),
        thumbnail: this.absolutizeUrl(rawPoster || cover),
        cover: this.absolutizeUrl(cover || rawPoster),
        description: String(data.description || '').trim() || undefined,
        genres,
        status: String(data.status || '').trim() || undefined,
        year: Number(data.year || 0) || undefined,
        rating: Number(data.score || data.rating || 0) || undefined,
        imdbScore: Number(data.malScore || 0) || undefined,
        episodeCount: Number(data.episodes?.total || 0) || undefined,
        relatedAnime: relatedAnime.length > 0 ? relatedAnime : undefined
      }

      // ── AniList image enrichment ──────────────────────────────────────────
      try {
        const anilist = await enrichWithAniList(title)
        if (anilist.cover) detail.cover = anilist.cover
        if (anilist.banner) detail.banner = anilist.banner
      } catch { /* non-fatal */ }

      try { cacheHooks.cacheAnime?.(detail) } catch {}
      return detail
    } catch (error) {
      console.error('[Anime47] getAnimeDetail error:', error)
      return null
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    try {
      // First, try the episodes API endpoint
      const apiUrl = `${this.apiBase}/anime/${animeId}/episodes?lang=vi`
      try {
        const response = await fetch(apiUrl, { 
          headers: this.jsonHeaders,
          signal: AbortSignal.timeout(10000)
        })
        if (response.ok) {
          const data = await response.json() as any
          const episodes: Episode[] = []
          
          // Parse teams -> groups -> episodes structure
          if (Array.isArray(data?.teams)) {
            for (const team of data.teams) {
              if (Array.isArray(team.groups)) {
                for (const group of team.groups) {
                  if (Array.isArray(group.episodes)) {
                    for (const ep of group.episodes) {
                      const number = Number(ep.number || ep.episodeNumber || 0)
                      const link = String(ep.link || '')
                      if (number && link) {
                        episodes.push({
                          id: String(ep.id || link.match(/ep-\d+-(\d+)/i)?.[1] || `${animeId}-ep-${number}`),
                          animeId,
                          number,
                          title: String(ep.title || `Tập ${number}`),
                          source: 'anime47',
                          href: this.absolutizeUrl(link)
                        } as Episode & { href?: string })
                      }
                    }
                  }
                }
              }
            }
          }
          
          if (episodes.length > 0) {
            const dedupByNumber = new Map<number, Episode>()
            for (const ep of episodes) if (!dedupByNumber.has(ep.number)) dedupByNumber.set(ep.number, ep)
            const result = Array.from(dedupByNumber.values()).sort((a, b) => a.number - b.number)
            try {
              cacheHooks.cacheEpisodes?.(animeId, result.map((episode) => ({
                id: episode.id,
                number: episode.number,
                title: episode.title,
                thumbnail: episode.thumbnail
              })))
            } catch {}
            return result
          }
        }
      } catch (apiError) {
        console.warn('[Anime47] Episodes API failed, falling back to HTML parsing:', apiError)
      }

      // Fallback: HTML parsing
      const detailUrl = this.buildDetailUrl(animeId)
      const html = await this.fetchHtml(detailUrl, { retries: 2 })
      const detailData = this.getDetailData(this.extractInitialState(html))
      const episodes: Episode[] = []

      if (detailData?.latestEpisodes && typeof detailData.latestEpisodes === 'object') {
        Object.values(detailData.latestEpisodes).forEach((ep: any) => {
          const link = this.absolutizeUrl(String(ep?.link || ''))
          const number = Number(ep?.episodeNumber || ep?.title || 0)
          if (!link || !number) return
          episodes.push({
            id: String(ep?.id || link.match(/ep-\d+-(\d+)/i)?.[1] || `${animeId}-ep-${number}`),
            animeId,
            number,
            title: `Tập ${number}`,
            source: 'anime47',
            href: link
          } as Episode & { href?: string })
        })
      }

      if (episodes.length < 8 && detailData?.watchUrl) {
        try {
          const watchHtml = await this.fetchHtml(this.absolutizeUrl(String(detailData.watchUrl)), { retries: 1 })
          episodes.push(...this.parseEpisodeLinksFromHtml(watchHtml, animeId))
        } catch {}
      }

      if (episodes.length === 0) {
        episodes.push(...this.parseEpisodeLinksFromHtml(html, animeId))
      }

      const dedupByNumber = new Map<number, Episode>()
      for (const ep of episodes) if (!dedupByNumber.has(ep.number)) dedupByNumber.set(ep.number, ep)
      const result = Array.from(dedupByNumber.values()).sort((a, b) => a.number - b.number)
      if (result.length > 0) {
        try {
          cacheHooks.cacheEpisodes?.(animeId, result.map((episode) => ({
            id: episode.id,
            number: episode.number,
            title: episode.title,
            thumbnail: episode.thumbnail
          })))
        } catch {}
      }
      return result
    } catch (error) {
      console.error('[Anime47] getEpisodes error:', error)
      return []
    }
  }

  async getVideoServers(episodeId: string): Promise<VideoServer[]> {
    try {
      const episodeUrl = episodeId.startsWith('http') ? episodeId : this.absolutizeUrl(episodeId)

      // Anime47 streams from nonprofit.asia CDN are obfuscated (PNG-wrapped segments).
      // The only reliable playback is via iframe embedding the original watch page.
      // We still expose the direct HLS as secondary option for advanced users.
      const servers: VideoServer[] = []

      const addServer = (candidate: VideoServer) => {
        if (!candidate.embedUrl) return
        if (servers.some((s) => s.embedUrl === candidate.embedUrl)) return
        servers.push(candidate)
      }

      // Primary: iframe watch page (always works)
      addServer({
        name: 'Watch Page (HD)',
        embedUrl: episodeUrl,
        quality: 'HD',
        type: 'iframe',
        source: 'anime47'
      })

      // Secondary: try to expose raw HLS for users who want to test
      const html = await this.fetchHtml(episodeUrl, { retries: 1 })
      const state = this.extractInitialState(html)
      const htmlWatchData = state?.queryCache?.queries?.[0]?.state?.data as Anime47WatchApiResponse | undefined
      const apiWatchData = await this.fetchWatchDataByApi(episodeUrl)
      const watchData = (apiWatchData?.streams?.length ? apiWatchData : htmlWatchData) || htmlWatchData

      if (Array.isArray(watchData?.streams)) {
        for (const stream of watchData.streams) {
          const link = this.absolutizeUrl(String(stream?.url || stream?.link || stream?.file || stream?.src || ''))
          if (!link.startsWith('http')) continue
          const resolvedType = this.inferStreamTypeFromUrl(link, stream?.player_type)
          addServer({
            name: String(stream?.server_name || stream?.label || stream?.name || stream?.quality || 'Direct'),
            embedUrl: link,
            quality: String(stream?.quality || 'HD'),
            type: resolvedType,
            source: 'anime47'
          })
        }
      }

      // Fallback regex extraction
      if (servers.length <= 1) {
        const links = Array.from(html.matchAll(/https?:\/\/[^"'\\\s]+(?:\.m3u8|\.mp4|\.mpd)[^"'\\\s]*/gi)).map((m) => m[0])
        for (const link of links) {
          const lower = link.toLowerCase()
          addServer({
            name: lower.includes('.m3u8') ? 'HLS' : lower.includes('.mpd') ? 'DASH' : 'MP4',
            embedUrl: link,
            quality: 'HD',
            type: lower.includes('.m3u8') ? 'hls' : lower.includes('.mpd') ? 'dash' : 'mp4',
            source: 'anime47'
          })
        }
      }

      const accessCode = String((apiWatchData?.access_mode?.code || htmlWatchData?.access_mode?.code || '')).toLowerCase()
      if (accessCode && accessCode !== 'public' && servers.length === 1 && servers[0].type === 'iframe') {
        const accessMessage = apiWatchData?.access_mode?.message || htmlWatchData?.access_mode?.message || 'Nội dung bị giới hạn truy cập'
        console.warn('[Anime47] non-public access mode:', accessCode, accessMessage)
      }
      return servers
    } catch (error) {
      console.error('[Anime47] getVideoServers error:', error)
      return []
    }
  }

  async extractStreamUrl(server: VideoServer): Promise<StreamInfo | null> {
    try {
      const url = this.absolutizeUrl(server.embedUrl || '')
      const lower = url.toLowerCase()

      // Anime47 HLS streams are obfuscated (PNG-wrapped segments).
      // For iframe servers, return immediately - let webview handle playback.
      if (server.type === 'iframe') {
        return {
          url,
          type: 'iframe',
          quality: server.quality || 'HD',
          headers: { Referer: this.baseUrl, Origin: this.baseUrl },
          provider: 'anime47'
        }
      }

      const looksLikeAnime47FileManifest = lower.includes('/file/')
      if (lower.includes('.m3u8') || (server.type === 'hls' && looksLikeAnime47FileManifest)) {
        const playlist = await fetchM3U8(url, { Referer: this.baseUrl })
        return {
          url: playlist?.defaultUrl || url,
          type: 'hls',
          quality: server.quality || 'HD',
          headers: { Referer: this.baseUrl, Origin: this.baseUrl },
          qualities: playlist?.qualities,
          provider: 'anime47'
        }
      }
      if (lower.includes('.mp4')) {
        return {
          url,
          type: 'mp4',
          quality: server.quality || 'HD',
          headers: { Referer: this.baseUrl, Origin: this.baseUrl },
          provider: 'anime47'
        }
      }
      if (lower.includes('.mpd')) {
        return {
          url,
          type: 'dash',
          quality: server.quality || 'HD',
          headers: { Referer: this.baseUrl, Origin: this.baseUrl },
          provider: 'anime47'
        }
      }

      // Fallback to iframe for unknown types
      return {
        url,
        type: 'iframe',
        quality: server.quality || 'HD',
        headers: { Referer: this.baseUrl, Origin: this.baseUrl },
        provider: 'anime47'
      }
    } catch (error) {
      console.error('[Anime47] extractStreamUrl error:', error)
      return null
    }
  }
}

