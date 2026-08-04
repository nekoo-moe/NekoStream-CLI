/**
 * Resolves each provider's live base URL, and remembers what it found.
 *
 * Three sources feed a provider's base URL, in strict precedence order:
 *
 *   1. `settings.providerDomains[provider]` — the user typed it in Settings.
 *      The prober NEVER writes here and never overrides it. Previously both the
 *      user and the auto-discovery shared this field, so a probe could silently
 *      replace a domain the user had deliberately chosen.
 *   2. `~/.nekostream-cli/domain-cache.json` — the last domain a probe verified.
 *      Written only by this module, carries `verifiedAt` so it is auditable.
 *   3. The seed in domain-registry.ts — first run, or nothing else survived.
 *
 * Probing runs at startup but is shaped so the normal case is nearly free: the
 * current domain is probed alone first (one request), and the TLD fan-out only
 * happens when that fails. Nothing here ever blocks the user from entering the
 * app — if the network is gone, resolution reports failure and the cached or
 * seeded value is used as-is.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { debugLog, debugWarn } from '../logger'
import { loadSettings, PROVIDER_DEFAULT_DOMAINS } from '../storage'
import type { ProviderId } from '../provider-types'
import {
  buildCandidates,
  isResolvedProviderId,
  normalizeBaseUrl,
  probeCandidate,
  PROVIDER_DOMAIN_SPECS,
  RESOLVED_PROVIDER_IDS,
  seedBaseUrl,
  matchesLabel,
  type ProbeDeps,
  type ResolvedProviderId
} from './domain-registry'

const DATA_DIR = path.join(os.homedir(), '.nekostream-cli')
const DOMAIN_CACHE_FILE = path.join(DATA_DIR, 'domain-cache.json')

/** How many candidates are probed at once during a fan-out. */
const FAN_OUT_CONCURRENCY = 4

/** Per-request budget. Eight candidates at four-wide stays inside ~5s worst case. */
const PROBE_TIMEOUT_MS = 2500

export type DomainSource = 'manual' | 'verified' | 'seed'

export interface DomainCacheEntry {
  baseUrl: string
  /** ISO timestamp of the probe that accepted this domain. */
  verifiedAt: string
}

type DomainCache = Partial<Record<ResolvedProviderId, DomainCacheEntry>>

export interface ResolvedDomain {
  baseUrl: string
  source: DomainSource
  verifiedAt?: string
}

// ── Cache file ───────────────────────────────────────────────────────────────

