/**
 * Static server for the playground harness.
 *
 * Serves the BUILT extension output at the root (the built panel.html
 * references /chunks/... and /assets/... absolutely) and the playground
 * files on top. Run `bun run build` first.
 *
 *   bun run playground   →  http://localhost:5180
 */
const ROOTS = ['.output/chrome-mv3', 'playground'];
const PORT = 5180;

Bun.serve({
  port: PORT,
  async fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === '/') path = '/index.html';
    for (const root of ROOTS) {
      const file = Bun.file(`${root}${path}`);
      if (await file.exists()) return new Response(file);
    }
    return new Response('Not found', { status: 404 });
  },
});

console.log(`playground → http://localhost:${PORT}`);
