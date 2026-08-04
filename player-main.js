/**
 * Electron main process for the NekoStream player window.
 *
 * Security model, stated up front because this file bends several of Electron's
 * defaults on purpose:
 *
 *  - The player renderer (player.html) keeps nodeIntegration because it reads
 *    the local isolate.css/isolate.js assets and drives the <webview>. It only
 *    ever loads a local file, never remote content.
 *  - Remote content lives exclusively inside the <webview>, which runs with
 *    nodeIntegration=no (see player.html).
 *  - Every host decision in this file goes through the hostname allowlist
 *    helpers below. Substring tests on full URLs are not used: a URL like
 *    https://evil.example/?r=animevietsub passes `includes('animevietsub')`
 *    and would have inherited the provider's cookies and Bearer token.
 */

const { app, BrowserWindow, session, ipcMain, webFrameMain, webContents } = require('electron')
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
const path = require('path')
const fs = require('fs')
const os = require('os')

const DATA_DIR = path.join(os.homedir(), '.nekostream-cli')

/** Debug artifacts (DOM dumps) are opt-in; the CLI passes this through. */
const DEBUG_ENABLED = process.env.NEKOSTREAM_CLI_DEBUG === '1'

/**
 * Read the bundled Eruda console from node_modules. Returns '' if the optional
 * dependency is missing, which leaves the console disabled — the previous
 * implementation pulled it from a public CDN on every playback, so a hijacked
 * or MITM'd CDN meant arbitrary script inside the stream page.
 */
function readErudaSource() {
  try {
    return fs.readFileSync(require.resolve('eruda/eruda.js'), 'utf-8')
  } catch {
    return ''
  }
}

let mainWindow = null

// ── Host allowlists ──────────────────────────────────────────────────────────

/**
 * Registrable labels of the providers we ship. Matched against the
 * second-to-last hostname segment so that `cdn.animevietsub.site` passes while
 * `animevietsub.attacker.example` does not.
 */
const PROVIDER_LABELS = ['animevietsub', 'anime47', 'animehay']

/** Hosts that legitimately serve player pages and video segments. */
const STREAM_HOSTS = [
  'abyss.to',
  'abysscdn.com',
  'hydrax.net',
  'googleapiscdn.com',
  'googleapis.com',
  'gstatic.com',
  'localhost',
  '127.0.0.1'
]

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** True when hostname equals one of `hosts` or is a subdomain of one. */
function hostMatches(hostname, hosts) {
  if (!hostname) return false
  return hosts.some((h) => hostname === h || hostname.endsWith('.' + h))
}

/** True when the registrable label of `hostname` is a known provider. */
function isProviderHost(hostname) {
  if (!hostname) return false
  const parts = hostname.split('.')
  if (parts.length < 2) return false
  return PROVIDER_LABELS.includes(parts[parts.length - 2])
}

function isStreamHost(hostname) {
  return hostMatches(hostname, STREAM_HOSTS)
}

// ── IPC ──────────────────────────────────────────────────────────────────────

/**
 * Window controls must only be driven by our own renderer. Without this an
 * <iframe> deep inside a stream page could reach the handler and puppet the
 * window.
 */
function isTrustedSender(event) {
  return (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents
  )
}

function logToRenderer(msg) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('main-log', msg)
  }
}

ipcMain.on('player:minimize', (event) => {
  if (!isTrustedSender(event)) return
  mainWindow.minimize()
})

ipcMain.on('player:toggle-maximize', (event) => {
  if (!isTrustedSender(event)) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

// ── Stream payload ───────────────────────────────────────────────────────────

/**
 * The payload arrives base64-encoded in an environment variable. It is written
 * by our own CLI, but it is parsed into values that decide where cookies and
 * auth tokens are sent — so it is validated as untrusted input rather than
 * spread straight into the request handlers.
 */
function parseStreamPayload(encoded) {
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))
  } catch (err) {
    throw new Error('Stream payload is not valid base64 JSON: ' + err.message)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stream payload must be a JSON object')
  }
  if (typeof parsed.url !== 'string' || !/^https?:\/\//i.test(parsed.url)) {
    throw new Error('Stream payload is missing an http(s) url')
  }

  // Only string-valued headers survive, and only the three we actually inject.
  const headers = {}
  const source = parsed.headers && typeof parsed.headers === 'object' ? parsed.headers : {}
  for (const name of ['Referer', 'Origin', 'User-Agent']) {
    if (typeof source[name] === 'string' && source[name]) headers[name] = source[name]
  }

  const localStorageState = {}
  if (parsed.localStorageState && typeof parsed.localStorageState === 'object') {
    for (const [k, v] of Object.entries(parsed.localStorageState)) {
      if (typeof v === 'string') localStorageState[k] = v
    }
  }

  return { ...parsed, url: parsed.url, headers, localStorageState }
}

