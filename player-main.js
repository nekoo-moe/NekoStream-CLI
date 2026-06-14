const { app, BrowserWindow, session, ipcMain } = require('electron')
const path = require('path')

let mainWindow = null

function createWindow() {
  const streamData = process.env.NEKOSTREAM_CLI_STREAM
  if (!streamData) {
    console.error('No stream data provided.')
    app.quit()
    return
  }

  const streamInfo = JSON.parse(Buffer.from(streamData, 'base64').toString('utf-8'))

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
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

  sessions.forEach(sess => {
    // Network-level ad-blocking (like browser extensions)
    sess.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const url = details.url;
      const lowerUrl = url.toLowerCase();

      // ── Whitelist: never block requests originating FROM or loaded in an animevietsub tab ──
      // AVS fetches probe URLs (googlesyndication, doubleclick, etc.) to detect adblock.
      // If we cancel those probes, the site shows the "Phát hiện trình chặn quảng cáo" overlay.
      // We must let these probes succeed so AVS thinks ads loaded normally.
      const referer   = (details.referrer  || '').toLowerCase();
      const initiator = (details.initiator || '').toLowerCase();
      const fromAvs   = referer.includes('animevietsub') || initiator.includes('animevietsub') || lowerUrl.includes('animevietsub');

      let isAvsTab = false;
      try {
        const { webContents } = require('electron');
        const wc = webContents.fromId(details.webContentsId);
        if (wc) {
          const tabUrl = wc.getURL().toLowerCase();
          if (tabUrl.includes('animevietsub')) {
            isAvsTab = true;
          }
        }
      } catch (e) {}

      if (fromAvs || isAvsTab) {
        return callback({ cancel: false });
      }

      const adKeywords = [
        'in88', 'quayhu', 'nohu', 'bet188', '188bet', 'w88', 'fun88', 'm88', 'fb88',
        'bk8', 'cmd368', 'letou', 'kyna', 'vwin', 'lixi88', 'loto188', 'kubet', 'ku-bet',
        'thabet', 'tha-bet', 'ae888', 'fi88', '12bet', 'junk', 'popunder', 'pop-under',
        'histats.com', 'clickadu', 'exoclick', 'juicyads', 'adsterra', 'yandex.ru',
        'adskeeper', 'mgid.com', 'ad-maven', 'onclickads', 'propellerads', 'cloudflareinsights.com'
      ];

      const shouldBlock = adKeywords.some(keyword => lowerUrl.includes(keyword)) ||
                          lowerUrl.includes('doubleclick.net') ||
                          lowerUrl.includes('googleads') ||
                          lowerUrl.includes('googlesyndication') ||
                          (lowerUrl.includes('banner') && (lowerUrl.includes('casino') || lowerUrl.includes('tai-xiu') || lowerUrl.includes('keo-nha-cai')));

      if (shouldBlock) {
        return callback({ cancel: true });
      }

      return callback({ cancel: false });
    });

    // Strip Content-Security-Policy and X-Frame-Options to allow script injection (Eruda) and cross-origin iframe handling
    sess.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
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

    // Always inject Referer/Origin/User-Agent headers (needed for iframe streams like googleapiscdn)
    if (streamInfo.headers) {
      const filter = { urls: ['*://*/*'] }
      sess.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        const headers = { ...details.requestHeaders }
        if (streamInfo.headers.Referer) headers['Referer'] = streamInfo.headers.Referer
        if (streamInfo.headers.Origin) headers['Origin'] = streamInfo.headers.Origin
        if (streamInfo.headers['User-Agent']) headers['User-Agent'] = streamInfo.headers['User-Agent']
        callback({ requestHeaders: headers })
      })
    }
  })

  // Load eruda script content securely in Node process
  const fs = require('fs')
  let erudaCode = ''
  try {
    const erudaPath = require.resolve('eruda/eruda.js')
    erudaCode = fs.readFileSync(erudaPath, 'utf-8')
  } catch (err) {
    try {
      const fallbackPath = path.join(__dirname, 'node_modules', 'eruda', 'eruda.js')
      erudaCode = fs.readFileSync(fallbackPath, 'utf-8')
    } catch (err2) {
      console.error('[Main] Failed to load eruda:', err2)
    }
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript(`
      window.initPlayer(${JSON.stringify(streamInfo)});
    `)
  })

  // Listen for webview attachment, then watch all frames it creates.
  // frame-created fires for EVERY frame (including dynamically injected iframes),
  // and WebFrameMain.executeJavaScript() bypasses all cross-origin restrictions.
  mainWindow.webContents.on('did-attach-webview', (event, guestWebContents) => {
    guestWebContents.on('frame-created', (e, details) => {
      const frame = details.frame

      frame.once('dom-ready', () => {
        const frameUrl = frame.url

        const isPlayer = frameUrl.includes('googleapiscdn.com') || frameUrl.includes('googleapis.com')
        if (!isPlayer) return

        // Dump DOM once for diagnostic (reads the real elements so we can write precise selectors)
        frame.executeJavaScript('document.documentElement.outerHTML')
          .then(html => {
            if (html && html.length > 200) {
              require('fs').writeFileSync(
                path.join(__dirname, 'dom-dump.html'), html, 'utf-8'
              )
            }
          })
          .catch(() => {})

        // Inject ad-blocking CSS + DOM cleaner directly inside the player frame
        frame.executeJavaScript(`
          (function() {
            // --- CSS block ---
            const style = document.createElement('style');
            style.id = '__neko_adblock__';
            style.textContent = [
              'img[src*="in88"],img[src*="quayhu"],img[src*="nohu"],',
              'img[src*="188bet"],img[src*="kubet"],img[src*="w88"],img[src*="fun88"],',
              '[class*="pause-ad"],[id*="pause-ad"],[class*="ads-pause"],[id*="ads-pause"],',
              '[class*="overlay-ad"],[id*="overlay-ad"],[class*="popup-ad"],[id*="popup-ad"],',
              '[class*="quangcao"],[id*="quangcao"],[class*="qc-"],[id*="qc-"] { display:none!important }'
            ].join('');
            (document.head || document.documentElement).appendChild(style);

            // --- DOM cleaner ---
            const AD_TEXTS = ['Đóng quảng cáo', 'Đóng và xem tiếp', 'Quảng cáo'];
            const AD_SRCS  = ['in88', 'quayhu', 'nohu', '188bet', 'kubet', 'w88', 'fun88'];

            const clean = () => {
              try {
                if (!document.body) return;
                document.querySelectorAll('div,section,article,button,a,span,img').forEach(el => {
                  const txt = (el.innerText || el.textContent || '').trim();
                  const src = (el.src || el.getAttribute('src') || el.getAttribute('href') || '').toLowerCase();
                  const isAdTxt = AD_TEXTS.some(t => txt === t || txt.startsWith(t));
                  const isAdSrc = AD_SRCS.some(k => src.includes(k));
                  if (!isAdTxt && !isAdSrc) return;

                  // Walk up to find fixed/absolute overlay container
                  let node = el;
                  for (let i = 0; i < 10; i++) {
                    const p = node.parentElement;
                    if (!p || p === document.body || p === document.documentElement) break;
                    if (p.querySelector('video') || p.querySelector('canvas')) break;
                    const cs = getComputedStyle(p);
                    if (cs.position === 'fixed' || cs.position === 'absolute') {
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
        `).catch(() => {})
      })
    })
  })

  mainWindow.loadFile(path.join(__dirname, 'player.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function injectStoredCookies(sessions) {
  const os = require('os')
  const fs = require('fs')
  const crypto = require('crypto')
  const path = require('path')

  const dataDir = path.join(os.homedir(), '.nekostream-cli')
  const authSessionsFile = path.join(dataDir, 'auth-sessions.json')

  if (!fs.existsSync(authSessionsFile)) return

  try {
    const raw = fs.readFileSync(authSessionsFile, 'utf-8')
    const parsed = JSON.parse(raw)
    
    const seed = `nekostream-cli:${os.hostname()}:${os.userInfo().username}:auth-v1`
    const key = crypto.createHash('sha256').update(seed).digest()

    const decrypt = (encoded) => {
      try {
        if (encoded.startsWith('plain:')) {
          return Buffer.from(encoded.slice(6), 'base64').toString('utf8')
        }
        const [ivHex, encryptedB64] = encoded.split(':')
        if (!ivHex || !encryptedB64) return null
        const iv = Buffer.from(ivHex, 'hex')
        const encrypted = Buffer.from(encryptedB64, 'base64')
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
      } catch (e) {
        return null
      }
    }

    for (const [provider, encoded] of Object.entries(parsed)) {
      const decrypted = decrypt(encoded)
      if (!decrypted) continue
      const sessionData = JSON.parse(decrypted)
      
      if (sessionData && sessionData.cookies) {
        for (const cookie of sessionData.cookies) {
          const domainNoDot = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
          const url = (cookie.secure ? 'https://' : 'http://') + domainNoDot + cookie.path
          const cookieDetails = {
            url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            expirationDate: cookie.expirationDate
          }
          for (const sess of sessions) {
            sess.cookies.set(cookieDetails).catch(err => {
              // Silent catch to prevent startup crashes on invalid cookie fields
            })
          }
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
