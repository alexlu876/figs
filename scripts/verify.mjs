// Playwright verification script. Run as:
//   ITER=N node /tmp/figs-loop/verify.mjs
// Requires: cd /Users/alex/lu/git/figs && npm i -D playwright && npx playwright install chromium
// Writes screenshots + a machine-readable summary to /tmp/figs-loop/iter-${ITER}-*.

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const iter = process.env.ITER || 'X';
const outDir = '/tmp/figs-loop';
const url = 'http://localhost:4321/';

const report = {
	iter,
	url,
	timestamp: new Date().toISOString(),
	errors: [],
	console: [],
	hotspots: 0,
	windowsOpened: [],
	bodyTextSample: '',
	pageTitle: '',
	hasDomainWordmark: false,
	hasAstroArtifact: false,
	viewport: { width: 1440, height: 900 },
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: report.viewport });
const page = await context.newPage();

page.on('console', (msg) => {
	if (msg.type() === 'error' || msg.type() === 'warning') {
		report.console.push(`[${msg.type()}] ${msg.text()}`);
	}
});
page.on('pageerror', (err) => report.errors.push(String(err)));

try {
	await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
} catch (e) {
	report.errors.push(`goto failed: ${e.message}`);
}

await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/iter-${iter}-home.png`, fullPage: false });

report.pageTitle = await page.title().catch(() => '');
const bodyText = (await page.locator('body').textContent().catch(() => '')) || '';
report.bodyTextSample = bodyText.replace(/\s+/g, ' ').trim().slice(0, 400);
report.hasDomainWordmark = /figtre\.es/i.test(bodyText);

const html = await page.content().catch(() => '');
report.hasAstroArtifact =
	/Astro\b/i.test(html) && !/data-astro|astro:|astro-island/i.test(html) === false
		? /astro\.build|generator.*astro/i.test(html)
		: /astro\.build|generator.*astro/i.test(html);

const hotspots = await page.locator('.hotspot, [data-window]').all();
report.hotspots = hotspots.length;

for (let i = 0; i < Math.min(hotspots.length, 5); i++) {
	const h = hotspots[i];
	const id = await h.getAttribute('data-window').catch(() => null);
	try {
		await h.scrollIntoViewIfNeeded({ timeout: 1000 });
		await h.click({ timeout: 1500, force: true });
		await page.waitForTimeout(200);
		const windowSelector = id ? `#window-${id}` : '[class*="window"]:not([hidden])';
		const visible = await page.locator(windowSelector).first().isVisible().catch(() => false);
		report.windowsOpened.push({ id: id || `hotspot-${i}`, opened: visible });
		if (visible && i === 0) {
			await page.screenshot({ path: `${outDir}/iter-${iter}-window.png` });
		}
	} catch (e) {
		report.windowsOpened.push({ id: id || `hotspot-${i}`, opened: false, error: e.message });
	}
}

writeFileSync(`${outDir}/iter-${iter}-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
