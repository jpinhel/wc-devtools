import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Web Components DevTools',
    description:
      'Inspect and debug Web Components on any page — shadow DOM tree, live editing, events, profiling',
    permissions: [
      'activeTab',
      // Required for chrome.scripting.executeScript (injects wc-inspector into page context)
      'scripting',
      // Required for chrome.tabs.sendMessage to arbitrary tabs and chrome.tabs.onUpdated
      'tabs',
    ],
    host_permissions: ['<all_urls>'],
    // WXT 0.20.x does not auto-generate devtools.html from defineUnlistedScript,
    // so we declare it explicitly. The file lives in public/devtools.html.
    devtools_page: 'devtools.html',
  },
});
