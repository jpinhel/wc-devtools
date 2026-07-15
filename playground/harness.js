/**
 * Harness — hosts the REAL built panel next to a demo page and plays the role
 * of background service worker + content script between them:
 *
 *   panel iframe (built panel.html + chrome shim)
 *        │ postMessage {__wcdt: 'from-panel'}
 *        ▼
 *   this file: command whitelist → demo-page iframe (wc-devtools-command)
 *        ▲
 *        │ 'wc-devtools-injected' messages ← wc-inspector.js in the page
 *
 * Same message protocol as the extension, no chrome APIs involved.
 */

const MESSAGE_VERSION = 2;

/** Same whitelist as entrypoints/content.ts. */
const PANEL_COMMANDS = new Set([
  'highlight-node',
  'set-prop',
  'enter-pick-mode',
  'exit-pick-mode',
  'scroll-into-view',
  'toggle-state',
  'set-attr',
  'remove-attr',
  'set-css-var',
  'trace-updates',
  'invoke-method',
  'dispatch-event',
]);

const pageFrame = document.getElementById('page');
const panelFrame = document.getElementById('panel');

// ── Panel bootstrap: fetch the built panel.html, prepend the chrome shim ─────

async function bootPanel() {
  const html = await (await fetch('/panel.html')).text();
  panelFrame.srcdoc = html.replace('<head>', '<head><script src="/panel-shim.js"></script>');
}

// ── Page → panel: relay inspector messages ────────────────────────────────────

function toPanel(message) {
  panelFrame.contentWindow?.postMessage({ __wcdt: 'to-panel', message }, '*');
}

// The demo page defines its components after CDN module imports resolve, and
// the panel connects on its own schedule — a snapshot requested before BOTH
// are ready would be empty forever (later sends are patches against ids the
// panel never saw). Refresh only once both sides are up.
let pageLoaded = false;
let panelConnected = false;

/**
 * Commands go through the page's own bridge script (which re-posts them from
 * inside the page) because the inspector rejects messages whose source is not
 * its own window — the same trust rule it applies against the real content
 * script's neighbours.
 */
function sendCommand(command) {
  pageFrame.contentWindow?.postMessage({ __wcdt: 'cmd', command }, '*');
}

function refreshWhenReady() {
  if (!pageLoaded || !panelConnected) return;
  sendCommand({ source: 'wc-devtools-command', type: 'refresh' });
}

pageFrame.addEventListener('load', () => {
  const pageWin = pageFrame.contentWindow;
  // `inspect()` exists in real devtools eval contexts — give the demo a stub.
  pageWin.inspect = (el) => console.log('[harness] inspect()', el);
  pageWin.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'wc-devtools-injected') return;
    if (data.version !== MESSAGE_VERSION) return;
    const { source: _source, ...payload } = data;
    toPanel(payload); // frameId absent → panel treats it as top frame
  });
  pageLoaded = true;
  refreshWhenReady();
});

// ── Panel → page: commands + eval ─────────────────────────────────────────────

window.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || typeof data !== 'object') return;

  if (data.__wcdt === 'from-panel') {
    const msg = data.message;
    if (!msg || msg.version !== MESSAGE_VERSION) return;
    const pageWin = pageFrame.contentWindow;
    if (!pageWin) return;
    if (msg.type === 'devtools-init') {
      // devtools-init is what triggers (re)injection in the real extension —
      // here the inspector is preloaded, so a fresh snapshot is the equivalent.
      panelConnected = true;
      refreshWhenReady();
    } else if (msg.type === 'refresh-request') {
      sendCommand({ source: 'wc-devtools-command', type: 'refresh' });
    } else if (PANEL_COMMANDS.has(msg.type)) {
      const { version: _version, ...command } = msg;
      sendCommand({ source: 'wc-devtools-command', ...command });
    }
    // devtools-init / keepalive have no meaning here — dropped.
  } else if (data.__wcdt === 'eval') {
    let result;
    let error;
    try {
      // Same-origin iframe: evaluate in the demo page's realm, like
      // chrome.devtools.inspectedWindow.eval does in the inspected page.
      result = pageFrame.contentWindow?.eval(data.code);
    } catch (err) {
      error = { isException: true, value: String(err) };
    }
    panelFrame.contentWindow?.postMessage(
      { __wcdt: 'eval-result', id: data.id, result: undefined, error },
      '*',
    );
    void result; // results are not serialized back — the panel never reads them
  }
});

bootPanel();
