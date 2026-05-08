// Video stream interceptor and parser
// Captures HLS/DASH/MP4 streams from video players

import type { Page } from 'playwright'

export interface VideoQuality {
  quality: string
  bandwidth?: number
  resolution?: string
  url: string
}

export interface ParsedPlaylist {
  type: 'master' | 'media'
  qualities: VideoQuality[]
  defaultUrl?: string
}

/**
 * Parse M3U8 master playlist to extract quality options
 */
export function parseM3U8(content: string, baseUrl: string): ParsedPlaylist {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l)
  const qualities: VideoQuality[] = []
  
  let isMaster = false
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Check if master playlist
    if (line.includes('#EXT-X-STREAM-INF')) {
      isMaster = true
      
      // Parse attributes
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/)
      const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/)
      
      const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : undefined
      const resolution = resolutionMatch ? resolutionMatch[1] : undefined
      
      // Get quality from resolution or bandwidth
      let quality = 'unknown'
      if (resolution) {
        const height = parseInt(resolution.split('x')[1])
        quality = `${height}p`
      } else if (bandwidth) {
        if (bandwidth > 4000000) quality = '1080p'
        else if (bandwidth > 2000000) quality = '720p'
        else if (bandwidth > 1000000) quality = '480p'
        else quality = '360p'
      }
      
      // Next line should be the URL
      const urlLine = lines[i + 1]
      if (urlLine && !urlLine.startsWith('#')) {
        const url = urlLine.startsWith('http') 
          ? urlLine 
          : new URL(urlLine, baseUrl).href
        
        qualities.push({
          quality,
          bandwidth,
          resolution,
          url
        })
        i++ // Skip URL line
      }
    }
  }
  
  // Sort by quality (highest first)
  qualities.sort((a, b) => {
    const getHeight = (q: string) => parseInt(q.replace('p', '')) || 0
    return getHeight(b.quality) - getHeight(a.quality)
  })
  
  return {
    type: isMaster ? 'master' : 'media',
    qualities,
    defaultUrl: qualities[0]?.url
  }
}

/**
 * Fetch and parse M3U8 playlist
 */
export async function fetchM3U8(url: string, headers: Record<string, string> = {}): Promise<ParsedPlaylist | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers
      }
    })
    
    if (!response.ok) return null
    
    const content = await response.text()
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1)
    
    return parseM3U8(content, baseUrl)
  } catch (error) {
    console.error('Error fetching M3U8:', error)
    return null
  }
}

/**
 * Try to find video sources from page JavaScript
 */
