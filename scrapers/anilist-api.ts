// AniList API service for fetching anime metadata and images
import { debugLog, debugWarn, debugError } from '../logger'
// Uses GraphQL API - https://docs.anilist.co/guide/introduction

// ============ TypeScript Interfaces ============

export interface AniListTitle {
  romaji?: string
  english?: string
  native?: string
}

export interface AniListCoverImage {
  extraLarge?: string  // 500x710
  large?: string       // 230x325
  medium?: string      // 120x170
}

export interface AniListStudio {
  name: string
}

export interface AniListMedia {
  id: number
  idMal?: number  // MyAnimeList ID for cross-reference
  title: AniListTitle
  synonyms?: string[]  // All alternative title names stored in AniList
  coverImage: AniListCoverImage
  bannerImage?: string  // 1900x400 - perfect for backgrounds
  description?: string
  episodes?: number
  status?: string
  averageScore?: number  // 0-100
  genres?: string[]
  studios?: {
    nodes: AniListStudio[]
  }
}

// Rich metadata returned from a single unified query
export interface AniListAnimeData {
  anilistId: number
  malId?: number
  cover?: string
  banner?: string
  synopsis?: string
  score?: number
  episodes?: number
  status?: string
  studios?: string[]
  genres?: string[]
}

interface AniListSearchResponse {
  data: {
    Page: {
      media: AniListMedia[]
    }
  }
  errors?: Array<{ message: string; status?: number }>
}

interface AniListSingleResponse {
  data: {
    Media: AniListMedia | null
  }
  errors?: Array<{ message: string; status?: number }>
}

// ============ Cache Implementation ============

const cache = new Map<string, { data: unknown; timestamp: number }>()
const CACHE_TTL = 1000 * 60 * 60 * 24 // 24 hours

function getCached<T>(key: string): T | null {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T
  }
  return null
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() })
}

// ============ Session-level Result Cache ============
// Prevents triple API calls (cover + banner + metadata) for same anime in one session

const sessionResultCache = new Map<string, AniListMedia | null>()

// ============ GraphQL Queries ============

const SEARCH_QUERY = `
query ($search: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
      id
      idMal
      title {
        romaji
        english
        native
      }
      synonyms
      coverImage {
        extraLarge
        large
        medium
      }
      bannerImage
      description(asHtml: false)
      episodes
      status
      averageScore
      genres
      studios(isMain: true) {
        nodes {
          name
        }
      }
    }
  }
}
`

