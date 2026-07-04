/**
 * AnimehayProvider — scraper for animehay01.site
 *
 * URL conventions:
 *   Detail page : /thong-tin-phim/<slug>-<numericId>.html
 *   Watch page  : /xem-phim/<slug>-tap<N>-<episodeId>.html
 *   Search      : /tim-kiem/?keyword=<q>
 *   New updates : /phim-moi-cap-nhap/tat-ca-1.html  (paginated trang-N.html)
 *   Schedule    : /lich-phat-song
 *
 * Anime ID = "<slug>-<numericId>"   e.g. "re-zero-4675"
 * Episode ID = numeric string       e.g. "75155"
 */

import * as cheerio from 'cheerio'
import { chromium } from 'playwright'
import {
  BaseScraper,
  AnimeSearchResult,
  AnimeDetail,
  Episode,
  VideoServer,
  StreamInfo,
  DailySchedule,
} from '../base'
import { externalApi } from '../external-api'

// ─── Helper types ────────────────────────────────────────────────────────────

type CacheHooks = {
  cacheAnime?: (anime: {
    id: string; source: string; title: string; titleAlt?: string
    thumbnail?: string; cover?: string; description?: string
    genres?: string[]; status?: string; year?: number; rating?: number
    episodeCount?: number
  }) => void
  cacheEpisodes?: (animeId: string, episodes: Array<{
    id: string; number: number; title?: string; thumbnail?: string
  }>) => void
}

let cacheHooks: CacheHooks = {}

