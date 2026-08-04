/**
 * Offline tests for the provider-domain resolver.
 *
 * The old domain fetcher accepted any candidate whose request did not throw and
 * wrote the winner straight into settings, permanently. A parking page, an ISP
 * block notice, or a squatter returning HTTP 200 was therefore enough to poison
 * the config with no way back. These checks exist because that failure mode had
 * no test at all — the negative cases below are the point of the file.
 *
 * Everything runs offline. `fetch` is injected through ProbeDeps, and HOME is
 * redirected at a temp directory before the resolver is imported so the real
 * `~/.nekostream-cli` is never read or written.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Must happen before importing anything that resolves DATA_DIR at module load.
const TEMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nekostream-domain-check-'))
process.env.HOME = TEMP_HOME
process.env.USERPROFILE = TEMP_HOME

const {
  PROVIDER_DOMAIN_SPECS,
  buildCandidates,
  matchesLabel,
  normalizeBaseUrl,
  probeCandidate,
  seedBaseUrl,
  verifyProviderHtml,
} = await import('../scrapers/domain-registry')

const {
  clearDomainCache,
  getResolvedDomain,
  rememberVerifiedDomain,
  resolveProviderDomain,
} = await import('../scrapers/domain-resolver')

type Spec = (typeof PROVIDER_DOMAIN_SPECS)['animevietsub']

const AVS = PROVIDER_DOMAIN_SPECS.animevietsub
const A47 = PROVIDER_DOMAIN_SPECS.anime47

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const SETTINGS_FILE = path.join(TEMP_HOME, '.nekostream-cli', 'settings.json')
const CACHE_FILE = path.join(TEMP_HOME, '.nekostream-cli', 'domain-cache.json')

function fixture(provider: string, name: string): string {
  return fs.readFileSync(path.join(FIXTURE_ROOT, provider, `${name}.html`), 'utf-8')
}

/** Hard-fail any real network call: nothing here is allowed to leave the box. */
function blockNetwork(): void {
  globalThis.fetch = (async () => {
    throw new Error('domain-check must not touch the network')
  }) as typeof fetch
}

function writeSettings(value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(value, null, 2), 'utf-8')
}

/** Reset both stores and the in-process memo between precedence scenarios. */
function resetState(): void {
  writeSettings({})
  clearDomainCache()
}

// ── Fake responses ───────────────────────────────────────────────────────────

/**
 * A Response stand-in. The real class computes `url` from the request, so a
 * constructed Response always reports '' — useless for testing the redirect
 * check, which is the security-relevant branch of probeCandidate.
 */
function fakeResponse(options: { url: string; body: string; status?: number }): Response {
  const status = options.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    url: options.url,
    text: async () => options.body,
  } as unknown as Response
}

/** A fetch that answers from a URL→response map and rejects anything else. */
function routedFetch(routes: Record<string, { url?: string; body: string; status?: number }>) {
  const calls: string[] = []
  const impl = (async (input: string | URL) => {
    const requested = String(input)
    calls.push(requested)
    const route = routes[requested]
    if (!route) throw new Error(`ENOTFOUND ${requested}`)
    return fakeResponse({ url: route.url ?? requested, body: route.body, status: route.status })
  }) as unknown as typeof fetch
  return { fetch: impl, calls }
}

// ── Fixtures for the negative cases ──────────────────────────────────────────

/** Long enough to clear the length floor, so length is never why these fail. */
function pad(marker: string): string {
  return `<!doctype html><html><body>${marker}${'<div class="filler"></div>'.repeat(400)}</body></html>`
}

const PARKING_PAGE = pad('<h1>This domain is for sale</h1><p>Buy this domain</p>')
const CF_CHALLENGE_PAGE = pad('<title>Just a moment...</title><div id="cf-browser-verification">')
const EMPTY_PAGE = '<!doctype html><html><body></body></html>'
const GENERIC_PAGE = pad('<h1>Welcome to nginx</h1>')

// ── Checks ───────────────────────────────────────────────────────────────────

/** The real homepages must pass, or the signature is too strict to be useful. */
function checkRealPagesVerify(): void {
  const avs = verifyProviderHtml(fixture('animevietsub', 'home-latest'), AVS)
  assert.ok(avs.ok, `AVS fixture rejected: ${avs.ok ? '' : avs.reason}`)

  const a47 = verifyProviderHtml(fixture('anime47', 'home-latest'), A47)
  assert.ok(a47.ok, `A47 fixture rejected: ${a47.ok ? '' : a47.reason}`)
}

