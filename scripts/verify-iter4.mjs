// Iter 4 custom verifier: capture /notes and /notes/hello screenshots,
// sample the palette on /notes (hex), confirm retro-window frame presence,
// measure contrast of body text, and check bounding box of the retro window.
// Also capture home + first window for side-by-side with iter-3.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const outDir = '/tmp/figs-loop';
const home = 'http://localhost:4321/';
const notesIndex = 'http://localhost:4321/notes';
const notesEntry = 'http://localhost:4321/notes/hello';

function rgbToLinear(c) {
	c /= 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relativeLum({ r, g, b }) {
	return 0.2126 * rgbToLinear(r) + 0.7152 * rgbToLinear(g) + 0.0722 * rgbToLinear(b);
}
function contrast(a, b) {
	const L1 = relativeLum(a);
	const L2 = relativeLum(b);
	const [lo, hi] = L1 < L2 ? [L1, L2] : [L2, L1];
	return (hi + 0.05) / (lo + 0.05);
}
function parseCssRgb(s) {
	const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
	if (!m) return null;
	return { r: +m[1], g: +m[2], b: +m[3] };
}
function toHex({ r, g, b }) {
	return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));

// === /notes index ===
await page.goto(notesIndex, { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(350);
await page.screenshot({ path: `${outDir}/iter-4-notes-index.png`, fullPage: false });

const notesIndexInfo = await page.evaluate(() => {
	const body = document.body;
	const bodyBg = getComputedStyle(body).backgroundColor;
	const bodyColor = getComputedStyle(body).color;
	const bodyFont = getComputedStyle(body).fontFamily;
	const page = document.querySelector('.page');
	const pageBg = page ? getComputedStyle(page).backgroundColor : null;
	const window = document.querySelector('article.window');
	const rect = window ? window.getBoundingClientRect() : null;
	const winBg = window ? getComputedStyle(window).backgroundColor : null;
	const winBorder = window ? getComputedStyle(window).border : null;
	const winShadow = window ? getComputedStyle(window).boxShadow : null;
	const titleEl = document.querySelector('.titlebar');
	const rules = document.querySelectorAll('.rule').length;
	const titleItalicEl = document.querySelector('.title em');
	const titleFontStyle = titleItalicEl ? getComputedStyle(titleItalicEl).fontStyle : null;
	const hasLeafSvg = !!document.querySelector('.title svg.leaf');
	const lede = document.querySelector('.lede');
	const ledeColor = lede ? getComputedStyle(lede).color : null;
	const ledeBg = lede ? getComputedStyle(lede).backgroundColor : null;
	const backBtn = document.querySelector('.back');
	const backRect = backBtn ? backBtn.getBoundingClientRect() : null;
	const backText = backBtn ? backBtn.textContent.trim() : null;
	const hasDomainWordmark = /figtre\.es/i.test(document.body.innerText);
	return {
		bodyBg, bodyColor, bodyFont,
		pageBg,
		window: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
		winBg, winBorder, winShadow,
		titleBarPresent: !!titleEl,
		rulesCount: rules,
		titleFontStyle,
		hasLeafSvg,
		ledeColor, ledeBg,
		backBtn: backRect ? { x: Math.round(backRect.x), y: Math.round(backRect.y), w: Math.round(backRect.width), h: Math.round(backRect.height), text: backText } : null,
		hasDomainWordmark,
	};
});

// Palette sampling: sample a canvas from the current page via SVG rasterization won't work here (no SVG).
// Instead we sample via the backing DOM + computed colors + take page screenshot, then read pixel colors from top-left/center.
const notesPagePixels = await page.evaluate(async () => {
	// Use html2canvas-style approach via drawing elements to a canvas is not feasible.
	// Instead probe computed styles at specific coords via elementFromPoint.
	function probe(x, y) {
		const el = document.elementFromPoint(x, y);
		if (!el) return null;
		return {
			tag: el.tagName.toLowerCase(),
			cls: el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className,
			bg: getComputedStyle(el).backgroundColor,
			color: getComputedStyle(el).color,
		};
	}
	return {
		topLeftBg: probe(20, 20),
		centerTop: probe(720, 60),
		windowCenter: probe(720, 400),
		windowText: probe(720, 420),
	};
});

// === /notes/hello entry ===
await page.goto(notesEntry, { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(350);
await page.screenshot({ path: `${outDir}/iter-4-notes-entry.png`, fullPage: false });

const notesEntryInfo = await page.evaluate(() => {
	const body = document.body;
	const win = document.querySelector('article.window');
	const rect = win ? win.getBoundingClientRect() : null;
	const winBg = win ? getComputedStyle(win).backgroundColor : null;
	const titleEm = document.querySelector('.title em');
	const titleText = titleEm ? titleEm.textContent : null;
	const proseP = document.querySelector('.prose p');
	const proseBg = proseP ? getComputedStyle(proseP).backgroundColor : null;
	const proseColor = proseP ? getComputedStyle(proseP).color : null;
	const link = document.querySelector('.prose a');
	const linkColor = link ? getComputedStyle(link).color : null;
	const hasH1 = !!document.querySelector('.prose h1');
	const hasLeafSvg = !!document.querySelector('.title svg.leaf');
	const footerButtons = document.querySelectorAll('.foot .back').length;
	return {
		window: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
		winBg,
		titleText,
		proseBg, proseColor,
		linkColor,
		hasH1,
		hasLeafSvg,
		footerButtons,
		bodyBg: getComputedStyle(body).backgroundColor,
	};
});

// === Home page compare (palette + canopy stats) ===
await page.goto(home, { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/iter-4-home-verify.png`, fullPage: false });

const homeInfo = await page.evaluate(() => {
	const canopy = document.querySelector('.canopy');
	const totalLeafCount = document.querySelectorAll('.canopy use').length;
	const edgeLeafCount = document.querySelectorAll('.edge-accent use').length;
	const branchPaths = document.querySelectorAll('.branch-skeleton path').length;
	const bottomEdgeUse = document.querySelectorAll('.edge-accent use').length;
	const hotspots = document.querySelectorAll('.hotspot, [data-window]').length;
	const hasDomainWordmark = /figtre\.es/i.test(document.body.innerText);
	// look for farmhouses: we expect a specific class or structure
	const farmhouses = document.querySelectorAll('.farmhouse, [data-farmhouse]').length;
	return { totalLeafCount, edgeLeafCount, branchPaths, bottomEdgeUse, hotspots, hasDomainWordmark, farmhouses };
});

// Pixel sample of farmhouse region on the home page
const homePixelScan = await page.evaluate(async () => {
	const canvas = document.createElement('canvas');
	canvas.width = 1440;
	canvas.height = 900;
	const ctx = canvas.getContext('2d');
	const svg = document.querySelector('svg.landscape');
	if (!svg) return null;
	const xml = new XMLSerializer().serializeToString(svg);
	const img = new Image();
	img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
	await new Promise((r) => { img.onload = r; });
	ctx.drawImage(img, 0, 0, 1440, 900);
	// Scan far hill band y=430..520, x=600..1440 for rooftop / house-like pixels
	function scan(y0, y1, x0, x1, pred) {
		const hits = [];
		const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
		for (let j = 0; j < y1 - y0; j++) {
			for (let i = 0; i < x1 - x0; i++) {
				const idx = (j * (x1 - x0) + i) * 4;
				const r = d[idx], g = d[idx + 1], b = d[idx + 2];
				if (pred(r, g, b)) hits.push({ x: x0 + i, y: y0 + j, r, g, b });
			}
		}
		return hits;
	}
	function cluster(pts, th = 12) {
		const groups = [];
		for (const p of pts) {
			let found = false;
			for (const g of groups) {
				if (Math.abs(g.x - p.x) < th && Math.abs(g.y - p.y) < th) {
					g.n++;
					g.x = (g.x * (g.n - 1) + p.x) / g.n;
					g.y = (g.y * (g.n - 1) + p.y) / g.n;
					found = true;
					break;
				}
			}
			if (!found) groups.push({ x: p.x, y: p.y, n: 1, r: p.r, g: p.g, b: p.b });
		}
		return groups.map((g) => ({ x: Math.round(g.x), y: Math.round(g.y), n: g.n, color: `rgb(${g.r},${g.g},${g.b})` }));
	}
	// Brown roof hits (dark brown)
	const brown = scan(430, 520, 600, 1440, (r, g, b) => r > 80 && r < 150 && g > 55 && g < 105 && b > 40 && b < 90 && r > g && g > b);
	// Reddish pink hits
	const reddish = scan(430, 520, 600, 1440, (r, g, b) => r > 120 && r > g + 18 && r > b + 18 && g < 180);

	// Also sample the canopy bottom edge region to see if bottom-edge-accent is doing palmate work
	// Canopy is roughly x: 0..780, y: 60..500. Sample its bottom arc (y=380..500) for leaf edges.
	const canopyBottom = scan(370, 500, 0, 780, (r, g, b) => g > r && g > b && g > 90 && g < 210 && Math.abs(r - b) < 40);
	return {
		farmhouseBrown: cluster(brown, 18).slice(0, 8),
		reddishSpecks: cluster(reddish, 18).slice(0, 8),
		canopyBottomLeafPixels: canopyBottom.length,
	};
});

await browser.close();

const report = {
	iter: 4,
	timestamp: new Date().toISOString(),
	notesIndex: {
		...notesIndexInfo,
		pixelProbes: notesPagePixels,
	},
	notesEntry: notesEntryInfo,
	home: homeInfo,
	homePixelScan,
	contrast: (() => {
		const fg = parseCssRgb(notesIndexInfo.bodyColor);
		const bg = parseCssRgb(notesIndexInfo.winBg || notesIndexInfo.bodyBg);
		if (!fg || !bg) return null;
		return {
			bodyText_vs_windowBg_ratio: Number(contrast(fg, bg).toFixed(2)),
			fgHex: toHex(fg),
			bgHex: toHex(bg),
		};
	})(),
	logs: logs.slice(-30),
};

writeFileSync(`${outDir}/iter-4-custom-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
