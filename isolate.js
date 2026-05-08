(() => {
  const rootSelectors = ['.watch-player', '.player-section', '.video-container', '.art-video-player', '#player', '.player-wrapper'];
  const anchorSelectors = [
    '.watch-player .jwplayer', '.player-section .jwplayer', '.video-container .jwplayer',
    '.player-wrapper.jw-active', '.player-wrapper .jwplayer', '.jwplayer', '.jw-video',
    '.video-js', '.vjs-tech', '.player-section video', '.video-container video',
    '.watch-player video', 'iframe[src*="anime47"]', 'iframe[src*="nonprofit"]',
    'iframe[src*="vlogphim"]', 'iframe[src*="anime3s"]', 'video', '.art-video-player'
  ];
  const containerSelectors = [
    '.watch-player', '.player-section', '.video-container', '.player-wrapper.jw-active',
    '.player-wrapper', '.jw-player-wrapper', '.jwplayer', 'main.q-page.watch-page',
    'main.q-page', 'main', '.art-video-player', '#player', '.player'
  ];

  const firstMatch = (selectors) => {
    for (const selector of selectors) {
      const found = document.querySelector(selector);
      if (found instanceof HTMLElement) return found;
    }
    return null;
  };

  const firstMatchWithin = (root, selectors) => {
    if (!(root instanceof HTMLElement)) return null;
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found instanceof HTMLElement) return found;
    }
    return null;
  };

  const stretch = (el) => {
    if (!(el instanceof HTMLElement)) return;
    el.style.setProperty('width', '100%', 'important');
    el.style.setProperty('height', '100%', 'important');
    el.style.setProperty('max-width', '100%', 'important');
    el.style.setProperty('max-height', '100%', 'important');
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('padding', '0', 'important');
    el.style.setProperty('padding-bottom', '0', 'important');
    el.style.setProperty('padding-top', '0', 'important');
    el.style.setProperty('top', '0', 'important');
    el.style.setProperty('left', '0', 'important');
    el.style.setProperty('transform', 'none', 'important');
    el.style.setProperty('background', '#000', 'important');
  };

  const hideSiblingBranches = (node, anchorNode) => {
    if (!(node instanceof HTMLElement)) return;
    let current = node;
    
    // Hide siblings upwards from root to body
    while (current?.parentElement) {
      const parent = current.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === current) continue;
        sibling.style.setProperty('display', 'none', 'important');
      }
      if (parent === document.body) break;
      current = parent;
    }

    // Hide siblings downwards from anchor to root
    if (anchorNode && anchorNode instanceof HTMLElement && node.contains(anchorNode)) {
      let currChild = anchorNode;
      while (currChild && currChild !== node && currChild.parentElement) {
        const parent = currChild.parentElement;
        if (!parent.classList.contains('jwplayer') && !parent.classList.contains('jw-wrapper')) {
          for (const sibling of Array.from(parent.children)) {
            if (!(sibling instanceof HTMLElement) || sibling === currChild) continue;
            sibling.style.setProperty('display', 'none', 'important');
            sibling.style.setProperty('visibility', 'hidden', 'important');
            sibling.style.setProperty('opacity', '0', 'important');
            sibling.style.setProperty('pointer-events', 'none', 'important');
            sibling.style.setProperty('width', '0', 'important');
            sibling.style.setProperty('height', '0', 'important');
          }
        }
        currChild = parent;
      }
    }
  };

  const isolateOnce = () => {
    const root = firstMatch(rootSelectors);
    const anchor = (root && firstMatchWithin(root, anchorSelectors)) || firstMatch(anchorSelectors);
    if (!(anchor instanceof HTMLElement)) return false;

    let toKeep = root;
    if (!(toKeep instanceof HTMLElement)) {
      for (const selector of containerSelectors) {
        const candidate = anchor.closest(selector);
        if (candidate instanceof HTMLElement && candidate !== document.body) {
          toKeep = candidate;
          break;
        }
      }
    }
    if (!(toKeep instanceof HTMLElement)) toKeep = anchor;

    toKeep.style.setProperty('position', 'fixed', 'important');
    toKeep.style.setProperty('inset', '0', 'important');
    toKeep.style.setProperty('width', '100vw', 'important');
    toKeep.style.setProperty('height', '100vh', 'important');
    toKeep.style.setProperty('max-width', '100vw', 'important');
    toKeep.style.setProperty('max-height', '100vh', 'important');
    toKeep.style.setProperty('overflow', 'hidden', 'important');
    toKeep.style.setProperty('background', '#000', 'important');
    toKeep.style.setProperty('z-index', '2147483000', 'important');

    stretch(anchor);
    stretch(toKeep);
    toKeep.querySelectorAll('video, iframe, .jwplayer, .jw-player-wrapper, .jw-holder, .jw-media, .jw-video, .video-js, .vjs-tech')
          .forEach((el) => stretch(el));

    document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    document.body.style.setProperty('overflow', 'hidden', 'important');
    document.body.style.setProperty('background', '#000', 'important');

    hideSiblingBranches(toKeep, anchor);
    return true;
  };

  const hideOverlayAds = () => {
    const collapse = (node) => {
      if (!(node instanceof HTMLElement)) return;
      node.style.setProperty('display', 'none', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');
      node.style.setProperty('opacity', '0', 'important');
      node.style.setProperty('width', '0', 'important');
      node.style.setProperty('height', '0', 'important');
      node.style.setProperty('pointer-events', 'none', 'important');
    };

    document.querySelectorAll('#avs-pause-ad, .avs-pause-ad, .avs-pause-ad-box, [id*="avs-pause" i], [class*="avs-pause" i]')
            .forEach(collapse);
    
    document.querySelectorAll('[id*="adblock" i], [class*="adblock" i], [id*="anti-ad" i], [class*="anti-ad" i]')
            .forEach(collapse);

    document.querySelectorAll('.jwplayer, .jw-wrapper, .jw-media').forEach(el => {
      el.style.setProperty('background', '#000', 'important');
    });
  };

  let matchedCount = 0;
  let attempts = 0;
  const maxAttempts = 120;

  const observer = new MutationObserver(() => {
    if (isolateOnce()) matchedCount += 1;
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const timer = window.setInterval(() => {
    attempts += 1;
    if (isolateOnce()) matchedCount += 1;
    if (attempts >= maxAttempts || matchedCount >= 3) {
      window.clearInterval(timer);
      observer.disconnect();
    }
  }, 500);

  let adHideTimer = null;
  const startAdCleanupLoop = () => {
    if (adHideTimer) return;
    hideOverlayAds();
    isolateOnce();
    adHideTimer = window.setInterval(() => {
      hideOverlayAds();
      isolateOnce();
    }, 1000);
  };

  window.setTimeout(startAdCleanupLoop, 2000);
  isolateOnce();
})();
