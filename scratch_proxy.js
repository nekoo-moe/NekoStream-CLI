const http = require('http');
const https = require('https');
const urlModule = require('url');

const server = http.createServer((req, res) => {
  const reqUrl = urlModule.parse(req.url, true);
  
  // If requesting the proxy root
  if (reqUrl.pathname === '/') {
    const target = reqUrl.query.url;
    if (!target) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <body style="font-family: system-ui, sans-serif; background: #0f0f13; color: #fff; padding: 50px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 80vh; margin: 0;">
          <div style="background: #181822; padding: 40px; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.5); max-width: 600px; width: 90%; border: 1px solid #2d2d3d;">
            <h2 style="color: #ff0055; margin-bottom: 10px;">NekoStream Stream Proxy Dev Server</h2>
            <p style="color: #aaa; margin-bottom: 30px; font-size: 14px;">Bypass CSP bảo mật của Google Player CDN để dễ dàng soi các thẻ quảng cáo bằng Chrome DevTools.</p>
            <form method="GET" action="/" style="display: flex; flex-direction: column; gap: 15px; width: 100%;">
              <input type="text" name="url" placeholder="Nhập link https://stream.googleapiscdn.com/..." style="width: 100%; padding: 14px; border-radius: 8px; border: 1px solid #444; background: #0b0b0f; color: #fff; box-sizing: border-box; font-size: 14px;">
              <button type="submit" style="padding: 14px; border-radius: 8px; background: #ff0055; color: #fff; border: none; cursor: pointer; font-weight: bold; font-size: 15px; transition: background 0.2s;">Bắt đầu Debug</button>
            </form>
          </div>
        </body>
      `);
      return;
    }
    
    console.log(`[Proxy] Fetching target player: ${target}`);
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://animevietsub.site/'
      }
    };
    
    https.get(target.trim(), options, (targetRes) => {
      let body = '';
      targetRes.on('data', (chunk) => { body += chunk; });
      targetRes.on('end', () => {
        // 1. Inject a base tag so relative links resolve to googleapiscdn
        const baseTag = `<base href="${new URL(target.trim()).origin}/">`;
        
        // 2. Inject a history API mock script to prevent cross-origin replaceState errors
        const historyMockScript = `
          <script>
            (function() {
              const originalReplaceState = history.replaceState;
              const originalPushState = history.pushState;
              
              const sanitizeUrl = function(url) {
                if (!url) return url;
                try {
                  // Resolve the URL against the document origin ( localhost:3000 )
                  const parsed = new URL(url, window.location.origin);
                  // Return absolute same-origin URL to prevent the browser from resolving against the <base> tag
                  return window.location.origin + parsed.pathname + parsed.search + parsed.hash;
                } catch (e) {
                  return '/';
                }
              };
              
              history.replaceState = function(state, title, url) {
                try {
                  return originalReplaceState.call(history, state, title, sanitizeUrl(url));
                } catch (e) {
                  console.warn('[Proxy Patch] Blocked replaceState error safely:', e.message);
                }
              };
              
              history.pushState = function(state, title, url) {
                try {
                  return originalPushState.call(history, state, title, sanitizeUrl(url));
                } catch (e) {
                  console.warn('[Proxy Patch] Blocked pushState error safely:', e.message);
                }
              };
              console.log('[Proxy Patch] History API successfully mocked to prevent base-tag origin conflicts.');
            })();
          </script>
        `;

        let modifiedBody = body;
        // Strip any client-side meta Content-Security-Policy tags to ensure our scripts execute
        modifiedBody = modifiedBody.replace(/<meta\s+http-equiv=["']content-security-policy["'][^>]*>/gi, '');

        if (modifiedBody.includes('<head>')) {
          modifiedBody = modifiedBody.replace('<head>', `<head>${baseTag}${historyMockScript}`);
        } else {
          modifiedBody = baseTag + historyMockScript + modifiedBody;
        }

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8'
        });
        res.end(modifiedBody);
        console.log('[Proxy] Served target HTML with base tag, history mock, and without meta CSP!');
      });
    }).on('error', (err) => {
      res.writeHead(500);
      res.end(`Error: ${err.message}`);
    });
  } else {
    // If requesting static assets (JS/CSS/images/etc.)
    // We proxy it to googleapiscdn
    const targetOrigin = 'https://stream.googleapiscdn.com';
    const targetUrlString = targetOrigin + req.url;
    
    const options = {
      method: req.method,
      headers: {
        ...req.headers,
        'Host': 'stream.googleapiscdn.com',
        'Referer': 'https://animevietsub.site/'
      }
    };
    
    // Remove host headers from local client
    delete options.headers['host'];
    delete options.headers['connection'];
    
    const connector = https.request(targetUrlString, options, (targetRes) => {
      const responseHeaders = { ...targetRes.headers };
      // Strip CSP and X-Frame-Options
      delete responseHeaders['content-security-policy'];
      delete responseHeaders['content-security-policy-report-only'];
      delete responseHeaders['x-frame-options'];
      
      res.writeHead(targetRes.statusCode, responseHeaders);
      targetRes.pipe(res);
    });
    
    req.pipe(connector);
  }
});

server.listen(3000, () => {
  console.log('==================================================');
  console.log('Proxy Server is running at http://localhost:3000');
  console.log('1. Open http://localhost:3000 in Google Chrome.');
  console.log('2. Paste your target stream URL:');
  console.log('   https://stream.googleapiscdn.com/playlist/...');
  console.log('3. Open DevTools (F12) to inspect and find the ad elements!');
  console.log('==================================================');
});