const GET_BY_ID_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    title {
      romaji
      english
      native
    }
    synonyms
    coverImage {
      extraLarge
      large
      medium
    }
    bannerImage
    description(asHtml: false)
    episodes
    status
    averageScore
    genres
    studios(isMain: true) {
      nodes {
        name
      }
    }
  }
}
`

const GET_BY_MAL_ID_QUERY = `
query ($idMal: Int) {
  Media(idMal: $idMal, type: ANIME) {
    id
    idMal
    title {
      romaji
      english
      native
    }
    synonyms
    coverImage {
      extraLarge
      large
      medium
    }
    bannerImage
    description(asHtml: false)
    episodes
    status
    averageScore
    genres
    studios(isMain: true) {
      nodes {
        name
      }
    }
  }
}
`

// ============ AniList API Service ============

export class AniListApiService {
  private endpoint = 'https://graphql.anilist.co'
  private lastRequestTime = 0
  private rateLimitRemaining = 90
  private rateLimitReset = 0
  private requestQueue: Promise<void> = Promise.resolve()

  private transformUrlsInObject(obj: any): any {
    if (!obj) return obj
    if (typeof obj === 'string') {
      // Transform AniList CDN URLs to go through our image proxy
      if (obj.startsWith('https://s4.anilist.co') || 
          obj.startsWith('https://media.anilist.co')) {
        return `nekostream-image://proxy?url=${encodeURIComponent(obj)}`
      }
      return obj
    }
    if (Array.isArray(obj)) {
      return obj.map((item: any) => this.transformUrlsInObject(item))
    }
    if (typeof obj === 'object') {
      const result: any = {}
      for (const key of Object.keys(obj)) {
        result[key] = this.transformUrlsInObject(obj[key])
      }
      return result
    }
    return obj
  }

  async graphqlRequest<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue = this.requestQueue.then(async () => {
        try {
          const now = Date.now()

          // Dynamic throttling based on remaining requests
          if (this.rateLimitRemaining <= 5 && now < this.rateLimitReset) {
            const waitTime = this.rateLimitReset - now
            debugLog(`[AniList] Rate limit low (${this.rateLimitRemaining} left). Waiting ${waitTime}ms...`)
            await new Promise(r => setTimeout(r, waitTime + 500))
          } else {
            // Soft delay to spread out requests sequentially
            const timeSinceLastRequest = Date.now() - this.lastRequestTime
            const minDelay = this.rateLimitRemaining < 30 ? 1000 : 350
            if (timeSinceLastRequest < minDelay) {
              await new Promise(r => setTimeout(r, minDelay - timeSinceLastRequest))
            }
          }
          this.lastRequestTime = Date.now()

          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ query, variables }),
          })

          // Parse rate limit headers
          const remaining = response.headers.get('x-ratelimit-remaining')
          const reset = response.headers.get('x-ratelimit-reset')

          if (remaining) this.rateLimitRemaining = parseInt(remaining, 10)
          if (reset) {
            const resetTime = parseInt(reset, 10)
            if (resetTime > 1000000000) {
              this.rateLimitReset = resetTime * 1000
            }
          }

          // Handle rate limiting
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After')
            let waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000
            if (this.rateLimitReset && this.rateLimitReset > Date.now()) {
              waitTime = Math.max(waitTime, this.rateLimitReset - Date.now())
            }
            debugWarn(`[AniList] Rate limited! Waiting ${waitTime}ms...`)
            await new Promise(r => setTimeout(r, waitTime + 1000))
            const result = await this.graphqlRequest<T>(query, variables)
            resolve(result)
            return
          }

          if (!response.ok) {
            throw new Error(`AniList API error: ${response.status}`)
          }

          const rawJson = await response.json()
          const json = this.transformUrlsInObject(rawJson)

          if (json.errors && json.errors.length > 0) {
            const error = json.errors[0]
            if (error.status === 429) {
              await new Promise(r => setTimeout(r, 60000))
              const result = await this.graphqlRequest<T>(query, variables)
              resolve(result)
              return
            }
            throw new Error(`AniList GraphQL error: ${error.message}`)
          }

          resolve(json as T)
        } catch (error) {
          reject(error)
        }
      }).catch(reject)
    })
  }

  /**
   * Search anime by title
   */
  async searchAnime(title: string, limit = 8): Promise<AniListMedia[]> {
    const cacheKey = `anilist-search:${title.toLowerCase()}`
    const cached = getCached<AniListMedia[]>(cacheKey)
    if (cached) return cached

    try {
      const cleanTitle = this.cleanTitle(title)
      const response = await this.graphqlRequest<AniListSearchResponse>(
        SEARCH_QUERY,
        { search: cleanTitle, page: 1, perPage: limit }
      )

      const results = response.data?.Page?.media || []
      if (results.length > 0) {
        setCache(cacheKey, results)
      }
      return results
    } catch (error) {
      debugError(`AniList searchAnime error for "${title}":`, error)
      return []
    }
  }

  /**
   * Get anime by AniList ID
   */
  async getAnimeById(anilistId: number): Promise<AniListMedia | null> {
    const cacheKey = `anilist-by-id:${anilistId}`
    const cached = getCached<AniListMedia>(cacheKey)
    if (cached) return cached

    try {
      const response = await this.graphqlRequest<AniListSingleResponse>(
        GET_BY_ID_QUERY,
        { id: anilistId }
      )

      const anime = response.data?.Media || null
      if (anime) setCache(cacheKey, anime)
      return anime
    } catch (error) {
      debugError(`AniList getAnimeById error for ID ${anilistId}:`, error)
      return null
    }
  }

  /**
   * Get anime by MAL ID (cross-reference)
   */
  async getAnimeByMalId(malId: number): Promise<AniListMedia | null> {
    const cacheKey = `anilist-by-mal:${malId}`
    const cached = getCached<AniListMedia>(cacheKey)
    if (cached) return cached

    try {
      const response = await this.graphqlRequest<AniListSingleResponse>(
        GET_BY_MAL_ID_QUERY,
        { idMal: malId }
      )

      const anime = response.data?.Media || null
      if (anime) setCache(cacheKey, anime)
      return anime
    } catch (error) {
      debugError(`AniList getAnimeByMalId error for MAL ID ${malId}:`, error)
      return null
    }
  }

  /**
   * Core search with session-level caching.
   * Returns the best matching AniListMedia or null.
   * This is the single entry point - cover, banner, and metadata all use this.
   */
  async findBestAnime(title: string, titleAlt?: string): Promise<AniListMedia | null> {
    // Build a stable session cache key
    const sessionKey = `${title.toLowerCase()}|${(titleAlt || '').toLowerCase()}`
    if (sessionResultCache.has(sessionKey)) {
      return sessionResultCache.get(sessionKey)!
    }

    const match = await this.findByTitleVariants(title, titleAlt)

    // Store in session cache (null also cached to prevent redundant searches)
    sessionResultCache.set(sessionKey, match)
    return match
  }

  /**
   * Tries title variants in priority order, stops as soon as a confident match is found.
   * Max 2 API queries in most cases.
   */
  private async findByTitleVariants(title: string, titleAlt?: string): Promise<AniListMedia | null> {
    // Split multi-name strings by comma → get individual clean names
    const altVariants = titleAlt
      ? titleAlt.split(',').map(s => s.trim()).filter(s => s.length >= 2)
      : []
    const titleVariants = title
      ? title.split(',').map(s => s.trim()).filter(s => s.length >= 2)
      : []

    // Priority: best alt names first, then main names
    // Use Set to deduplicate
    const seen = new Set<string>()
    const queriesToTry: string[] = []

    for (const v of [...altVariants, ...titleVariants]) {
      const lower = v.toLowerCase()
      if (!seen.has(lower)) {
        seen.add(lower)
        queriesToTry.push(v)
      }
    }

    // Filter out bad queries:
    // - Too short (< 4 chars) - prevents 3-letter acronyms like NGO, SAO, EVA causing false matches
    // - All uppercase & short (≤ 5 chars) - abbreviations: NGO, SAO, BOT, etc.
    const isUsableQuery = (q: string) => {
      const trimmed = q.trim()
      if (trimmed.length < 4) return false
      if (trimmed.length <= 5 && trimmed === trimmed.toUpperCase() && /^[A-Z]+$/.test(trimmed)) return false
      return true
    }

    const validQueries = queriesToTry.filter(isUsableQuery)

    if (validQueries.length === 0) {
      debugLog(`[AniList] All queries filtered out (too short/acronym) for: "${title}" / "${titleAlt}"`)
      return null
    }

    for (const query of validQueries) {
      debugLog('[AniList] Searching with query:', query)
      const results = await this.searchAnime(query)

      if (results.length > 0) {
        const match = this.findBestMatch(results, title, titleAlt)
        if (match) {
          debugLog(`[AniList] Matched: "${match.title.romaji}" (score threshold passed)`)
          return match
        }
        // Got results but no confident match → try next variant
        debugLog(`[AniList] Results found for "${query}" but no confident match, trying next...`)
      }
    }

    debugLog(`[AniList] No match found for: "${title}" / "${titleAlt}"`)
    return null
  }

  /**
   * Get high-quality cover image (uses session cache)
   */
  async getCoverImage(title: string, titleAlt?: string): Promise<string | null> {
    try {
      const match = await this.findBestAnime(title, titleAlt)
      if (!match) return null

      const cover = match.coverImage.extraLarge || match.coverImage.large || match.coverImage.medium || null
      if (cover) {
        debugLog('[AniList] Found cover for', match.title.romaji, ':', cover.substring(0, 50))
      }
      return cover
    } catch (error) {
      debugError('AniList getCoverImage error:', error)
      return null
    }
  }

  /**
   * Get banner/background image (1900x400) - uses session cache
   */
  async getBannerImage(title: string, titleAlt?: string): Promise<string | null> {
    try {
      const match = await this.findBestAnime(title, titleAlt)
      if (!match) return null

      const banner = match.bannerImage || null
      if (banner) {
        debugLog('[AniList] Found banner for', match.title.romaji)
      } else {
        debugLog('[AniList] No banner available for:', match.title.romaji)
      }
      return banner
    } catch (error) {
      debugError('AniList getBannerImage error:', error)
      return null
    }
  }

  /**
   * Get ALL metadata in one call (cover + banner + synopsis + etc.)
   * Uses session cache - no extra API calls if findBestAnime already ran.
   */
  async getEnhancedMetadata(title: string, titleAlt?: string): Promise<AniListAnimeData | null> {
    try {
      const match = await this.findBestAnime(title, titleAlt)
      if (!match) return null

      return {
        anilistId: match.id,
        malId: match.idMal,
        cover: match.coverImage.extraLarge || match.coverImage.large,
        banner: match.bannerImage,
        synopsis: match.description,
        score: match.averageScore,
        episodes: match.episodes,
        status: match.status,
        studios: match.studios?.nodes.map(s => s.name),
        genres: match.genres,
      }
    } catch (error) {
      debugError('AniList getEnhancedMetadata error:', error)
      return null
    }
  }

  /**
   * Clean title for better search results
   */
  private cleanTitle(title: string): string {
    return title
      // Remove Vietnamese suffixes
      .replace(/\s*(vietsub|thuyết minh|lồng tiếng|fhd|hd|full|tập \d+)/gi, '')
      // Remove season indicators
      .replace(/\s*(phần|season|ss|mùa)\s*\d+/gi, '')
      // Remove special characters
      .replace(/[△▽★☆♪♫]/g, '')
      // Remove bracketed content
      .replace(/\s*\([^)]+\)\s*/g, ' ')
      .replace(/\s*\[[^\]]+\]\s*/g, ' ')
      // Clean whitespace
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Find best matching anime from search results.
   * Uses romaji/english/native/synonyms for matching.
   * Returns null if no result meets the confidence threshold (score > 15).
   */
  private findBestMatch(
    results: AniListMedia[],
    title: string,
    titleAlt?: string
  ): AniListMedia | null {
    if (results.length === 0) return null

    const normalizeStr = (s: string) =>
      s.toLowerCase()
        .replace(/[△▽★☆♪♫]/g, '')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

    // We compare against all comma-split variants for better matching
    const searchTitles = title
      .split(',')
      .map(s => normalizeStr(this.cleanTitle(s.trim())))
      .filter(Boolean)

    const searchAltTitles = titleAlt
      ? titleAlt.split(',').map(s => normalizeStr(this.cleanTitle(s.trim()))).filter(Boolean)
      : []

    const allSearchTerms = [...new Set([...searchAltTitles, ...searchTitles])]

    // Threshold score - prevents unrelated matches (like Evangelion from "NGO")
    let bestScore = 15
    let bestMatch: AniListMedia | null = null

    for (const anime of results) {
      let score = 0

      const aniTitle = anime.title.romaji ? normalizeStr(anime.title.romaji) : ''
      const aniTitleEn = anime.title.english ? normalizeStr(anime.title.english) : ''
      const aniTitleNative = anime.title.native ? normalizeStr(anime.title.native) : ''
      const aniSynonyms = (anime.synonyms || []).map(s => normalizeStr(s))

      const allAniNames = [aniTitle, aniTitleEn, aniTitleNative, ...aniSynonyms].filter(Boolean)

      for (const query of allSearchTerms) {
        if (!query) continue

        // Exact match: highest score
        if (allAniNames.some(n => n === query)) {
          score += 100
        }

        // Partial match: AniList title contains query or vice versa
        if (aniTitle && (aniTitle.includes(query) || query.includes(aniTitle))) {
          score += 50
        }
        if (aniTitleEn && (aniTitleEn.includes(query) || query.includes(aniTitleEn))) {
          score += 40
        }

        // Synonym matching (curated by AniList team - highly reliable)
        for (const syn of aniSynonyms) {
          if (syn === query) {
            score += 70  // Exact synonym match
          } else if (syn.includes(query) || query.includes(syn)) {
            score += 25  // Partial synonym match
          }
        }

        // Word-level overlap scoring
        const queryWords = query.split(' ').filter(w => w.length > 2)
        const aniWords = aniTitle.split(' ').filter(w => w.length > 2)
        if (queryWords.length > 0 && aniWords.length > 0) {
          const overlap = queryWords.filter(w => aniWords.includes(w)).length
          const overlapRatio = overlap / Math.max(queryWords.length, aniWords.length)
          score += Math.round(overlapRatio * 40)
        }
      }

      // Popularity boost for disambiguation (but not dominant)
      if (anime.averageScore) score += anime.averageScore / 20

      if (score > bestScore) {
        bestScore = score
        bestMatch = anime
      }
    }

    return bestMatch
  }
}

// Singleton instance
export const anilistApi = new AniListApiService()
