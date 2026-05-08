// AnimeVietsub.id Scraper
// Uses Playwright for JavaScript rendering and video extraction

import * as cheerio from 'cheerio'
import { 
  BaseScraper, 
  AnimeSearchResult, 
  AnimeDetail, 
  Episode, 
  VideoServer, 
  StreamInfo,
  DailySchedule
} from '../base'
import { getCrawler } from '../crawler'
import {
  BrowserProfile,
  pickRandomProfile,
  buildProfileHeaders,
  isBlockedStatus,
  isBlockedError,
  isCloudflareChallengePage,
  isOriginServerDownPage,
  SiteDownError,
  HostThrottle,
} from '../fingerprint'
import { extractVideoFromJS, fetchM3U8 } from '../interceptor'

import { externalApi } from '../external-api'
import { enrichWithAniList } from '../anilist'
// Auth services removed for standalone CLI
// Extended AnimeDetail with additional metadata
export interface AnimeDetailExtended extends AnimeDetail {
  descriptionVi?: string
  descriptionEn?: string
  imdbScore?: number
  tags?: string[]
  director?: string
  studio?: string
  country?: string
  language?: string
  quality?: string
  views?: number
  followers?: number
  season?: string
  relatedAnime?: Array<{
    id: string
    title: string
    label: string
    href: string
  }>
  characters?: Array<{
    name: string
    image?: string
  }>
}

export class AnimeVietsubProvider extends BaseScraper {
  name = 'AnimeVietsub'
  baseUrl = 'https://animevietsub.bz'

  // User endpoints omitted in standalone CLI
  private toMediaProxyUrl(sourceUrl: string, referer: string): string {
    const query = new URLSearchParams({
      url: sourceUrl,
      referer
    })
    return `nekostream-media://proxy?${query.toString()}`
  }

  // --- Botasaurus pattern: per-host throttle (request spacing to reduce ban probability) ---
  private static readonly throttle = new HostThrottle(800)

  /**
   * Hosts confirmed to block raw fetch() (520/403). For these we skip the
   * fetch loop entirely and escalate straight to Playwright.
   * Seeded at class definition with known-blocked providers.
   */
  private static readonly blockedHostCache = new Set<string>([
    'animevietsub.bz',
  ])

  // --- Botasaurus pattern: jittered exponential backoff (port from request_decorator retry_wait) ---
  private jitteredWait(attempt: number): Promise<void> {
    const base = Math.min(1000 * Math.pow(2, attempt), 8000)
    const jitter = Math.floor(Math.random() * 1000)
    return this.sleep(base + jitter)
  }

  private buildRequestHeaders(
    extraHeaders: Record<string, string> = {},
    profile?: BrowserProfile
  ): Record<string, string> {
    const p = profile ?? pickRandomProfile()
    const cookieHeader = null
    return {
      ...buildProfileHeaders(p, `${this.baseUrl}/`),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...extraHeaders,
    }
  }

  private isLikelyAdUrl(urlText: string): boolean {
    const lower = urlText.toLowerCase()
    return (
      lower.includes('win88') ||
      lower.includes('i9bet') ||
      lower.includes('yo88') ||
      lower.includes('fb88') ||
      lower.includes('sunwin') ||
      lower.includes('apihrx/1s_blank.mp4') ||
      lower.includes('_news.mp4') ||
      lower.includes('/ads') ||
      lower.includes('doubleclick') ||
      lower.includes('googlesyndication')
    )
  }