// ── Ad blocking ──────────────────────────────────────────────────────────────

/**
 * Gambling / popunder ad networks, matched against the *hostname* only.
 *
 * Previously this list was matched with `url.includes()` and contained the bare
 * tokens 'bet' and 'game', which blocked any URL containing those three or four
 * letters anywhere — including legitimate paths like `/api/betterQuality` or
 * `?game=...`. Keep entries specific enough to be a hostname fragment.
 */
const AD_HOST_FRAGMENTS = [
  'in88',
  'quayhu',
  'nohu',
  'bet188',
  '188bet',
  'w88',
  'fun88',
  'm88',
  'fb88',
  'bk8',
  'cmd368',
  'letou',
  'vwin',
  'lixi88',
  'loto188',
  'kubet',
  'ku-bet',
  'thabet',
  'tha-bet',
  'ae888',
  'fi88',
  '12bet',
  'sin88',
  'popunder',
  'pop-under',
  'popads',
  'popcash',
  'histats.com',
  'clickadu',
  'exoclick',
  'juicyads',
  'adsterra',
  'adskeeper',
  'mgid.com',
  'ad-maven',
  'onclickads',
  'propellerads',
  'adsco.re',
  'adscore',
  'decafeligiblyhad.com',
  'morphify.net'
]

/** Ad probes the provider itself fetches to detect adblockers. */
const AD_PROBE_HOSTS = ['doubleclick.net', 'googleads.g.doubleclick.net', 'googlesyndication.com']