/**
 * The cases the old implementation accepted. Each of these returned HTTP 200 and
 * was therefore enough to overwrite a working domain in settings.
 */
function checkImpostorPagesRejected(): void {
  const cases: Array<[string, string, Spec]> = [
    ['parking page', PARKING_PAGE, AVS],
    ['cloudflare challenge', CF_CHALLENGE_PAGE, AVS],
    ['empty page', EMPTY_PAGE, AVS],
    ['generic server page', GENERIC_PAGE, AVS],
    // A live provider that is simply not the one asked for: AVS markup must not
    // satisfy the Anime47 signature, and vice versa.
    ['other provider markup (A47 spec)', fixture('animevietsub', 'home-latest'), A47],
    ['other provider markup (AVS spec)', fixture('anime47', 'home-latest'), AVS],
  ]

  for (const [label, html, spec] of cases) {
    const result = verifyProviderHtml(html, spec)
    assert.equal(result.ok, false, `${label}: wrongly accepted as ${spec.label}`)
  }
}

/**
 * `hostname.includes(label)` was how the old code decided a domain was ours —
 * the same bug already fixed one layer up in the Electron host checks. Here it
 * decided what got written to disk and then sent session cookies.
 */
function checkLabelMatching(): void {
  assert.equal(matchesLabel('animevietsub.site', 'animevietsub'), true)
  assert.equal(matchesLabel('www.animevietsub.site', 'animevietsub'), true)
  assert.equal(matchesLabel('cdn.animevietsub.site', 'animevietsub'), true)
  assert.equal(matchesLabel('ANIMEVIETSUB.LOVE', 'animevietsub'), true)

  assert.equal(matchesLabel('animevietsub.attacker.example', 'animevietsub'), false)
  assert.equal(matchesLabel('animevietsub-cdn.example', 'animevietsub'), false)
  assert.equal(matchesLabel('notanimevietsub.site', 'animevietsub'), false)
  assert.equal(matchesLabel('example.com', 'animevietsub'), false)
  assert.equal(matchesLabel('localhost', 'animevietsub'), false)
  assert.equal(matchesLabel('anime47.best', 'animevietsub'), false)
}

function checkCandidateOrdering(): void {
  const candidates = buildCandidates(AVS, 'https://animevietsub.love')

  assert.equal(candidates[0], 'https://animevietsub.love', 'current domain must be probed first')
  assert.equal(new Set(candidates).size, candidates.length, 'candidates contain duplicates')
  for (const url of candidates) {
    assert.ok(url.startsWith('https://'), `non-HTTPS candidate: ${url}`)
  }
  for (const tld of AVS.tlds) {
    assert.ok(
      candidates.includes(`https://animevietsub.${tld}`),
      `seed TLD .${tld} missing from candidates`
    )
  }

  // A preferred value belonging to someone else is dropped, not probed.
  const hostile = buildCandidates(AVS, 'https://animevietsub.attacker.example')
  assert.ok(
    !hostile.some((url) => url.includes('attacker')),
    'hostile preferred domain leaked into the candidate list'
  )

  assert.equal(normalizeBaseUrl('animevietsub.site'), 'https://animevietsub.site')
  assert.equal(normalizeBaseUrl('https://animevietsub.site/phim/'), 'https://animevietsub.site')
  assert.equal(normalizeBaseUrl('   '), '')
  assert.equal(normalizeBaseUrl('not a url'), '')
}

async function checkProbeAcceptsRealPage(): Promise<void> {
  const { fetch: impl } = routedFetch({
    'https://animevietsub.site/': { body: fixture('animevietsub', 'home-latest') },
  })

  const result = await probeCandidate('https://animevietsub.site', AVS, { fetch: impl })
  assert.ok(result.ok, `real page rejected: ${result.ok ? '' : result.reason}`)
  assert.equal(result.baseUrl, 'https://animevietsub.site')
}

/**
 * Redirects have to be followed — providers bounce between their own domains
 * constantly — so the final hostname is what must be checked. Trusting the
 * requested URL instead would let any candidate hand over an origin to adopt.
 */
