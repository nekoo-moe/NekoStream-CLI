/**
 * Auth Service for NekoStream CLI
 * Manages login sessions for AnimeVietsub and Anime47 providers.
 * Uses Playwright headful (visible browser) instead of Electron BrowserWindow.
 */

import { loadAuthSession, saveAuthSession, clearAuthSession, getProviderCookieHeader, getProviderBaseUrl, type StoredCookie, type AuthSession } from '../storage'

// ── Shared Types ──────────────────────────────────────────────────────────────

export interface ProviderAuthStatus {
  provider: string
  loggedIn: boolean
  cookieCount: number
  hasAuthLikeCookie: boolean
  authConfirmed?: boolean
  userDisplayName?: string
  userAvatarUrl?: string
  userId?: string | number
}

export interface UserDataItem {
  animeId: string
  title: string
  thumbnail?: string
  url: string
  episodeNumber?: number
  status?: string  // watching, completed, favorite, etc.
}

export interface NotificationItem {
  id: string
  animeId?: string
  title: string
  message: string
  url: string
  thumbnail?: string
  timeAgo: string
  isRead: boolean
}

export interface UserDataResult {
  success: boolean
  authenticated: boolean
  items: UserDataItem[]
  notifications?: NotificationItem[]
  totalPages?: number
  currentPage?: number
  error?: string
}

// Re-export for convenience
export { getProviderCookieHeader }

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasAuthLikeCookie(cookies: StoredCookie[]): boolean {
  return cookies.some(c => /sess|auth|token|user|member|login/i.test(c.name))
}

function normalizeSameSite(v?: string): 'Strict' | 'Lax' | 'None' | undefined {
  if (!v) return undefined
  const n = v.toLowerCase()
  if (n === 'strict') return 'Strict'
  if (n === 'lax') return 'Lax'
  if (n === 'none' || n === 'no_restriction') return 'None'
  return undefined
}

function toStoredCookie(c: any): StoredCookie {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain || '',
    path: c.path || '/',
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
    sameSite: normalizeSameSite(c.sameSite),
    expirationDate: c.expires !== -1 ? c.expires : undefined
  }
}

async function launchHeadfulBrowser() {
  const { chromium } = await import('playwright')
  try {
    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    })
    return browser
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Executable doesn't exist") || msg.includes('browserType.launch')) {
      throw new Error('Trình duyệt Playwright chưa được cài. Chạy: npx playwright install chromium')
    }
    throw err
  }
}

/** Singleton adblocker instance — initialized once, reused for all contexts */
let _adblocker: any = null
async function getAdblocker() {
  if (_adblocker) return _adblocker
  try {
    const { PlaywrightBlocker } = await import('@ghostery/adblocker-playwright')
    const { fetch } = await import('cross-fetch')
    _adblocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch)
    console.log('[AdBlock] Ghostery adblocker loaded with EasyList/uBlock filter lists')
  } catch {
    console.log('[AdBlock] Could not load Ghostery adblocker, falling back to basic blocking')
    _adblocker = null
  }
  return _adblocker
}

/**
 * Apply ad blocking to a Playwright BrowserContext.
 * Sets up CSS/JS pop-up blocking via context.addInitScript (context-level).
 * Call applyAdBlockingToPage(page) after creating each page for network blocking.
 */
async function applyAdBlocking(context: import('playwright').BrowserContext): Promise<void> {
  // CSS + JS pop-up blocking at context level (runs on every page before load)
  await context.addInitScript(() => {
    window.open = () => null
    window.alert = () => {}
    window.confirm = () => false
    window.prompt = () => null

    const hideAds = () => {
      const style = document.createElement('style')
      style.textContent = `
        a[href*="win88"], a[href*="yo88"], a[href*="i9bet"],
        a[href*="sunwin"], a[href*="vsbet"], a[href*="five88"],
        a[href*="hit.club"], a[href*="gemwin"], a[href*="789bet"],
        img[src*="win88"], img[src*="yo88"], img[src*="i9bet"],
        img[src*="sunwin"], img[src*="gemwin"],
        [class*="quang-cao"], [id*="quang-cao"],
        [class*="popup-ad"], [class*="ad-overlay"],
        [class*="sticky-ad"], [class*="fixed-ad"], [class*="float-ad"] {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `
      document.head?.appendChild(style)
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hideAds)
    } else {
      hideAds()
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue
          const html = (node.outerHTML || '').toLowerCase()
          if (/win88|yo88|i9bet|sunwin|vsbet|five88|hit\.club|gemwin|789bet/.test(html)) {
            node.remove()
          }
        }
      }
    })
    const startObserver = () => observer.observe(document.body || document.documentElement, { childList: true, subtree: true })
    document.body ? startObserver() : document.addEventListener('DOMContentLoaded', startObserver)
  })
}

/**
 * Apply network-level ad blocking to a specific Playwright Page.
 * Uses @ghostery/adblocker-playwright (EasyList/uBlock) if available,
 * falls back to manual domain pattern matching.
 */