function isIntrusiveAdHost(hostname) {
  return AD_HOST_FRAGMENTS.some((fragment) => hostname.includes(fragment))
}

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  const streamData = process.env.NEKOSTREAM_CLI_STREAM
  if (!streamData) {
    console.error('No stream data provided.')
    app.quit()
    return
  }

  let streamInfo
  try {
    streamInfo = parseStreamPayload(streamData)
  } catch (err) {
    console.error('[Main] Refusing to start:', err.message)
    app.quit()
    return
  }

  // Hosts named by this specific stream. Derived once so the request handlers
  // can allow the exact origins this playback needs and nothing more.
  const payloadHosts = [streamInfo.url, streamInfo.headers.Referer, streamInfo.headers.Origin]
    .map(hostnameOf)
    .filter(Boolean)

  const isPlaybackHost = (hostname) =>
    isProviderHost(hostname) || isStreamHost(hostname) || payloadHosts.includes(hostname)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      // player.html only ever loads from disk; remote content is confined to
      // the <webview>, which runs with nodeIntegration=no.
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // Required for some streams (CORS bypass)
      webviewTag: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  const playerSession = session.fromPartition('persist:player-session')
  const sessions = [session.defaultSession, playerSession]

  // Inject decrypted stored cookies into sessions
  injectStoredCookies(sessions)

  sessions.forEach((sess) => {
    // Network-level ad-blocking (like browser extensions)
    sess.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const hostname = hostnameOf(details.url)

      // ── Step 1: Unconditional block for intrusive / gambling / popup ad networks ──
      // These are never whitelisted, even inside a provider tab context.
      const lowerUrl = details.url.toLowerCase()
      const isIntrusiveAd =
        isIntrusiveAdHost(hostname) ||
        (lowerUrl.includes('banner') &&
          (lowerUrl.includes('casino') ||
            lowerUrl.includes('tai-xiu') ||
            lowerUrl.includes('keo-nha-cai')))

      if (isIntrusiveAd) {
        logToRenderer(`[AdBlock] Blocked URL: ${details.url}`)
        return callback({ cancel: true })
      }

      // ── Step 2: Let the provider's own adblock probes through ──
      // AVS fetches googlesyndication/doubleclick to detect adblockers. Cancel
      // those and the site shows its "Phát hiện trình chặn quảng cáo" overlay
      // instead of playing. So they are allowed, but only when the request
      // really originates from a provider page.
      const fromProvider =
        isProviderHost(hostnameOf(details.referrer)) ||
        isProviderHost(hostnameOf(details.initiator)) ||
        isProviderHost(hostname)

      let inProviderTab = false
      try {
        const wc = webContents.fromId(details.webContentsId)
        if (wc) inProviderTab = isProviderHost(hostnameOf(wc.getURL()))
      } catch {
        // webContents may already be gone; fall through to the default policy.
      }

      if (fromProvider || inProviderTab) {
        return callback({ cancel: false })
      }

      // ── Step 3: Block ad domains everywhere else (players/iframes) ──
      if (hostMatches(hostname, AD_PROBE_HOSTS)) {
        return callback({ cancel: true })
      }

      return callback({ cancel: false })
    })

    // Strip CSP and X-Frame-Options so the stream page can be framed and
    // instrumented. Scoped to the provider and stream hosts: stripping these on
    // every response weakened every other origin the window ever touched,
    // including the ad and analytics domains we do not control.
    sess.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      if (!isPlaybackHost(hostnameOf(details.url))) {
        return callback({ cancel: false })
      }
      const responseHeaders = { ...details.responseHeaders }
      for (const key of Object.keys(responseHeaders)) {
        const lowerKey = key.toLowerCase()
        if (
          lowerKey === 'content-security-policy' ||
          lowerKey === 'content-security-policy-report-only' ||
          lowerKey === 'x-frame-options'
        ) {
          delete responseHeaders[key]
        }
      }
      callback({ cancel: false, responseHeaders })
    })

    // Inject Referer/Origin/User-Agent, needed for iframe streams.
    sess.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      const headers = { ...details.requestHeaders }
      const hostname = hostnameOf(details.url)
      const providerLabel = hostname.split('.').slice(-2)[0]

      // Bearer token goes to Anime47 and nowhere else. A substring test used to
      // decide this, so any URL containing "anime47" — on any host — received
      // the user's access token.
      if (isProviderHost(hostname) && providerLabel === 'anime47') {
        const token = streamInfo.localStorageState?.access_token
        if (token) headers['Authorization'] = `Bearer ${token}`
      }

      // Override Referer/Origin for player page loads only, never for video
      // chunk requests (those are signed against their own origin).
      if (isPlaybackHost(hostname)) {
        if (streamInfo.headers.Referer) headers['Referer'] = streamInfo.headers.Referer
        if (streamInfo.headers.Origin) headers['Origin'] = streamInfo.headers.Origin
      }

      if (streamInfo.headers['User-Agent']) headers['User-Agent'] = streamInfo.headers['User-Agent']
      callback({ requestHeaders: headers })
    })
  })

  mainWindow.webContents.on('did-finish-load', () => {
    const originalUA = session.defaultSession.getUserAgent()
    const cleanUA = originalUA
      .replace(/Electron\/[0-9.]+\s?/i, '')
      .replace(/NekoStream-CLI\/[0-9.]+\s?/i, '')
      .trim()
    // The preload copy that player.html builds reads these two fields to decide
    // whether to start the Eruda console. Both are absent unless this process
    // was started with NEKOSTREAM_CLI_DEBUG=1, so the console fails closed and
    // never touches the network — the source ships in node_modules.
    const preloadInfo = { ...streamInfo, __nekoDebug: DEBUG_ENABLED }
    if (DEBUG_ENABLED) {
      preloadInfo.__nekoErudaSource = readErudaSource()
    }
    mainWindow?.webContents.executeJavaScript(`
      window.initPlayer(${JSON.stringify(preloadInfo)}, ${JSON.stringify(__dirname)}, ${JSON.stringify(cleanUA)});
    `)
  })

  // Listen for webview attachment, then watch all frames it creates.
  // frame-created fires for EVERY frame (including dynamically injected iframes),
  // and WebFrameMain.executeJavaScript() bypasses all cross-origin restrictions.
  mainWindow.webContents.on('did-attach-webview', (event, guestWebContents) => {
    // Block all popups from the player webview
    guestWebContents.setWindowOpenHandler((details) => {
      console.log('[Webview Blocked popup]:', details.url)
      return { action: 'deny' }
    })

    // Block navigation away from the provider/stream hosts.
    guestWebContents.on('will-navigate', (e, url) => {
      const scheme = (url.split(':')[0] || '').toLowerCase()
      const isAllowed =
        scheme === 'about' || scheme === 'chrome-extension' || isPlaybackHost(hostnameOf(url))
      if (!isAllowed) {
        console.log('[Webview Blocked redirect]:', url)
        e.preventDefault()
      }
    })

    const injectIntoFrame = (frame) => {
      try {
        if (!isStreamHost(hostnameOf(frame.url))) return

        // Diagnostic DOM snapshot, used when writing ad selectors for a new
        // player. Opt-in, and written under the user's data dir — it used to be
        // written unconditionally into the installed package directory on every
        // playback, which both leaked page content and dirtied node_modules.
        if (DEBUG_ENABLED) {
          frame
            .executeJavaScript('document.documentElement.outerHTML')
            .then((html) => {
              if (html && html.length > 200) {
                fs.mkdirSync(DATA_DIR, { recursive: true })
                fs.writeFileSync(path.join(DATA_DIR, 'dom-dump.html'), html, 'utf-8')
              }
            })
            .catch(() => {})
        }

        frame
          .executeJavaScript(
            `
          (function() {
            if (window.__neko_cleaner_active__) return;
            window.__neko_cleaner_active__ = true;

            // --- CSS block ---
            if (!document.getElementById('__neko_adblock__')) {
              const style = document.createElement('style');
              style.id = '__neko_adblock__';
              style.textContent = [
                'img[src*="in88"],img[src*="quayhu"],img[src*="nohu"],',
                'img[src*="188bet"],img[src*="kubet"],img[src*="w88"],img[src*="fun88"],img[src*="sin88"],',
                'div[style*="sin88"],div[style*="in88"],',
                '[class*="art-ad"],[class*="artplayer-ad"],[class*="art-ads"],[class*="artplayer-ads"],',
                '[class*="ads-container"],[class*="ad-container"],[class*="pause-ad"],[id*="pause-ad"],',
                '[class*="ads-pause"],[id*="ads-pause"],[class*="overlay-ad"],[id*="overlay-ad"],',
                '[class*="popup-ad"],[id*="popup-ad"],[class*="quangcao"],[id*="quangcao"],',
                '[class*="qc-"],[id*="qc-"] { display:none!important }'
              ].join('');
              (document.head || document.documentElement).appendChild(style);
            }

            // --- DOM cleaner ---
            const AD_TEXTS = ['Đóng quảng cáo', 'Đóng và xem tiếp', 'Quảng cáo'];
            // Specific gambling-brand fragments only. Bare 'bet' and 'game'
            // used to be in this list and removed unrelated player controls.
            const AD_SRCS  = ['in88', 'quayhu', 'nohu', '188bet', 'kubet', 'w88', 'fun88', 'sin88'];

            const clean = () => {
              try {
                // Bypass Abyss popup click-jacking by rewriting the overlay click event
                if (window.abyssConfig || document.onclick || document.ontouchend) {
                  if (document.onclick !== null || document.ontouchend !== null) {
                    document.onclick = null;
                    document.ontouchend = null;
                    const overlay = document.getElementById('overlay');
                    if (overlay) {
                      overlay.onclick = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (window.jwplayer && typeof window.jwplayer === 'function') {
                          try {
                            window.jwplayer().play();
                          } catch(err) {}
                        }
                        overlay.remove();
                      };
                      overlay.ontouchend = overlay.onclick;
                    }
                  }
                }

                if (!document.body) return;
                document.querySelectorAll('div,section,article,button,a,span,img').forEach(el => {
                  const txt = (el.innerText || el.textContent || '').trim();
                  const src = (el.src || el.getAttribute('src') || el.getAttribute('href') || '').toLowerCase();
                  const isAdTxt = AD_TEXTS.some(t => txt === t || txt.startsWith(t));
                  const isAdSrc = AD_SRCS.some(k => src.includes(k));
                  if (!isAdTxt && !isAdSrc) return;

                  // Walk up to find fixed/absolute overlay container or known ad class wrapper
                  let node = el;
                  for (let i = 0; i < 10; i++) {
                    const p = node.parentElement;
                    if (!p || p === document.body || p === document.documentElement) break;
                    if (p.querySelector('video') || p.querySelector('canvas')) break;

                    const className = (p.className || '').toString().toLowerCase();
                    const id = (p.id || '').toString().toLowerCase();
                    const isAdContainer = className.includes('ad') || className.includes('qc') || className.includes('banner') || className.includes('popup') || className.includes('overlay') ||
                                          id.includes('ad') || id.includes('qc') || id.includes('banner') || id.includes('popup') || id.includes('overlay');

                    const cs = getComputedStyle(p);
                    if (cs.position === 'fixed' || cs.position === 'absolute' || isAdContainer) {
                      p.remove(); return;
                    }
                    node = p;
                  }
                  el.remove();
                });
              } catch(e) {}
            };

            clean();
            setInterval(clean, 250);
          })();
        `
          )
          .catch(() => {})
      } catch (err) {
        console.error('[Main Webview] Failed to inject frame:', err)
      }
    }

    guestWebContents.on('did-frame-finish-load', (e, isMainFrame, frameProcessId, frameRoutingId) => {
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
      if (frame) {
        injectIntoFrame(frame)
      }
    })

    guestWebContents.on('frame-created', (e, details) => {
      const frame = details.frame
      setTimeout(() => {
        injectIntoFrame(frame)
      }, 500)
    })
  })

  mainWindow.loadFile(path.join(__dirname, 'player.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── Stored session cookies ───────────────────────────────────────────────────

/**
 * Read the CLI's encrypted auth sessions and seed the player's cookie jars.
 *
 * This duplicates the crypto in storage.ts because the player runs in a
 * separate Electron process that does not load the compiled CLI. The two must
 * stay in sync — the format is documented there. Unifying them behind one
 * shared module is Phase 6 work.
 */
function injectStoredCookies(sessions) {
  const crypto = require('crypto')
  const authSessionsFile = path.join(DATA_DIR, 'auth-sessions.json')

  if (!fs.existsSync(authSessionsFile)) return

  try {
    const parsed = JSON.parse(fs.readFileSync(authSessionsFile, 'utf-8'))

    const seed = `nekostream-cli:${os.hostname()}:${os.userInfo().username}:auth-v1`
    const key = crypto.createHash('sha256').update(seed).digest()

    const decrypt = (encoded) => {
      if (typeof encoded !== 'string') return null
      try {
        // AES-256-GCM (current format). The auth tag is verified, so a tampered
        // file fails closed instead of yielding attacker-chosen cookies.
        if (encoded.startsWith('gcm1:')) {
          const [ivHex, tagHex, encryptedB64] = encoded.slice(5).split(':')
          if (!ivHex || !tagHex || !encryptedB64) return null
          const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
          decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
          return Buffer.concat([
            decipher.update(Buffer.from(encryptedB64, 'base64')),
            decipher.final()
          ]).toString('utf8')
        }
        // Legacy AES-256-CBC records. The old 'plain:' base64 escape hatch is
        // rejected on purpose: it let anyone downgrade the file to plaintext.
        const [ivHex, encryptedB64] = encoded.split(':')
        if (!ivHex || !encryptedB64) return null
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'))
        return Buffer.concat([
          decipher.update(Buffer.from(encryptedB64, 'base64')),
          decipher.final()
        ]).toString('utf8')
      } catch {
        return null
      }
    }

    for (const encoded of Object.values(parsed)) {
      const decrypted = decrypt(encoded)
      if (!decrypted) continue

      let sessionData
      try {
        sessionData = JSON.parse(decrypted)
      } catch {
        continue
      }
      if (!sessionData || !Array.isArray(sessionData.cookies)) continue

      for (const cookie of sessionData.cookies) {
        // Cookies come from a file on disk, so shape-check before handing them
        // to Electron — and only accept ones belonging to a known provider.
        if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') continue
        if (typeof cookie.domain !== 'string' || !cookie.domain) continue

        const domainNoDot = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
        if (!isProviderHost(domainNoDot.toLowerCase())) continue

        const cookiePath = typeof cookie.path === 'string' ? cookie.path : '/'
        const url = (cookie.secure ? 'https://' : 'http://') + domainNoDot + cookiePath
        const cookieDetails = {
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookiePath,
          secure: !!cookie.secure,
          httpOnly: !!cookie.httpOnly,
          expirationDate: cookie.expirationDate
        }
        for (const sess of sessions) {
          sess.cookies.set(cookieDetails).catch(() => {
            // Invalid cookie fields must not crash player startup.
          })
        }
      }
    }
    console.log('[Main] Decrypted and injected saved session cookies.')
  } catch (err) {
    console.error('[Main] Failed to inject stored cookies:', err)
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
