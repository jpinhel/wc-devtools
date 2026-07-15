/**
 * Records the README demo GIF against the playground harness.
 *
 * Prereqs: `bun run build`, the playground server running (`bun run playground`),
 * and ffmpeg on the PATH.
 *
 *   bun playground/record-demo.ts   →  .github/assets/demo.gif
 *
 * Scenario (~14 s): select a card → live-edit its `variant` property →
 * invoke toggleElevation() from the Methods tab → enable trace updates and
 * watch the clock flash on every re-render.
 */
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { chromium } from 'playwright';

const VIDEO_DIR = '.output/demo-video';
const GIF = '.github/assets/demo.gif';

mkdirSync(VIDEO_DIR, { recursive: true });
mkdirSync('.github/assets', { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 860 },
  recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 860 } },
});
const page = await context.newPage();

await page.goto('http://localhost:5180/');
const panel = page.frameLocator('#panel');

// Wait for the tree to populate, then let the viewer take the scene in
await panel.locator('.tree-node').first().waitFor({ timeout: 15_000 });
await page.waitForTimeout(1200);

// 1 — select the first <demo-card>
await panel.locator('.tree-node', { hasText: 'demo-card' }).first().click();
await page.waitForTimeout(1200);

// 2 — live-edit the `variant` property: primary → danger
const variantRow = panel.locator('.prop-row', { hasText: 'variant' }).first();
await variantRow.locator('.pv-edit-btn').click();
const editInput = panel.locator('.prop-edit-input');
await editInput.fill('');
await editInput.pressSequentially('danger', { delay: 90 });
await page.waitForTimeout(400);
await editInput.press('Enter');
await page.waitForTimeout(1400); // the card turns red in the page

// 3 — invoke toggleElevation() from the Methods tab
await panel.locator('.tab', { hasText: 'Methods' }).click();
await page.waitForTimeout(700);
const methodRow = panel.locator('.method-row', { hasText: 'toggleElevation' });
await methodRow.hover();
await page.waitForTimeout(400);
await methodRow.locator('.method-run-btn').click();
await page.waitForTimeout(1400); // the card gets its shadow, result shows inline

// 4 — trace updates: the clock flashes on every re-render
await panel.locator('.trace-btn').click();
await page.waitForTimeout(3800);

await context.close();
await browser.close();

// ── webm → gif (ffmpeg two-pass palette) ──────────────────────────────────────

const webm = readdirSync(VIDEO_DIR).find((f) => f.endsWith('.webm'));
if (!webm) throw new Error('no video recorded');
renameSync(`${VIDEO_DIR}/${webm}`, `${VIDEO_DIR}/demo.webm`);

const filters = 'fps=12,scale=1100:-1:flags=lanczos';
const convert = Bun.spawnSync([
  'ffmpeg',
  '-y',
  '-i',
  `${VIDEO_DIR}/demo.webm`,
  '-filter_complex',
  `[0:v]${filters},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
  GIF,
]);
if (convert.exitCode !== 0) {
  console.error(convert.stderr.toString().slice(-600));
  throw new Error('ffmpeg failed');
}

const size = Bun.file(GIF).size;
console.log(`✓ ${GIF} — ${(size / 1024 / 1024).toFixed(2)} MB`);