async function applyAdBlockingToPage(page: import('playwright').Page): Promise<void> {
  const blocker = await getAdblocker()
  if (blocker) {
    await blocker.enableBlockingInPage(page)
  } else {
    // Fallback: manual domain blocking
    await page.route('**/*', (route) => {
      const url = route.request().url().toLowerCase()
      if (/win88|yo88|i9bet|sunwin|fb88|vsbet|five88|hit\.club|gemwin|789bet|doubleclick|googlesyndication|exoclick|trafficjunky|popads|adcash|propellerads/.test(url)) {
        return route.abort()
      }
      return route.continue()
    })
  }
}

export function getAuthStatus(provider: string): ProviderAuthStatus {
  const session = loadAuthSession(provider)
  if (!session) return { provider, loggedIn: false, cookieCount: 0, hasAuthLikeCookie: false }

  const nowEpoch = Date.now() / 1000
  const valid = session.cookies.filter(c => !c.expirationDate || c.expirationDate > nowEpoch)
  const authCookie = hasAuthLikeCookie(valid)
  return {
    provider,
    loggedIn: Boolean(session.authConfirmed || session.userDisplayName || authCookie),
    cookieCount: valid.length,
    hasAuthLikeCookie: authCookie,
    authConfirmed: session.authConfirmed,
    userDisplayName: session.userDisplayName,
    userAvatarUrl: session.userAvatarUrl,
    userId: session.userId
  }
}

export function logoutProvider(provider: string): void {
  clearAuthSession(provider)
}

// ── AnimeVietsub Login ─────────────────────────────────────────────────────────

/**
 * Opens a visible Chromium window for user to login to AnimeVietsub.
 * Detects login success by URL change, then captures and saves cookies.
 */
export async function loginAnimeVietsubInteractive(): Promise<ProviderAuthStatus> {
  const AVS_BASE = getProviderBaseUrl('animevietsub')
  const AVS_LOGIN_URL = `${AVS_BASE}/account/login/`

  console.log(`\n[Auth] Opening browser for AnimeVietsub login...`)
  console.log(`[Auth] URL: ${AVS_LOGIN_URL}`)
  console.log('[Auth] Vui lòng đăng nhập trong cửa sổ trình duyệt. Cửa sổ sẽ tự đóng sau khi đăng nhập thành công.\n')

  const browser = await launchHeadfulBrowser()
  const context = await browser.newContext({
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1280, height: 720 }
  })

  // Stealth + ad blocking at context level (before any page is created)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    ;(globalThis as any).chrome = { runtime: {} }
  })
  await applyAdBlocking(context)

  const page = await context.newPage()
  await applyAdBlockingToPage(page)

  try {
    await page.goto(AVS_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Wait for successful login (redirect away from login page)
    await page.waitForFunction(
      () => !location.href.includes('/login') && !location.href.includes('/dang-nhap'),
      { timeout: 180000, polling: 1000 }
    )

    // Extra settle time for cookies to be written
    await page.waitForTimeout(2000)

    // Capture cookies from all origins the browser visited
    const rawCookies = await context.cookies()
    const cookies = rawCookies.filter(c => c.value && c.name).map(toStoredCookie)

    // Try to detect username from page
    let userDisplayName: string | undefined
    let userAvatarUrl: string | undefined
    try {
      const identity = await page.evaluate(() => {
        const usernameEl = document.querySelector('.UserInfo, .user-name, .username, [data-username], .LoggedUser')
        const avatarEl = document.querySelector('.UserAvatar img, .user-avatar img, .header-user-avatar img')
        return {
          username: usernameEl?.textContent?.trim() || usernameEl?.getAttribute('data-username') || null,
          avatar: avatarEl?.getAttribute('src') || null
        }
      })
      if (identity.username && identity.username.length < 50) userDisplayName = identity.username
      if (identity.avatar) userAvatarUrl = identity.avatar.startsWith('/') ? `${AVS_BASE}${identity.avatar}` : identity.avatar
    } catch { /* non-fatal */ }

    const session: AuthSession = {
      provider: 'animevietsub',
      cookies,
      capturedAt: new Date().toISOString(),
      source: 'interactive-login',
      authConfirmed: true,
      userDisplayName,
      userAvatarUrl
    }
    saveAuthSession('animevietsub', session)
    console.log(`[Auth] AnimeVietsub: Đăng nhập thành công! (${cookies.length} cookies)`)
    if (userDisplayName) console.log(`[Auth] Logged in as: ${userDisplayName}`)
    return getAuthStatus('animevietsub')
  } finally {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    await new Promise(r => setTimeout(r, 500))
  }
}

// ── AnimeVietsub Data Fetching ─────────────────────────────────────────────────

function buildAvsHeaders(cookieHeader: string, referer?: string): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cookie': cookieHeader,
    'Referer': referer || getProviderBaseUrl('animevietsub') + '/'
  }
}

function toAbsoluteAvsUrl(raw: string): string {
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `https:${raw}`
  const base = getProviderBaseUrl('animevietsub')
  if (raw.startsWith('/')) return `${base}${raw}`
  return `${base}/${raw}`
}