export function configureAnimehаyCacheHooks(hooks: CacheHooks): void {
  cacheHooks = { ...cacheHooks, ...hooks }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class AnimehayProvider extends BaseScraper {
  name = 'animehay'
  baseUrl = 'https://animehay01.site'

  private get headers() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: this.baseUrl + '/',
    }
  }

  // ── Private utilities ───────────────────────────────────────────────────

  private parseHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html)
  }

  private decodeHtml(text: string): string {
    return text
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
      .trim()
  }

  private absolutizeUrl(input: string): string {
    const val = String(input || '').trim()
    if (!val) return ''
    if (val.startsWith('http://') || val.startsWith('https://')) return val
    if (val.startsWith('//')) return `https:${val}`
    if (val.startsWith('/')) return `${this.baseUrl}${val}`
    return `${this.baseUrl}/${val}`
  }

  /**
   * Extract numeric anime ID from a /thong-tin-phim/ URL.
   * e.g. "/thong-tin-phim/re-zero-4675.html" → "re-zero-4675"
   */
  private extractAnimeId(href: string): string | null {
    const m = href.match(/\/thong-tin-phim\/([^/?#]+?)(?:\.html)?(?:[/?#]|$)/i)
    return m?.[1] || null
  }

  /**
   * Extract numeric episode ID from a /xem-phim/ URL.
   * e.g. "/xem-phim/re-zero-tap-5-75155.html" → "75155"
   */
  private extractEpisodeId(href: string): string | null {
    const m = href.match(/\/xem-phim\/.*?-(\d+)(?:\.html)?(?:[/?#]|$)/i)
    return m?.[1] || null
  }

  /** Extract episode number from watch URL. e.g. "-tap-5-75155" → 5 */
  private extractEpisodeNumber(href: string): number {
    const m = href.match(/[_-]tap[_-](\d+)[_-]/i)
    return m ? parseInt(m[1], 10) : 0
  }

  private buildDetailUrl(animeId: string): string {
    if (animeId.startsWith('http')) return animeId
    return `${this.baseUrl}/thong-tin-phim/${animeId}.html`
  }

  private async fetchHtml(url: string, retries = 2): Promise<string> {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      try {
        const resp = await fetch(url, { headers: this.headers, signal: controller.signal })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return await resp.text()
      } catch (err) {
        lastError = err
        if (attempt < retries) await this.sleep(600 * (attempt + 1))
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Network error')
  }

  // ── Card parsing ────────────────────────────────────────────────────────

  /**
   * Parse anime cards from any listing page.
   * AnimehayАниlist uses two layouts:
   *  A) <a href="/thong-tin-phim/..."> with adjacent <a href="/xem-phim/..."> + img
   *  B) Sidebar/recent list with title text inside the link
   */
  private parseCardsFromHtml(html: string): AnimeSearchResult[] {
    const $ = this.parseHtml(html)
    const seen = new Set<string>()
    const results: AnimeSearchResult[] = []

    const push = (card: AnimeSearchResult) => {
      if (!card.id || seen.has(card.id)) return
      seen.add(card.id)
      results.push(card)
    }

    // Layout A: grid/list cards - anchor to detail page
    $('a[href*="/thong-tin-phim/"]').each((_, el) => {
      const href = $(el).attr('href') || ''
      const animeId = this.extractAnimeId(href)
      if (!animeId) return

      const $card = $(el).closest('li, article, .item, .film-item, div').first()
      const $img = $card.find('img').first().length
        ? $card.find('img').first()
        : $(el).find('img').first()

      const title = (
        $(el).attr('title') ||
        $card.find('h3, h2, .title, .film-name, .name').first().text() ||
        $img.attr('alt') ||
        $(el).text()
      ).trim()
      if (!title || title.length < 2) return

      const rawSrc = $img.attr('data-src') || $img.attr('src') || ''
      const thumbnail = this.absolutizeUrl(rawSrc)

      // Try to read latest episode badge (e.g. "Tập 5" or "5/??")
      const epBadge = $card.find('.episode-badge, .ep, .episode, [class*="ep"]').first().text().trim()
      const epMatch = epBadge.match(/(\d+)/)
      const latestEp = epMatch ? parseInt(epMatch[1], 10) : undefined

      push({
        id: animeId,
        source: 'animehay',
        title: this.decodeHtml(title),
        thumbnail,
        cover: thumbnail,
        status: epBadge || undefined,
        totalEpisodes: latestEp,
      })
    })

    return results
  }

  // ── BaseScraper interface ───────────────────────────────────────────────

  async getHomeCards(section: 'trending' | 'latest' = 'trending'): Promise<AnimeSearchResult[]> {
    try {
      // Main listing page shows all recently updated anime
      const url = section === 'trending'
        ? `${this.baseUrl}/xep-hang`
        : `${this.baseUrl}/phim-moi-cap-nhap/tat-ca-1.html`

      const html = await this.fetchHtml(url)
      const cards = this.parseCardsFromHtml(html)

      // Also fetch page 2 for 'latest' to have more content
      if (section === 'latest' && cards.length < 30) {
        try {
          const html2 = await this.fetchHtml(`${this.baseUrl}/phim-moi-cap-nhap/tat-ca-2.html`)
          const cards2 = this.parseCardsFromHtml(html2)
          const seen = new Set(cards.map(c => c.id))
          for (const c of cards2) {
            if (!seen.has(c.id)) { seen.add(c.id); cards.push(c) }
          }
        } catch { /* page 2 optional */ }
      }

      return cards.slice(0, 72)
    } catch (err) {
      console.error('[AnimehayProvider] getHomeCards error:', err)
      return []
    }
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const q = query.trim()
    if (!q) return []

    // Animehay uses slugs for search: /tim-kiem/keyword-with-dashes.html
    const slug = q.trim().replace(/\s+/g, '-')
    const urls = [
      `${this.baseUrl}/tim-kiem/${encodeURIComponent(slug)}.html`,
      `${this.baseUrl}/tim-kiem/${slug}.html`, // Sometimes encodeURIComponent breaks Vietnamese accents on their backend
    ]

    const seen = new Set<string>()
    const results: AnimeSearchResult[] = []

    for (const url of urls) {
      try {
        const html = await this.fetchHtml(url, 1)
        const cards = this.parseCardsFromHtml(html)
        for (const c of cards) {
          if (!seen.has(c.id)) { seen.add(c.id); results.push(c) }
        }
        if (results.length >= 5) break  // first successful URL is enough
      } catch (err) {
        console.warn('[AnimehayProvider] search url failed:', url, err)
      }
    }

    // Filter out results that have no word overlap to prevent fallback pages
    const lq = q.toLowerCase()
    const lqWords = lq.split(' ').filter(w => w.length > 1)
    
    const filtered = results.filter(item => {
      const t = item.title.toLowerCase()
      const tAlt = (item.titleAlt || '').toLowerCase()
      if (t.includes(lq) || tAlt.includes(lq)) return true
      
      for (const w of lqWords) {
        if (t.includes(w) || tAlt.includes(w)) return true
      }
      return false
    })

    // Rank results: exact title matches first
    return filtered
      .sort((a, b) => {
        const aHit = a.title.toLowerCase().includes(lq) ? 1 : 0
        const bHit = b.title.toLowerCase().includes(lq) ? 1 : 0
        return bHit - aHit
      })
      .slice(0, 48)
  }

  async getAnimeDetail(id: string): Promise<AnimeDetail | null> {
    try {
      const detailUrl = this.buildDetailUrl(id)
      const html = await this.fetchHtml(detailUrl, 2)
      const $ = this.parseHtml(html)

      // Title
      const title = (
        $('h1.film-name, h1[class*="title"], h1').first().text() ||
        $('meta[property="og:title"]').attr('content') ||
        ''
      ).replace(/\s*\|\s*AnimeHay.*$/i, '').trim()

      const titleAlt = $('h2.film-name-sub, h2[class*="name"], .sub-title').first().text().trim() || undefined

      // Thumbnail from og:image or first cover img
      const ogImage = $('meta[property="og:image"]').attr('content') || ''
      const imgSrc = ogImage || $('img.film-poster, img[class*="poster"], img[class*="cover"]').first().attr('src') || ''
      let thumbnail = this.absolutizeUrl(imgSrc)

      // Description. Prefer the longest detail-page text, then meta fallback.
      const descriptionCandidates = [
        $('.film-description, .description, [class*="desc"], .content-film, .film-content').first().text().trim(),
        $('.film-description p, .description p, [class*="desc"] p').map((_, el) => $(el).text().trim()).get().join(' '),
        $('meta[name="description"]').attr('content') || ''
      ].filter(Boolean)
      let description = descriptionCandidates.sort((a, b) => b.length - a.length)[0] || undefined

      // Genres
      const genres: string[] = []
      const addGenre = (raw?: string) => {
        const genre = this.decodeHtml(String(raw || '').trim())
        if (genre && genre.length > 1 && !genres.includes(genre)) genres.push(genre)
      }
      $('a[href*="/the-loai/"], a[href*="/genre/"], a[href*="/genres/"]').each((_, el) => {
        addGenre($(el).text().trim() || $(el).attr('title'))
      })

      // Status / Year / Episode count from info section
      let status: string | undefined
      let year: number | undefined
      let episodeCount: number | undefined
      let rating: number | undefined

      // AnimeHay uses flex badges for info instead of lists
      $('.list-info div, .list-info span, .info div, .info span, .detail-info div, .film-info li').each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim()
        
        if (/đang chiếu|hoàn tất|ongoing|completed/i.test(text)) {
          status = text
        }
        
        const y = text.match(/\b(19\d{2}|20\d{2})\b/)
        if (y && !year) {
          year = parseInt(y[1], 10)
        }
        
        const n = text.match(/(\d+)\s*(?:tập|eps)/i)
        if (n && !episodeCount) {
          episodeCount = parseInt(n[1], 10)
        }
        
        const r = text.match(/([\d.]+)\s*\(.*đánh giá\)/i) || text.match(/điểm:\s*([\d.]+)/i)
        if (r && !rating) {
          rating = parseFloat(r[1])
        }
      })

      // Related / season anime
      const relatedAnime: AnimeDetail['relatedAnime'] = []
      const seenRelated = new Set<string>()
      $('a[href*="/thong-tin-phim/"]').each((_, el) => {
        const href = $(el).attr('href') || ''
        const relId = this.extractAnimeId(href)
        if (!relId || relId === id || seenRelated.has(relId)) return
        seenRelated.add(relId)
        
        const relTitle = ($(el).attr('title') || $(el).text()).trim()
        if (!relTitle || relTitle.length < 2) return
        const relThumb = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || ''
        relatedAnime.push({
          id: relId,
          title: this.decodeHtml(relTitle),
          thumbnail: this.absolutizeUrl(relThumb),
          href: this.absolutizeUrl(href),
        })
      })

      // ── AniList image enrichment ────────────────────────────────────────
      let cover = thumbnail
      let banner: string | undefined
      try {
        const anilistMeta = await externalApi.getEnhancedMetadata(title, titleAlt)
        if (anilistMeta?.cover) {
          cover = anilistMeta.cover
          thumbnail = anilistMeta.cover
        }
        if (anilistMeta?.banner) banner = anilistMeta.banner
        if ((!description || description.endsWith('...') || description.length < 80) && anilistMeta?.synopsis) {
          description = anilistMeta.synopsis
        }
        if (genres.length === 0 && anilistMeta?.genres?.length) {
          anilistMeta.genres.forEach(addGenre)
        }
        if (!episodeCount && anilistMeta?.episodes) episodeCount = anilistMeta.episodes
      } catch { /* non-fatal */ }

      const detail: AnimeDetail = {
        id,
        source: 'animehay',
        title: this.decodeHtml(title),
        titleAlt,
        thumbnail,
        cover,
        banner,
        description,
        genres,
        status,
        year,
        rating,
        episodeCount,
        relatedAnime: relatedAnime.length > 0 ? relatedAnime : undefined,
      }

      try { cacheHooks.cacheAnime?.(detail) } catch { /* ignore */ }
      return detail
    } catch (err) {
      console.error('[AnimehayProvider] getAnimeDetail error:', err)
      return null
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    try {
      const detailUrl = this.buildDetailUrl(animeId)
      const html = await this.fetchHtml(detailUrl, 2)
      const $ = this.parseHtml(html)
      const episodes: Episode[] = []
      const seen = new Set<string>()
      
      const slugMatch = animeId.match(/^(.*?)-\d+$/)
      const slug = slugMatch ? slugMatch[1] : animeId

      // AnimeHay has an episode list but also may have sidebars with other anime episodes
      // We limit to the specific container if it exists, or just filter by slug
      const $episodeLinks = $('.list-item-episode').length > 0 
        ? $('.list-item-episode a[href*="/xem-phim/"]') 
        : $('a[href*="/xem-phim/"]')

      $episodeLinks.each((_, el) => {
        const href = this.absolutizeUrl($(el).attr('href') || '')
        
        // Ensure this link is actually for the current anime to avoid sidebar contamination
        if (!href.includes(`/${slug}-`)) return

        const episodeId = this.extractEpisodeId(href)
        if (!episodeId || seen.has(episodeId)) return
        seen.add(episodeId)

        let number = this.extractEpisodeNumber(href)
        if (!number || isNaN(number)) {
          number = episodes.length > 0 ? Math.max(...episodes.map(e => e.number)) + 1 : 1
        }

        let labelText = $(el).text().trim()
        
        // Clean up UI button text that might get matched
        if (labelText.toLowerCase().includes('xem ngay') || labelText.includes('play')) {
          labelText = `Tập ${number}`
        } else if (labelText && !isNaN(Number(labelText))) {
          labelText = `Tập ${labelText}`
        }

        episodes.push({
          id: episodeId,
          animeId,
          number,
          title: labelText || `Tập ${number}`,
          source: 'animehay',
          href,
        } as Episode & { href: string })
      })

      const sorted = episodes.sort((a, b) => a.number - b.number)

      try {
        cacheHooks.cacheEpisodes?.(animeId, sorted.map(e => ({
          id: e.id, number: e.number, title: e.title, thumbnail: e.thumbnail,
        })))
      } catch { /* ignore */ }

      return sorted
    } catch (err) {
      console.error('[AnimehayProvider] getEpisodes error:', err)
      return []
    }
  }

  async getVideoServers(episodeId: string): Promise<VideoServer[]> {
    try {
      // episodeId may be a full URL or just the numeric ID stored as href
      const episodeUrl = episodeId.startsWith('http')
        ? episodeId
        : this.absolutizeUrl(episodeId)

      const servers: VideoServer[] = []
      const addServer = (s: VideoServer) => {
        if (!s.embedUrl) return
        if (servers.some(x => x.embedUrl === s.embedUrl)) return
        servers.push(s)
      }

      // Primary: Playwright intercept to discover HLS/CDN streams
      try {
        const hlsUrls = await this.interceptVideoUrls(episodeUrl, 12000)
        let foundM3u8 = false
        let foundMp4 = false
        
        for (const url of hlsUrls) {
          const lower = url.toLowerCase()
          if (lower.includes('.m3u8')) {
            if (foundM3u8) continue
            foundM3u8 = true
            addServer({
              name: 'HLS (AnimeHay)',
              embedUrl: url,
              quality: 'HD',
              type: 'hls',
              source: 'animehay',
            })
          } else if (lower.includes('.mp4')) {
            if (foundMp4) continue
            foundMp4 = true
            addServer({
              name: 'Video (AnimeHay)',
              embedUrl: url,
              quality: 'HD',
              type: 'mp4',
              source: 'animehay',
            })
          }
        }
      } catch (err) {
        console.warn('[AnimehayProvider] Playwright intercept failed:', err)
      }

      // Return the intercepted servers. We do not use the iframe watch page fallback anymore.
      return servers
    } catch (err) {
      console.error('[AnimehayProvider] getVideoServers error:', err)
      return []
    }
  }

  /**
   * Launch a headless Playwright browser, navigate to the watch page,
   * and intercept any .m3u8 / .mp4 / video CDN responses for up to `timeoutMs`.
   */
  private async interceptVideoUrls(watchUrl: string, timeoutMs: number): Promise<string[]> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
    })

    const context = await browser.newContext({
      userAgent: this.headers['User-Agent'],
      locale: 'vi-VN',
      ignoreHTTPSErrors: true,
    })

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()
    const found: string[] = []

    page.on('response', (response: import('playwright').Response) => {
      const url = response.url()
      const ct = response.headers()['content-type'] || ''
      if (
        url.includes('.m3u8') ||
        url.includes('.mp4') ||
        ct.includes('application/x-mpegurl') ||
        ct.includes('application/vnd.apple.mpegurl') ||
        ct.includes('video/mp4') ||
        (ct.includes('video/') && !ct.includes('webm'))
      ) {
        if (!found.includes(url)) found.push(url)
      }
    })

    try {
      await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
      // Wait for video to start loading
      await page.waitForTimeout(Math.min(timeoutMs, 10000))

      // Also try clicking play button if video hasn't started
      if (found.length === 0) {
        try {
          await page.click('button[class*="play"], .play-btn, [class*="player"] button', { timeout: 3000 })
          await page.waitForTimeout(3000)
        } catch { /* no play button found */ }
      }
    } finally {
      await page.close().catch(() => {})
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
    }

    return found
  }

  async extractStreamUrl(server: VideoServer): Promise<StreamInfo | null> {
    try {
      const url = server.embedUrl || ''
      if (!url) return null

      const lower = url.toLowerCase()

      if (server.type === 'iframe') {
        return {
          url,
          type: 'iframe',
          quality: server.quality || 'HD',
          headers: { Referer: this.baseUrl, Origin: this.baseUrl },
          provider: 'animehay',
        }
      }

      if (lower.includes('.m3u8') || server.type === 'hls') {
        return {
          url,
          type: 'hls',
          quality: server.quality || 'HD',
          headers: { Referer: this.baseUrl, Origin: this.baseUrl },
          provider: 'animehay',
        }
      }

      if (lower.includes('.mp4') || server.type === 'mp4') {
        return {
          url,
          type: 'mp4',
          quality: server.quality || 'HD',
          headers: { Referer: this.baseUrl, Origin: this.baseUrl },
          provider: 'animehay',
        }
      }

      // Unknown — treat as iframe
      return {
        url,
        type: 'iframe',
        quality: server.quality || 'HD',
        headers: { Referer: this.baseUrl, Origin: this.baseUrl },
        provider: 'animehay',
      }
    } catch (err) {
      console.error('[AnimehayProvider] extractStreamUrl error:', err)
      return null
    }
  }

  async getSchedule(): Promise<DailySchedule[]> {
    try {
      const html = await this.fetchHtml(`${this.baseUrl}/lich-phat-song`, 1)
      const $ = this.parseHtml(html)
      const schedule: DailySchedule[] = []

      // AnimeHay schedule uses .schedule-grid > .schedule-col
      $('.schedule-grid .schedule-col').each((_, colEl) => {
        const rawHeader = $(colEl).find('.schedule-col-header').text().trim().replace(/\\s+/g, ' ')
        let day = rawHeader.replace(/Hôm nay/i, '').trim()
        
        // Normalize days
        if (day === 'Thứ 2') day = 'Thứ Hai'
        else if (day === 'Thứ 3') day = 'Thứ Ba'
        else if (day === 'Thứ 4') day = 'Thứ Tư'
        else if (day === 'Thứ 5') day = 'Thứ Năm'
        else if (day === 'Thứ 6') day = 'Thứ Sáu'
        else if (day === 'Thứ 7') day = 'Thứ Bảy'
        else if (day.toLowerCase() === 'chủ nhật') day = 'Chủ Nhật'

        const animes = this.parseCardsFromHtml($(colEl).html() || '')
        if (animes.length > 0) schedule.push({ day, animes })
      })

      // Fallback: if no structured day sections, return all cards as "All"
      if (schedule.length === 0) {
        const cards = this.parseCardsFromHtml(html)
        if (cards.length > 0) schedule.push({ day: 'Lịch phát sóng', animes: cards })
      }

      return schedule
    } catch (err) {
      console.error('[AnimehayProvider] getSchedule error:', err)
      return []
    }
  }
}
