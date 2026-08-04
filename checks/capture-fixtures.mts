/**
 * Fixture capture tool — DEV ONLY, hits live provider sites.
 *
 * This is deliberately NOT part of `npm test`. Parser tests must stay offline
 * and deterministic; this tool is how the offline fixtures get refreshed when a
 * provider changes its markup.
 *
 * Usage:
 *   npx tsx checks/capture-fixtures.mts              # all providers
 *   npx tsx checks/capture-fixtures.mts animehay     # one provider
 *
 * Captured HTML is written to checks/fixtures/<provider>/<name>.html and is
 * committed, so the parser tests run without network access.
 *
 * The providers sit behind Cloudflare, so a capture run may partially fail.
 * Each target is independent: a failure is reported and skipped rather than
 * aborting the run, and existing fixtures are never overwritten with an error
 * page (see looksLikeHtml).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Anime47Provider } from '../scrapers/providers/anime47'
import { AnimeVietsubProvider } from '../scrapers/providers/animevietsub'

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** A capture target: run `fetch` and store whatever HTML the provider received. */
type Target = {
  provider: string
  name: string
  run: (record: Recorder) => Promise<unknown>
}

/** Records every HTML document a provider fetches during one call. */
type Recorder = {
  pages: string[]
}

/**
 * Reject obvious non-content so a Cloudflare challenge never replaces a good
 * fixture. Real provider pages are far larger than this floor.
 */
function looksLikeHtml(html: string): boolean {
  if (html.length < 2000) return false
  const lower = html.toLowerCase()
  if (lower.includes('just a moment') || lower.includes('cf-browser-verification')) return false
  return lower.includes('<html') || lower.includes('<!doctype')
}

function write(provider: string, name: string, html: string): void {
  const dir = path.join(FIXTURE_ROOT, provider)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.html`)
  fs.writeFileSync(file, html, 'utf-8')
  console.log(`  saved ${path.relative(process.cwd(), file)} (${html.length} bytes)`)
}

/**
 * Wrap a provider's private fetchHtml so every document it retrieves is
 * recorded. Providers are cast to a loose shape because fetchHtml is private by
 * design — capture is a dev-time concern and must not widen the public API.
 */
function instrument(provider: object, recorder: Recorder): void {
  const target = provider as { fetchHtml?: (...args: unknown[]) => Promise<string> }
  const original = target.fetchHtml
  if (typeof original !== 'function') throw new Error('provider has no fetchHtml to instrument')

  target.fetchHtml = async (...args: unknown[]) => {
    const html = await original.apply(provider, args)
    if (typeof html === 'string') recorder.pages.push(html)
    return html
  }
}

/**
 * A real AnimeVietsub slug, needed for the detail/episode captures. Titles come
 * and go from the site, so if these captures start failing, re-probe with
 * getHomeCards('latest') and update this.
 */
const AVS_SAMPLE_ID = 'kamen-rider-zeztz-i1-a5767'

// AnimeHay is intentionally absent: the provider is kept working but is no
// longer invested in, so it has no fixtures and no parser tests.
const TARGETS: Target[] = [
  {
    provider: 'animevietsub',
    name: 'home-latest',
    run: async (recorder) => {
      const provider = new AnimeVietsubProvider()
      instrument(provider, recorder)
      return provider.getHomeCards('latest')
    },
  },
  {
    provider: 'anime47',
    name: 'home-latest',
    run: async (recorder) => {
      const provider = new Anime47Provider()
      instrument(provider, recorder)
      return provider.getHomeCards('latest')
    },
  },
  {
    provider: 'animevietsub',
    name: 'detail',
    run: async (recorder) => {
      const provider = new AnimeVietsubProvider()
      instrument(provider, recorder)
      return provider.getAnimeDetail(AVS_SAMPLE_ID)
    },
  },
  {
    provider: 'animevietsub',
    name: 'episodes',
    run: async (recorder) => {
      const provider = new AnimeVietsubProvider()
      instrument(provider, recorder)
      return provider.getEpisodes(AVS_SAMPLE_ID)
    },
  },
]

// Search is deliberately not captured. Anime47 searches through a JSON API (no
// HTML to record), and AnimeVietsub's /tim-kiem/ path is consistently
// challenge-gated. Search ranking is covered by checks/search-check.mts using
// synthetic cards instead.

async function main(): Promise<void> {
  const filter = process.argv[2]
  const targets = filter ? TARGETS.filter((t) => t.provider === filter) : TARGETS

  if (targets.length === 0) {
    console.error(`No capture target matches "${filter}".`)
    process.exit(1)
  }

  let saved = 0
  let failed = 0

  for (const target of targets) {
    console.log(`\n${target.provider}/${target.name}`)
    const recorder: Recorder = { pages: [] }
    try {
      await target.run(recorder)
    } catch (error) {
      console.log(`  fetch error: ${error instanceof Error ? error.message : String(error)}`)
    }

    const usable = recorder.pages.filter(looksLikeHtml)
    if (usable.length === 0) {
      console.log('  no usable HTML captured — existing fixture left untouched')
      failed++
      continue
    }

    // Keep the largest document: alternate-domain retries and challenge pages
    // are consistently smaller than the real listing.
    const best = usable.reduce((a, b) => (b.length > a.length ? b : a))
    write(target.provider, target.name, best)
    saved++
  }

  console.log(`\ncapture-fixtures: ${saved} saved, ${failed} unavailable`)
}

await main()
