// External API service for fetching anime metadata
// Consolidates AniList and Jikan metadata wrappers

import { anilistApi, type AniListAnimeData } from './anilist-api'
import { jikanApi } from './jikan-api'

export class ExternalApiService {
  /**
   * Get high-quality cover image — AniList only (extraLarge: 500x710)
   */
  async getCoverImage(title: string, titleAlt?: string): Promise<string | null> {
    try {
      console.log('[ExternalAPI] Fetching cover for:', titleAlt?.split(',')[0] || title)
      const meta = await anilistApi.getEnhancedMetadata(title, titleAlt)
      if (meta?.cover) {
        console.log('[ExternalAPI] ✅ Got AniList cover:', meta.cover.substring(0, 70) + '...')
        return meta.cover
      }
      console.log('[ExternalAPI] ⚠️ No cover found for:', titleAlt?.split(',')[0] || title)
      return null
    } catch (error) {
      console.error('getCoverImage error:', error)
      return null
    }
  }

  /**
   * Get Discord Presence Banner (Cover) Image — MAL Jikan
   */
  async getJikanCover(title: string, titleAlt?: string): Promise<string | null> {
    try {
      return await jikanApi.getAnimeCover(title, titleAlt)
    } catch (error) {
      console.error('getJikanCover error:', error)
      return null
    }
  }

  /**
   * Get banner/background image — AniList bannerImage (1900x400)
   */
  async getBannerImage(title: string, titleAlt?: string): Promise<string | null> {
    try {
      return await anilistApi.getBannerImage(title, titleAlt)
    } catch (error) {
      console.error('getBannerImage error:', error)
      return null
    }
  }

  /**
   * Get full metadata — AniList only (cover + banner + synopsis + score + genres + studios)
   * Session-cached: free if getCoverImage was already called for the same title.
   */
  async getEnhancedMetadata(title: string, titleAlt?: string): Promise<AniListAnimeData | null> {
    try {
      return await anilistApi.getEnhancedMetadata(title, titleAlt)
    } catch (error) {
      console.error('getEnhancedMetadata error:', error)
      return null
    }
  }
}

// Singleton instance
export const externalApi = new ExternalApiService()
