const isIframe = window.self !== window.top;
const currentUrl = window.location.href;

// Inject localStorage state immediately before any page scripts run
;(function injectLocalStorage() {
  try {
    if (typeof __streamInfo !== 'undefined' && __streamInfo && __streamInfo.localStorageState && typeof __streamInfo.localStorageState === 'object') {
      const hostname = window.location.hostname;
      if (hostname.includes('anime47')) {
        console.log('[Preload] Synchronously injecting Anime47 localStorage keys...');
        for (const [k, v] of Object.entries(__streamInfo.localStorageState)) {
          try {
            localStorage.setItem(k, v);
          } catch (e) {
            console.error('[Preload] localStorage set failed:', e);
          }
        }
        console.log('[Preload] Injection done. LocalStorage keys:', Object.keys(__streamInfo.localStorageState));
      }
    }
  } catch (err) {
    console.error('[Preload] injectLocalStorage error:', err);
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// 0-A. ADBLOCK DETECTION BYPASS — runs SYNCHRONOUSLY before any site JS
//      Must be at the very top so it executes before site scripts check globals
// ═══════════════════════════════════════════════════════════════════════════
;(function bypassAdblockDetection() {
  try {
    if (window.location.hostname.includes('animevietsub')) {
      return;
    }
    // ── 1. Fake Google Ad Manager (DFP / GPT) ──────────────────────────────
    if (!window.googletag) {
      const cmd = [];
      cmd.push = function(fn) { try { fn(); } catch(e) {} };
      window.googletag = {
        cmd,
        apiReady: true,
        pubadsReady: true,
        defineSlot: function() {
          const slot = { addService: function() { return slot; }, setTargeting: function() { return slot; } };
          return slot;
        },
        defineOutOfPageSlot: function() {
          const slot = { addService: function() { return slot; } };
          return slot;
        },
        pubads: function() {
          return {
            enableSingleRequest: function() {},
            enableLazyLoad: function() {},
            collapseEmptyDivs: function() {},
            setTargeting: function() { return this; },
            refresh: function() {},
            disableInitialLoad: function() {},
            addEventListener: function() {},
            getSlots: function() { return []; },
            updateCorrelator: function() {}
          };
        },
        companionAds: function() { return { setRefreshUnfilledSlots: function() {} }; },
        enableServices: function() {},
        display: function() {},
        destroySlots: function() { return true; },
        getVersion: function() { return '2024'; },
        openConsole: function() {}
      };
    }

    // ── 2. Fake Google AdSense ─────────────────────────────────────────────
    if (!window.adsbygoogle) {
      try {
        Object.defineProperty(window, 'adsbygoogle', {
          get: function() { return window._fakeAds || (window._fakeAds = { push: function() {}, loaded: true }); },
          configurable: true
        });
      } catch(e) {
        window.adsbygoogle = { push: function() {}, loaded: true };
      }
    }

    // ── 3. Fake other common ad globals ───────────────────────────────────
    window.__cmp    = window.__cmp    || function(cmd, arg, cb) { if (typeof cb === 'function') cb({}, true); };
    window.__tcfapi = window.__tcfapi || function(cmd, v, cb) {  if (typeof cb === 'function') cb({ gdprApplies: false }, true); };
    window.__uspapi = window.__uspapi || function(cmd, v, cb) {  if (typeof cb === 'function') cb('1---', true); };
    window.yaads    = window.yaads    || { addPlacements: function() {}, refresh: function() {} };
    window._ym_     = window._ym_     || {};
    window.fbq      = window.fbq      || function() {};
    window._fbq     = window._fbq     || window.fbq;

    // ── 4. Inject CSS: hide overlay + fake .adsbox as visible ─────────────
    const style = document.createElement('style');
    style.id = '__neko_adbypass__';
    style.textContent = [
      '[class*="adblock"],[id*="adblock"],',
      '[class*="ad-block"],[id*="ad-block"],',
      '[class*="adblocker"],[id*="adblocker"],',
      '[class*="detect-ad"],[id*="detect-ad"],',
      '[class*="ad_detect"],[id*="ad_detect"],',
      '.adblock-notice,.ad-block-notice,.adblock-overlay,',
      '#adblock-overlay,#adblock-notice,#ad-block-overlay,',
      '#adblock-modal,.adblock-modal,[class*="adblock-modal"],',
      '[class*="ads-detect"],[id*="ads-detect"],',
      '.avs-adblock,.avs-ad-block,#avs-adblock,',
      '.popup-adblock,.modal-adblock { display:none!important; opacity:0!important; visibility:hidden!important; pointer-events:none!important; }',
      // Fake .adsbox visible so height-check passes (offsetHeight must not be 0)
      '.adsbox,.ad,.ads,#ads,.adsbygoogle,.pub_300x250,',
      '.pub_300x250m,.pub_728x90,.text-ad,.textAd,',
      '.text_ad,.text_ads,.text-ads,.text-ad-links { display:block!important; height:1px!important; width:1px!important; overflow:hidden!important; position:absolute!important; left:-9999px!important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);

    // ── 5. Fake .adsbox offsetHeight via createElement interception ────────
    // Many sites do: el = create('.adsbox'); body.append(el); if (el.offsetHeight === 0) → blocked
    const _createElement = document.createElement.bind(document);
    document.createElement = function(tag) {
      const el = _createElement(tag);
      if (tag === 'ins' || tag === 'div') {
        const _setAttr = el.setAttribute.bind(el);
        el.setAttribute = function(name, val) {
          _setAttr(name, val);
          if (name === 'class' && /\badsbox\b|\bad\b|\bads\b|\badsbygoogle\b/.test(val)) {
            try {
              Object.defineProperties(el, {
                offsetHeight: { get: function() { return 1; }, configurable: true },
                offsetWidth:  { get: function() { return 1; }, configurable: true },
                clientHeight: { get: function() { return 1; }, configurable: true },
              });
            } catch(e) {}
          }
        };
      }
      return el;
    };

    // ── 6. MutationObserver: instantly remove overlay when it appears ─────
    const ADBLOCK_TEXT = [
      'Phát hiện trình chặn quảng cáo',
      'trình chặn quảng cáo',
      'Vui lòng tắt tiện ích chặn',
      'adblock detected',
      'ad blocker detected',
      'please disable your ad blocker',
      'disable adblock',
      'turn off adblock',
    ];
    const ADBLOCK_CLASSES = /adblock|ad.block|adblocker|ad.detect|detect.ad/i;

    function isAdblockOverlay(el) {
      if (!(el instanceof HTMLElement)) return false;
      if (el.querySelector && el.querySelector('video')) return false;
      const cls = (el.className || '') + ' ' + (el.id || '');
      if (ADBLOCK_CLASSES.test(cls)) return true;
      const txt = (el.innerText || el.textContent || '');
      return ADBLOCK_TEXT.some(function(t) { return txt.includes(t); });
    }

    function removeAdblockOverlays() {
      try {
        document.querySelectorAll('div,section,aside,article,dialog').forEach(function(el) {
          if (isAdblockOverlay(el)) el.remove();
        });
      } catch(e) {}
    }

    removeAdblockOverlays();

    const observer = new MutationObserver(function(mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          const node = added[j];
          if (node.nodeType !== 1) continue;
          if (isAdblockOverlay(node)) { node.remove(); continue; }
          if (node.querySelectorAll) {
            node.querySelectorAll('div,section,aside').forEach(function(child) {
              if (isAdblockOverlay(child)) child.remove();
            });
          }
        }
      }
    });

    function startObserver() {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        removeAdblockOverlays();
      }
    }

    if (document.body) {
      startObserver();
    } else {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    }

    // ── 7. Intercept fetch/XHR for ad probe URLs ──────────────────────────
    const _fetch = window.fetch;
    window.fetch = function(input, init) {
      const url = (typeof input === 'string' ? input : (input && input.url) || '').toLowerCase();
      if (
        url.includes('doubleclick') || url.includes('googlesyndication') ||
        url.includes('adservice')   || url.includes('pagead') ||
        url.includes('/ads/')       || url.includes('adsense')
      ) {
        return Promise.resolve(new Response('', { status: 200, headers: { 'content-type': 'text/javascript' } }));
      }
      return _fetch.apply(this, arguments);
    };

    const _XHR_open = XMLHttpRequest.prototype.open;
    const _XHR_send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._neko_url = (url || '').toLowerCase();
      return _XHR_open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      const url = this._neko_url || '';
      if (
        url.includes('doubleclick') || url.includes('googlesyndication') ||
        url.includes('adservice')   || url.includes('pagead')
      ) {
        try {
          Object.defineProperty(this, 'status',       { get: function() { return 200; }, configurable: true });
          Object.defineProperty(this, 'responseText', { get: function() { return ''; }, configurable: true });
          Object.defineProperty(this, 'readyState',   { get: function() { return 4; }, configurable: true });
        } catch(e) {}
        const self = this;
        setTimeout(function() {
          try { if (self.onreadystatechange) self.onreadystatechange(); if (self.onload) self.onload(); } catch(e) {}
        }, 10);
        return;
      }
      return _XHR_send.apply(this, arguments);
    };

  } catch(e) {
    // Silent fail — never break the page
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// 0-B. Neutralize anti-devtools detection
// ═══════════════════════════════════════════════════════════════════════════
(function() {
  try {
    const _setInterval = window.setInterval;
    window.setInterval = function(fn, delay) {
      try {
        if (typeof fn === 'function' && fn.toString().includes('debugger')) {
          return _setInterval(function() {}, delay);
        }
      } catch(e) {}
      return _setInterval.apply(window, arguments);
    };

    const _setTimeout = window.setTimeout;
    window.setTimeout = function(fn, delay) {
      try {
        if (typeof fn === 'function' && fn.toString().includes('debugger')) {
          return _setTimeout(function() {}, delay);
        }
      } catch(e) {}
      return _setTimeout.apply(window, arguments);
    };

    const _Function = window.Function;
    window.Function = new Proxy(_Function, {
      apply: function(target, thisArg, args) {
        const src = args.join('');
        if (src.includes('debugger') || src.includes('devtools')) return function() {};
        return Reflect.apply(target, thisArg, args);
      },
      construct: function(target, args) {
        const src = args.join('');
        if (src.includes('debugger') || src.includes('devtools')) return function() {};
        return Reflect.construct(target, args);
      }
    });
  } catch(e) {}
})();


// 1. Mock History API to prevent cross-origin SecurityError in guest frames
(function() {
  const originalReplaceState = window.history.replaceState;
  const originalPushState = window.history.pushState;
  
  const sanitizeUrl = function(url) {
    if (!url) return url;
    try {
      const parsed = new URL(url, window.location.origin);
      return window.location.origin + parsed.pathname + parsed.search + parsed.hash;
    } catch (e) {
      return '/';
    }
  };
  
  window.history.replaceState = function(state, title, url) {
    try { return originalReplaceState.call(window.history, state, title, sanitizeUrl(url)); }
    catch (e) {}
  };
  
  window.history.pushState = function(state, title, url) {
    try { return originalPushState.call(window.history, state, title, sanitizeUrl(url)); }
    catch (e) {}
  };
})();

// 2. Active ad-blocking CSS injection for all frames
window.addEventListener('DOMContentLoaded', function() {
  try {
    if (window.location.hostname.includes('animevietsub')) return;
    const style = document.createElement('style');
    style.textContent = [
      'iframe[src*="in88"],iframe[src*="bet"],iframe[src*="game"],iframe[src*="nohu"],iframe[src*="quayhu"],',
      'a[href*="in88"],a[href*="bet"],a[href*="game"],a[href*="nohu"],a[href*="quayhu"],',
      'img[src*="in88"],img[src*="bet"],img[src*="game"],',
      'div[id*="avs-pause" i],div[class*="avs-pause" i],',
      '#avs-pause-ad,.avs-pause-ad,.avs-pause-ad-box{',
      'display:none!important;visibility:hidden!important;',
      'opacity:0!important;pointer-events:none!important;width:0!important;height:0!important;}'
    ].join('');
    document.documentElement.appendChild(style);
  } catch (e) {}
});

// Passive and active ad removal loop
var cleanDOM = function() {
  try {
    if (window.location.hostname.includes('animevietsub')) return;
    var doc = document;
    if (!doc || !doc.body) return;

    doc.querySelectorAll('button,a,div,span,img').forEach(function(el) {
      var text = (el.textContent || '').trim();
      var src = el.src || el.getAttribute('src') || '';
      var href = el.getAttribute('href') || '';
      
      if (
        text === 'Đóng quảng cáo' || text === 'Đóng và xem tiếp' ||
        text === 'Quảng cáo' || text === 'Close X' ||
        text.includes('Nếu bạn không thể truy cập AnimeVietsub') ||
        src.includes('in88') ||
        href.includes('in88') || href.includes('bet') ||
        href.includes('game') || href.includes('quayhu') || href.includes('nohu') ||
        (el.tagName === 'IMG' && el.style.position === 'absolute' && parseInt(el.style.zIndex) > 100)
      ) {
        var parent = el.parentElement;
        var removed = false;
        for (var i = 0; i < 4; i++) {
          if (!parent || parent === doc.body || parent === doc.documentElement) break;
          if (parent.querySelector('video') || parent.querySelector('canvas') || parent.id === 'player') break;
          var cs = window.getComputedStyle(parent);
          if (cs.position === 'absolute' || cs.position === 'fixed') {
            parent.remove(); removed = true; break;
          }
          parent = parent.parentElement;
        }
        if (!removed) el.remove();
      }
    });

    doc.querySelectorAll('a[href]').forEach(function(a) {
      var href = a.getAttribute('href') || '';
      if (href.includes('in88') || href.includes('quayhu') ||
          href.includes('nohu') || href.includes('188bet') ||
          href.includes('kubet') || href.includes('w88')) {
        var parent = a.parentElement;
        for (var i = 0; i < 4; i++) {
          if (!parent || parent === doc.body || parent === doc.documentElement) break;
          if (parent.querySelector('video') || parent.querySelector('canvas') || parent.id === 'player') break;
          var cur = parent;
          parent = parent.parentElement;
          cur.remove();
        }
        a.remove();
      }
    });
    
    doc.querySelectorAll('meta[http-equiv="content-security-policy" i]').forEach(function(m) { m.remove(); });

  } catch (e) {}
};

setInterval(cleanDOM, 300);

// 3. Inject Eruda developer console on the Google Player page
var isPlayerPage = currentUrl.includes('googleapiscdn.com') || currentUrl.includes('googleapis.com');

if (isPlayerPage) {
  var initEruda = function() {
    try {
      if (window.eruda) return;
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/eruda';
      script.onload = function() {
        if (window.eruda) window.eruda.init({ theme: 'dark', tool: ['console', 'elements', 'network', 'resources'] });
      };
      script.onerror = function() {
        var fallback = document.createElement('script');
        fallback.src = 'https://cdnjs.cloudflare.com/ajax/libs/eruda/3.0.1/eruda.min.js';
        fallback.onload = function() { if (window.eruda) window.eruda.init({ theme: 'dark' }); };
        document.documentElement.appendChild(fallback);
      };
      document.documentElement.appendChild(script);
    } catch (err) {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEruda);
  } else {
    initEruda();
  }
}
