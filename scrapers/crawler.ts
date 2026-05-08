// Playwright-based scraper engine with stealth capabilities
// Handles JavaScript rendering, anti-bot bypass, and video stream interception

import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { EventEmitter } from 'events'

export interface CrawlerOptions {
  headless?: boolean
  timeout?: number
  userAgent?: string
  proxy?: string
}

export interface InterceptedStream {
  url: string
  type: 'hls' | 'mp4' | 'dash' | 'unknown'
  quality?: string
  headers?: Record<string, string>
}

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
]

export class PlaywrightCrawler extends EventEmitter {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private options: CrawlerOptions
  
  constructor(options: CrawlerOptions = {}) {
    super()
    this.options = {
      headless: true,
      timeout: 30000,
      ...options
    }
  }

  private getRandomUserAgent(): string {
    return this.options.userAgent || 
      DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
  }

  async init(): Promise<void> {
    if (this.browser) return

    this.browser = await chromium.launch({
      headless: this.options.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    })

    this.context = await this.browser.newContext({
      userAgent: this.getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      // Stealth settings
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      bypassCSP: true
    })

    // Add stealth scripts to evade detection
    await this.context.addInitScript(() => {
      // Override webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      })

      // Override plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      })

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['vi-VN', 'vi', 'en-US', 'en']
      })

      // Override chrome
      (window as any).chrome = {
        runtime: {}
      }

      // Override permissions
      const originalQuery = window.navigator.permissions.query
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: 'denied' } as PermissionStatus)
          : originalQuery(parameters)
      )
    })

    console.log('✅ Playwright crawler initialized')
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close()
      this.context = null
    }
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }

  async newPage(): Promise<Page> {
    if (!this.context) {
      await this.init()
    }
    return await this.context!.newPage()
  }

  /**
   * Lightweight ad/tracker blocking for noisy providers (e.g. Animet/HRX).
   * We block known ad networks and popup flows while keeping media requests intact.
   */
  async enableAdBlocking(page: Page): Promise<void> {
    const blockedHosts = [
      'doubleclick.net',
      'googlesyndication.com',
      'googleadservices.com',
      'adservice.google.com',
      'adnxs.com',
      'taboola.com',
      'outbrain.com',
      'popads.net',
      'propellerads.com',
      'adsterra.com',
      'exoclick.com',
      'hilltopads.net',
      'trafficjunky.net',
      'juicyads.com',
      'analytics.ahrefs.com'
    ]

    page.on('popup', async (popup) => {
      await popup.close().catch(() => {})
    })

    await page.route('**/*', async (route) => {
      const request = route.request()
      const url = request.url().toLowerCase()
      const type = request.resourceType()

      const matchedHost = blockedHosts.some((host) => url.includes(host))
      if (matchedHost) {
        await route.abort().catch(() => {})
        return
      }

      if (
        type === 'script' &&
        /(popunder|popup|onclickads|adsystem|adnetwork|adserver|bannerads)/i.test(url)
      ) {
        await route.abort().catch(() => {})
        return
      }

      await route.continue().catch(async () => {
        await route.abort().catch(() => {})
      })
    })
  }

  /**
   * Navigate to URL and wait for content to load
   */
  async goto(page: Page, url: string, options: { waitFor?: string } = {}): Promise<void> {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.options.timeout
    })

    // Wait for specific selector if provided
    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: this.options.timeout })
    }

    // Wait a bit for dynamic content
    await page.waitForTimeout(1000)
  }

  /**
   * Intercept network requests to capture video streams
   */
  async interceptStreams(page: Page, navigateUrl: string): Promise<InterceptedStream[]> {
    const streams: InterceptedStream[] = []
    const seenUrls = new Set<string>()

    // Listen for responses
    page.on('response', async (response) => {
      const url = response.url()
      
      // Skip if already seen
      if (seenUrls.has(url)) return
      
      // Check for video streams
      const contentType = response.headers()['content-type'] || ''
      const isStream = 
        url.includes('.m3u8') ||
        url.includes('.mpd') ||
        url.includes('.mp4') ||
        url.includes('/hls/') ||
        url.includes('/video/') ||
        contentType.includes('mpegurl') ||
        contentType.includes('dash+xml') ||
        contentType.includes('video/')

      if (isStream) {
        seenUrls.add(url)
        
        let type: InterceptedStream['type'] = 'unknown'
        if (url.includes('.m3u8') || contentType.includes('mpegurl')) {
          type = 'hls'
        } else if (url.includes('.mpd') || contentType.includes('dash')) {
          type = 'dash'
        } else if (url.includes('.mp4') || contentType.includes('video/mp4')) {
          type = 'mp4'
        }

        // Determine quality from URL
        let quality = 'unknown'
        const qualityMatch = url.match(/(\d{3,4})p|(\d{3,4})\.m3u8|quality[=_](\d+)/i)
        if (qualityMatch) {
          quality = (qualityMatch[1] || qualityMatch[2] || qualityMatch[3]) + 'p'
        } else if (url.includes('1080')) {
          quality = '1080p'
        } else if (url.includes('720')) {
          quality = '720p'
        } else if (url.includes('480')) {
          quality = '480p'
        }

        streams.push({
          url,
          type,
          quality,
          headers: {
            'Referer': page.url(),
            'Origin': new URL(page.url()).origin
          }
        })

        this.emit('stream', streams[streams.length - 1])
      }
    })

    // Navigate to the page
    await page.goto(navigateUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.options.timeout
    })

    // Wait for video player to initialize and start loading
    await page.waitForTimeout(5000)

    // Try to trigger video load by clicking play buttons
    try {
      const playButtons = await page.$$('button[class*="play"], .play-button, [aria-label*="play"], .art-icon-play')
      for (const btn of playButtons) {
        await btn.click().catch(() => {})
        await page.waitForTimeout(1000)
      }
    } catch (e) {
      // Ignore click errors
    }

    // Wait a bit more for streams to be captured
    await page.waitForTimeout(3000)

    return streams
  }

  /**
   * Extract content from iframe
   */
  async extractFromIframe(page: Page, iframeSelector: string): Promise<string | null> {
    try {
      const iframe = await page.$(iframeSelector)
      if (!iframe) return null

      const src = await iframe.getAttribute('src')
      if (!src) return null

      // Get full URL
      const baseUrl = new URL(page.url())
      const iframeUrl = src.startsWith('//') 
        ? `${baseUrl.protocol}${src}`
        : src.startsWith('http')
          ? src
          : new URL(src, baseUrl).href

      return iframeUrl
    } catch (error) {
      console.error('Error extracting iframe:', error)
      return null
    }
  }

  /**
   * Solve Cloudflare challenge (wait for it to pass)
   */
  async waitForCloudflare(page: Page, maxWait: number = 30000): Promise<boolean> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWait) {
      const title = await page.title()
      const content = await page.content()
      
      // Check if still on Cloudflare challenge
      if (
        title.includes('Just a moment') ||
        content.includes('Checking your browser') ||
        content.includes('cf-browser-verification')
      ) {
        await page.waitForTimeout(1000)
        continue
      }
      
      // Challenge passed
      return true
    }
    
    return false
  }
}

// Singleton instance
let crawlerInstance: PlaywrightCrawler | null = null

export async function getCrawler(options?: CrawlerOptions): Promise<PlaywrightCrawler> {
  if (!crawlerInstance) {
    crawlerInstance = new PlaywrightCrawler(options)
    await crawlerInstance.init()
  }
  return crawlerInstance
}

export async function closeCrawler(): Promise<void> {
  if (crawlerInstance) {
    await crawlerInstance.close()
    crawlerInstance = null
  }
}
