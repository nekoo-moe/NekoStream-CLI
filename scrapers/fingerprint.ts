/**
 * Browser Fingerprint Profiles
 *
 * Also contains:
 *   - SiteDownError: typed error for origin-server outages
 *   - isOriginServerDownPage: detects custom 5xx error pages from known providers
 *
 * Ported from botasaurus browser_decorator.py + request_decorator.py patterns:
 * - user_agent evaluated per run_task (rotation per attempt)
 * - Coherent UA + Accept-Language + sec-ch-ua profile (not just UA string)
 * - evaluate_proxy: random.choice(proxy_list) → pickRandomProfile()
 *
 * Each profile mimics a real browser session: UA, sec-ch-ua hints, platform,
 * and Accept-Language are kept consistent (botasaurus: "keep Referer/Accept-Language
 * coherent with UA profile").
 */

export interface BrowserProfile {
  ua: string
  secChUa: string
  secChUaMobile: string
  secChUaPlatform: string
  acceptLanguage: string
}

/** Botasaurus pattern: full browser profile pool (not just UA strings) */
const BROWSER_PROFILES: BrowserProfile[] = [
  // Chrome 124 Windows
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  },
  // Chrome 122 Windows
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  },
  // Chrome 120 Windows
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'en-US,en;q=0.9,vi;q=0.8',
  },
  // Chrome 124 macOS
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"',
    acceptLanguage: 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  },
  // Chrome 122 macOS
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"',
    acceptLanguage: 'en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7',
  },
  // Firefox 125 Windows
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    secChUa: '',   // Firefox does not send sec-ch-ua
    secChUaMobile: '',
    secChUaPlatform: '',
    acceptLanguage: 'vi-VN,vi;q=0.8,en-US;q=0.5,en;q=0.3',
  },
  // Firefox 123 Windows
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    secChUa: '',
    secChUaMobile: '',
    secChUaPlatform: '',
    acceptLanguage: 'vi-VN,vi;q=0.8,en-US;q=0.5,en;q=0.3',
  },
  // Chrome 123 Linux
  {
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    secChUa: '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Linux"',
    acceptLanguage: 'en-US,en;q=0.9',
  },
]

/**
 * Botasaurus pattern: evaluate_proxy (random.choice) → pick random full profile.
 * Ensures UA + sec-ch-ua + platform are always coherent.
 */
export function pickRandomProfile(): BrowserProfile {
  return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)]
}

/**
 * Build fetch headers from a coherent browser profile.
 * Botasaurus: "keep Referer/Accept-Language coherent with UA profile"
 */
export function buildProfileHeaders(
  profile: BrowserProfile,
  referer: string,
  extraHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': profile.ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': profile.acceptLanguage,
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': referer,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
  }

  // Add Chromium client hints only for Chrome/Chromium profiles
  if (profile.secChUa) {
    headers['sec-ch-ua'] = profile.secChUa
    headers['sec-ch-ua-mobile'] = profile.secChUaMobile
    headers['sec-ch-ua-platform'] = profile.secChUaPlatform
    headers['Sec-Fetch-Dest'] = 'document'
    headers['Sec-Fetch-Mode'] = 'navigate'
    headers['Sec-Fetch-Site'] = 'same-origin'
    headers['Sec-Fetch-User'] = '?1'
  }

  return { ...headers, ...extraHeaders }
}

/**
 * Botasaurus pattern: isBlockedError — expanded from 403-only to cover full
 * Cloudflare error range and rate-limit responses.
 *
 * Cloudflare error codes:
 *   520 Unknown error, 521 Web server is down, 522 Connection timed out
 *   523 Origin unreachable, 524 Timeout, 525 SSL handshake failed
 *   526 Invalid SSL cert, 527 Railgun error, 530 Origin DNS error
 *   429 Too Many Requests (rate limiting)
 *   403 Forbidden (explicit block)
 */
export function isBlockedStatus(status: number): boolean {
  return status === 403 || status === 429 || (status >= 520 && status <= 530)
}

export function isBlockedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message
  // Match "HTTP 403", "HTTP 429", "HTTP 520" ... "HTTP 530"
  const statusMatch = msg.match(/HTTP (\d{3})/)
  if (statusMatch) {
    return isBlockedStatus(parseInt(statusMatch[1], 10))
  }
  return msg.includes('Forbidden')
}

/**
 * Botasaurus pattern: Cloudflare challenge detection.
 * Detects when a 200 response body is actually a CF challenge/CAPTCHA page.
 * (botasaurus: wait_for_cf, CloudflareDetectionException)
 */
export function isCloudflareChallengePage(html: string): boolean {
  if (html.length > 50000) return false  // Real pages are usually longer
  const lower = html.toLowerCase()
  return (
    lower.includes('just a moment') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('checking your browser') ||
    lower.includes('enable javascript and cookies') ||
    lower.includes('cloudflare') && lower.includes('challenge') ||
    lower.includes('ray id') && html.length < 15000 ||
    lower.includes('_cf_chl_opt') ||
    lower.includes('turnstile')
  )
}

/**
 * Typed error for when the origin server (not Cloudflare) is returning a 5xx
 * error page. Thrown when fetchHtmlWithPlaywright detects a known error page.
 */
export class SiteDownError extends Error {
  constructor(public readonly providerName: string) {
    super(`${providerName}: Máy chủ đang bảo trì hoặc gặp sự cố tạm thời. Vui lòng thử lại sau.`)
    this.name = 'SiteDownError'
  }
}

/**
 * Detects a custom origin-server 5xx error page returned by known providers.
 *
 * AnimeVietsub returns an 888k HTML page when its origin is down that:
 *   - Has title "Lỗi Server 5xx"
 *   - Has class="feature-list" in body (their custom error UI)
 *   - Contains zero /phim/ links
 *
 * Unlike isCloudflareChallengePage (which catches CF-generated pages),
 * this catches the provider's own error HTML.
 */
export function isOriginServerDownPage(html: string): boolean {
  const lower = html.toLowerCase()
  // AnimeVietsub custom 5xx page markers
  const isAVS5xx =
    lower.includes('lỗi server 5xx') ||
    lower.includes('loi server 5xx') ||
    (lower.includes('feature-list') &&
      lower.includes('web server is returning an unknown error') &&
      !lower.includes('/phim/'))
  if (isAVS5xx) return true
  // Generic origin-down signals when page has no real content
  const hasNoLinks = !lower.includes('/phim/') && !lower.includes('/anime/')
  const isErrorPage =
    (lower.includes('500') || lower.includes('503') || lower.includes('502')) &&
    lower.includes('server') &&
    html.length > 200000 && // Big page = full CSS bundle injected
    hasNoLinks
  return isErrorPage
}

/**
 * Botasaurus pattern: per-host request throttle.
 * "Enforce request spacing to reduce ban probability" (Phase 2, Task 2.3).
 * Maintains last-request timestamp per hostname and enforces minimum gap.
 */
export class HostThrottle {
  private lastRequestAt = new Map<string, number>()
  private readonly minGapMs: number

  constructor(minGapMs = 800) {
    this.minGapMs = minGapMs
  }

  async wait(url: string): Promise<void> {
    let hostname: string
    try {
      hostname = new URL(url).hostname
    } catch {
      return
    }

    const last = this.lastRequestAt.get(hostname) ?? 0
    const elapsed = Date.now() - last
    const remaining = this.minGapMs - elapsed

    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining))
    }
    this.lastRequestAt.set(hostname, Date.now())
  }
}
