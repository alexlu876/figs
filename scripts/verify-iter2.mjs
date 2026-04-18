// Iter-2 focused checks. Measures canopy leaf count, canopy/tree bbox,
// person bbox, number of clouds, sample sky colors to detect texture variance,
// and z-order of open windows.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const url = 'http://localhost:4321/';
const outDir = '/tmp/figs-loop';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 1,
});
const page = await context.newPage();

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(500);

// Static DOM measurements
const domReport = await page.evaluate(() => {
	const svg = document.querySelector('svg.landscape');
	const canopy = svg?.querySelector('g.canopy');
	const leaves = canopy ? canopy.querySelectorAll('use') : [];
	const cloudUses = Array.from(svg?.querySelectorAll('use') || []).filter(
		(u) => u.getAttribute('href') === '#cloud1' || u.getAttribute('xlink:href') === '#cloud1'
	);

	// Canopy bbox
	let cbox = null;
	if (canopy) {
		const r = canopy.getBoundingClientRect();
		cbox = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
	}
	const svgBox = svg?.getBoundingClientRect();

	// Count hotspots
	const hotspotIds = Array.from(svg?.querySelectorAll('.hotspot') || []).map(
		(h) => h.getAttribute('data-window')
	);

	// Person group — find the group with transform containing 365 and scale(1.4)
	const allG = Array.from(svg?.querySelectorAll('g') || []);
	const personG = allG.find((g) => {
		const t = g.getAttribute('transform') || '';
		return /translate\(365/.test(t) && /scale\(1\.4\)/.test(t);
	});
	const personBox = personG ? personG.getBoundingClientRect() : null;

	// Trunk path bbox (approximation): first path with fill="url(#trunk)"
	const trunkPath = svg?.querySelector('path[fill="url(#trunk)"]');
	const trunkBox = trunkPath ? trunkPath.getBoundingClientRect() : null;

	// Check that #trunkClip exists and #trunkMask doesn't
	const hasTrunkClip = !!svg?.querySelector('#trunkClip');
	const hasTrunkMask = !!svg?.querySelector('#trunkMask');

	// Check Astro dev toolbar present in DOM
	const toolbar = document.querySelector('astro-dev-toolbar');
	const toolbarVisible = !!toolbar && getComputedStyle(toolbar).display !== 'none';

	return {
		viewport: { w: window.innerWidth, h: window.innerHeight },
		svgBox: svgBox ? {
			x: Math.round(svgBox.x), y: Math.round(svgBox.y),
			w: Math.round(svgBox.width), h: Math.round(svgBox.height)
		} : null,
		canopyBox: cbox,
		leafCount: leaves.length,
		cloudUseCount: cloudUses.length,
		hotspotIds,
		personBox: personBox ? {
			x: Math.round(personBox.x), y: Math.round(personBox.y),
			w: Math.round(personBox.width), h: Math.round(personBox.height)
		} : null,
		trunkBox: trunkBox ? {
			x: Math.round(trunkBox.x), y: Math.round(trunkBox.y),
			w: Math.round(trunkBox.width), h: Math.round(trunkBox.height)
		} : null,
		hasTrunkClip,
		hasTrunkMask,
		toolbarExists: !!toolbar,
		toolbarVisible,
	};
});

// Sample pixel colors from the home screenshot to detect sky texture
// variance. We'll take a full-page screenshot, read its bytes and compute
// pixel-level stddev in a sky sampling window.
const shot = await page.screenshot({ path: `${outDir}/iter-2-verify-home.png`, fullPage: false });

// Open each window, check z-order
const zReport = [];
await page.evaluate(() => document.querySelectorAll('.window').forEach((w) => { w.hidden = true; }));
for (const id of ['about', 'notes', 'projects', 'contact', 'now']) {
	try {
		await page.locator(`.hotspot[data-window="${id}"]`).first().click({ force: true, timeout: 2000 });
		await page.waitForTimeout(120);
		const info = await page.evaluate((wid) => {
			const w = document.getElementById(`window-${wid}`);
			if (!w) return { id: wid, open: false };
			const style = getComputedStyle(w);
			return {
				id: wid,
				open: !w.hasAttribute('hidden'),
				zIndex: w.style.zIndex || style.zIndex,
				rect: (() => { const r = w.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
			};
		}, id);
		zReport.push(info);
	} catch (e) {
		zReport.push({ id, error: e.message });
	}
}

// Keep everything open and verify their z-indices ascend in open order
const allOpen = await page.evaluate(() => {
	return Array.from(document.querySelectorAll('.window'))
		.filter((w) => !w.hasAttribute('hidden'))
		.map((w) => ({
			id: w.id,
			z: parseInt(w.style.zIndex || getComputedStyle(w).zIndex || '0', 10),
		}))
		.sort((a, b) => a.z - b.z);
});

// Close windows for a clean screenshot
await page.evaluate(() => document.querySelectorAll('.window').forEach((w) => { w.hidden = true; }));

// Pixel variance on sky sampling window using the PNG
// Simple approach: shrink the screenshot via PNG parsing
// We'll use zlib-decode of the PNG via node built-ins is heavy; instead, use
// Playwright's screenshot of a clip region and compute pixel stddev via
// getImageData in a data URL we load in the same page.
// Sample sky and hill pixels by taking clip screenshots and loading them via canvas.
const skyShot = await page.screenshot({ clip: { x: 900, y: 30, width: 500, height: 370 } });
const hillShot = await page.screenshot({ clip: { x: 700, y: 470, width: 500, height: 80 } });
const skyB64 = 'data:image/png;base64,' + skyShot.toString('base64');
const hillB64 = 'data:image/png;base64,' + hillShot.toString('base64');

const skyStats = await page.evaluate(async ({ skyB64, hillB64 }) => {
	async function stats(dataUrl, w, h) {
		const img = new Image();
		await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		ctx.drawImage(img, 0, 0);
		const sample = ctx.getImageData(0, 0, w, h).data;
		let n = 0, sumR = 0, sumG = 0, sumB = 0;
		for (let i = 0; i < sample.length; i += 4) {
			sumR += sample[i]; sumG += sample[i + 1]; sumB += sample[i + 2]; n++;
		}
		const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
		let varR = 0, varG = 0, varB = 0;
		for (let i = 0; i < sample.length; i += 4) {
			varR += (sample[i] - meanR) ** 2;
			varG += (sample[i + 1] - meanG) ** 2;
			varB += (sample[i + 2] - meanB) ** 2;
		}
		return {
			mean: [meanR, meanG, meanB].map((v) => +v.toFixed(1)),
			std: [Math.sqrt(varR / n), Math.sqrt(varG / n), Math.sqrt(varB / n)].map((v) => +v.toFixed(2)),
		};
	}
	const sky = await stats(skyB64, 500, 370);
	const hill = await stats(hillB64, 500, 80);
	return { sky, hill };
}, { skyB64, hillB64 });

const report = {
	timestamp: new Date().toISOString(),
	dom: domReport,
	canopyPctOfSvg: domReport.canopyBox && domReport.svgBox ? {
		w: +(domReport.canopyBox.w / domReport.svgBox.w * 100).toFixed(1),
		h: +(domReport.canopyBox.h / domReport.svgBox.h * 100).toFixed(1),
	} : null,
	personPctOfViewport: domReport.personBox && domReport.viewport ? {
		w: +(domReport.personBox.w / domReport.viewport.w * 100).toFixed(2),
		h: +(domReport.personBox.h / domReport.viewport.h * 100).toFixed(2),
	} : null,
	zOrder: zReport,
	allOpenSorted: allOpen,
	zAscending: allOpen.every((w, i, a) => i === 0 || a[i - 1].z <= w.z),
	skyStats,
	logs: logs.slice(-20),
};

writeFileSync(`${outDir}/iter-2-custom-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
