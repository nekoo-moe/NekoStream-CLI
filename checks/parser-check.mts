/**
 * Offline parser tests against committed HTML fixtures.
 *
 * These run with no network access: every provider's private fetchHtml is
 * replaced with a fixture reader, so the assertions exercise the parsing layer
 * only. Refresh the fixtures with `npx tsx checks/capture-fixtures.mts` when a
 * provider changes its markup.
 *
 * Assertions are deliberately structural rather than exact — fixtures are
 * snapshots of a live site, so titles and episode counts change with every
 * recapture. What must hold is the shape: cards have ids and titles, ids are
 * unique, episode numbers are positive and sorted, URLs are absolute.
 *
 * AnimeHay has no fixtures on purpose: the provider is kept working but is no
 * longer invested in.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Anime47Provider } from '../scrapers/providers/anime47'
import { AnimeVietsubProvider } from '../scrapers/providers/animevietsub'
import type { AnimeSearchResult, Episode } from '../scrapers/base'

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

function fixture(provider: string, name: string): string {
  return fs.readFileSync(path.join(FIXTURE_ROOT, provider, `${name}.html`), 'utf-8')
}

/**
 * Hard-fail any network call. Detail parsing calls enrichWithAniList, which is
 * non-throwing and would silently reach the real API — making this check slow
 * and dependent on AniList being up. Blocking fetch keeps the run offline and
 * proves the enrichment stays optional.
 */
function blockNetwork(): void {
  globalThis.fetch = (async () => {
    throw new Error('parser-check must not touch the network')
  }) as typeof fetch
}

/**
 * Serve a fixture in place of every network fetch. Providers are cast to a
 * loose shape because fetchHtml is private by design — stubbing it is a
 * test-time concern and must not widen the public API.
 */
function stubHtml(provider: object, html: string): void {
  ;(provider as { fetchHtml: (...args: unknown[]) => Promise<string> }).fetchHtml = async () => html
}

/** Every card must be individually addressable and renderable. */
function assertUsableCards(cards: AnimeSearchResult[], source: string, label: string): void {
  assert.ok(cards.length > 0, `${label}: expected at least one card`)

  const ids = new Set<string>()
  for (const card of cards) {
    assert.ok(card.id, `${label}: card has empty id`)
    assert.ok(card.title.trim().length >= 2, `${label}: card ${card.id} has no usable title`)
    assert.equal(card.source, source, `${label}: card ${card.id} has wrong source`)
    assert.ok(!ids.has(card.id), `${label}: duplicate card id ${card.id}`)
    ids.add(card.id)

    // A relative thumbnail would render as a broken image in the CLI/player.
    if (card.thumbnail) {
      assert.match(
        card.thumbnail,
        /^https?:\/\//,
        `${label}: card ${card.id} thumbnail not absolute`
      )
    }
  }
}

async function checkAnimeVietsubHomeCards(): Promise<void> {
  const provider = new AnimeVietsubProvider()
  stubHtml(provider, fixture('animevietsub', 'home-latest'))

  const cards = await provider.getHomeCards('latest')
  assertUsableCards(cards, 'animevietsub', 'AVS home-latest')

  // getHomeCards caps its own output; going over means the slice was lost.
  assert.ok(cards.length <= 48, 'AVS home-latest: exceeded the 48-card cap')

  // Detail pages and episode links are not anime cards and must be filtered out.
  for (const card of cards) {
    assert.ok(
      !card.id.includes('xem-phim'),
      `AVS home-latest: watch link leaked as card (${card.id})`
    )
    assert.ok(!/\/tap-/.test(card.id), `AVS home-latest: episode link leaked as card (${card.id})`)
  }
}

