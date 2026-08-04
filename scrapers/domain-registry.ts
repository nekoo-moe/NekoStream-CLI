/**
 * The single source of truth for provider domains.
 *
 * Providers in this space rotate domains without notice, so a hardcoded
 * `baseUrl` is a feature with an expiry date: it works until the site moves,
 * then the CLI is simply broken for everyone who installed before the move.
 * This module holds the shape of each provider's domain — its registrable
 * label, the TLDs it has used, and, crucially, a *content signature* that says
 * what its real homepage looks like.
 *
 * That signature is the part the previous implementation was missing. It used
 * to accept any candidate whose fetch did not throw, so a parking page, a
 * squatter, or an ISP block page returning HTTP 200 counted as success — and
 * the result was written to settings permanently, with no TTL to recover from.
 *
 * Everything here is pure and I/O-free: `fetch` arrives through `ProbeDeps` so
 * the whole layer is testable offline (see checks/domain-check.mts). State and
 * disk live in domain-resolver.ts.
 */

import { isCloudflareChallengePage, isOriginServerDownPage } from './fingerprint'

/** Providers whose domains are probed. AnimeHay is deliberately excluded. */
export const RESOLVED_PROVIDER_IDS = ['animevietsub', 'anime47'] as const

export type ResolvedProviderId = (typeof RESOLVED_PROVIDER_IDS)[number]

export interface ProviderDomainSpec {
  /**
   * Registrable label — the part that does not change when the TLD does. This
   * is also the identity we check candidates against, so a hostile
   * `animevietsub.attacker.example` cannot pass as ours.
   */
  label: string
  /**
   * Candidate TLDs, most-likely first. Order matters: it decides which live
   * domain wins when several respond.
   */
  tlds: string[]
  /** Path fetched when probing. Must exist on the real site. */
  probePath: string
  /**
   * True when the HTML looks like this provider's real page. Called only after
   * the generic rejections below have passed.
   */
  hasSignature: (html: string, lower: string) => boolean
  /**
   * Some providers serve their JSON API from a different TLD than their site
   * (Anime47 serves `/api` from `.love`). Kept here so the mapping is data
   * rather than a regex buried in the provider class.
   */
  apiTld?: string
}

export const PROVIDER_DOMAIN_SPECS: Record<ResolvedProviderId, ProviderDomainSpec> = {
  animevietsub: {
    label: 'animevietsub',
    // .site and .love are the long-lived pair; the rest are domains the site
    // has actually used, plus the TLDs it has rotated through historically.
    tlds: ['site', 'love', 'fan', 'bz', 'tv', 'pro', 'net', 'cc'],
    probePath: '/',
    // `TPost` is the CSS class on every card in their homepage grid, and
    // `/phim/` is the detail-page prefix. A page with both is their template;
    // a page with neither is something else wearing their domain.
    hasSignature: (_html, lower) => lower.includes('/phim/') && lower.includes('tpost')
  },
  anime47: {
    label: 'anime47',
    tlds: ['best', 'love', 'net', 'pro', 'cc'],
    probePath: '/',
    hasSignature: (_html, lower) => lower.includes('anime47') && lower.includes('/phim/'),
    apiTld: 'love'
  }
}

/** Domain a provider falls back to when nothing has been probed yet. */
export function seedBaseUrl(provider: ResolvedProviderId): string {
  const spec = PROVIDER_DOMAIN_SPECS[provider]
  return `https://${spec.label}.${spec.tlds[0]}`
}

export function isResolvedProviderId(value: string): value is ResolvedProviderId {
  return RESOLVED_PROVIDER_IDS.includes(value as ResolvedProviderId)
}

/**
 * True when `hostname`'s registrable label is `label`, so `cdn.anime47.best`
 * matches and `anime47.attacker.example` does not.
 *
 * This replaces `hostname.includes(label)`, which was how the old resolver
 * decided whether a redirect target could be trusted and written to disk.
 */
export function matchesLabel(hostname: string, label: string): boolean {
  const parts = hostname.toLowerCase().split('.')
  if (parts.length < 2) return false
  return parts[parts.length - 2] === label.toLowerCase()
}

/** Strip trailing slashes and force a scheme so comparisons are stable. */
export function normalizeBaseUrl(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(withScheme).origin
  } catch {
    return ''
  }
}

/**
 * Candidate origins for a provider, best-first and deduplicated.
 *
 * `preferred` (the domain currently in use) always goes first so the common
 * case costs exactly one request. Only its label is trusted — a preferred value
 * pointing at someone else's host is dropped rather than probed.
 */