  private isTimeoutLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const message = error.message.toLowerCase()
    return error.name === 'AbortError' || message.includes('timeout') || message.includes('aborted')
  }



  /**
   * Fetch HTML using native fetch with block-aware retry + Playwright fallback.
   * Botasaurus patterns applied:
   *   - pickRandomProfile() per attempt (coherent UA + sec-ch-ua + Accept-Language)
   *   - isBlockedStatus: catches 403, 429, 520-530 (Cloudflare range)
   *   - isCloudflareChallengePage: detects CF challenge disguised as 200
   *   - HostThrottle: per-host request spacing (800ms min gap)
   *   - jitteredWait: exponential backoff with jitter on retry
   *   - Playwright escalation: browser fallback after retries exhausted
   */
  private async fetchHtml(
    url: string,
    options: { timeoutMs?: number; retries?: number; useBrowserFallback?: boolean } = {}
  ): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 20000
    const retries = options.retries ?? 2
    const useBrowserFallback = options.useBrowserFallback ?? true

    // --- Playwright-first for known-blocked hosts ---
    // Skip the fetch loop entirely and go straight to Playwright for hosts
    // that consistently return 520/403 on raw fetch() calls.
    let hostname = ''
    try { hostname = new URL(url).hostname } catch { /* ignore */ }
    if (hostname && AnimeVietsubProvider.blockedHostCache.has(hostname)) {
      if (!useBrowserFallback) throw new Error(`Lỗi kết nối: host bị chặn (${hostname})`)
      console.log(`[Scraper] Host "${hostname}" is in blocked cache — going Playwright-first for ${url}`)
      return await this.fetchHtmlWithPlaywright(url)
    }

    let lastError: unknown
    let consecutiveBlocks = 0

    for (let attempt = 0; attempt <= retries; attempt++) {
      // Botasaurus: evaluate_proxy → pickRandomProfile() per attempt
      const profile = pickRandomProfile()
      try {
        // Botasaurus: HostThrottle — enforce request spacing per hostname
        await AnimeVietsubProvider.throttle.wait(url)

        const response = await fetch(url, {
          headers: this.buildRequestHeaders({}, profile),
          signal: AbortSignal.timeout(timeoutMs),
        })

        // Botasaurus: isBlockedStatus covers 403, 429, 520-530
        if (isBlockedStatus(response.status)) {
          consecutiveBlocks++
          const err = new Error(`HTTP ${response.status}: ${response.statusText || 'Blocked'}`)
          lastError = err
          if (attempt < retries) {
            console.warn(`[Scraper] HTTP ${response.status} on attempt ${attempt + 1}/${retries + 1} for ${url} — retrying with new profile...`)
            await this.jitteredWait(attempt)
            continue
          }
          // Auto-cache host as blocked after exhausting retries
          if (hostname) {
            AnimeVietsubProvider.blockedHostCache.add(hostname)
            console.warn(`[Scraper] Added "${hostname}" to blocked-host cache`)
          }
          if (useBrowserFallback) {
            console.warn(`[Scraper] Blocked (${response.status}) after ${consecutiveBlocks} attempt(s), escalating to Playwright for ${url}`)
            return await this.fetchHtmlWithPlaywright(url)
          }
          throw new Error(`Lỗi kết nối: HTTP ${response.status}`)
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const html = await response.text()

        // Botasaurus: CloudflareDetectionException — detect CF challenge on 200 response
        if (isCloudflareChallengePage(html)) {
          consecutiveBlocks++
          console.warn(`[Scraper] CF challenge page detected on attempt ${attempt + 1}/${retries + 1} for ${url}`)
          if (attempt < retries) {
            await this.jitteredWait(attempt)
            continue
          }
          if (useBrowserFallback) {
            console.warn(`[Scraper] CF challenge persists, escalating to Playwright for ${url}`)
            return await this.fetchHtmlWithPlaywright(url)
          }
          throw new Error('Lỗi kết nối: Cloudflare challenge không thể vượt qua')
        }

        return html
      } catch (error) {
        // Re-throw SiteDownError immediately — no retries for a down server
        if (error instanceof SiteDownError) throw error
        lastError = error

        // Botasaurus: isBlockedError covers HTTP 403/429/520-530
        if (isBlockedError(error)) {
          consecutiveBlocks++
          if (attempt < retries) {
            console.warn(`[Scraper] Block error on attempt ${attempt + 1}/${retries + 1} — retrying...`)
            await this.jitteredWait(attempt)
            continue
          }
          if (useBrowserFallback) {
            console.warn(`[Scraper] Block error exhausted retries, escalating to Playwright for ${url}`)
            return await this.fetchHtmlWithPlaywright(url)
          }
          throw new Error(`Lỗi kết nối: ${(error as Error).message}`)
        }

        if (attempt < retries && this.isTimeoutLikeError(error)) {
          await this.sleep(500 * (attempt + 1))
          continue
        }

        if (error instanceof Error) {
          if (this.isTimeoutLikeError(error)) {
            throw new Error('Yêu cầu quá lâu không phản hồi. Vui lòng thử lại.')
          }
          throw new Error(`Lỗi kết nối: ${error.message}`)
        }
        throw error
      }
    }

    if (lastError instanceof Error && this.isTimeoutLikeError(lastError)) {
      throw new Error('Yêu cầu quá lâu không phản hồi. Vui lòng thử lại.')
    }
    throw new Error('Lỗi kết nối không xác định')
  }

  /**
   * Playwright-based HTML fetch — injects Cloudflare clearance cookies from
   * Electron's default session so the browser context has a valid cf_clearance token.
   *
   * Strategy:
   *   1. Pull all cookies for animevietsub.bz from Electron's defaultSession
   *   2. Inject them into a fresh Playwright browser context
   *   3. Navigate, wait for /phim/ links to appear (SPA AJAX content renders)
   *   4. Capture and return the fully rendered HTML
   *
   * Without cf_clearance, Playwright is stuck in a Cloudflare Turnstile loop.
   * With it (set by the user's normal Electron browser visit), CF treats the
   * Playwright session as a recognized client.
   */
  private async fetchHtmlWithPlaywright(url: string): Promise<string> {
    const { chromium } = await import('playwright')

    // --- Step 1: Pull CF + session cookies from Electron default session ---
    let playwrightCookies: Array<{
      name: string; value: string; domain: string; path: string;
      httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None'
    }> = []
    try {
      const electronCookies: any[] = []
      playwrightCookies = electronCookies
        .filter(c => c.value && c.name)
        .map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain || new URL(url).hostname,
          path: c.path || '/',
          httpOnly: Boolean(c.httpOnly),
          secure: Boolean(c.secure),
          sameSite: (c.sameSite === 'strict' ? 'Strict' : c.sameSite === 'lax' ? 'Lax' : 'None') as 'Strict' | 'Lax' | 'None',
        }))
      if (playwrightCookies.length > 0) {
        const cfCookie = playwrightCookies.find(c => c.name === 'cf_clearance')
        console.log(`[Scraper] Injecting ${playwrightCookies.length} cookies into Playwright (cf_clearance: ${cfCookie ? '✅' : '❌ missing'})`)
      } else {
        console.warn('[Scraper] No Electron session cookies found — CF challenge may not resolve')
        console.warn('[Scraper] Tip: visit animevietsub.bz in the app browser to set cf_clearance')
      }
    } catch (err) {
      console.warn('[Scraper] Could not read Electron session cookies:', err)
    }

    // --- Step 2: Launch headless Chromium with cookie injection ---
    const profile = pickRandomProfile()
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
        ],
      })
    } catch (launchErr) {
      const msg = launchErr instanceof Error ? launchErr.message : String(launchErr)
      if (msg.includes("Executable doesn't exist") || msg.includes('browserType.launch')) {
        console.error('[Scraper] Playwright browser not installed. Run: npx playwright install chromium')
        throw new Error('Trình duyệt nền chưa được cài đặt. Vui lòng chạy: npx playwright install chromium')
      }
      throw launchErr
    }

    const context = await browser.newContext({
      userAgent: profile.ua,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    })

    // Stealth
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).chrome = { runtime: {} }
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] })
    })

    // Inject CF cookies
    if (playwrightCookies.length > 0) {
      await context.addCookies(playwrightCookies)
    }

    const page = await context.newPage()
    try {
      console.log(`[Scraper] Playwright navigating to: ${url}`)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 })

      // Wait for CF challenge to pass (if cookies didn't help, it may still loop)
      let cfWaitMs = 0
      while (cfWaitMs < 20000) {
        const title = await page.title().catch(() => '')
        const snippet = await page.content().catch(() => '').then(h => h.slice(0, 2000).toLowerCase())
        if (
          title.includes('Just a moment') ||
          snippet.includes('_cf_chl_opt') ||
          snippet.includes('cf-browser-verification')
        ) {
          await page.waitForTimeout(1500)
          cfWaitMs += 1500
          continue
        }
        break
      }

      // Wait for SPA card content to render via AJAX
      console.log('[Scraper] Waiting for /phim/ links to appear (SPA AJAX content)...')
      try {
        await page.waitForSelector('a[href*="/phim/"]', { timeout: 12000 })
        console.log('[Scraper] ✅ /phim/ links appeared in DOM')
      } catch {
        console.warn('[Scraper] ⚠️ /phim/ links did not appear — capturing anyway')
        // Scroll to trigger lazy content
        await page.evaluate(() => (globalThis as any).scrollTo(0, (globalThis as any).document.body.scrollHeight / 2))
        await page.waitForTimeout(2000)
      }

      // Extra settle time
      await page.waitForTimeout(1000)

      const html = await page.content()
      if (!html || html.length < 100) {
        throw new Error('Playwright trả về nội dung trống')
      }
      console.log(`[Scraper] Playwright fallback succeeded, HTML length: ${html.length}`)

      // Detect origin-server down page (e.g. "Lỗi Server 5xx" custom page).
      if (isOriginServerDownPage(html)) {
        const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
        console.warn(`[Scraper] Origin server down page detected for ${hostname}`)
        throw new SiteDownError(this.name)
      }

      return html
    } finally {
      await page.close().catch(() => {})
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
    }
  }

  /**
   * Parse HTML with Cheerio
   */
  private parseHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html)
  }

  /**
   * Multi-strategy card element selector.
   *
   * AnimeVietsub uses several different WordPress theme structures across
   * different page versions. We try each selector in priority order and
   * return the first set with content that includes /phim/ links.
   *
   * This guards against the site changing its HTML structure between deploys.
   */
  private selectCardElements($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
    const strategies = [
      // Toroplay / WP anime theme (most common AVS structure)
      '.TPostMv',
      'article.TPostMv',
      '.TPost.TPostMv',
      // Generic list structures
      '.MovieList li',
      '.MovieList article',
      '.movies-list li',
      '.movies-list article',
      'section.movies-list li',
      // Alternate theme structures
      '.film_list-wrap .flw-item',
      '.flw-item',
      // Broad fallbacks
      'li:has(a[href*="/phim/"])',
      'article:has(a[href*="/phim/"])',
      // Last resort: any element directly wrapping a /phim/ anchor
      'li, article, .item, .TPost',
    ]

    for (const sel of strategies) {
      try {
        const matched = $(sel)
        // Confirm at least one matched element contains a /phim/ link
        if (matched.length > 0) {
          const hasPhimLink = matched.toArray().some(el =>
            $(el).find('a[href*="/phim/"]').length > 0
          )
          if (hasPhimLink) {
            console.log(`[Scraper] selectCardElements: using selector "${sel}" (${matched.length} elements)`)
            return matched
          }
        }
      } catch {
        // Invalid selector for this cheerio version — skip
      }
    }

    // Absolute fallback: return empty cheerio selection
    console.warn('[Scraper] selectCardElements: no matching strategy found, returning empty set')
    return $([])
  }

  private absolutizeUrl(urlText: string): string {
    if (!urlText) return ''
    if (urlText.startsWith('//')) return `https:${urlText}`
    if (urlText.startsWith('/')) return `${this.baseUrl}${urlText}`
    return urlText
  }

  private parseImdbScore(text: string): number | undefined {
    const normalized = text.replace(',', '.')
    const imdbMatch = normalized.match(/imdb[^0-9]*(\d+(?:\.\d+)?)/i)
    if (imdbMatch?.[1]) {
      const imdb = parseFloat(imdbMatch[1])
      if (!Number.isNaN(imdb) && imdb >= 0 && imdb <= 10) {
        return imdb
      }
    }

    const scoreMatch = normalized.match(/\b(\d\.\d)\b/)
    if (scoreMatch?.[1]) {
      const score = parseFloat(scoreMatch[1])
      if (!Number.isNaN(score) && score >= 0 && score <= 10) {
        return score
      }
    }

    return undefined
  }

  private extractCardData($root: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): AnimeSearchResult | null {
    const $link = $root.find('a[href*="/phim/"]').first()
    const href = $link.attr('href') || ''
    if (!href.includes('/phim/') || href.includes('/xem-phim') || href.includes('/tap-')) return null

    const id = this.parseIdFromUrl(href)
    if (!id) return null

    const $img = $root.find('img').first()
    const headingTitle = $root.find('h2, h3, .Title, .name a').first().text().trim()
    const imageTitle = ($img.attr('title') || $img.attr('alt') || '').trim()
    const linkTitle = ($link.attr('title') || '').trim()
    const title =
      headingTitle ||
      imageTitle ||
      linkTitle ||
      ''
    if (!title) return null

    // Extract titleAlt from subtitle element or infer from ID slug
    // Try common subtitle selectors  
    const subtitleFromCard = $root.find('.SubTitle, .sub-title, .original-title, small, span.alt').first().text().trim()
    // Parse romaji/English title from ID slug (e.g., "tongari-boushi-no-atelier-a5910" -> "Tongari Boushi no Atelier")
    const slugWithoutSuffix = id.replace(/-a\d+$/, '') // Remove trailing -aXXXX
    const titleFromSlug = slugWithoutSuffix
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    // Use subtitle if found and different from main title
    // Prefer subtitle over slug (subtitle is actually on the page, slug might mismatch)
    const isVietnamese = (s: string) => /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(s)
    const titleAlt = (subtitleFromCard && subtitleFromCard.toLowerCase() !== title.toLowerCase())
      ? (isVietnamese(subtitleFromCard) ? undefined : subtitleFromCard)  // Prefer non-Viet alt
      : (titleFromSlug.toLowerCase() !== title.toLowerCase() ? titleFromSlug : undefined)

    const thumbnail = this.absolutizeUrl($img.attr('data-src') || $img.attr('src') || '')
    let cover = this.absolutizeUrl(
      $root.find('[style*="background-image"]').first().attr('data-src') ||
      $root.find('[style*="background-image"]').first().attr('src') ||
      ''
    )
    if (!cover) {
      const styleText = $root.find('[style*="background-image"]').first().attr('style') || ''
      const styleMatch = styleText.match(/url\((['"]?)(.*?)\1\)/i)
      cover = this.absolutizeUrl(styleMatch?.[2] || '')
    }

    const rawStatus =
      $root.find('.mli-eps, .mli-quality, .quality, .Qlty, .ribbon, .episode').first().text().trim() || ''
    const compactStatus = rawStatus
      .replace(/[_\s]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim()
    let status: string | undefined
    if (compactStatus.length > 0 && compactStatus.length <= 16) {
      status = compactStatus
    } else {
      const fallbackMatch = $root.text().match(/(HOÀN[_\s]*TẤT|TẬP[_\s]*\d+|FULL)/i)
      if (fallbackMatch?.[1]) {
        status = fallbackMatch[1].replace(/[_\s]+/g, ' ').trim()
      }
    }

    const ratingText = $root.find('.anime-avg-user-rating, .Vote, [class*="rating"], [class*="imdb"]').first().text().trim()
    const ratingMatch = ratingText.match(/(\d+\.?\d*)/)
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined
    const imdbScore = this.parseImdbScore(ratingText)

    const tags: string[] = []
    $root.find('a[href*="/the-loai/"], .genres a, .genre a, .TAX a').each((_, tagEl) => {
      const tag = $(tagEl).text().trim()
      if (tag && tag.length <= 32 && !tags.includes(tag)) tags.push(this.decodeHtml(tag))
    })

    const yearMatch = $root.text().match(/(19|20)\d{2}/)
    const year = yearMatch ? parseInt(yearMatch[0], 10) : undefined

    const epText = $root.find('.mli-eps, .episode-count, [class*="episode"]').first().text()
    const epMatch = epText.match(/(\d+)/)
    const totalEpisodes = epMatch ? parseInt(epMatch[1], 10) : undefined

    return {
      id,
      source: this.name.toLowerCase(),
      title: this.decodeHtml(title),
      titleAlt: titleAlt ? this.decodeHtml(titleAlt) : undefined,
      thumbnail,
      cover: cover || thumbnail,
      rating,
      imdbScore,
      status,
      year,
      totalEpisodes,
      tags: tags.length > 0 ? tags : undefined
    }
  }

  async getSchedule(): Promise<DailySchedule[]> {
    try {
      const html = await this.fetchHtml(`${this.baseUrl}/lich-chieu-phim.html`, { timeoutMs: 25000, retries: 2 })
      const $ = this.parseHtml(html)
      const schedules: DailySchedule[] = []
      const fetchedAt = Date.now()

      $('section.Homeschedule').each((_, sectionEl) => {
        const $section = $(sectionEl)
        const rawDay = $section.find('.Top h1 b').text().trim() || $section.find('.Top h1').text().trim()
        if (!rawDay) return

        const dayName = rawDay.replace(/,/g, '').trim()
        
        const animes: AnimeSearchResult[] = []
        // Only select direct li children to avoid duplicating li + article inside li
        $section.find('ul.MovieList > li').each((_, el) => {
          const $el = $(el)
          // Pass the li itself (contains the a[href] link extractCardData needs)
          const card = this.extractCardData($el, $)
          if (!card) return

          // Extract airing info from the Image div inside the li
          const $imgDiv = $el.find('.Image')
          const $timeSpan = $imgDiv.find('.mli-timeschedule').first()
          const airingDelay = $timeSpan.text().trim()
          const airingInSeconds = parseInt($timeSpan.attr('data-timer_second') || '', 10)
          const airingTime = $imgDiv.find('span.b').first().text().trim()
          
          if (airingTime) card.airingTime = airingTime
          if (airingDelay) card.airingDelay = airingDelay
          if (!isNaN(airingInSeconds)) card.airingInSeconds = airingInSeconds
          
          animes.push(card)
        })

        if (animes.length > 0) {
          schedules.push({ day: dayName, animes, fetchedAt })
        }
      })

      // Re-sort so it starts from Monday
      const dayOrder: Record<string, number> = {
        'Thứ Hai': 1, 'Thứ 2': 1,
        'Thứ Ba': 2, 'Thứ 3': 2,
        'Thứ Tư': 3, 'Thứ 4': 3,
        'Thứ Năm': 4, 'Thứ 5': 4,
        'Thứ Sáu': 5, 'Thứ 6': 5,
        'Thứ Bảy': 6, 'Thứ 7': 6,
        'Chủ Nhật': 7
      }
      
      schedules.sort((a, b) => {
        const dA = dayOrder[a.day] || 99
        const dB = dayOrder[b.day] || 99
        return dA - dB
      })

      return schedules
    } catch (error) {
      console.error(`[Scraper] getSchedule error:`, error)
      return []
    }
  }

  async getHomeCards(section: 'trending' | 'latest' = 'trending'): Promise<AnimeSearchResult[]> {
    const listUrl = section === 'latest'
      ? `${this.baseUrl}/danh-sach/phim-moi-cap-nhat/`
      : `${this.baseUrl}/`

    try {
      // useBrowserFallback: true → 403 after retries auto-escalates to Playwright
      const html = await this.fetchHtml(listUrl, { timeoutMs: 25000, retries: 2, useBrowserFallback: true })
      const $ = this.parseHtml(html)
      const results: AnimeSearchResult[] = []
      const seenIds = new Set<string>()

      this.selectCardElements($).each((_, el) => {
        const card = this.extractCardData($(el), $)
        if (!card || seenIds.has(card.id)) return
        seenIds.add(card.id)
        results.push(card)
      })

      if (results.length > 0) return results.slice(0, 48)

      // Only fallback to search when HTML parsed OK but yielded 0 cards (not a 403/down scenario)
      console.warn('[Scraper] getHomeCards: HTML loaded but 0 cards parsed, trying search fallback')
      return this.search('anime')
    } catch (error) {
      // Site is temporarily down — propagate as a typed error so UI can show proper message
      if (error instanceof SiteDownError) {
        console.warn(`[Scraper] getHomeCards(${section}): ${error.message}`)
        throw error
      }
      console.error(`[Scraper] getHomeCards(${section}) error:`, error)
      if (section === 'latest') {
        // Fallback to trending homepage when latest page is unstable (non-down errors only)
        return this.getHomeCards('trending')
      }
      // Do NOT fall back to search() — it would also fail and make the error worse.
      // Return empty array so HomeView can show a graceful empty/retry state.
      console.error('[Scraper] getHomeCards completely failed — returning empty array for graceful UI')
      return []
    }
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    console.log('[Scraper] search() called with query:', query)

    if (!query || query.trim().length === 0) {
      console.log('[Scraper] Empty query, returning empty results')
      return []
    }

    // Search URL candidates — try each in order until one returns cards
    const searchUrls = [
      `${this.baseUrl}/tim-kiem/${encodeURIComponent(query)}/`,
      `${this.baseUrl}/?s=${encodeURIComponent(query)}`,
    ]

    for (const searchUrl of searchUrls) {
      try {
        console.log('[Scraper] Fetching URL:', searchUrl)
        // useBrowserFallback: true → 403 after retries auto-escalates to Playwright
        const html = await this.fetchHtml(searchUrl, { retries: 2, useBrowserFallback: true })
        console.log('[Scraper] HTML length:', html.length)

        if (html.length < 100) {
          console.warn('[Scraper] Search response too short, trying next URL')
          continue
        }

        const $ = this.parseHtml(html)

        const results: AnimeSearchResult[] = []
        const seenIds = new Set<string>()
        this.selectCardElements($).each((_, el) => {
          const card = this.extractCardData($(el), $)
          if (!card || seenIds.has(card.id)) return
          seenIds.add(card.id)
          results.push(card)
        })

        console.log('[Scraper] Parsed results count:', results.length)

        if (results.length > 0) {
          return results.slice(0, 24)
        }

        // 0 results from this URL — log and try next
        console.log('[Scraper] No results from', searchUrl, '— trying next search URL pattern')
      } catch (error) {
        // Site down — re-throw immediately, don't try other URLs
        if (error instanceof SiteDownError) throw error
        console.warn('[Scraper] Search attempt failed for', searchUrl, error)
      }
    }

    // All URL patterns exhausted — return empty with log
    console.log('[Scraper] All search URL patterns returned 0 results')
    return []
  }

  async getAnimeDetail(id: string): Promise<AnimeDetailExtended | null> {
    try {
      const detailUrl = `${this.baseUrl}/phim/${id}/`
      const html = await this.fetchHtml(detailUrl)
      const $ = this.parseHtml(html)
      
      // Extract title from h1.Title
      const title = $('h1.Title').first().text().trim() || 
                    $('h1').first().text().trim() || id
      
      // Extract alternative titles from multiple sources and pick the best clean one
      // Priority: h2.SubTitle (most reliable) > og:title > keywords
      const subtitleRaw = $('h2.SubTitle').first().text().trim()
      // og:title and keywords are captured for potential future use but not currently needed
      // const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || ''
      // const keywords = $('meta[name="keywords"]').attr('content')?.trim() || ''
      
      // Process SubTitle: split by common separators to get individual names
      // AVS uses formats like: "Romaji Name; English Name" or "Romaji, English"
      const subtitleParts = subtitleRaw
        ? subtitleRaw.split(/[,;|/\\]/).map(s => s.trim()).filter(s => s.length > 2)
        : []
      
      // Pick the best alt title: prefer the part that looks like Japanese/English (non-Vietnamese)
      // Heuristic: titles without Vietnamese diacritics are likely Romaji/English
      const isVietnamese = (s: string) => /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(s)
      
      // Find best non-Vietnamese alt (Romaji or English)
      const bestAlt = subtitleParts.find(p => !isVietnamese(p) && p !== title) ||
                      subtitleParts[0] ||
                      undefined
      
      const titleAlt = bestAlt ? this.decodeHtml(bestAlt) : undefined

      // Extract thumbnail from poster image
      let thumbnail = $('.Image figure img, .TPost .Image img').first()
        .attr('data-src') || 
        $('.Image figure img, .TPost .Image img').first().attr('src') || ''
      thumbnail = this.absolutizeUrl(thumbnail)

      // Extract cover/banner from TPostBg or meta
      let cover = $('.TPostBg').attr('src') || 
                  $('meta[itemprop="image"]').first().attr('content') || thumbnail
      cover = this.absolutizeUrl(cover)

      // Extract descriptions (VI/EN)
      const descriptionVi = $('.Description, .desc, .summary, [itemprop="description"]').first().text().trim() || undefined
      let descriptionEn =
        $('.DescriptionEn, .description-en, .summary-en, [class*="english"]').first().text().trim() ||
        undefined
      if (!descriptionEn) {
        const enMeta = $('meta[property="og:description"]').attr('content') || ''
        descriptionEn = enMeta.includes(' ') ? enMeta.trim() : undefined
      }
      const description = descriptionVi || descriptionEn

      // Extract rating from JSON-LD schema or star rating
      let rating: number | undefined
      // ratingCount extracted but not yet surfaced in AnimeDetail schema — kept for future use
      // ratingCount collected but not yet in AnimeDetail return schema
      // Try JSON-LD first
      const jsonLdScript = $('script[type="application/ld+json"]').first().html()
      if (jsonLdScript) {
        try {
          const jsonLd = JSON.parse(jsonLdScript)
          if (jsonLd.aggregateRating) {
            rating = parseFloat(jsonLd.aggregateRating.ratingValue)
          }
        } catch (e) {}
      }
      
      // Fallback to DOM
      if (!rating) {
        const ratingText = $('#average_score, .post-ratings strong').first().text()
        if (ratingText) {
          rating = parseFloat(ratingText)
        }
      }

      // Extract tags/genres ONLY from anime-info container to avoid pulling global site tags
      const infoRoot = $('.TPost, .MovieInfo, .InfoList, .Description').first()
      const tagCandidates = infoRoot.length > 0 ? infoRoot.find('a[href*="/the-loai/"], a[href*="/tag/"]') : $('a[href*="/the-loai/"], a[href*="/tag/"]')
      const genres: string[] = []
      tagCandidates.each((_, el) => {
        const genre = $(el).attr('title') || $(el).text().trim()
        if (genre && !genres.includes(genre)) genres.push(this.decodeHtml(genre))
      })
      const tags = [...genres]

      // Extract info from InfoList
      let status: string | undefined
      let year: number | undefined
      let director: string | undefined
      let studio: string | undefined
      let country: string | undefined
      let language: string | undefined
      let quality: string | undefined
      let totalEpisodes: number | undefined
      let views: number | undefined
      let followers: number | undefined
      let seasonInfo: string | undefined
      
      $('.InfoList li, .Info li, p.Info span').each((_, el) => {
        const text = $(el).text().trim()
        
        if (text.includes('Trạng thái:')) {
          status = text.replace('Trạng thái:', '').trim()
        }
        if (text.includes('Đạo diễn:')) {
          director = text.replace('Đạo diễn:', '').trim()
        }
        if (text.includes('Studio:')) {
          studio = $(el).find('a').text().trim() || text.replace('Studio:', '').trim()
        }
        if (text.includes('Quốc gia:')) {
          country = $(el).find('a').text().trim() || text.replace('Quốc gia:', '').trim()
        }
        if (text.includes('Ngôn ngữ:')) {
          language = text.replace('Ngôn ngữ:', '').trim()
        }
        if (text.includes('Chất lượng:')) {
          quality = $(el).find('.Qlty').text().trim() || text.replace('Chất lượng:', '').trim()
        }
        if (text.includes('Thời lượng:')) {
          const epMatch = text.match(/(\d+)\//)
          if (epMatch) totalEpisodes = parseInt(epMatch[1])
        }
        if (text.includes('Lượt Xem') || text.includes('Số người theo dõi:')) {
          const numMatch = text.replace(/,/g, '').match(/(\d+)/)
          if (numMatch) {
            if (text.includes('Lượt Xem')) views = parseInt(numMatch[1])
            if (text.includes('Số người theo dõi:')) followers = parseInt(numMatch[1])
          }
        }
        if (text.includes('Season:')) {
          seasonInfo = $(el).find('a').attr('title') || $(el).find('a').text().trim()
        }
      })
      
      // Extract year from Date span or info
      const yearText = $('p.Info .Date a, span.Date a').first().attr('title') || 
                       $('p.Info .Date a, span.Date a').first().text().trim()
      const yearMatch = yearText?.match(/(\d{4})/) || html.match(/(\d{4})/)
      if (yearMatch) year = parseInt(yearMatch[1])

      // Extract views from span
      const viewSpan = $('p.Info .View, span.View').first().text()
      if (viewSpan && !views) {
        const viewMatch = viewSpan.replace(/,/g, '').match(/(\d+)/)
        if (viewMatch) views = parseInt(viewMatch[1])
      }

      // Extract related anime (seasons/movies)
      const relatedAnime: Array<{ id: string; title: string; label: string; href: string }> = []
      const relatedSeen = new Set<string>()
      $('.season_item a, .Season .season_item a, .related-season a[href*="/phim/"], [class*="season"] a[href*="/phim/"]').each((_, el) => {
        const $el = $(el)
        const href = this.absolutizeUrl($el.attr('href') || '')
        const title = $el.attr('title') || ''
        const label = $el.text().trim()
        const relId = this.parseIdFromUrl(href)
        if (relId && title && !relatedSeen.has(relId)) {
          relatedSeen.add(relId)
          relatedAnime.push({
            id: relId,
            title: this.decodeHtml(title.replace('Phim ', '')),
            label,
            href
          })
        }
      })

      // Extract characters
      const characters: Array<{ name: string; image?: string }> = []
      $('#MvTb-Cast .ListCast li').each((_, el) => {
        const $el = $(el)
        const name = $el.find('figcaption').text().trim()
        let image = $el.find('img').attr('src') || undefined
        if (image?.includes('cast-image.png')) image = undefined // Skip placeholder
        if (name) {
          characters.push({ name: this.decodeHtml(name), image })
        }
      })

      // Count episodes from list
      const episodeCount = $('.list-episode a.episode-link, .list-episode li.episode a').length || 
                           $('a[href*="/tap-"]').length || undefined

      // Fetch AniList metadata (cover + banner) in one session-cached call
      let enhancedCover = cover
      let enhancedBanner: string | undefined = undefined
      try {
        const anilistMeta = await externalApi.getEnhancedMetadata(title, titleAlt)
        if (anilistMeta?.cover) {
          enhancedCover = anilistMeta.cover
          console.log(`✅ Got enhanced cover from AniList:`, anilistMeta.cover.substring(0, 60) + '...')
        }
        if (anilistMeta?.banner) {
          enhancedBanner = anilistMeta.banner
          console.log(`✅ Got banner from AniList:`, anilistMeta.banner.substring(0, 60) + '...')
        }
      } catch (e) {
        console.log('⚠️ Could not fetch AniList metadata, using local cover')
      }

      const imdbText = $('.InfoList, .Info, .MovieInfo').text()
      const imdbScore = this.parseImdbScore(imdbText)

      const anime: AnimeDetailExtended = {
        id,
        source: this.name.toLowerCase(),
        title: this.decodeHtml(title),
        titleAlt: titleAlt || undefined,
        thumbnail,
        cover: enhancedCover || cover,
        banner: enhancedBanner,
        descriptionVi: descriptionVi ? this.decodeHtml(descriptionVi) : undefined,
        descriptionEn: descriptionEn ? this.decodeHtml(descriptionEn) : undefined,
        description: description ? this.decodeHtml(description) : undefined,
        genres,
        tags,
        status,
        year,
        rating,
        imdbScore,
        episodeCount: totalEpisodes || episodeCount,
        director,
        studio,
        country,
        language,
        quality,
        views,
        followers,
        season: seasonInfo,
        relatedAnime: relatedAnime.length > 0 ? relatedAnime : undefined,
        characters: characters.length > 0 ? characters : undefined
      }

      // ── AniList image enrichment ──────────────────────────────────────────
      try {
        const anilist = await enrichWithAniList(anime.title)
        if (anilist.cover) anime.cover = anilist.cover
        if (anilist.banner) anime.banner = anilist.banner
      } catch { /* non-fatal */ }


      return anime
    } catch (error) {
      console.error('AnimeVietsub getAnimeDetail error:', error)
      return null
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    try {
      // First try the xem-phim.html page which has complete episode list
      let watchUrl = `${this.baseUrl}/phim/${animeId}/xem-phim.html`
      let html = await this.fetchHtml(watchUrl)
      let $ = this.parseHtml(html)
      
      // If no episodes found, try the detail page
      if ($('.list-episode a.episode-link, .list-episode li a').length === 0) {
        const detailUrl = `${this.baseUrl}/phim/${animeId}/`
        html = await this.fetchHtml(detailUrl)
        $ = this.parseHtml(html)
      }
      
      const episodes: Episode[] = []
      const seenNumbers = new Set<number>()
      
      // Parse episodes from list-episode container
      $('.list-episode li.episode a, .list-episode a.episode-link, a[data-id][href*="/tap-"]').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href') || ''
        const episodeId = $el.attr('data-id') || ''
        const dataHash = $el.attr('data-hash') || ''
        const text = $el.text().trim()
        const title = $el.attr('title') || ''
        
        // Extract episode number from text or URL
        const numMatch = text.match(/^(\d+)$/) || 
                         title.match(/Tập\s*(\d+)/i) ||
                         href.match(/tap-(\d+)/i) ||
                         href.match(/-(\d+)$/)
        
        let number = numMatch ? parseInt(numMatch[1]) : 0
        if (!number || isNaN(number)) {
          number = seenNumbers.size > 0 ? Math.max(...Array.from(seenNumbers)) + 1 : 1
        }
        
        while (seenNumbers.has(number)) {
          number++
        }
        seenNumbers.add(number)
        
        // Create a unique episode ID
        const epId = episodeId || this.parseIdFromUrl(href) || `${animeId}-ep-${number}`
        
        episodes.push({
          id: epId,
          animeId,
          number,
          title: title ? this.decodeHtml(title) : `Tập ${number.toString().padStart(3, '0')}`,
          source: 'animevietsub',
          // Store extra data for later use
          dataHash,
          href
        } as Episode & { dataHash?: string; href?: string })
      })

      // Sort by episode number
      episodes.sort((a, b) => a.number - b.number)


      return episodes
    } catch (error) {
      console.error('AnimeVietsub getEpisodes error:', error)
      return []
    }
  }

  async getVideoServers(episodeId: string): Promise<VideoServer[]> {
    try {
      // The episodeId can be:
      // 1. A data-id from episode list (e.g., "10032")
      // 2. A full URL
      // 3. A slug from URL (e.g., "tap-001-10032")
      
      let episodeUrl: string
      let html: string
      
      if (episodeId.startsWith('http')) {
        episodeUrl = episodeId
      } else if (episodeId.includes('/')) {
        episodeUrl = `${this.baseUrl}${episodeId}`
      } else if (/^\d+$/.test(episodeId)) {
        // Numeric data-id from episode list is not a valid watch URL by itself.
        // Use ajax endpoint to resolve server links directly.
        const response = await fetch(`${this.baseUrl}/ajax/player?v=${encodeURIComponent(episodeId)}`, {
          headers: this.buildRequestHeaders({
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': this.baseUrl
          })
        })
        if (response.ok) {
          const data: any = await response.json().catch(() => null)
          const servers: VideoServer[] = []
          if (data?.link) {
            const link = String(data.link)
            servers.push({
              name: link.includes('googleapiscdn') || link.includes('storage.') ? 'DU (Recommended)' : 'Main Server',
              embedUrl: link,
              quality: 'FHD',
              type: data.playTech || 'iframe',
              source: 'animevietsub'
            })
          }
          if (servers.length > 0) {
            console.log(`📺 Found ${servers.length} servers via ajax/player:`, servers.map(s => s.name).join(', '))
            return servers
          }
        }
        episodeUrl = `${this.baseUrl}/xem-phim/${episodeId}.html`
      } else {
        // Try to construct URL from episode ID or slug
        // First, check if it's a numeric ID - we need the anime context
        episodeUrl = `${this.baseUrl}/xem-phim/${episodeId}.html`
      }
      
      html = await this.fetchHtml(episodeUrl, { timeoutMs: 30000, retries: 2 })
      const $ = this.parseHtml(html)
      
      const servers: VideoServer[] = []
      
      // Extract player data from inline script (this contains DU server video)
      const playerDataMatch = html.match(/window\.PLAYER_DATA\s*=\s*(\{[\s\S]*?\});/)
      if (playerDataMatch) {
        try {
          const playerData = JSON.parse(playerDataMatch[1])
          console.log('📺 PLAYER_DATA:', JSON.stringify(playerData).substring(0, 200))
          
          if (playerData.link) {
            // This is typically the DU server (storage.googleapiscdn.com)
            const isDUServer = playerData.link.includes('googleapiscdn') || 
                               playerData.link.includes('storage.')
            const quality = 'FHD'
            
            servers.push({
              name: isDUServer ? 'DU (Recommended)' : 'Main Server',
              embedUrl: playerData.link,
              quality,
              type: playerData.playTech, // 'iframe', 'api', 'embed'
              source: 'animevietsub'
            })
          }
        } catch (e) {
          console.error('Failed to parse PLAYER_DATA:', e)
        }
      }
      
      // Parse all episode links to find different servers
      // Structure: li.episode a.episode-link with data-source, data-hash, data-play
      $('.list-episode a.episode-link, .list-episode li.episode a').each((_, el) => {
        const $el = $(el)
        const dataSource = $el.attr('data-source')
        const dataHash = $el.attr('data-hash')
        const dataPlay = $el.attr('data-play')
        // data-id reserved for future use
        // const dataId = $el.attr('data-id')
        const isActive = $el.hasClass('active')
        
        // Only process active episode links for server extraction
        if (!isActive || !dataHash) return
        
        // Create server entry based on data-source
        let serverName = 'Server'
        if (dataSource === 'du') serverName = 'DU'
        else if (dataSource === 'hydrax') serverName = 'Hydrax'
        else if (dataSource === 'fb') serverName = 'FB Server'
        else if (dataSource === 'gg') serverName = 'Google'
        else if (dataSource) serverName = dataSource.toUpperCase()
        
        // Don't add duplicates
        if (!servers.some(s => s.name.includes(serverName))) {
          servers.push({
            name: serverName,
            embedUrl: dataHash, // This is the encrypted hash to decode
            quality: 'HD',
            type: dataPlay || 'api',
            source: 'animevietsub'
          })
        }
      })
      
      // Find server groups from list-server section
      $('.list-server .server-title, .list-server h3.server-title').each((_, el) => {
        const serverName = $(el).text().trim()
        const $parent = $(el).closest('.backup-server, .server-group')
        const $activeEp = $parent.find('.episode-link.active, .episode-link').first()
        const dataHash = $activeEp.attr('data-hash')
        const dataPlay = $activeEp.attr('data-play')
        const dataSource = $activeEp.attr('data-source')
        
        if (dataHash && !servers.some(s => s.name === serverName)) {
          servers.push({
            name: serverName || dataSource?.toUpperCase() || 'Server',
            embedUrl: dataHash,
            quality: 'HD',
            type: dataPlay || 'api',
            source: 'animevietsub'
          })
        }
      })

      // Find backup link servers
      $('#links-backup a, .backup-link a').each((_, el) => {
        const $el = $(el)
        let src = $el.attr('href') || ''
        const name = $el.text().trim()
        
        if (src.startsWith('//')) src = `https:${src}`
        
        if (src && src.startsWith('http') && !servers.some(s => s.embedUrl === src)) {
          servers.push({
            name: name || 'Backup',
            embedUrl: src,
            quality: 'HD',
            source: 'animevietsub'
          })
        }
      })

      // Find iframes as fallback
      if (servers.length === 0) {
        $('iframe[src]').each((_, el) => {
          let src = $(el).attr('src') || ''
          if (src.startsWith('//')) src = `https:${src}`
          
          if (src && src.startsWith('http')) {
            let name = 'Server'
            if (src.includes('storage.googleapiscdn')) name = 'DU (CDN)'
            else if (src.includes('hydrax')) name = 'Hydrax'
            else if (src.includes('fb') || src.includes('facebook')) name = 'FB'
            else if (src.includes('stream')) name = 'Stream'
            else if (src.includes('drive.google')) name = 'Google Drive'
            
            servers.push({
              name,
              embedUrl: src,
              quality: 'HD',
              type: 'iframe',
              source: 'animevietsub'
            })
          }
        })
      }

      // Find video source in scripts
      if (servers.length === 0) {
        const scriptMatch = html.match(/(?:file|source|url|src)["']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)/i)
        if (scriptMatch) {
          servers.push({
            name: 'Direct HLS',
            embedUrl: scriptMatch[1],
            quality: 'HD',
            type: 'hls',
            source: 'animevietsub'
          })
        }
      }
      
      console.log(`📺 Found ${servers.length} servers:`, servers.map(s => s.name).join(', '))

      return servers
    } catch (error) {
      console.error('AnimeVietsub getVideoServers error:', error)
      return []
    }
  }

  async extractStreamUrl(server: VideoServer): Promise<StreamInfo | null> {
    try {
      let embedUrl = server.embedUrl
      
      // If it's already a stream URL, return directly
      if (embedUrl.includes('.m3u8') || embedUrl.includes('.mp4') || embedUrl.includes('/playlist/')) {
        if (embedUrl.startsWith('//')) embedUrl = `https:${embedUrl}`
        const normalized = embedUrl.toLowerCase()
        const shouldProxy =
          normalized.includes('storage.googleapiscdn.com') ||
          normalized.includes('storage.googleapis.com') ||
          normalized.includes('/chunks/') ||
          normalized.includes('/playlist/')
        const finalUrl = shouldProxy ? this.toMediaProxyUrl(embedUrl, this.baseUrl) : embedUrl
        const inferredType: 'hls' | 'mp4' =
          embedUrl.includes('.m3u8') || embedUrl.includes('/playlist/')
            ? 'hls'
            : 'mp4'
        
        return {
          url: finalUrl,
          type: inferredType,
          quality: server.quality || 'HD',
          headers: {
            'Referer': this.baseUrl,
            'Origin': this.baseUrl
          }
        }
      }

      // Fix URL format
      if (!embedUrl.startsWith('http')) {
        if (embedUrl.startsWith('//')) {
          embedUrl = `https:${embedUrl}`
        } else {
          embedUrl = `https://${embedUrl}`
        }
      }
      
      console.log('🔍 Extracting stream from:', embedUrl)
      console.log('📺 Server type:', server.type)
      
      // For DU server (storage.googleapiscdn.com iframe), we need special handling
      // The iframe itself loads an HLS player that plays video
      if (embedUrl.includes('storage.googleapiscdn.com') || server.type === 'iframe') {
        return await this.extractFromDUServer(embedUrl, server)
      }
      
      // For API type, use AJAX to get video URL
      if (server.type === 'api') {
        return await this.extractFromAPIServer(embedUrl, server)
      }

      // Use Playwright to extract stream from embed page
      return await this.extractWithPlaywright(embedUrl, server)
      
    } catch (error) {
      console.error('AnimeVietsub extractStreamUrl error:', error)
      let fallbackUrl = server.embedUrl
      if (fallbackUrl.startsWith('//')) fallbackUrl = `https:${fallbackUrl}`
      if (!fallbackUrl.startsWith('http')) fallbackUrl = `https://${fallbackUrl}`
      return {
        url: fallbackUrl,
        type: server.type === 'iframe' ? 'iframe' : 'hls',
        quality: server.quality || 'HD',
        headers: {
          'Referer': this.baseUrl,
          'Origin': this.baseUrl
        }
      }
    }
  }

  /**
   * Extract video from DU server (storage.googleapiscdn.com)
   * The player iframe loads HLS content that we need to intercept
   */
  private async extractFromDUServer(embedUrl: string, server: VideoServer): Promise<StreamInfo | null> {
    console.log('🎬 Extracting from DU server:', embedUrl)
    
    const crawler = await getCrawler()
    const page = await crawler.newPage()
    
    try {
      const interceptedUrls: string[] = []
      
      // Intercept network requests to find HLS/video URLs
      page.on('response', async (response: import('playwright').Response) => {
        const url = response.url()
        const contentType = response.headers()['content-type'] || ''
        
        // Look for HLS manifests or DU playlist/video files
        if (url.includes('.m3u8') || 
            url.includes('.mp4') ||
            url.includes('/playlist/') ||
            url.includes('/hls/') ||
            url.includes('/video/') ||
            contentType.includes('mpegurl') ||
            contentType.includes('video/')) {
          console.log('🎯 Intercepted:', url.substring(0, 100))
          interceptedUrls.push(url)
        }
      })
      
      // Navigate to the embed page.
      // Do NOT use networkidle here: DU player keeps network active and causes timeout.
      await page.goto(embedUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      })
      
      // Wait for player to initialize
      await page.waitForTimeout(3000)
      
      // Try to extract video source from page JS
      const jsUrls = await extractVideoFromJS(page)
      interceptedUrls.push(...jsUrls)
      
      // Try clicking play if video hasn't started
      try {
        await page.click('video, .play-button, [class*="play"]').catch(() => {})
        await page.waitForTimeout(2000)
      } catch (e) {}
      
      // Find best URL from intercepted requests (filter known ad URLs)
      const cleanUrls = interceptedUrls.filter(url => !this.isLikelyAdUrl(url))
      const m3u8Url = cleanUrls.find(url => url.includes('.m3u8'))
      const playlistUrl = cleanUrls.find(url => url.includes('/playlist/'))
      const mp4Url = cleanUrls.find(url => url.includes('.mp4'))
      const streamUrl = m3u8Url || playlistUrl || mp4Url
      
      if (streamUrl) {
        console.log('✅ Found DU stream:', streamUrl.substring(0, 100))
        // DU playlist URLs are frequently token-bound and can 403 via proxy.
        // Keep iframe playback for DU player path and let main-process frame
        // ad-cleaner strip pause ads in-place.
        if (streamUrl.includes('/playlist/')) {
          return {
            url: embedUrl,
            type: 'iframe',
            quality: server.quality || 'FHD',
            headers: {
              'Referer': this.baseUrl,
              'Origin': this.baseUrl
            }
          }
        }
        // For raw chunk URLs we still keep iframe fallback.
        if (streamUrl.includes('/chunks/')) {
          return {
            url: embedUrl,
            type: 'iframe',
            quality: server.quality || 'FHD',
            headers: {
              'Referer': this.baseUrl,
              'Origin': this.baseUrl
            }
          }
        }
        
        // Try to parse HLS for quality options
        if (streamUrl.includes('.m3u8')) {
          const finalM3u8 = this.toMediaProxyUrl(streamUrl, embedUrl)
          const playlist = await fetchM3U8(streamUrl, { Referer: embedUrl })
          if (playlist && playlist.qualities.length > 0) {
            return {
              url: finalM3u8,
              type: 'hls',
              quality: playlist.qualities[0].quality,
              headers: {
                'Referer': embedUrl,
                'Origin': new URL(embedUrl).origin
              }
            }
          }
        }
        
        return {
          url: streamUrl.includes('storage.googleapis') || streamUrl.includes('/chunks/')
            ? this.toMediaProxyUrl(streamUrl, embedUrl)
            : streamUrl,
          type: streamUrl.includes('.m3u8') ? 'hls' : 'mp4',
          quality: server.quality || 'FHD',
          headers: {
            'Referer': embedUrl,
            'Origin': new URL(embedUrl).origin
          }
        }
      }
      
      console.log('⚠️ No clean stream found in DU extraction, fallback to iframe')
      return {
        url: embedUrl,
        type: 'iframe',
        quality: server.quality || 'HD',
        headers: {
          'Referer': this.baseUrl,
          'Origin': this.baseUrl
        }
      }
      
    } finally {
      await page.close()
    }
  }

  /**
   * Extract video using API type (data-hash)
   */
  private async extractFromAPIServer(hash: string, server: VideoServer): Promise<StreamInfo | null> {
    console.log('🔗 Extracting from API server with hash')
    
    // The hash is used by the site's internal API
    // We need to call the same endpoint the player uses
    try {
      const response = await fetch(`${this.baseUrl}/ajax/player`, {
        method: 'POST',
        headers: this.buildRequestHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        }),
        body: `hash=${encodeURIComponent(hash)}`
      })
      
      if (response.ok) {
        const data = await response.json() as Record<string, string>
        if (data.link) {
          return {
            url: data.link,
            type: data.link.includes('.m3u8') ? 'hls' : 'mp4',
            quality: server.quality || 'HD',
            headers: {
              'Referer': this.baseUrl,
              'Origin': this.baseUrl
            }
          }
        }
      }
    } catch (e) {
      console.error('API extraction failed:', e)
    }
    
    // Fallback to Playwright
    return this.extractWithPlaywright(hash, server)
  }

  /**
   * Generic Playwright-based extraction
   */
  private async extractWithPlaywright(embedUrl: string, server: VideoServer): Promise<StreamInfo | null> {
    const crawler = await getCrawler()
    const page = await crawler.newPage()
    
    try {
      const interceptedUrls: string[] = []
      
      page.on('response', async (response: import('playwright').Response) => {
        const url = response.url()
        if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('/hls/')) {
          interceptedUrls.push(url)
        }
      })
      
      await page.goto(embedUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      })
      
      await page.waitForTimeout(3000)
      
      const jsUrls = await extractVideoFromJS(page)
      interceptedUrls.push(...jsUrls)
      
      try {
        await page.click('.play-button, [class*="play"], button:has-text("Play")').catch(() => {})
        await page.waitForTimeout(2000)
      } catch (e) {}
      
      const cleanUrls = interceptedUrls.filter(url => !this.isLikelyAdUrl(url))
      const m3u8Url = cleanUrls.find(url => url.includes('.m3u8'))
      const mp4Url = cleanUrls.find(url => url.includes('.mp4'))
      const streamUrl = m3u8Url || mp4Url
      
      if (streamUrl) {
        console.log('✅ Found stream:', streamUrl)
        
        if (streamUrl.includes('.m3u8')) {
          const finalM3u8 = this.toMediaProxyUrl(streamUrl, embedUrl)
          const playlist = await fetchM3U8(streamUrl, { Referer: embedUrl })
          if (playlist && playlist.qualities.length > 0) {
            return {
              url: finalM3u8,
              type: 'hls',
              quality: playlist.qualities[0].quality,
              headers: {
                'Referer': embedUrl,
                'Origin': new URL(embedUrl).origin
              }
            }
          }
        }
        
        return {
          url: streamUrl.includes('storage.googleapis') || streamUrl.includes('/chunks/')
            ? this.toMediaProxyUrl(streamUrl, embedUrl)
            : streamUrl,
          type: streamUrl.includes('.m3u8') ? 'hls' : 'mp4',
          quality: server.quality || 'HD',
          headers: {
            'Referer': embedUrl,
            'Origin': new URL(embedUrl).origin
          }
        }
      }
      
      console.log('⚠️ No clean stream found in generic extraction')
      return null
    } finally {
      await page.close()
    }
  }

  // Helper: Decode HTML entities
  private decodeHtml(html: string): string {
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&nbsp;/g, ' ')
  }
}
