/**
 * Shared AniList GraphQL utility for image enrichment.
 *
 * Provides high-quality cover images (coverImage.extraLarge ~475px wide)
 * and banner images (bannerImage ~1900×400) by matching anime titles
 * against the AniList API. Results are cached in-memory per process lifetime.
 *
 * Usage:
 *   import { enrichWithAniList } from '../anilist'
 *   const { cover, banner } = await enrichWithAniList(title)
 */

const ANILIST_ENDPOINT = 'https://graphql.anilist.co'

export interface AniListImageResult {
  cover?: string   // coverImage.extraLarge — high-res portrait thumbnail
  banner?: string  // bannerImage — 1900×400 landscape background
  anilistId?: number
}

// In-memory cache keyed by normalised title — avoids redundant API calls
// when multiple episodes/detail requests fire for the same show.
const cache = new Map<string, AniListImageResult>()

function normalizeTitleForSearch(title: string): string {
  return title
    .replace(/\s*\(?\d{4}\)?$/, '')      // strip trailing year
    .replace(/\s*(Phần|Mùa|Season|Part)\s*\d+/i, '')  // strip season suffix
    .replace(/\s+/g, ' ')
    .trim()
}

const GQL_QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
    id
    coverImage { extraLarge }
    bannerImage
  }
}
`.trim()

/**
 * Fetch AniList image data for an anime by title.
 * Non-throwing — returns empty object on any network or parse error.
 */
export async function enrichWithAniList(
  rawTitle: string,
  timeoutMs = 8000
): Promise<AniListImageResult> {
  const title = normalizeTitleForSearch(rawTitle)
  if (!title) return {}

  const cached = cache.get(title)
  if (cached !== undefined) return cached

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: GQL_QUERY, variables: { search: title } }),
      signal: controller.signal,
    })

    if (!response.ok) {
      // AniList rate-limits with 429 — don't cache, just return empty
      if (response.status === 429) return {}
      cache.set(title, {})
      return {}
    }

    const json = await response.json() as {
      data?: { Media?: { id?: number; coverImage?: { extraLarge?: string }; bannerImage?: string } }
    }
    const media = json?.data?.Media
    const result: AniListImageResult = {
      cover: media?.coverImage?.extraLarge || undefined,
      banner: media?.bannerImage || undefined,
      anilistId: media?.id || undefined,
    }
    cache.set(title, result)
    return result
  } catch {
    // Timeout / network error — do not cache so next attempt can retry
    return {}
  } finally {
    clearTimeout(timer)
  }
}
