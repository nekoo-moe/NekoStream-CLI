import assert from 'node:assert/strict'
import { Anime47Provider } from '../scrapers/providers/anime47'
import { AnimeVietsubProvider } from '../scrapers/providers/animevietsub'
import { SiteDownError } from '../scrapers/fingerprint'
import { cleanSearchQuery, rankSearchResults } from '../scrapers/search-utils'
import type { AnimeSearchResult } from '../scrapers/base'

const result = (id: string, title: string, titleAlt?: string): AnimeSearchResult => ({
  id,
  source: 'check',
  title,
  titleAlt,
})

function cardHtml(items: AnimeSearchResult[]): string {
  const cards = items.map((item) => `
    <article class="TPostMv">
      <a href="/phim/${item.id}/" title="${item.title}">
        <img alt="${item.title}" src="/${item.id}.jpg">
        <h2>${item.title}</h2>
        ${item.titleAlt ? `<small>${item.titleAlt}</small>` : ''}
      </a>
    </article>`).join('')
  return `<!doctype html><html><body>${cards}</body></html>`.padEnd(120, ' ')
}

async function checkSearchUtils(): Promise<void> {
  assert.equal(cleanSearchQuery('  One　  Piece  '), 'One Piece')
  assert.deepEqual(rankSearchResults([], 'one piece', 10), [])
  assert.deepEqual(rankSearchResults([result('x', 'One Piece')], '  ', 10), [])
  assert.deepEqual(rankSearchResults([result('x', 'One Piece')], 'one piece', 0), [])
  assert.deepEqual(rankSearchResults([result('x', 'One Piece')], 'one piece', -1), [])
  assert.equal(rankSearchResults([result('short', 'A')], 'a', 10)[0]?.id, 'short')
  assert.deepEqual(rankSearchResults([result('short', 'Tales of Demons')], 'a', 10), [])

  const accentRank = rankSearchResults([
    result('plain', 'Co Dau'),
    result('accent', 'Có Dấu'),
  ], 'có dấu', 10)
  assert.deepEqual(accentRank.map((item) => item.id), ['accent', 'plain'])
  assert.equal(rankSearchResults([result('accent', 'Có Dấu')], 'co dau', 10)[0]?.id, 'accent')
  assert.equal(rankSearchResults([result('d', 'Đấu La Đại Lục')], 'dau la', 10)[0]?.id, 'd')

  assert.equal(rankSearchResults([
    result('alt', 'Hải Tặc Mũ Rơm', 'One Piece'),
  ], 'one piece', 10)[0]?.id, 'alt')
  assert.equal(rankSearchResults([
    result('label', 'Frieren - Vietsub'),
  ], 'frieren', 10)[0]?.id, 'label')
  assert.equal(rankSearchResults([
    result('episode', 'Solo Leveling - Tập 12'),
  ], 'solo leveling', 10)[0]?.id, 'episode')
  assert.equal(rankSearchResults([
    result('bracket', 'Sousou no Frieren [Vietsub]'),
  ], 'sousou no frieren', 10)[0]?.id, 'bracket')
  assert.equal(rankSearchResults([
    result('quality', 'Bleach - HD'),
  ], 'bleach', 10)[0]?.id, 'quality')
  assert.equal(rankSearchResults([
    result('year', 'Bleach 2024'),
  ], '2024', 10)[0]?.id, 'year')

  assert.deepEqual(rankSearchResults([
    result('noise', 'Tin anime hôm nay'),
    result('match', 'One Piece Film Red'),
  ], 'one piece', 10).map((item) => item.id), ['match'])
  assert.deepEqual(rankSearchResults([
    result('weak', 'One Random Show'),
  ], 'one piece red', 10), [])
  assert.deepEqual(rankSearchResults([
    result('short-noise', 'Tales of Demons'),
  ], 'of', 10), [])

  const duplicateRank = rankSearchResults([
    result(' SAME ', 'One Piece Special'),
    result('same', 'One Piece'),
  ], 'one piece', 10)
  assert.deepEqual(duplicateRank.map((item) => item.title), ['One Piece'])

  const stableRank = rankSearchResults([
    result('first', 'Naruto Movie'),
    result('second', 'Naruto Shippuden'),
  ], 'naruto', 10)
  assert.deepEqual(stableRank.map((item) => item.id), ['first', 'second'])
}

