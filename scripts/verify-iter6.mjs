// Iter 6 independent verifier (verifier agent).
// Separate from scripts/verify-custom.mjs (iter 5 heritage) and verify.mjs.
// Covers:
//   - Mobile home @ 375x812 → /tmp/figs-loop/iter-6-mobile-independent.png
//   - For each of 5 hotspots: tap; assert window fully inside viewport
//   - Screenshot one window (about) → iter-6-mobile-window-independent.png
//   - Close button >= 32px tap target
//   - /notes at mobile → iter-6-notes-mobile-independent.png
//   - Head meta: og:* + twitter:* presence + values
//   - Desktop @ 1440x900: tab to first hotspot, capture focus state
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const outDir = '/tmp/figs-loop';
const baseUrl = 'http://localhost:4321';

const report = {
	iter: 6,
	timestamp: new Date().toISOString(),
	mobile: { viewport: { width: 375, height: 812 }, hotspots: {} },
	desktop: { viewport: { width: 1440, height: 900 } },
	meta: {},
	errors: [],
	console: [],
};

const browser = await chromium.launch({ headless: true });

// ===========================================================================
// MOBILE
// ===========================================================================
const mobileCtx = await browser.newContext({
	viewport: { width: 375, height: 812 },
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
});
const mPage = await mobileCtx.newPage();
mPage.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning')
		report.console.push(`[mobile ${m.type()}] ${m.text()}`);
});
mPage.on('pageerror', (e) => report.errors.push(`[mobile] ${String(e)}`));

await mPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle', timeout: 15000 });
await mPage.screenshot({ path: `${outDir}/iter-6-mobile-independent.png`, fullPage: false });

// Meta check
report.meta = await mPage.evaluate(() => {
	const all = Array.from(document.querySelectorAll('meta')).map((m) => ({
		name: m.getAttribute('name'),
		property: m.getAttribute('property'),
		content: m.getAttribute('content'),
	}));
	const pick = (p, isName) => {
		const hit = all.find((m) => (isName ? m.name === p : m.property === p));
		return hit ? hit.content : null;
	};
	return {
		ogType: pick('og:type'),
		ogSiteName: pick('og:site_name'),
		ogTitle: pick('og:title'),
		ogDescription: pick('og:description'),
		ogUrl: pick('og:url'),
		ogImage: pick('og:image'),
		twitterCard: pick('twitter:card', true),
		twitterTitle: pick('twitter:title', true),
		twitterDescription: pick('twitter:description', true),
		twitterImage: pick('twitter:image', true),
		themeColor: pick('theme-color', true),
		description: pick('description', true),
		canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
		favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href') || null,
	};
});

report.mobile.svg = await mPage.evaluate(() => {
	const svg = document.querySelector('svg.landscape');
	return {
		viewBox: svg?.getAttribute('viewBox'),
		preserveAspectRatio: svg?.getAttribute('preserveAspectRatio'),
	};
});

const ids = ['about', 'notes', 'projects', 'contact', 'now'];
for (const id of ids) {
	await mPage.evaluate(() => {
		document.querySelectorAll('aside.window').forEach((w) => (w.hidden = true));
	});
	await mPage.waitForTimeout(50);

	const hotspot = await mPage.$(`[data-window="${id}"]`);
	if (!hotspot) {
		report.mobile.hotspots[id] = { error: 'hotspot not found' };
		continue;
	}

	const hotRect = await hotspot.evaluate((el) => {
		const r = el.getBoundingClientRect();
		return { w: r.width, h: r.height };
	});

	await hotspot.tap();
	await mPage.waitForTimeout(150);

	const res = await mPage.evaluate((wid) => {
		const win = document.getElementById(`window-${wid}`);
		if (!win) return { present: false };
		const visible = !win.hidden;
		const r = win.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		return {
			present: true,
			visible,
			rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height },
			viewport: { vw, vh },
			inViewport:
				r.left >= -0.5 &&
				r.top >= -0.5 &&
				r.right <= vw + 0.5 &&
				r.bottom <= vh + 0.5,
		};
	}, id);

	report.mobile.hotspots[id] = { hotRect, ...res };

	if (id === 'about') {
		await mPage.screenshot({ path: `${outDir}/iter-6-mobile-window-independent.png`, fullPage: false });
		const close = await mPage.$(`#window-${id} .close`);
		report.mobile.closeButton = close
			? await close.evaluate((b) => {
					const r = b.getBoundingClientRect();
					return { width: r.width, height: r.height, passes: r.width >= 32 && r.height >= 32 };
			  })
			: null;
	}

	const close = await mPage.$(`#window-${id} [data-close]`);
	if (close) await close.tap();
	await mPage.waitForTimeout(80);
}