async function checkAnimeVietsubDetail(): Promise<void> {
  const provider = new AnimeVietsubProvider()
  stubHtml(provider, fixture('animevietsub', 'detail'))

  const detail = await provider.getAnimeDetail('fixture-anime')
  assert.ok(detail, 'AVS detail: parser returned null')
  assert.ok(detail.title.trim().length >= 2, 'AVS detail: no usable title')
  assert.ok(!detail.title.includes('&amp;'), 'AVS detail: title left HTML-encoded')

  if (detail.thumbnail) {
    assert.match(detail.thumbnail, /^https?:\/\//, 'AVS detail: thumbnail not absolute')
  }
  if (detail.genres) {
    assert.ok(Array.isArray(detail.genres), 'AVS detail: genres not an array')
    for (const genre of detail.genres) {
      assert.ok(genre.trim().length > 0, 'AVS detail: blank genre entry')
    }
  }
}

/** Episode lists drive playback order, so numbering is the contract that matters. */
function assertUsableEpisodes(episodes: Episode[], animeId: string, label: string): void {
  assert.ok(episodes.length > 0, `${label}: expected at least one episode`)

  const numbers = new Set<number>()
  let previous = 0
  for (const episode of episodes) {
    assert.ok(episode.id, `${label}: episode has empty id`)
    assert.equal(episode.animeId, animeId, `${label}: episode ${episode.id} has wrong animeId`)
    assert.ok(
      Number.isInteger(episode.number),
      `${label}: episode ${episode.id} number not an integer`
    )
    assert.ok(episode.number > 0, `${label}: episode ${episode.id} has non-positive number`)

    // Duplicate numbers would make "next episode" ambiguous.
    assert.ok(!numbers.has(episode.number), `${label}: duplicate episode number ${episode.number}`)
    numbers.add(episode.number)

    assert.ok(episode.number >= previous, `${label}: episodes not sorted ascending`)
    previous = episode.number
  }
}

async function checkAnimeVietsubEpisodes(): Promise<void> {
  const provider = new AnimeVietsubProvider()
  stubHtml(provider, fixture('animevietsub', 'episodes'))

  const episodes = await provider.getEpisodes('fixture-anime')
  assertUsableEpisodes(episodes, 'fixture-anime', 'AVS episodes')
}

async function checkAnime47HomeCards(): Promise<void> {
  const provider = new Anime47Provider()
  const html = fixture('anime47', 'home-latest')
  stubHtml(provider, html)

  // 'trending' is the unfiltered path and is what proves the parser works.
  const trending = await provider.getHomeCards('trending')
  assertUsableCards(trending, 'anime47', 'A47 home-trending')
  assert.ok(trending.length <= 72, 'A47 home-trending: exceeded the 72-card cap')

  for (const card of trending) {
    assert.ok(
      !card.id.includes('/xem/'),
      `A47 home-trending: watch link leaked as card (${card.id})`
    )
  }

  // 'latest' filters the same cards by their status badge, so it is a subset.
  // It must never be empty while trending has cards: the homepage no longer
  // ships __INITIAL_STATE__, so no card carries a status and an unguarded
  // filter would blank the section entirely.
  const latest = await provider.getHomeCards('latest')
  assert.ok(latest.length > 0, 'A47 home-latest: empty while trending has cards')
  const trendingIds = new Set(trending.map((card) => card.id))
  for (const card of latest) {
    assert.ok(
      trendingIds.has(card.id),
      `A47 home-latest: card ${card.id} absent from unfiltered set`
    )
  }
}

async function main(): Promise<void> {
  blockNetwork()

  const checks: Array<[string, () => Promise<void>]> = [
    ['animevietsub home cards', checkAnimeVietsubHomeCards],
    ['animevietsub detail', checkAnimeVietsubDetail],
    ['animevietsub episodes', checkAnimeVietsubEpisodes],
    ['anime47 home cards', checkAnime47HomeCards],
  ]

  for (const [name, run] of checks) {
    await run()
    console.log(`  ok  ${name}`)
  }

  console.log(`\nparser-check: ${checks.length} checks passed`)
}

await main()