export function buildCandidates(spec: ProviderDomainSpec, preferred?: string): string[] {
  const ordered: string[] = []
  const preferredOrigin = preferred ? normalizeBaseUrl(preferred) : ''
  if (preferredOrigin) {
    try {
      if (matchesLabel(new URL(preferredOrigin).hostname, spec.label)) {
        ordered.push(preferredOrigin)
      }
    } catch {
      // Unparseable preferred value; the seed list below still applies.
    }
  }
  for (const tld of spec.tlds) {
    ordered.push(`https://${spec.label}.${tld}`)
  }
  // HTTPS only: these are auth-bearing origins, and the whole point of probing
  // is to pick one we then send cookies to.
  return [...new Set(ordered)].filter((url) => url.startsWith('https://'))
}

/**
 * Pages that are technically a 200 but are not a provider: parked domains,
 * for-sale placeholders, ISP block notices, and CDN interstitials.
 */
const PARKING_MARKERS = [
  'domain for sale',
  'this domain is for sale',
  'buy this domain',
  'domain is parked',
  'parked domain',
  'parkingcrew',
  'sedoparking',
  'afternic',
  'dan.com',
  'godaddy.com/domainsearch',
  'namecheap.com/domains',
  'expired domain'
]

export type VerifyResult = { ok: true } | { ok: false; reason: string }

/**
 * Decide whether `html` is the provider's real page.
 *
 * Rejections come first and are all "this is not content" checks; the
 * provider-specific signature only runs on what survives. Two of the three
 * rejections reuse the detectors already written for the scraper retry loop
 * (fingerprint.ts) rather than restating their heuristics here.
 */
export function verifyProviderHtml(html: string, spec: ProviderDomainSpec): VerifyResult {
  if (!html || html.length < 2000) {
    return { ok: false, reason: `phản hồi quá ngắn (${html?.length ?? 0} bytes)` }
  }

  const lower = html.toLowerCase()

  if (isCloudflareChallengePage(html)) {
    return { ok: false, reason: 'trang Cloudflare challenge' }
  }
  if (isOriginServerDownPage(html)) {
    return { ok: false, reason: 'trang lỗi origin server' }
  }
  for (const marker of PARKING_MARKERS) {
    if (lower.includes(marker)) {
      return { ok: false, reason: `trang parking/rao bán domain (${marker})` }
    }
  }

  if (!spec.hasSignature(html, lower)) {
    return { ok: false, reason: 'không khớp chữ ký nội dung của provider' }
  }

  return { ok: true }
}

/** Injected so probing is offline-testable. */
export interface ProbeDeps {
  fetch: typeof fetch
  timeoutMs?: number
}

export type ProbeResult =
  | { ok: true; baseUrl: string }
  | { ok: false; candidate: string; reason: string }

const DEFAULT_PROBE_TIMEOUT_MS = 2500

/** Browser-ish headers: a bare Node fetch is refused by several of these hosts. */
const PROBE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
}

/**
 * Fetch one candidate and decide whether it is a usable base URL.
 *
 * The redirect check is the security-relevant part: providers redirect between
 * their own domains constantly, so redirects must be followed — but the final
 * hostname is re-checked against the label before its HTML is trusted. Without
 * that, any candidate could hand us an attacker origin to adopt and persist.
 */
export async function probeCandidate(
  candidate: string,
  spec: ProviderDomainSpec,
  deps: ProbeDeps
): Promise<ProbeResult> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const url = `${candidate}${spec.probePath}`

  let response: Response
  try {
    response = await deps.fetch(url, {
      headers: PROBE_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, candidate, reason: `không kết nối được (${message})` }
  }

  if (!response.ok) {
    return { ok: false, candidate, reason: `HTTP ${response.status}` }
  }

  // Where we actually landed, which may not be where we asked.
  const finalUrl = response.url || url
  let finalOrigin: string
  let finalHostname: string
  try {
    const parsed = new URL(finalUrl)
    finalOrigin = parsed.origin
    finalHostname = parsed.hostname
  } catch {
    return { ok: false, candidate, reason: 'URL phản hồi không phân giải được' }
  }

  if (!matchesLabel(finalHostname, spec.label)) {
    return { ok: false, candidate, reason: `redirect ra ngoài provider (${finalHostname})` }
  }
  if (!finalOrigin.startsWith('https://')) {
    return { ok: false, candidate, reason: `redirect xuống HTTP (${finalOrigin})` }
  }

  let html: string
  try {
    html = await response.text()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, candidate, reason: `không đọc được body (${message})` }
  }

  const verified = verifyProviderHtml(html, spec)
  if (!verified.ok) {
    return { ok: false, candidate, reason: verified.reason }
  }

  return { ok: true, baseUrl: finalOrigin }
}
