import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

/**
 * DevTools page script — loaded by devtools.html (declared as devtools_page in the manifest).
 * Creates the "Web Components" panel in the browser's DevTools.
 *
 * This runs in the DevTools page context, NOT in the inspected tab.
 */
export default defineUnlistedScript(() => {
  chrome.devtools.panels.create('Web Components', '/icon/16.png', '/panel.html', () => {
    console.log('[WC DevTools] Panel created');
  });
});
