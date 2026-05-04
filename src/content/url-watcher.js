/**
 * URL change detection for LinkedIn SPA navigation.
 * Fixes bug #6: replaces MutationObserver on full document subtree
 * with Navigation API (Chrome 102+) and polling fallback.
 */

let lastUrl = '';
let pollInterval = null;
let callbacks = [];
let navHandler = null; // Stored reference for cleanup

/**
 * Start watching for URL changes.
 * @param {Function} onUrlChange - Called with the new URL when navigation occurs
 */
export function startWatching(onUrlChange) {
  // Prevent duplicate callbacks
  if (callbacks.includes(onUrlChange)) {
    return () => unsubscribe(onUrlChange);
  }

  callbacks.push(onUrlChange);

  // Only set up watchers once
  if (callbacks.length > 1) {
    return () => unsubscribe(onUrlChange);
  }

  lastUrl = window.location.href;

  // Strategy 1: Navigation API (Chrome 102+, preferred)
  if (typeof navigation !== 'undefined') {
    navHandler = (event) => {
      const newUrl = event.destination.url;
      if (newUrl && newUrl !== lastUrl) {
        lastUrl = newUrl;
        notifyCallbacks(newUrl);
      }
    };
    navigation.addEventListener('navigate', navHandler);
    return () => unsubscribe(onUrlChange);
  }

  // Strategy 2: Polling fallback (1s interval — balances responsiveness vs CPU)
  pollInterval = setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      notifyCallbacks(currentUrl);
    }
  }, 1000);

  return () => unsubscribe(onUrlChange);
}

/**
 * Stop watching for URL changes.
 */
export function stopWatching() {
  callbacks = [];
  teardownWatchers();
}

function unsubscribe(callback) {
  callbacks = callbacks.filter(cb => cb !== callback);
  if (callbacks.length === 0) {
    teardownWatchers();
  }
}

function teardownWatchers() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (navHandler && typeof navigation !== 'undefined') {
    navigation.removeEventListener('navigate', navHandler);
    navHandler = null;
  }
}

function notifyCallbacks(url) {
  for (const cb of [...callbacks]) {
    try {
      cb(url);
    } catch (err) {
      console.error('URL watcher callback error:', err);
    }
  }
}
