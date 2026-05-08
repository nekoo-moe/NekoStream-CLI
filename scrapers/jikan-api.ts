import { request } from 'undici'

export interface JikanAnimeData {
  cover: string | null
}

class JikanApiService {
  private readonly CACHE_DURATION_MS = 1000 * 60 * 60 * 24 // 24 hours caching
  private cache = new Map<string, { data: JikanAnimeData; timestamp: number }>()
  
  // Rate limiting properties (Jikan applies strict limits, spacing out by 1000ms is perfectly safe)
  private lastRequestTime = 0
  private readonly RATE_LIMIT_DELAY_MS = 1100 

  async getAnimeCover(title: string, titleAlt?: string): Promise<string | null> {
    const rawTitle = titleAlt ? titleAlt.split(',')[0].trim() : title.trim()
    if (!rawTitle) return null

    const cacheKey = rawTitle.toLowerCase()
    
    // Check in-memory session cache first
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
      return cached.data.cover
    }

    // Apply strict rate limiting before fetch
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY_MS - timeSinceLastRequest))
    }
    
    try {
      this.lastRequestTime = Date.now()
      const searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(rawTitle)}&limit=1`
      const { statusCode, body } = await request(searchUrl, {
        headers: {
          'User-Agent': 'NekoStream-Desktop-App/1.0'
        }
      })

      if (statusCode !== 200) {
        console.warn(`[JikanAPI] API returned status ${statusCode} for "${rawTitle}"`)
        return null
      }

      const rawBody = await body.text()
      const json = JSON.parse(rawBody)

      if (json.data && json.data.length > 0) {
        // Prefer large webp, fallback to large jpg
        const cover = json.data[0].images?.webp?.large_image_url || json.data[0].images?.jpg?.large_image_url || null
        
        const result = { cover }
        this.cache.set(cacheKey, { data: result, timestamp: Date.now() })
        
        console.log(`[JikanAPI] Cached cover for "${rawTitle}": ${cover}`)
        return cover
      }
      
      console.warn(`[JikanAPI] No anime found matching "${rawTitle}"`)
      // Cache empty result to avoid hitting limit for unknowns
      this.cache.set(cacheKey, { data: { cover: null }, timestamp: Date.now() })
      return null
    } catch (error) {
      console.error('[JikanAPI] Error fetching anime cover:', error)
      return null
    }
  }
}

export const jikanApi = new JikanApiService()