function readCache(): DomainCache {
  try {
    if (!fs.existsSync(DOMAIN_CACHE_FILE)) return {}
    const parsed = JSON.parse(fs.readFileSync(DOMAIN_CACHE_FILE, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const result: DomainCache = {}
    for (const [provider, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!RESOLVED_PROVIDER_IDS.includes(provider as ResolvedProviderId)) continue
      if (!value || typeof value !== 'object') continue
      const entry = value as Partial<DomainCacheEntry>
      if (typeof entry.baseUrl !== 'string') continue

      // A cache entry is data from disk, so re-check it rather than trusting it:
      // the file is user-writable and its whole job is to name an origin we then
      // send session cookies to.
      const origin = normalizeBaseUrl(entry.baseUrl)
      if (!origin) continue
      const spec = PROVIDER_DOMAIN_SPECS[provider as ResolvedProviderId]
      if (!matchesLabel(new URL(origin).hostname, spec.label)) continue

      result[provider as ResolvedProviderId] = {
        baseUrl: origin,
        verifiedAt: typeof entry.verifiedAt === 'string' ? entry.verifiedAt : ''
      }
    }
    return result
  } catch (error) {
    debugWarn('[Domain] Không đọc được domain cache:', error)
    return {}
  }
}

function writeCacheEntry(provider: ResolvedProviderId, baseUrl: string): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    const cache = readCache()
    cache[provider] = { baseUrl, verifiedAt: new Date().toISOString() }
    fs.writeFileSync(DOMAIN_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
  } catch (error) {
    // A read-only home directory must not break playback; the domain still
    // applies for this session, it just is not remembered.
    debugWarn('[Domain] Không ghi được domain cache:', error)
  }
}

export function clearDomainCache(): void {
  try {
    if (fs.existsSync(DOMAIN_CACHE_FILE)) fs.unlinkSync(DOMAIN_CACHE_FILE)
  } catch (error) {
    debugWarn('[Domain] Không xoá được domain cache:', error)
  }
  resolvedThisSession.clear()
}

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * In-process memo. Every provider method calls getResolvedDomain(), so without
 * this the settings file and the cache file would be re-read on every request.
 */
const resolvedThisSession = new Map<ResolvedProviderId, ResolvedDomain>()

/** The manual override, if the user set one and it is actually this provider. */
function manualOverride(provider: ResolvedProviderId): string | null {
  try {
    const raw = loadSettings().providerDomains?.[provider]
    if (!raw || !raw.trim()) return null
    const origin = normalizeBaseUrl(raw)
    if (!origin) return null
    // A typo that lands on someone else's domain is worth surfacing rather than
    // silently sending cookies to.
    if (!matchesLabel(new URL(origin).hostname, PROVIDER_DOMAIN_SPECS[provider].label)) {
      debugWarn(
        `[Domain] Bỏ qua override thủ công cho ${provider}: ${origin} không thuộc provider này`
      )
      return null
    }
    return origin
  } catch {
    return null
  }
}

/**
 * The base URL to use right now, without touching the network.
 *
 * This is what providers and auth call on every request; it is deliberately
 * synchronous and cheap so it can sit in a hot path.
 */
export function getResolvedDomain(provider: ResolvedProviderId): ResolvedDomain {
  const manual = manualOverride(provider)
  if (manual) return { baseUrl: manual, source: 'manual' }

  const memo = resolvedThisSession.get(provider)
  if (memo) return memo

  const cached = readCache()[provider]
  if (cached) {
    const entry: ResolvedDomain = {
      baseUrl: cached.baseUrl,
      source: 'verified',
      verifiedAt: cached.verifiedAt
    }
    resolvedThisSession.set(provider, entry)
    return entry
  }

  return { baseUrl: seedBaseUrl(provider), source: 'seed' }
}

/** Convenience wrapper for the many callers that only want the string. */
export function getResolvedBaseUrl(provider: ResolvedProviderId): string {
  return getResolvedDomain(provider).baseUrl
}

/**
 * Base URL for any provider, including the ones that are not probed.
 *
 * This is the single entry point the rest of the codebase should use. Probed
 * providers go through the resolver; AnimeHay (kept working, no longer invested
 * in) falls back to its manual override or its literal default.
 */
export function getProviderBaseUrl(provider: ProviderId): string {
  return getProviderDomainInfo(provider).baseUrl
}

/**
 * Same resolution as {@link getProviderBaseUrl}, but reports *where* the value
 * came from. The Settings menu shows this so a user can tell a domain they typed
 * from one the prober found from an untouched default — which the old menu could
 * not, because both lived in the same settings field.
 */
export function getProviderDomainInfo(provider: ProviderId): ResolvedDomain {
  if (isResolvedProviderId(provider)) return getResolvedDomain(provider)

  const custom = loadSettings().providerDomains?.[provider]
  if (custom && custom.trim()) {
    const origin = normalizeBaseUrl(custom)
    if (origin) return { baseUrl: origin, source: 'manual' }
  }
  return { baseUrl: PROVIDER_DEFAULT_DOMAINS[provider], source: 'seed' }
}

/**
 * Candidate origins to retry a failed request against, current domain excluded.
 * Replaces the per-provider `knownBaseUrls` list that only AnimeVietsub had.
 */
export function getAlternateBaseUrls(provider: ResolvedProviderId): string[] {
  const current = getResolvedBaseUrl(provider)
  return buildCandidates(PROVIDER_DOMAIN_SPECS[provider], current).filter(
    (url) => url !== current
  )
}

/**
 * Record a domain that a real request just proved works.
 *
 * Called from the scraper retry path, so it must not override a manual choice:
 * the user asked for that domain specifically, and a working alternative does
 * not change their intent.
 */
export function rememberVerifiedDomain(provider: ResolvedProviderId, baseUrl: string): void {
  const origin = normalizeBaseUrl(baseUrl)
  if (!origin) return
  if (!matchesLabel(new URL(origin).hostname, PROVIDER_DOMAIN_SPECS[provider].label)) return
  if (manualOverride(provider)) return
  if (getResolvedBaseUrl(provider) === origin) return

  resolvedThisSession.set(provider, {
    baseUrl: origin,
    source: 'verified',
    verifiedAt: new Date().toISOString()
  })
  writeCacheEntry(provider, origin)
  debugLog(`[Domain] ${provider}: đã ghi nhận domain hoạt động ${origin}`)
}

export type ResolveOutcome =
  | { status: 'ok'; provider: ResolvedProviderId; baseUrl: string; changed: boolean }
  | { status: 'manual'; provider: ResolvedProviderId; baseUrl: string }
  | { status: 'failed'; provider: ResolvedProviderId; baseUrl: string; tried: number }

/** Run `tasks` at most `limit` at a time, preserving result order. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Probe one provider and persist the winner.
 *
 * Two phases on purpose. The current domain is probed alone first, because it
 * is right almost every time and a hit costs one request — that is what makes
 * "always probe at startup" affordable. Only when it fails do we fan out across
 * the TLD list, and even then the ordering in the spec decides the winner, so
 * results stay deterministic rather than "whichever host replied first".
 */
export async function resolveProviderDomain(
  provider: ResolvedProviderId,
  deps: ProbeDeps = { fetch: globalThis.fetch, timeoutMs: PROBE_TIMEOUT_MS }
): Promise<ResolveOutcome> {
  const spec = PROVIDER_DOMAIN_SPECS[provider]
  const current = getResolvedDomain(provider)

  if (current.source === 'manual') {
    // The user pinned this. Probing it would only produce a warning we have no
    // mandate to act on.
    return { status: 'manual', provider, baseUrl: current.baseUrl }
  }

  const fast = await probeCandidate(current.baseUrl, spec, deps)
  if (fast.ok) {
    if (fast.baseUrl !== current.baseUrl || current.source === 'seed') {
      rememberVerifiedDomain(provider, fast.baseUrl)
    }
    return {
      status: 'ok',
      provider,
      baseUrl: fast.baseUrl,
      changed: fast.baseUrl !== current.baseUrl
    }
  }
  debugWarn(`[Domain] ${provider}: ${current.baseUrl} không dùng được — ${fast.reason}`)

  const alternates = buildCandidates(spec, current.baseUrl).filter(
    (url) => url !== current.baseUrl
  )
  const probes = await mapWithLimit(alternates, FAN_OUT_CONCURRENCY, (candidate) =>
    probeCandidate(candidate, spec, deps)
  )

  // First success in spec order, not first to answer — keeps the choice stable
  // across runs.
  for (const result of probes) {
    if (result.ok) {
      rememberVerifiedDomain(provider, result.baseUrl)
      debugLog(`[Domain] ${provider}: chuyển sang ${result.baseUrl}`)
      return { status: 'ok', provider, baseUrl: result.baseUrl, changed: true }
    }
    debugWarn(`[Domain] ${provider}: ${result.candidate} loại — ${result.reason}`)
  }

  return {
    status: 'failed',
    provider,
    baseUrl: current.baseUrl,
    tried: alternates.length + 1
  }
}

/**
 * Resolve every probed provider concurrently. Never throws: a provider whose
 * probe blows up is reported as failed and the app continues on its cached or
 * seeded domain.
 */
export async function resolveAllDomains(deps?: ProbeDeps): Promise<ResolveOutcome[]> {
  return Promise.all(
    RESOLVED_PROVIDER_IDS.map(async (provider) => {
      try {
        return await resolveProviderDomain(provider, deps)
      } catch (error) {
        debugWarn(`[Domain] ${provider}: probe lỗi không mong đợi:`, error)
        return {
          status: 'failed' as const,
          provider,
          baseUrl: getResolvedBaseUrl(provider),
          tried: 0
        }
      }
    })
  )
}
