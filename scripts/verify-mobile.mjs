// Iter 6 mobile verifier.
// - Load home at 375x812 (iPhone 13-ish).
// - Capture /tmp/figs-loop/iter-6-home-mobile.png.
// - Tap each of the 5 hotspots, assert the corresponding window is
//   visible and fully within the viewport; capture a window screenshot
//   for one of them.
// - Assert 44px minimum tap-target on the close button on mobile.
// - Assert OG/twitter meta tags are present in page head.
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'node:fs';

const outDir = '/tmp/figs-loop';
const url = 'http://localhost:4321/';

const report = {
	iter: 6,
	timestamp: new Date().toISOString(),
	viewport: { width: 375, height: 812 },
	hotspots: {},
	meta: {},
	errors: [],
	console: [],
};

const browser = await chromium.launch({ headless: true });
// Emulate iPhone 13-ish (375x812, devicePixelRatio 3, touch enabled).
const context = await browser.newContext({
	viewport: { width: 375, height: 812 },
	deviceScaleFactor: 3,
	isMobile: true,
	hasTouch: true,
	userAgent:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();

page.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning')
		report.console.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => report.errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

// Capture the home at mobile viewport.
await page.screenshot({ path: `${outDir}/iter-6-home-mobile.png`, fullPage: false });

// === Meta tag checks ========================================================
report.meta = await page.evaluate(() => {
	const pick = (sel) => document.querySelector(sel)?.getAttribute('content') || null;
	return {
		ogTitle: pick('meta[property="og:title"]'),
		ogDescription: pick('meta[property="og:description"]'),
		ogType: pick('meta[property="og:type"]'),
		ogImage: pick('meta[property="og:image"]'),
		twitterCard: pick('meta[name="twitter:card"]'),
		twitterTitle: pick('meta[name="twitter:title"]'),
		themeColor: pick('meta[name="theme-color"]'),
	};
});

// === SVG mobile viewBox swap ================================================
report.svg = await page.evaluate(() => {
	const svg = document.querySelector('svg.landscape');
	return {
		viewBox: svg?.getAttribute('viewBox'),
		preserveAspectRatio: svg?.getAttribute('preserveAspectRatio'),
	};
});

// === Hotspot tap test =======================================================
const ids = ['about', 'notes', 'projects', 'contact', 'now'];
for (const id of ids) {
	// close any currently-open window by pressing Escape via the close button
	await page.evaluate(() => {
		document.querySelectorAll('aside.window').forEach((w) => (w.hidden = true));
	});

	// Tap the hotspot.
	const selector = `[data-window="${id}"]`;
	const hotspot = await page.$(selector);
	if (!hotspot) {
		report.hotspots[id] = { error: 'not found' };
		continue;
	}
	// Use tap for mobile touch semantics
	await hotspot.tap();
	await page.waitForTimeout(120);

	const result = await page.evaluate((wid) => {
		const win = document.getElementById(`window-${wid}`);
		if (!win) return { present: false };
		const visible = !win.hidden;
		const r = win.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const inViewport =
			r.left >= 0 &&
			r.top >= 0 &&
			r.right <= vw + 0.5 &&
			r.bottom <= vh + 0.5;
		return {
			visible,
			rect: { left: r.left, top: r.top, width: r.width, height: r.height },
			viewport: { vw, vh },
			inViewport,
		};
	}, id);
	report.hotspots[id] = result;

	if (id === 'about' && result.visible) {
		await page.screenshot({ path: `${outDir}/iter-6-window-mobile.png`, fullPage: false });
	}

	// Verify close-button tap target size.
	if (id === 'about') {
		report.closeButton = await page.evaluate(() => {
			const btn = document.querySelector('#window-about .close');
			if (!btn) return null;
			const r = btn.getBoundingClientRect();
			return { width: r.width, height: r.height };
		});
	}

	// Close it via the close button (tap).
	const close = await page.$(`#window-${id} [data-close]`);
	if (close) await close.tap();
	await page.waitForTimeout(80);
}

// === Focus-outline check (tabbing into a hotspot) ==========================
// Playwright can't really "tab" through an SVG element easily on mobile,
// but we can assert the focus-visible CSS rule is present in the stylesheet.
report.focusOutline = await page.evaluate(() => {
	// Force focus on about hotspot and check computed outline.
	const el = document.querySelector('.hotspot[data-window="about"]');
	if (!el) return { ok: false, reason: 'no about hotspot' };
	el.focus();
	const cs = getComputedStyle(el);
	return {
		outlineStyle: cs.outlineStyle,
		outlineColor: cs.outlineColor,
		outlineWidth: cs.outlineWidth,
		outlineOffset: cs.outlineOffset,
	};
});

await browser.close();

writeFileSync(`${outDir}/iter-6-custom-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