export async function extractVideoFromJS(page: Page): Promise<string[]> {
  const videos: string[] = []
  
  try {
    // Try to get video sources from various player implementations
    const sources = await page.evaluate(() => {
      const urls: string[] = []
      
      // Check video elements
      document.querySelectorAll('video').forEach(video => {
        if (video.src) urls.push(video.src)
        if (video.currentSrc) urls.push(video.currentSrc)
        video.querySelectorAll('source').forEach(source => {
          if (source.src) urls.push(source.src)
        })
      })
      
      // Check for ArtPlayer
      if ((window as any).art?.option?.url) {
        urls.push((window as any).art.option.url)
      }
      
      // Check for Plyr
      if ((window as any).player?.source?.sources) {
        (window as any).player.source.sources.forEach((s: any) => {
          if (s.src) urls.push(s.src)
        })
      }
      
      // Check for Video.js
      if ((window as any).videojs) {
        try {
          const players = (window as any).videojs.getPlayers()
          Object.values(players).forEach((p: any) => {
            if (p?.currentSrc) urls.push(p.currentSrc())
            if (p?.src) urls.push(typeof p.src === 'function' ? p.src() : p.src)
          })
        } catch (e) {}
      }
      
      // Check for JWPlayer - multiple detection methods
      if ((window as any).jwplayer) {
        try {
          // Try default instance
          const jw = (window as any).jwplayer()
          if (jw?.getPlaylistItem) {
            const item = jw.getPlaylistItem()
            if (item?.file) urls.push(item.file)
            if (item?.sources) {
              item.sources.forEach((s: any) => {
                if (s.file) urls.push(s.file)
              })
            }
          }
          if (jw?.getConfig) {
            const config = jw.getConfig()
            if (config?.file) urls.push(config.file)
            if (config?.playlist) {
              config.playlist.forEach((p: any) => {
                if (p.file) urls.push(p.file)
                if (p.sources) p.sources.forEach((s: any) => s.file && urls.push(s.file))
              })
            }
          }
        } catch (e) {}
        
        // Try all JWPlayer instances
        try {
          const allJw = (window as any).jwplayer?.instances || []
          allJw.forEach((inst: any) => {
            try {
              const item = inst?.getPlaylistItem?.()
              if (item?.file) urls.push(item.file)
              if (item?.sources) item.sources.forEach((s: any) => s.file && urls.push(s.file))
            } catch (e) {}
          })
        } catch (e) {}
      }
      
      // Check global variables commonly used by anime sites
      const globals = ['source', 'video_url', 'videoUrl', 'fileUrl', 'file', 'streamUrl', 'hlsUrl', 'mp4Url', 'playUrl']
      globals.forEach(g => {
        const val = (window as any)[g]
        if (typeof val === 'string' && val.includes('http')) urls.push(val)
      })
      
      // Search in page scripts for video URLs
      const scripts = document.querySelectorAll('script')
      scripts.forEach(script => {
        const content = script.textContent || ''
        
        // Find m3u8 URLs
        const m3u8Matches = content.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g)
        if (m3u8Matches) urls.push(...m3u8Matches)
        
        // Find mp4 URLs - more aggressive pattern
        const mp4Matches = content.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g)
        if (mp4Matches) urls.push(...mp4Matches)
        
        // Find file: "url" patterns (common in player configs)
        const fileMatches = content.match(/["']file["']\s*:\s*["']([^"']+)["']/gi)
        fileMatches?.forEach(m => {
          const urlMatch = m.match(/["']([^"']+)["']$/i)
          if (urlMatch?.[1]?.startsWith('http')) urls.push(urlMatch[1])
        })
        
        // Find sources array patterns
        const sourcesMatch = content.match(/["']?sources["']?\s*:\s*\[([^\]]+)\]/gi)
        sourcesMatch?.forEach(m => {
          const urlMatches = m.match(/https?:\/\/[^\s"'<>\]]+/g)
          if (urlMatches) urls.push(...urlMatches)
        })
      })
      
      // Check iframes for potential embed URLs (for logging/fallback)
      document.querySelectorAll('iframe[src]').forEach(iframe => {
        const src = iframe.getAttribute('src')
        if (src && (src.includes('player') || src.includes('embed') || src.includes('video'))) {
          // Don't add iframe URLs as direct streams, but log them
          console.log('[extractVideoFromJS] Found player iframe:', src)
        }
      })
      
      return urls
    })
    
    // Deduplicate and filter
    const unique = [...new Set(sources)].filter(url => {
      if (!url.startsWith('http')) return false
      // Must contain video extension or streaming patterns
      return (
        url.includes('.m3u8') || 
        url.includes('.mp4') || 
        url.includes('.mpd') ||
        url.includes('.webm') ||
        url.includes('/hls/') ||
        url.includes('/video/')
      )
    })
    
    console.log('[extractVideoFromJS] Found', unique.length, 'video URLs')
    videos.push(...unique)
  } catch (error) {
    console.error('Error extracting video from JS:', error)
  }
  
  return videos
}

/**
 * Wait for video element to have a source
 */
export async function waitForVideoSource(page: Page, timeout: number = 10000): Promise<string | null> {
  try {
    const source = await page.evaluate(() => {
      return new Promise<string | null>((resolve) => {
        const checkVideo = () => {
          const video = document.querySelector('video')
          if (video?.src && video.src !== '') {
            resolve(video.src)
            return true
          }
          return false
        }
        
        // Check immediately
        if (checkVideo()) return
        
        // Watch for changes
        const observer = new MutationObserver(() => {
          if (checkVideo()) {
            observer.disconnect()
          }
        })
        
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src']
        })
        
        // Timeout
        setTimeout(() => {
          observer.disconnect()
          resolve(null)
        }, 10000)
      })
    })
    
    return source
  } catch (error) {
    return null
  }
}
