/**
 * chrome.* shim injected into the panel iframe BEFORE the panel bundle runs.
 *
 * The real panel talks to a background service worker through a
 * chrome.runtime.Port and evaluates code in the inspected page through
 * chrome.devtools.inspectedWindow.eval. Here both are bridged to the parent
 * harness window, which plays background + content script.
 */
(() => {
  const messageListeners = new Set();

  const port = {
    name: 'devtools',
    postMessage(message) {
      parent.postMessage({ __wcdt: 'from-panel', message }, '*');
    },
    onMessage: { addListener: (fn) => messageListeners.add(fn) },
    onDisconnect: { addListener: () => {} },
  };

  let evalSeq = 0;
  const evalCallbacks = new Map();

  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.__wcdt === 'to-panel') {
      for (const fn of messageListeners) fn(data.message);
    } else if (data.__wcdt === 'eval-result') {
      const cb = evalCallbacks.get(data.id);
      evalCallbacks.delete(data.id);
      cb?.(data.result, data.error);
    }
  });

  window.chrome = {
    runtime: {
      connect: () => port,
    },
    devtools: {
      inspectedWindow: {
        tabId: 1,
        eval(code, optionsOrCb, maybeCb) {
          const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
          const id = ++evalSeq;
          if (cb) evalCallbacks.set(id, cb);
          parent.postMessage({ __wcdt: 'eval', id, code }, '*');
        },
      },
      panels: {},
    },
  };
})();
