// Iter 3 custom verifier: capture window-open states at 3 viewport positions,
// audit /notes page for visual consistency, sample "red/pink dots" in the
// distant field to check if they are intentional or stray noise, and
// re-measure canopy silhouette lobiness + branch visibility.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const url = 'http://localhost:4321/';
const notesUrl = 'http://localhost:4321/notes';
const outDir = '/tmp/figs-loop';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(600);

// Baseline home capture (higher-res cropped)
await page.screenshot({ path: `${outDir}/iter-3-home-verify.png`, fullPage: false });

// === Pixel sampling: scan the distant field band (y=440..520) for pixels
// that look notably red/pink against sage (R >> G and R >> B). These are
// the suspicious dots the verifier flagged. Also estimate cluster count. ===
const colorAudit = await page.evaluate(async () => {
	const canvas = document.createElement('canvas');
	canvas.width = 1440;
	canvas.height = 900;
	const ctx = canvas.getContext('2d');
	// Render the SVG to a data URL then into the canvas
	const svg = document.querySelector('svg.landscape');
	const xml = new XMLSerializer().serializeToString(svg);
	const img = new Image();
	img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
	await new Promise((r) => { img.onload = r; });
	ctx.drawImage(img, 0, 0, 1440, 900);
	// Sample band 1: far hills y=440..500
	// Sample band 2: mid field y=500..600
	function scan(y0, y1, x0, x1) {
		const hits = [];
		const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
		for (let j = 0; j < y1 - y0; j++) {
			for (let i = 0; i < x1 - x0; i++) {
				const idx = (j * (x1 - x0) + i) * 4;
				const r = d[idx], g = d[idx + 1], b = d[idx + 2];
				// "Reddish" = r notably higher than g and b, and not gray
				if (r > 120 && r > g + 18 && r > b + 18 && g < 180) {
					hits.push({ x: x0 + i, y: y0 + j, r, g, b });
				}
			}
		}
		return hits;
	}
	const farBand = scan(430, 520, 600, 1440);
	const midBand = scan(500, 640, 600, 1440);
	// Cluster hits to rough groups (manhattan ~16px)
	function cluster(pts) {
		const groups = [];
		for (const p of pts) {
			let found = false;
			for (const g of groups) {
				if (Math.abs(g.x - p.x) < 16 && Math.abs(g.y - p.y) < 16) {
					g.n++;
					g.x = (g.x * (g.n - 1) + p.x) / g.n;
					g.y = (g.y * (g.n - 1) + p.y) / g.n;
					found = true;
					break;
				}
			}
			if (!found) groups.push({ x: p.x, y: p.y, n: 1, r: p.r, g: p.g, b: p.b });
		}
		return groups;
	}
	return {
		farBandHitCount: farBand.length,
		midBandHitCount: midBand.length,
		farClusters: cluster(farBand).slice(0, 20),
		midClusters: cluster(midBand).slice(0, 20),
	};
});

// === Canopy silhouette lobiness: sample the canopy outline's bumpiness ===
const canopyStats = await page.evaluate(() => {
	const canopy = document.querySelector('.canopy');
	if (!canopy) return null;
	const box = canopy.getBoundingClientRect();
	// Count leaves and edge leaves
	const edgeLeafCount = document.querySelectorAll('.edge-accent use').length;
	const totalLeafCount = document.querySelectorAll('.canopy use').length;
	const branchPaths = document.querySelectorAll('.branch-skeleton path').length;
	return {
		canopyBox: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
		edgeLeafCount,
		totalLeafCount,
		branchPaths,
	};
});

// === Window open at 3 viewport positions ===
// The windows use fixed absolute coordinates; simulate viewport by scrolling.
// Since the scene is 100vh fixed we'll take screenshots at three scroll states:
// top, middle-right (after clicking hotspots), and a small-viewport variant.
const windowCaptures = [];

async function closeAll() {
	await page.evaluate(() => document.querySelectorAll('.window').forEach((w) => { w.hidden = true; }));
}

// Position 1: top-left hotspot (contact)
await closeAll();
await page.locator('.hotspot[data-window="contact"]').first().click({ force: true });
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/iter-3-window-contact.png`, fullPage: false });
windowCaptures.push({ id: 'contact', pos: 'top-left' });

// Position 2: all windows open, center
await closeAll();
for (const hs of ['about', 'projects', 'now']) {
	await page.locator(`.hotspot[data-window="${hs}"]`).first().click({ force: true });
	await page.waitForTimeout(120);
}
await page.screenshot({ path: `${outDir}/iter-3-window-stack.png`, fullPage: false });
windowCaptures.push({ id: 'stack', pos: 'middle' });

// Position 3: notes window at 1024x768 viewport
await closeAll();
await page.setViewportSize({ width: 1024, height: 768 });
await page.waitForTimeout(200);
await page.locator('.hotspot[data-window="notes"]').first().click({ force: true });
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/iter-3-window-notes-sm.png`, fullPage: false });
windowCaptures.push({ id: 'notes', pos: '1024x768' });

// === /notes page visual consistency check ===
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(notesUrl, { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/iter-3-notes-page.png`, fullPage: false });
const notesInfo = await page.evaluate(() => {
	const body = document.body;
	const bg = getComputedStyle(body).backgroundColor;
	const fontFamily = getComputedStyle(body).fontFamily;
	const color = getComputedStyle(body).color;
	// Does /notes reference any of the retro window vocabulary? Hills? Tree? Fig leaves? SVG?
	const hasSvg = !!document.querySelector('svg.landscape');
	const hasRetroWindow = !!document.querySelector('.window');
	const hasFigImagery = /fig|sage|hill/i.test(document.body.innerText);
	return { bg, fontFamily, color, hasSvg, hasRetroWindow, hasFigImagery };
});

const report = {
	iter: 3,
	timestamp: new Date().toISOString(),
	colorAudit,
	canopyStats,
	windowCaptures,
	notesPage: notesInfo,
	logs: logs.slice(-20),
};

writeFileSync(`${outDir}/iter-3-custom-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
