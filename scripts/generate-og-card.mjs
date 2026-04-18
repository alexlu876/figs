// Generate a 1200×630 PNG social card from the home scene.
// Uses Playwright to render the live dev server at the OG aspect ratio,
// then crops a clean rectangle over the tree + hills + sky that reads well
// in a Twitter/Slack/Discord unfurl.
//
// Run with the dev server up at http://localhost:4321:
//   node scripts/generate-og-card.mjs
// Writes to public/og-card.png so Astro will serve it at /og-card.png.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'og-card.png');
mkdirSync(dirname(outPath), { recursive: true });

const browser = await chromium.launch({ headless: true });
// Render at exact OG dimensions. 2x DPR for crispness on retina previews —
// the actual PNG is still written at the physical viewport size (1200×630).
const ctx = await browser.newContext({
	viewport: { width: 1200, height: 630 },
	deviceScaleFactor: 1,
});
const page = await ctx.newPage();

await page.goto('http://localhost:4321/', { waitUntil: 'networkidle', timeout: 20000 });

// Hide any open windows / hotspot focus rings so the card is a clean painting.
await page.addStyleTag({
	content: `
		.window { display: none !important; }
		.hotspot { outline: none !important; }
		/* Tighten the SVG to the OG aspect (1200:630 ≈ 1.905) by widening the
		   viewBox horizontally — this pulls in a bit more sky on the right
		   so the tree sits left-of-center (menu-bar aesthetic preserved). */
		.landscape {
			width: 100vw !important;
			height: 100vh !important;
		}
	`,
});

// Keep the native desktop viewBox ("0 0 1440 900") and
// preserveAspectRatio="xMinYMid slice" — at a 1200×630 viewport this
// slices a narrow top+bottom band, leaving the tree + hills + figs +
// person + sky all intact and the tree anchored to the left, matching
// the menu-bar aesthetic in the brief.

// Give turbulence filters + any deferred paint a beat to settle.
await page.waitForTimeout(400);

await page.screenshot({
	path: outPath,
	type: 'png',
	fullPage: false,
	clip: { x: 0, y: 0, width: 1200, height: 630 },
});

await browser.close();
console.log(`Wrote ${outPath}`);