function parseAvsAnimeList(html: string): UserDataItem[] {
  const items: UserDataItem[] = []
  // Split by TPostMv items
  const parts = html.split(/<li[^>]*class="[^"]*TPostMv[^"]*"[^>]*>/i)
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i]
    const linkMatch = block.match(/href="((?:https?:\/\/animevietsub\.[a-z]+)?\/phim\/([^/"?#]+)\/?)"[^>]*>/i)
    if (!linkMatch) continue
    const animeId = linkMatch[2].replace(/\/$/, '')
    if (!animeId) continue
    const url = toAbsoluteAvsUrl(linkMatch[1])
    const titleMatch = block.match(/<h2[^>]*class="[^"]*Title[^"]*"[^>]*>([^<]+)<\/h2>/i) ||
                       block.match(/<h2[^>]*>([^<]+)<\/h2>/i)
    const title = titleMatch ? titleMatch[1].trim() : animeId.replace(/-a\d+$/, '').replace(/-/g, ' ')
    const imgMatch = block.match(/<img[^>]*src="([^"]+)"/i)
    const thumbnail = imgMatch ? toAbsoluteAvsUrl(imgMatch[1]) : undefined
    if (!items.some(x => x.animeId === animeId)) {
      items.push({ animeId, title, thumbnail, url })
    }
  }
  return items
}

function parseAvsPagination(html: string): { currentPage: number; totalPages: number } {
  let currentPage = 1, totalPages = 1
  const curMatch = html.match(/<span[^>]*class="[^"]*current[^"]*"[^>]*>(\d+)/i)
  if (curMatch) currentPage = parseInt(curMatch[1], 10)
  const trangLinks = html.match(/trang-(\d+)\.html/gi) || []
  for (const l of trangLinks) {
    const n = parseInt(l.match(/trang-(\d+)/i)?.[1] || '0', 10)
    if (n > totalPages) totalPages = n
  }
  return { currentPage, totalPages }
}

/**
 * Fetch an AnimeVietsub page using Playwright headless with injected cookies.
 * Required because animevietsub.site returns 403 to plain Node.js fetch().
 */
async function fetchAvsPage(
  url: string,
  cookies: import('../storage').StoredCookie[]
): Promise<{ html: string; finalUrl: string } | null> {
  const { chromium } = await import('playwright')
  let browser: import('playwright').Browser | null = null
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
    const context = await browser.newContext({
      locale: 'vi-VN',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    // Inject all saved cookies
    const pwCookies = cookies
      .filter(c => c.name && c.value)
      .map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '.animevietsub.site',
        path: c.path || '/',
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: (c.sameSite || 'Lax') as 'Strict' | 'Lax' | 'None',
        expires: c.expirationDate ?? -1
      }))

    await context.addCookies(pwCookies)

    const page = await context.newPage()
    // Block images/media to speed up (we only need HTML)
    await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,mp4,webm,mp3}', r => r.abort())

    console.log(`[AVS] Fetching (Playwright): ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const finalUrl = page.url()
    console.log(`[AVS] → final: ${finalUrl}`)

    if (/dang-nhap|\/login/i.test(finalUrl)) {
      console.log('[AVS] ⚠ Redirected to login — cookie invalid/expired')
      return null
    }

    const html = await page.content()
    const itemCount = (html.match(/class="[^"]*TPostMv[^"]*"/gi) || []).length
    console.log(`[AVS] HTML length: ${html.length}, TPostMv items found: ${itemCount}`)
    return { html, finalUrl }
  } catch (err) {
    console.log(`[AVS] fetch error: ${err}`)
    return null
  } finally {
    await browser?.close().catch(() => {})
  }
}

/**
 * Fetch an Anime47 page using Playwright headless with full localStorage restored.
 *
 * Strategy:
 *   1. Launch headless Chromium
 *   2. Navigate to anime47.best homepage (to prime the origin)
 *   3. Restore the COMPLETE localStorage snapshot captured at login time
 *   4. Navigate to the target URL — the SPA finds its auth state exactly as at login
 *
 * This avoids guessing key names and works regardless of how the SPA stores auth.
 */
export async function fetchA47Page(url: string): Promise<string | null> {
  const session = loadAuthSession('anime47')
  const token = session?.accessToken ?? null
  const lsSnapshot = session?.localStorageState ?? null

  if (!token && !lsSnapshot) {
    console.log('[A47] No auth data found, cannot fetch authenticated page')
    return null
  }

  const A47_ORIGIN = getProviderBaseUrl('anime47') || 'https://anime47.best'
  const { chromium } = await import('playwright')
  let browser: import('playwright').Browser | null = null
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const context = await browser.newContext({
      locale: 'vi-VN',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    // Block heavy assets for speed
    await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,mp4,webm,mp3}', r => r.abort())

    const page = await context.newPage()

    // Step 1: Prime the origin by navigating to homepage first
    // This is required so localStorage.setItem works (same-origin policy)
    console.log(`[A47] Priming origin: ${A47_ORIGIN}`)
    await page.goto(A47_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})

    // Step 2: Restore full localStorage snapshot from login session
    if (lsSnapshot && Object.keys(lsSnapshot).length > 0) {
      await page.evaluate((snapshot) => {
        try {
          Object.entries(snapshot).forEach(([k, v]) => {
            try { localStorage.setItem(k, v) } catch {}
          })
        } catch {}
      }, lsSnapshot)
      console.log(`[A47] Restored ${Object.keys(lsSnapshot).length} localStorage entries`)
    } else if (token) {
      // Fallback: inject only the token under common key names
      await page.evaluate((jwt) => {
        ['access_token', 'token', 'auth_token', 'authToken'].forEach(k => {
          try { localStorage.setItem(k, jwt) } catch {}
        })
      }, token)
      console.log(`[A47] Injected JWT token into localStorage`)
    }

    // Step 3: Navigate to the target URL with restored auth
    console.log(`[A47] Fetching (Playwright): ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    const finalUrl = page.url()

    if (/\/auth\/login|\/login(?!\/)/i.test(finalUrl)) {
      console.log(`[A47] ⚠ Redirected to login (${finalUrl}) — session expired, please re-login`)
      return null
    }

    // Wait for SPA state to fully hydrate
    await page.waitForFunction(
      () => !!(window as any).__NEXT_DATA__ || !!(window as any).__NUXT__ || !!(window as any).__INITIAL_STATE__ || document.readyState === 'complete',
      { timeout: 10000, polling: 300 }
    ).catch(() => {})

    const html = await page.content()
    console.log(`[A47] ✅ HTML length: ${html.length}`)
    return html
  } catch (err) {
    console.log(`[A47] Playwright fetch error: ${err}`)
    return null
  } finally {
    await browser?.close().catch(() => {})
  }
}