// /notes at mobile
await mPage.goto(`${baseUrl}/notes`, { waitUntil: 'networkidle', timeout: 15000 });
await mPage.screenshot({ path: `${outDir}/iter-6-notes-mobile-independent.png`, fullPage: false });

report.mobile.notes = await mPage.evaluate(() => {
	const ov = document.scrollingElement || document.documentElement;
	return {
		scrollWidth: ov.scrollWidth,
		clientWidth: ov.clientWidth,
		horizontalScroll: ov.scrollWidth > ov.clientWidth + 1,
	};
});

await mobileCtx.close();

// ===========================================================================
// DESKTOP
// ===========================================================================
const dCtx = await browser.newContext({
	viewport: { width: 1440, height: 900 },
});
const dPage = await dCtx.newPage();
dPage.on('pageerror', (e) => report.errors.push(`[desktop] ${String(e)}`));
dPage.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning')
		report.console.push(`[desktop ${m.type()}] ${m.text()}`);
});

await dPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle', timeout: 15000 });
await dPage.screenshot({ path: `${outDir}/iter-6-desktop-independent.png`, fullPage: false });

report.desktop.svg = await dPage.evaluate(() => {
	const svg = document.querySelector('svg.landscape');
	return {
		viewBox: svg?.getAttribute('viewBox'),
		preserveAspectRatio: svg?.getAttribute('preserveAspectRatio'),
	};
});

// Tab until we land on a hotspot.
let focusInfo = null;
for (let i = 0; i < 14; i++) {
	await dPage.keyboard.press('Tab');
	await dPage.waitForTimeout(60);
	focusInfo = await dPage.evaluate(() => {
		const a = document.activeElement;
		if (!a) return null;
		const isHotspot = !!a.classList?.contains?.('hotspot');
		const cs = getComputedStyle(a);
		const r = a.getBoundingClientRect?.() ?? null;
		return {
			tag: a.tagName,
			id: a.id,
			dataWindow: a.getAttribute?.('data-window') ?? null,
			isHotspot,
			outlineStyle: cs.outlineStyle,
			outlineColor: cs.outlineColor,
			outlineWidth: cs.outlineWidth,
			outlineOffset: cs.outlineOffset,
			rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
		};
	});
	if (focusInfo?.isHotspot) break;
}
report.desktop.focus = focusInfo;

if (focusInfo?.isHotspot && focusInfo.rect) {
	const r = focusInfo.rect;
	const pad = 50;
	const clip = {
		x: Math.max(0, Math.floor(r.x - pad)),
		y: Math.max(0, Math.floor(r.y - pad)),
		width: Math.min(1440 - Math.max(0, Math.floor(r.x - pad)), Math.ceil(r.w + pad * 2)),
		height: Math.min(900 - Math.max(0, Math.floor(r.y - pad)), Math.ceil(r.h + pad * 2)),
	};
	await dPage.screenshot({ path: `${outDir}/iter-6-focus-state.png`, clip });
}

report.desktop.focusableHotspots = await dPage.evaluate(() => {
	return Array.from(document.querySelectorAll('.hotspot')).map((el) => ({
		dataWindow: el.getAttribute('data-window'),
		tabindex: el.getAttribute('tabindex'),
		role: el.getAttribute('role'),
		ariaLabel: el.getAttribute('aria-label'),
	}));
});

await dCtx.close();
await browser.close();

writeFileSync(`${outDir}/iter-6-verifier-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
