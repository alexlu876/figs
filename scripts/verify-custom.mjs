// Custom verifier: measure tree footprint, check hotspots, capture window-open state.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const url = 'http://localhost:4321/';
const outDir = '/tmp/figs-loop';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(400);

// Measure SVG element and tree-related groups' bounding boxes.
const data = await page.evaluate(() => {
	const svg = document.querySelector('svg.landscape');
	const svgBox = svg?.getBoundingClientRect();
	const hotspots = Array.from(document.querySelectorAll('.hotspot')).map((el) => {
		const r = el.getBoundingClientRect();
		return {
			id: el.getAttribute('data-window'),
			x: Math.round(r.x),
			y: Math.round(r.y),
			w: Math.round(r.width),
			h: Math.round(r.height),
		};
	});
	// The tree doesn't have a dedicated wrapper group — estimate from the union
	// of all foliage ellipses and trunk paths in the source. We'll grab every path/ellipse
	// that has a fill referencing foliage, trunk, or the explicit large ellipses near the top.
	// As a simpler heuristic, compute the bounding box of all SVG children with certain fills.
	const candidates = Array.from(svg?.querySelectorAll('ellipse, path') || []).filter((el) => {
		const f = el.getAttribute('fill') || '';
		return /foliage|trunk/i.test(f) || el.getAttribute('stroke')?.includes?.('trunk');
	});
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const el of candidates) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) continue;
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.width);
		maxY = Math.max(maxY, r.y + r.height);
	}
	const treeBox = isFinite(minX) ? {
		x: Math.round(minX), y: Math.round(minY),
		w: Math.round(maxX - minX), h: Math.round(maxY - minY),
	} : null;

	// Domain wordmark / Astro branding
	const html = document.documentElement.outerHTML;
	const hasDomainWordmark = /figtre\.es/i.test(document.body.innerText);
	const hasAstroGenerator = /<meta[^>]+name=["']generator["'][^>]+astro/i.test(html);
	const hasAstroFavicon = /favicon\.svg/i.test(html) && /astro/i.test(html);

	// Retrieve the person group
	const personGroup = svg?.querySelector('g[transform*="340"]'); // brittle but works in current code
	const personBox = personGroup ? personGroup.getBoundingClientRect() : null;

	return {
		svg: svgBox ? { x: Math.round(svgBox.x), y: Math.round(svgBox.y), w: Math.round(svgBox.width), h: Math.round(svgBox.height) } : null,
		hotspots,
		treeBox,
		personBox: personBox ? { x: Math.round(personBox.x), y: Math.round(personBox.y), w: Math.round(personBox.width), h: Math.round(personBox.height) } : null,
		hasDomainWordmark,
		hasAstroGenerator,
		hasAstroFavicon,
		viewport: { w: window.innerWidth, h: window.innerHeight },
	};
});

// Click each hotspot individually and capture.
const hotspotScreens = [];
for (const hs of ['about', 'notes', 'projects', 'contact', 'now']) {
	try {
		// Close any open window first
		await page.evaluate(() => {
			document.querySelectorAll('.window').forEach((w) => { w.hidden = true; });
		});
		const el = await page.locator(`.hotspot[data-window="${hs}"]`).first();
		await el.click({ timeout: 2000, force: true });
		await page.waitForTimeout(150);
		const win = page.locator(`#window-${hs}`);
		const visible = await win.isVisible();
		if (visible) {
			await page.screenshot({ path: `${outDir}/iter-1-window-${hs}.png`, fullPage: false });
		}
		hotspotScreens.push({ id: hs, visible });
	} catch (e) {
		hotspotScreens.push({ id: hs, visible: false, error: e.message });
	}
}

// Take a large hi-res screenshot for final comparison
await page.evaluate(() => document.querySelectorAll('.window').forEach((w) => { w.hidden = true; }));
await page.screenshot({ path: `${outDir}/iter-1-home-highres.png`, fullPage: false });

const report = {
	timestamp: new Date().toISOString(),
	...data,
	hotspotScreens,
	treePctWidth: data.treeBox && data.svg ? +(data.treeBox.w / data.svg.w * 100).toFixed(1) : null,
	treePctHeight: data.treeBox && data.svg ? +(data.treeBox.h / data.svg.h * 100).toFixed(1) : null,
	treeRightEdgePct: data.treeBox && data.svg ? +((data.treeBox.x + data.treeBox.w) / data.svg.w * 100).toFixed(1) : null,
	logs: logs.slice(-20),
};

writeFileSync(`${outDir}/iter-1-custom-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