async function checkProbeRejectsOffLabelRedirect(): Promise<void> {
  const realBody = fixture('animevietsub', 'home-latest')

  const offLabel = routedFetch({
    'https://animevietsub.site/': { url: 'https://animevietsub.attacker.example/', body: realBody },
  })
  const hostile = await probeCandidate('https://animevietsub.site', AVS, { fetch: offLabel.fetch })
  assert.equal(hostile.ok, false, 'redirect to a foreign host was accepted')

  const downgrade = routedFetch({
    'https://animevietsub.site/': { url: 'http://animevietsub.site/', body: realBody },
  })
  const insecure = await probeCandidate('https://animevietsub.site', AVS, {
    fetch: downgrade.fetch,
  })
  assert.equal(insecure.ok, false, 'redirect down to HTTP was accepted')

  // A redirect that stays inside the provider is the normal case and must work.
  const sibling = routedFetch({
    'https://animevietsub.site/': { url: 'https://animevietsub.love/', body: realBody },
  })
  const moved = await probeCandidate('https://animevietsub.site', AVS, { fetch: sibling.fetch })
  assert.ok(moved.ok, 'same-provider redirect was rejected')
  assert.equal(moved.baseUrl, 'https://animevietsub.love', 'redirect target not adopted')
}

async function checkProbeRejectsBadResponses(): Promise<void> {
  const cases: Array<[string, { url?: string; body: string; status?: number }]> = [
    ['HTTP 503', { body: fixture('animevietsub', 'home-latest'), status: 503 }],
    ['parking page', { body: PARKING_PAGE }],
    ['cloudflare challenge', { body: CF_CHALLENGE_PAGE }],
    ['empty page', { body: EMPTY_PAGE }],
  ]

  for (const [label, route] of cases) {
    const { fetch: impl } = routedFetch({ 'https://animevietsub.site/': route })
    const result = await probeCandidate('https://animevietsub.site', AVS, { fetch: impl })
    assert.equal(result.ok, false, `${label}: wrongly accepted`)
  }

  // Connection failure must be a clean negative, not a throw.
  const { fetch: dead } = routedFetch({})
  const unreachable = await probeCandidate('https://animevietsub.site', AVS, { fetch: dead })
  assert.equal(unreachable.ok, false, 'unreachable host did not report failure')
}

/** seed → cache → manual, in that order, with no store bleeding into another. */
function checkPrecedence(): void {
  resetState()
  const seeded = getResolvedDomain('animevietsub')
  assert.equal(seeded.source, 'seed', 'clean state should resolve to the seed')
  assert.equal(seeded.baseUrl, seedBaseUrl('animevietsub'))

  rememberVerifiedDomain('animevietsub', 'https://animevietsub.love')
  const verified = getResolvedDomain('animevietsub')
  assert.equal(verified.source, 'verified', 'probe result should beat the seed')
  assert.equal(verified.baseUrl, 'https://animevietsub.love')
  assert.ok(verified.verifiedAt, 'verified entry is missing its timestamp')

  // The prober writes its own file and never settings — that separation is what
  // stops a probe from silently replacing a domain the user chose.
  const settingsOnDisk = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
  assert.deepEqual(
    settingsOnDisk.providerDomains ?? {},
    {},
    'prober wrote into settings.providerDomains'
  )
  assert.ok(fs.existsSync(CACHE_FILE), 'domain-cache.json was not written')
  const cacheOnDisk = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
  assert.ok(cacheOnDisk.animevietsub?.verifiedAt, 'cache entry is missing verifiedAt')

  writeSettings({ providerDomains: { animevietsub: 'animevietsub.tv' } })
  const manual = getResolvedDomain('animevietsub')
  assert.equal(manual.source, 'manual', 'manual override should beat the cache')
  assert.equal(manual.baseUrl, 'https://animevietsub.tv')

  // With an override in place, a later probe result must not take effect.
  rememberVerifiedDomain('animevietsub', 'https://animevietsub.fan')
  const stillManual = getResolvedDomain('animevietsub')
  assert.equal(stillManual.baseUrl, 'https://animevietsub.tv', 'prober overrode a manual choice')

  // An override pointing at a foreign host is ignored rather than honoured.
  writeSettings({ providerDomains: { animevietsub: 'https://animevietsub.attacker.example' } })
  const hostile = getResolvedDomain('animevietsub')
  assert.notEqual(hostile.source, 'manual', 'foreign manual override was accepted')
  assert.ok(!hostile.baseUrl.includes('attacker'), 'foreign manual override leaked through')

  resetState()
}

/**
 * A cache file is user-writable data, so it is re-validated, not trusted.
 *
 * resetState() clears the in-process memo first and the poisoned file is written
 * after, so the read below really does go to disk.
 */