/**
 * Use Playwright to intercept the actual M3U8/MP4 stream URL from an Anime47 watch page.
 *
 * JWPlayer resolves opaque token URLs (pl.vlogphim.net/file/<token>) internally in the browser.
 * We cannot do this with a plain fetch() call — we must let JWPlayer run with auth and intercept
 * the real streaming request.
 *
 * Strategy:
 *   1. Launch headless Playwright with localStorage auth restored
 *   2. Navigate to the watch page → JWPlayer initializes
 *   3. Intercept all network requests
 *   4. Return the first .m3u8 / .mp4 / /playlist/ URL found
 *   5. Also try to extract from window.jwplayer() API as fallback
 */
export async function interceptA47StreamUrl(watchPageUrl: string): Promise<{
  url: string
  type: 'hls' | 'mp4' | 'dash'
  referer: string
} | null> {
  const session = loadAuthSession('anime47')
  const lsSnapshot = session?.localStorageState ?? null
  const token = session?.accessToken ?? null

  if (!token && !lsSnapshot) return null

  const A47_ORIGIN = getProviderBaseUrl('anime47') || 'https://anime47.best'
  const { chromium } = await import('playwright')
  let browser: import('playwright').Browser | null = null

  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const context = await browser.newContext({
      locale: 'vi-VN',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    // Block images/fonts but NOT video/media (we need to intercept those requests)
    await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf}', r => r.abort())

    let capturedStreamUrl: string | null = null
    let capturedType: 'hls' | 'mp4' | 'dash' = 'hls'

    // Intercept ALL requests — look for M3U8/MP4/playlist patterns
    context.on('request', (request) => {
      if (capturedStreamUrl) return
      const url = request.url()
      const lower = url.toLowerCase()
      if (lower.includes('.m3u8')) {
        capturedStreamUrl = url
        capturedType = 'hls'
        console.log(`[A47] 🎯 Intercepted M3U8: ${url}`)
      } else if (lower.includes('/playlist/') || lower.includes('/hls/') || lower.includes('/stream/')) {
        capturedStreamUrl = url
        capturedType = 'hls'
        console.log(`[A47] 🎯 Intercepted HLS stream: ${url}`)
      } else if (lower.includes('.mp4') && !lower.includes('thumbnail') && !lower.includes('poster')) {
        capturedStreamUrl = url
        capturedType = 'mp4'
        console.log(`[A47] 🎯 Intercepted MP4: ${url}`)
      } else if (lower.includes('.mpd')) {
        capturedStreamUrl = url
        capturedType = 'dash'
        console.log(`[A47] 🎯 Intercepted DASH: ${url}`)
      }
    })

    const page = await context.newPage()

    // Prime origin and restore localStorage
    await page.goto(A47_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    if (lsSnapshot && Object.keys(lsSnapshot).length > 0) {
      await page.evaluate((snap) => {
        Object.entries(snap).forEach(([k, v]) => {
          try { localStorage.setItem(k, v) } catch {}
        })
      }, lsSnapshot)
    } else if (token) {
      await page.evaluate((jwt) => {
        ['access_token', 'token', 'auth_token'].forEach(k => {
          try { localStorage.setItem(k, jwt) } catch {}
        })
      }, token)
    }

    console.log(`[A47] Intercepting streams from: ${watchPageUrl}`)
    await page.goto(watchPageUrl, { waitUntil: 'networkidle', timeout: 30000 })

    // Wait up to 12s for JWPlayer to initialize and make its first stream request
    const deadline = Date.now() + 12000
    while (!capturedStreamUrl && Date.now() < deadline) {
      await page.waitForTimeout(500)

      // Fallback: try to extract URL from JWPlayer API
      if (!capturedStreamUrl) {
        capturedStreamUrl = await page.evaluate(() => {
          try {
            const jw = (window as any).jwplayer?.()
            if (!jw) return null
            const item = jw.getPlaylistItem?.()
            const file = item?.file || item?.sources?.[0]?.file
            if (file && file.startsWith('http')) return file
          } catch {}
          // Also check video element
          const video = document.querySelector('video')
          if (video?.src && video.src.startsWith('http') && !video.src.includes('blob:')) return video.src
          if (video?.currentSrc && video.currentSrc.startsWith('http')) return video.currentSrc
          return null
        }).catch(() => null)

        if (capturedStreamUrl) {
          const lower = capturedStreamUrl.toLowerCase()
          capturedType = lower.includes('.mp4') ? 'mp4' : lower.includes('.mpd') ? 'dash' : 'hls'
          console.log(`[A47] 🎯 JWPlayer API: ${capturedStreamUrl}`)
        }
      }
    }

    if (capturedStreamUrl) {
      return { url: capturedStreamUrl, type: capturedType, referer: A47_ORIGIN }
    }

    console.log(`[A47] ⚠ Could not intercept stream URL from ${watchPageUrl}`)
    return null
  } catch (err) {
    console.log(`[A47] Stream interception error: ${err}`)
    return null
  } finally {
    await browser?.close().catch(() => {})
  }
}

export async function fetchAnimeVietsubList(listType: 'favorites' | 'history' | 'following', page = 1): Promise<UserDataResult> {
  const session = loadAuthSession('animevietsub')
  if (!session) return { success: false, authenticated: false, items: [], error: 'Chưa đăng nhập AnimeVietsub' }

  const base = getProviderBaseUrl('animevietsub')
  const altBase = base.replace(/animevietsub\.[a-z]+$/i, 'animevietsub.site')
  const bases = base === altBase ? [base] : [base, altBase]

  const pathMap: Record<string, string> = {
    favorites: '/tu-phim',
    history: '/lich-su/',
    following: '/theo-doi/'
  }
  const listPath = pathMap[listType]

  for (const b of bases) {
    const url = page > 1 ? `${b}${listPath.replace(/\/$/, '')}/trang-${page}.html` : `${b}${listPath}`
    const result = await fetchAvsPage(url, session.cookies)
    if (!result) continue
    const items = parseAvsAnimeList(result.html)
    const pagination = parseAvsPagination(result.html)
    return { success: true, authenticated: true, items, totalPages: pagination.totalPages, currentPage: pagination.currentPage }
  }
  return { success: false, authenticated: true, items: [], error: `Không tìm thấy trang ${listType}` }
}

export async function fetchAllAnimeVietsubList(listType: 'favorites' | 'history' | 'following'): Promise<UserDataResult> {
  const allItems: UserDataItem[] = []
  const first = await fetchAnimeVietsubList(listType, 1)
  if (!first.success) return first
  allItems.push(...first.items)
  const totalPages = first.totalPages || 1
  for (let p = 2; p <= totalPages; p++) {
    const res = await fetchAnimeVietsubList(listType, p)
    if (!res.success || res.items.length === 0) break
    for (const item of res.items) {
      if (!allItems.some(x => x.animeId === item.animeId)) allItems.push(item)
    }
    await new Promise(r => setTimeout(r, 300))
  }
  return { success: true, authenticated: true, items: allItems, totalPages, currentPage: totalPages }
}

export async function fetchAnimeVietsubNotifications(page = 1): Promise<UserDataResult> {
  const session = loadAuthSession('animevietsub')
  if (!session) return { success: false, authenticated: false, items: [], error: 'Chưa đăng nhập AnimeVietsub' }

  const base = getProviderBaseUrl('animevietsub')
  const altBase = base.replace(/animevietsub\.[a-z]+$/i, 'animevietsub.site')
  const bases = base === altBase ? [base] : [base, altBase]

  for (const b of bases) {
    const url = page > 1
      ? `${b}/tai-khoan/thong-bao/trang-${page}.html`
      : `${b}/tai-khoan/thong-bao/`
    const result = await fetchAvsPage(url, session.cookies)
    if (!result) continue
    const items = parseAvsAnimeList(result.html)
    const pagination = parseAvsPagination(result.html)
    return { success: true, authenticated: true, items, totalPages: pagination.totalPages, currentPage: pagination.currentPage }
  }
  return { success: false, authenticated: true, items: [], notifications: [], error: 'Không tìm thấy trang thông báo' }
}

// ── Anime47 Login ──────────────────────────────────────────────────────────────

/**
 * Opens a visible Chromium window for user to login to Anime47.
 * Captures cookies + userId from localStorage/sessionStorage after login.
 */
export async function loginAnime47Interactive(): Promise<ProviderAuthStatus> {
  const A47_BASE = getProviderBaseUrl('anime47')
  const A47_API = A47_BASE.replace(/\.[a-z]+$/, '.love') + '/api'

  console.log(`\n[Auth] Opening browser for Anime47 login...`)
  console.log(`[Auth] URL: ${A47_BASE}/auth/login`)
  console.log('[Auth] Vui lòng đăng nhập trong cửa sổ trình duyệt. Cửa sổ sẽ tự đóng sau khi đăng nhập thành công.\n')

  const browser = await launchHeadfulBrowser()
  const context = await browser.newContext({
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1280, height: 720 }
  })
  // Stealth + ad blocking at context level
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  await applyAdBlocking(context)

  const page = await context.newPage()
  await applyAdBlockingToPage(page)

  try {
    // Intercept auth API responses to capture JWT token before the page loads
    let capturedToken: string | null = null

    page.on('response', async (response) => {
      const url = response.url().toLowerCase()
      // Anime47 auth endpoints that return tokens
      if (url.includes('/api/auth') || url.includes('/api/login') || url.includes('/login') || url.includes('/token')) {
        try {
          if (response.headers()['content-type']?.includes('application/json')) {
            const body = await response.json().catch(() => null)
            if (body) {
              const token = body.token || body.access_token || body.accessToken ||
                            body.data?.token || body.data?.access_token || body.data?.accessToken ||
                            body.result?.token || body.result?.access_token
              if (token && String(token).length > 20) {
                capturedToken = String(token)
                console.log(`[Auth] JWT captured from network response: ${url}`)
              }
            }
          }
        } catch { /* ignore parse errors */ }
      }
    })

    await page.goto(`${A47_BASE}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Wait for user to login — anime47 redirects to homepage after successful login
    await page.waitForFunction(
      () => !location.href.includes('/auth/login') && !location.href.includes('/login'),
      { timeout: 180000, polling: 1000 }
    )

    // Give time for any async auth responses to complete
    await page.waitForTimeout(3000)

    // If network didn't capture token, try localStorage exhaustively
    if (!capturedToken) {
      capturedToken = await page.evaluate(() => {
        // Dump all keys for debugging
        const lsKeys = Object.keys(localStorage)
        const ssKeys = Object.keys(sessionStorage)
        console.log('[debug] localStorage keys:', lsKeys.join(', '))
        console.log('[debug] sessionStorage keys:', ssKeys.join(', '))

        // Try every localStorage/sessionStorage entry for JWT-like values
        for (const store of [localStorage, sessionStorage]) {
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i)!
            const val = store.getItem(key) || ''
            // JWT token is a long string, often starts with "ey" (base64 encoded JSON)
            if (val.startsWith('ey') && val.length > 40) return val
            // Try to parse JSON for nested token
            if (val.startsWith('{') || val.startsWith('[')) {
              try {
                const parsed = JSON.parse(val)
                const t = parsed?.token || parsed?.access_token || parsed?.accessToken ||
                          parsed?.data?.token || parsed?.data?.access_token
                if (t && String(t).length > 20) return String(t)
              } catch {}
            }
          }
        }
        // Check window-level token vars
        const win = window as any
        return win.__token || win.__accessToken || win.__auth?.token || null
      }).catch(() => null)

      if (capturedToken) {
        console.log(`[Auth] JWT captured from localStorage scan`)
      } else {
        console.log(`[Auth] ⚠ No JWT token found. Will try cookie-based auth.`)
      }
    }

    const rawCookies = await context.cookies()
    const cookies = rawCookies.filter(c => c.value && c.name).map(toStoredCookie)
    console.log(`[Auth] Captured ${cookies.length} cookies, token: ${capturedToken ? 'YES' : 'NO'}`)

    // Extract userId and username from page state
    let userDisplayName: string | undefined
    let userAvatarUrl: string | undefined
    let userId: string | number | undefined

    try {
      const data = await page.evaluate(() => {
        // Try sessionStorage / localStorage for token/user data
        let userId: any = null
        let username: string | null = null
        let avatar: string | null = null

        try {
          const userJson = sessionStorage.getItem('user') || localStorage.getItem('user')
          if (userJson) {
            const u = JSON.parse(userJson)
            userId = u?.id || u?.user_id || null
            username = u?.username || u?.name || u?.display_name || null
            avatar = u?.avatar || u?.avatar_url || null
          }
        } catch {}

        // Fallback: read from DOM
        if (!username) {
          const nameEl = document.querySelector('.header-user-name, .user-name, [class*="username"]')
          username = nameEl?.textContent?.trim() || null
        }
        if (!avatar) {
          const avatarEl = document.querySelector('.header-user-avatar img, .user-avatar img')
          avatar = avatarEl?.getAttribute('src') || null
        }

        // Try window.__INITIAL_STATE__
        try {
          const state = (window as any).__INITIAL_STATE__
          if (state?.queryCache?.queries) {
            for (const q of state.queryCache.queries) {
              const d = q.state?.data
              if (d?.id && (d?.username || d?.name)) {
                userId = userId || d.id
                username = username || d.username || d.name
                avatar = avatar || d.avatar
                break
              }
            }
          }
        } catch {}

        // Extract token from common storage locations
        let accessToken: string | null = null
        const tokenKeys = ['access_token', 'token', 'auth_token', 'authToken', 'jwt', 'bearer']
        for (const key of tokenKeys) {
          const val = localStorage.getItem(key) || sessionStorage.getItem(key)
          if (val && val.length > 20) { accessToken = val; break }
        }
        // Also check for token inside user JSON
        if (!accessToken) {
          try {
            const userJson = localStorage.getItem('user') || sessionStorage.getItem('user')
            if (userJson) {
              const parsed = JSON.parse(userJson)
              accessToken = parsed?.token || parsed?.access_token || parsed?.accessToken || null
            }
          } catch {}
        }

        // Capture full localStorage + sessionStorage snapshot
        const localStorageState: Record<string, string> = {}
        for (const store of [localStorage, sessionStorage]) {
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i)!
            const val = store.getItem(key)
            if (val !== null) localStorageState[key] = val
          }
        }

        return { userId, username, avatar, accessToken, localStorageState }
      })

      if (data.username && data.username.length < 50) userDisplayName = data.username
      if (data.avatar) userAvatarUrl = data.avatar.startsWith('/') ? `${A47_BASE}${data.avatar}` : data.avatar
      if (data.userId) userId = data.userId
      // Merge token: network interception is most reliable, then evaluate scan
      if (!capturedToken && (data as any).accessToken) {
        capturedToken = (data as any).accessToken
      }
      // Also log what keys we found
      const lsState: Record<string, string> = (data as any).localStorageState || {}
      const lsKeys = Object.keys(lsState)
      console.log(`[Auth] localStorage keys captured (${lsKeys.length}): ${lsKeys.join(', ')}`)
    } catch { /* non-fatal */ }

    const lsState: Record<string, string> = (await page.evaluate(() => {
      const state: Record<string, string> = {}
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i)!
          const val = store.getItem(key)
          if (val !== null) state[key] = val
        }
      }
      return state
    }).catch(() => {}))
    || {}

    const session: AuthSession = {
      provider: 'anime47',
      cookies,
      capturedAt: new Date().toISOString(),
      source: 'interactive-login',
      authConfirmed: true,
      userDisplayName,
      userAvatarUrl: userAvatarUrl ? (userAvatarUrl.startsWith('/') ? `${A47_BASE}${userAvatarUrl}` : userAvatarUrl) : undefined,
      userId,
      accessToken: capturedToken ?? undefined,
      localStorageState: Object.keys(lsState).length > 0 ? lsState : undefined
    }
    saveAuthSession('anime47', session)

    if (capturedToken) {
      console.log(`[Auth] Anime47: Đăng nhập thành công với JWT token! ✅`)
    } else {
      console.log(`[Auth] Anime47: Đăng nhập thành công (${cookies.length} cookies, không có JWT)`)
      console.log(`[Auth] ⚠ Nếu bị 401, hãy đăng xuất và đăng nhập lại`)
    }
    if (userDisplayName) console.log(`[Auth] Logged in as: ${userDisplayName}`)
    if (userId) console.log(`[Auth] User ID: ${userId}`)
    return getAuthStatus('anime47')
  } finally {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    await new Promise(r => setTimeout(r, 500))
  }
}

// ── Anime47 Data Fetching ──────────────────────────────────────────────────────

function buildA47Headers(authToken?: string | null, cookieHeader?: string | null): Record<string, string> {
  const base = getProviderBaseUrl('anime47')
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': base + '/',
    'Origin': base
  }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  if (cookieHeader) headers['Cookie'] = cookieHeader
  return headers
}

function getA47ApiBase(): string {
  const base = getProviderBaseUrl('anime47')
  // API lives on anime47.love regardless of frontend domain
  return base.replace(/\.[a-z]+$/, '.love') + '/api'
}

function mapA47Item(item: any): UserDataItem | null {
  if (!item || typeof item !== 'object') return null
  const base = getProviderBaseUrl('anime47')
  const link = String(item.link || item.canonical_url || item.url || '')
  const idMatch = link.match(/\/phim\/([^/]+)\/m(\d+)/i)
  const animeId = idMatch ? `${idMatch[1]}-m${idMatch[2]}` : String(item.id || item.anime_id || '')
  const title = String(item.title || item.name || '').trim()
  if (!animeId || !title) return null
  const rawPoster = String(item.poster || item.thumbnail || item.image || '')
  const thumbnail = rawPoster ? (rawPoster.startsWith('/') ? `${base}${rawPoster}` : rawPoster) : undefined
  return {
    animeId,
    title,
    thumbnail,
    url: link.startsWith('http') ? link : `${base}${link}`,
    status: String(item.status || item.list_status || '')
  }
}

/**
 * Get Anime47 user ID from stored session or API.
 */
async function getAnime47UserId(headers: Record<string, string>): Promise<string | number | null> {
  const session = loadAuthSession('anime47')
  if (session?.userId) return session.userId

  // Fetch from profile API
  try {
    const apiBase = getA47ApiBase()
    const res = await fetch(`${apiBase}/user/me`, { headers })
    if (res.ok) {
      const data = await res.json() as any
      const userId = data?.id || data?.user_id || data?.data?.id
      if (userId) {
        saveAuthSession('anime47', { ...session!, userId })
        return userId
      }
    }
  } catch { /* ignore */ }
  return null
}

export type Anime47ListStatus = 'favorite' | 'watching' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_watch' | 'history'

/**
 * Fetch user anime list by status from Anime47 REST API.
 */
export async function fetchAnime47List(status: Anime47ListStatus, page = 1): Promise<UserDataResult> {
  const session = loadAuthSession('anime47')
  if (!session) return { success: false, authenticated: false, items: [], error: 'Chưa đăng nhập Anime47' }

  const token = session.accessToken || null
  const cookieHeader = getProviderCookieHeader('anime47')
  if (!token && !cookieHeader) return { success: false, authenticated: false, items: [], error: 'Chưa đăng nhập Anime47 (không có token hoặc cookie)' }

  const headers = buildA47Headers(token, cookieHeader)
  const apiBase = getA47ApiBase()
  try {
    let url: string
    if (status === 'history') {
      url = `${apiBase}/profile/history/all?status=history&page=${page}&lang=vi`
    } else {
      const userId = await getAnime47UserId(headers)
      if (!userId) return { success: false, authenticated: true, items: [], error: 'Không lấy được User ID' }
      url = `${apiBase}/profile/${userId}/list?status=${status}&page=${page}&lang=vi`
    }

    console.log(`[A47] Fetching: ${url}`)
    const res = await fetch(url, { headers })
    console.log(`[A47] → ${res.status}`)
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { success: false, authenticated: false, items: [], error: 'Session hết hạn, vui lòng đăng nhập lại' }
      return { success: false, authenticated: true, items: [], error: `HTTP ${res.status}` }
    }

    const data = await res.json() as any
    const rawItems: any[] = Array.isArray(data) ? data :
                            Array.isArray(data?.data) ? data.data :
                            Array.isArray(data?.results) ? data.results :
                            Array.isArray(data?.items) ? data.items : []

    const items = rawItems.map(mapA47Item).filter((x): x is UserDataItem => x !== null)
    const totalPages = data?.meta?.last_page || data?.last_page || data?.totalPages || 1
    const currentPage = data?.meta?.current_page || data?.current_page || page

    return { success: true, authenticated: true, items, totalPages, currentPage }
  } catch (error) {
    return { success: false, authenticated: true, items: [], error: String(error) }
  }
}

export async function fetchAllAnime47List(status: Anime47ListStatus): Promise<UserDataResult> {
  const allItems: UserDataItem[] = []
  const first = await fetchAnime47List(status, 1)
  if (!first.success) return first
  allItems.push(...first.items)
  const totalPages = first.totalPages || 1
  for (let p = 2; p <= totalPages; p++) {
    const res = await fetchAnime47List(status, p)
    if (!res.success || res.items.length === 0) break
    for (const item of res.items) {
      if (!allItems.some(x => x.animeId === item.animeId)) allItems.push(item)
    }
    await new Promise(r => setTimeout(r, 200))
  }
  return { success: true, authenticated: true, items: allItems, totalPages, currentPage: totalPages }
}

export async function fetchAnime47Notifications(page = 1): Promise<UserDataResult> {
  const cookieHeader = getProviderCookieHeader('anime47')
  if (!cookieHeader) return { success: false, authenticated: false, items: [], error: 'Chưa đăng nhập Anime47' }

  const apiBase = getA47ApiBase()
  try {
    const res = await fetch(`${apiBase}/notifications?page=${page}&lang=vi`, { headers: buildA47Headers(cookieHeader) })
    if (!res.ok) return { success: false, authenticated: res.status !== 401, items: [], error: `HTTP ${res.status}` }

    const data = await res.json() as any
    const rawItems: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
    const notifications: NotificationItem[] = rawItems.map((item: any, idx: number) => ({
      id: String(item.id || idx),
      animeId: item.anime_id ? String(item.anime_id) : undefined,
      title: String(item.title || item.anime_title || ''),
      message: String(item.message || item.body || item.content || ''),
      url: String(item.url || item.link || getProviderBaseUrl('anime47')),
      thumbnail: item.thumbnail || item.image || undefined,
      timeAgo: String(item.time_ago || item.created_at || ''),
      isRead: Boolean(item.is_read || item.read)
    }))

    const totalPages = data?.meta?.last_page || data?.last_page || 1
    return { success: true, authenticated: true, items: [], notifications, totalPages, currentPage: page }
  } catch (error) {
    return { success: false, authenticated: true, items: [], error: String(error) }
  }
}

export async function fetchAnime47Profile(): Promise<{ username?: string; userId?: string | number; stats?: Record<string, number> } | null> {
  const session = loadAuthSession('anime47')
  if (!session) return null
  const token = session.accessToken || null
  const cookieHeader = getProviderCookieHeader('anime47')
  if (!token && !cookieHeader) return null

  const headers = buildA47Headers(token, cookieHeader)
  const apiBase = getA47ApiBase()
  try {
    const userId = await getAnime47UserId(headers)
    if (!userId) return null
    const res = await fetch(`${apiBase}/profile/${userId}`, { headers })
    if (!res.ok) return null
    const data = await res.json() as any
    return {
      username: data?.username || data?.name,
      userId: data?.id,
      stats: {
        total: data?.total_anime || 0,
        completed: data?.total_completed || 0,
        watching: data?.total_watching || 0,
        planToWatch: data?.total_plan_to_watch || 0
      }
    }
  } catch { return null }
}