async function checkAnimeVietsub(): Promise<void> {
  const provider = new AnimeVietsubProvider() as any
  const calls: Array<{ url: string; options: Record<string, unknown> }> = []
  const enough = Array.from({ length: 12 }, (_, index) => result(`one-piece-a${index}`, `One Piece ${index}`))
  provider.fetchHtml = async (url: string, options: Record<string, unknown>) => {
    calls.push({ url, options })
    return cardHtml(enough)
  }

  const enoughResults = await provider.search('  One   Piece  ')
  assert.equal(enoughResults.length, 12)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/tim-kiem\/One%20Piece\/$/)
  assert.deepEqual(calls[0].options, {
    timeoutMs: 8000,
    retries: 0,
    useBrowserFallback: false,
    allowDomainFallback: false,
  })

  const mergingProvider = new AnimeVietsubProvider() as any
  const mergeCalls: Array<Record<string, unknown>> = []
  mergingProvider.fetchHtml = async (_url: string, options: Record<string, unknown>) => {
    mergeCalls.push(options)
    if (mergeCalls.length === 1) {
      return cardHtml([
        result('one-piece-a1', 'One Piece'),
        result('sidebar-a2', 'Tin anime hôm nay'),
      ])
    }
    return cardHtml([
      result('one-piece-a1', 'One Piece Duplicate'),
      result('one-piece-a3', 'One Piece Film Red'),
    ])
  }

  const merged = await mergingProvider.search('one piece')
  assert.deepEqual(merged.map((item: AnimeSearchResult) => item.id), ['one-piece-a1', 'one-piece-a3'])
  assert.equal(mergeCalls.length, 2)

  const browserProvider = new AnimeVietsubProvider() as any
  const rawCalls: Array<Record<string, unknown>> = []
  const browserCalls: Array<{ url: string; timeoutMs: number }> = []
  browserProvider.fetchHtml = async (_url: string, options: Record<string, unknown>) => {
    rawCalls.push(options)
    return cardHtml([result('noise-a1', 'Tin anime')])
  }
  browserProvider.fetchHtmlWithPlaywright = async (url: string, timeoutMs: number) => {
    browserCalls.push({ url, timeoutMs })
    return cardHtml([result('bleach-a2', 'Bleach')])
  }
  assert.deepEqual((await browserProvider.search('bleach')).map((item: AnimeSearchResult) => item.id), ['bleach-a2'])
  assert.equal(rawCalls.length, 2)
  assert.equal(browserCalls.length, 1)
  assert.equal(browserCalls[0].timeoutMs, 20000)

  const downProvider = new AnimeVietsubProvider() as any
  downProvider.fetchHtml = async () => { throw new SiteDownError('AnimeVietsub') }
  await assert.rejects(() => downProvider.search('one piece'), SiteDownError)
}

async function checkAnime47(): Promise<void> {
  const mappingProvider = new Anime47Provider() as any
  assert.deepEqual(mappingProvider.mapStateAnime({
    url: '/phim/one-piece/m12.html',
    name: 'One Piece',
  }), {
    id: 'one-piece-m12',
    source: 'anime47',
    title: 'One Piece',
    titleAlt: undefined,
    thumbnail: '',
    cover: '',
    status: undefined,
    rating: undefined,
    year: undefined,
    totalEpisodes: undefined,
  })

  const provider = new Anime47Provider() as any
  const pages: number[] = []
  provider.fetchJson = async (url: string, options: Record<string, unknown>) => {
    const page = Number(new URL(url).searchParams.get('page'))
    pages.push(page)
    assert.deepEqual(options, { timeoutMs: 8000, retries: 0 })
    return page === 1
      ? { data: [
          { url: '/phim/one-piece/m1.html', name: 'One Piece' },
          { url: '/phim/sidebar/m2.html', name: 'Tin anime' },
        ] }
      : { items: Array.from({ length: 11 }, (_, index) => ({
          link: `/phim/one-piece-${index}/m${index + 10}.html`,
          title: `One Piece ${index}`,
        })) }
  }
  provider.fetchHtml = async () => { throw new Error('HTML fallback must not run') }

  const results = await provider.search('  One   Piece ')
  assert.equal(results.length, 12)
  assert.deepEqual(pages, [1, 2])

  const emptyPageProvider = new Anime47Provider() as any
  const emptyPages: number[] = []
  const htmlCalls: Array<{ url: string; options: Record<string, unknown> }> = []
  emptyPageProvider.fetchJson = async (url: string) => {
    emptyPages.push(Number(new URL(url).searchParams.get('page')))
    return { results: [] }
  }
  emptyPageProvider.fetchHtml = async (url: string, options: Record<string, unknown>) => {
    htmlCalls.push({ url, options })
    return `<!doctype html><html><body>
      <article><a href="/phim/bleach/m99.html" title="Bleach"><img alt="Bleach"></a></article>
    </body></html>`
  }

  assert.deepEqual((await emptyPageProvider.search('bleach')).map((item: AnimeSearchResult) => item.id), ['bleach-m99'])
  assert.deepEqual(emptyPages, [1])
  assert.equal(htmlCalls.length, 1)
  assert.deepEqual(htmlCalls[0].options, {
    timeoutMs: 8000,
    retries: 0,
    useBrowserFallback: false,
  })

  const noiseProvider = new Anime47Provider() as any
  let fallbackCount = 0
  noiseProvider.fetchJson = async () => ({ results: [{
    link: '/phim/sidebar/m1.html',
    title: 'Tin anime',
  }] })
  noiseProvider.fetchHtml = async () => {
    fallbackCount++
    return '<html><body>No cards</body></html>'
  }
  assert.deepEqual(await noiseProvider.search('bleach'), [])
  assert.equal(fallbackCount, 2)
}

await checkSearchUtils()
await checkAnimeVietsub()
await checkAnime47()
console.log('search-check: ok')