function checkPoisonedCacheIgnored(): void {
  resetState()
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({
      animevietsub: { baseUrl: 'https://animevietsub.attacker.example', verifiedAt: 'x' },
      anime47: { baseUrl: 'not-a-url', verifiedAt: 'x' },
    }),
    'utf-8'
  )

  const avs = getResolvedDomain('animevietsub')
  assert.equal(avs.source, 'seed', 'poisoned cache entry was adopted')
  const a47 = getResolvedDomain('anime47')
  assert.equal(a47.source, 'seed', 'malformed cache entry was adopted')

  resetState()
}

/** Fast path: one request, no fan-out, when the current domain is healthy. */
async function checkResolveFastPath(): Promise<void> {
  resetState()
  const { fetch: impl, calls } = routedFetch({
    'https://animevietsub.site/': { body: fixture('animevietsub', 'home-latest') },
  })

  const outcome = await resolveProviderDomain('animevietsub', { fetch: impl })
  assert.equal(outcome.status, 'ok')
  assert.equal(outcome.baseUrl, 'https://animevietsub.site')
  assert.equal(calls.length, 1, `fast path made ${calls.length} requests, expected 1`)

  resetState()
}

/** Fan-out: the seed is dead, a later TLD is alive, and the winner is cached. */
async function checkResolveFanOut(): Promise<void> {
  resetState()
  const { fetch: impl } = routedFetch({
    // .site answers, but with a parking page — exactly the case the old code
    // treated as success.
    'https://animevietsub.site/': { body: PARKING_PAGE },
    'https://animevietsub.love/': { body: fixture('animevietsub', 'home-latest') },
  })

  const outcome = await resolveProviderDomain('animevietsub', { fetch: impl })
  assert.equal(outcome.status, 'ok')
  assert.equal(outcome.baseUrl, 'https://animevietsub.love', 'fan-out picked the wrong domain')
  assert.equal(getResolvedDomain('animevietsub').source, 'verified', 'winner was not cached')

  resetState()
}

/** Everything dead: report failure, keep the current value, never throw. */
async function checkResolveAllDead(): Promise<void> {
  resetState()
  const { fetch: impl } = routedFetch({})

  const outcome = await resolveProviderDomain('animevietsub', { fetch: impl })
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.baseUrl, seedBaseUrl('animevietsub'), 'failed probe changed the domain')
  assert.ok(outcome.status === 'failed' && outcome.tried > 1, 'fan-out did not run')
  assert.ok(!fs.existsSync(CACHE_FILE), 'a failed probe wrote to the cache')

  resetState()
}

/** A pinned domain is never probed: the user's choice is not ours to re-litigate. */
async function checkResolveSkipsManual(): Promise<void> {
  resetState()
  writeSettings({ providerDomains: { animevietsub: 'animevietsub.tv' } })
  const { fetch: impl, calls } = routedFetch({})

  const outcome = await resolveProviderDomain('animevietsub', { fetch: impl })
  assert.equal(outcome.status, 'manual')
  assert.equal(outcome.baseUrl, 'https://animevietsub.tv')
  assert.equal(calls.length, 0, 'a manually pinned domain was probed anyway')

  resetState()
}

async function main(): Promise<void> {
  blockNetwork()

  const checks: Array<[string, () => void | Promise<void>]> = [
    ['real provider pages verify', checkRealPagesVerify],
    ['impostor pages rejected', checkImpostorPagesRejected],
    ['registrable-label matching', checkLabelMatching],
    ['candidate ordering', checkCandidateOrdering],
    ['probe accepts a real page', checkProbeAcceptsRealPage],
    ['probe rejects off-label redirect', checkProbeRejectsOffLabelRedirect],
    ['probe rejects bad responses', checkProbeRejectsBadResponses],
    ['domain precedence', checkPrecedence],
    ['poisoned cache ignored', checkPoisonedCacheIgnored],
    ['resolve fast path', checkResolveFastPath],
    ['resolve fan-out', checkResolveFanOut],
    ['resolve with everything dead', checkResolveAllDead],
    ['resolve skips manual override', checkResolveSkipsManual],
  ]

  try {
    for (const [name, run] of checks) {
      await run()
      console.log(`  ok  ${name}`)
    }
  } finally {
    fs.rmSync(TEMP_HOME, { recursive: true, force: true })
  }

  console.log(`\ndomain-check: ${checks.length} checks passed`)
}

await main()
