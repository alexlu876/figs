// Iter 5 custom verifier: affordance + site-level coherence.
// - t=0 vs t=2500ms home capture to verify one-time "pssst" bob
// - hover hotspot, check computed cursor:pointer
// - tab through, verify each hotspot can receive focus (tabindex=0) and
//   fires openWindow on Enter/Space
// - capture about-fig pulse across 3 frames over 1s to confirm scale changes
// - emulate prefers-reduced-motion; confirm pulse stops
// - favicon + 404 sanity
// - /notes polish: hover state + excerpt rendering
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const outDir = '/tmp/figs-loop';
const url = 'http://localhost:4321/';
const notesUrl = 'http://localhost:4321/notes';
const notesEntry = 'http://localhost:4321/notes/hello';
const faviconUrl = 'http://localhost:4321/favicon.svg';
const notFoundUrl = 'http://localhost:4321/this-does-not-exist';

const report = {
	iter: 5,
	timestamp: new Date().toISOString(),
	affordance: {},
	reducedMotion: {},
	favicon: {},
	notFound: {},
	notes: {},
	regression: {},
	errors: [],
	console: [],
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning') report.console.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => report.errors.push(String(e)));

// === AFFORDANCE =============================================================
await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });

// t=0 capture (immediately after load, before 1.8s pssst timer)
await page.screenshot({ path: `${outDir}/iter-5-pssst-t0.png`, fullPage: false });

// t=2500ms capture — pssst bob fires around t=1800ms and staggers 120ms/hotspot,
// so by 2500 the last hotspot should be mid/late bob or just finishing.
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/iter-5-pssst-t2500.png`, fullPage: false });

// Wait for all bob animations to settle so later frames are clean.
await page.waitForTimeout(800);

// Hover one hotspot (about fig); check computed cursor + transform change.
const aboutHotspot = page.locator('.hotspot[data-window="about"]').first();
await aboutHotspot.hover({ force: true });
await page.waitForTimeout(200);
const cursorStyle = await aboutHotspot.evaluate((el) => getComputedStyle(el).cursor);
report.affordance.hoverCursor = cursorStyle;
await page.mouse.move(10, 10); // un-hover

// Tab through; confirm each of 5 hotspots is focusable and wired to Enter/Space.
// Reset focus to body first.
await page.evaluate(() => { document.activeElement?.blur?.(); document.body.focus(); });

const focusResults = [];
const hotspotIds = ['notes', 'contact', 'about', 'projects', 'now']; // DOM order
for (const id of hotspotIds) {
	// Focus via JS (Playwright tab order through SVG tabindex=0 is
	// unpredictable across browsers; we validate tabindex + keydown wiring
	// directly instead of relying on Tab keypresses).
	const h = page.locator(`.hotspot[data-window="${id}"]`).first();
	const tabindex = await h.getAttribute('tabindex');
	const role = await h.getAttribute('role');
	const ariaLabel = await h.getAttribute('aria-label');
	// Focus it
	await h.evaluate((el) => el.focus());
	const isFocused = await h.evaluate((el) => document.activeElement === el);
	// Fire Enter and confirm the matching window opens.
	await page.evaluate((wid) => {
		const win = document.getElementById(`window-${wid}`);
		if (win) win.hidden = true;
	}, id);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(120);
	const openedOnEnter = await page.evaluate(
		(wid) => !document.getElementById(`window-${wid}`)?.hidden,
		id
	);
	// Close it, then try Space.
	await page.evaluate((wid) => {
		const win = document.getElementById(`window-${wid}`);
		if (win) win.hidden = true;
	}, id);
	await h.evaluate((el) => el.focus());
	await page.keyboard.press('Space');
	await page.waitForTimeout(120);
	const openedOnSpace = await page.evaluate(
		(wid) => !document.getElementById(`window-${wid}`)?.hidden,
		id
	);
	// Hide again for next iter
	await page.evaluate((wid) => {
		const win = document.getElementById(`window-${wid}`);
		if (win) win.hidden = true;
	}, id);
	focusResults.push({ id, tabindex, role, ariaLabel, isFocused, openedOnEnter, openedOnSpace });
}
report.affordance.focusResults = focusResults;

// === ABOUT-FIG PULSE over 1s (3 frames) =====================================
// We sample the computed transform scale of the .pulse-target at 3 points.
// If the breathe animation is active, the matrix scale value should differ
// across frames. We also screenshot-crop the fig hotspot area.
await page.evaluate(() => { document.activeElement?.blur?.(); });
await page.waitForTimeout(400);

const pulseSamples = [];
const cropBox = { x: 190, y: 110, width: 220, height: 190 }; // around about hotspot mapped to viewport
// Map SVG coordinate (300,200) to DOM — svg is viewBox 0 0 1440 900, viewport 1440x900 so 1:1.
for (let i = 0; i < 3; i++) {
	const frameLabel = `t${i * 500}`;
	await page.screenshot({
		path: `${outDir}/iter-5-pulse-${frameLabel}.png`,
		clip: cropBox,
	});
	const sample = await page.evaluate(() => {
		const target = document.querySelector('.hotspot-pulse .pulse-target');
		if (!target) return null;
		const cs = getComputedStyle(target);
		return { transform: cs.transform, animationName: cs.animationName, animationPlayState: cs.animationPlayState };
	});
	pulseSamples.push({ frame: frameLabel, ...sample });
	if (i < 2) await page.waitForTimeout(500);
}
report.affordance.pulseSamples = pulseSamples;
// Unique transforms across frames = animation is running
const uniqueTransforms = new Set(pulseSamples.map((s) => s && s.transform)).size;
report.affordance.pulseTransformsUnique = uniqueTransforms;

// === REDUCED MOTION ========================================================
const ctxRM = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	reducedMotion: 'reduce',
});
const pageRM = await ctxRM.newPage();
await pageRM.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
await pageRM.waitForTimeout(600);

// Sample pulse CSS — expect animation-name: none under reduced motion.
const rmSamples = [];
for (let i = 0; i < 3; i++) {
	await pageRM.screenshot({
		path: `${outDir}/iter-5-rm-pulse-${i}.png`,
		clip: cropBox,
	});
	const s = await pageRM.evaluate(() => {
		const t = document.querySelector('.hotspot-pulse .pulse-target');
		if (!t) return null;
		const cs = getComputedStyle(t);
		return { animationName: cs.animationName, transform: cs.transform };
	});
	rmSamples.push({ frame: i, ...s });
	if (i < 2) await pageRM.waitForTimeout(500);
}
report.reducedMotion.samples = rmSamples;
report.reducedMotion.animationDisabled = rmSamples.every((s) => s && s.animationName === 'none');
report.reducedMotion.transformsIdentical = new Set(rmSamples.map((s) => s && s.transform)).size === 1;

await ctxRM.close();

// === FAVICON ===============================================================
const favResp = await page.goto(faviconUrl, { waitUntil: 'domcontentloaded' });
report.favicon.status = favResp?.status();
report.favicon.contentType = favResp?.headers()['content-type'];
const favBody = await page.content().catch(() => '');
report.favicon.looksLikeSvg = /<svg[\s>]/i.test(favBody);
report.favicon.bodyBytes = favBody.length;
report.favicon.hasFigLeafPath = /path/i.test(favBody);

// === 404 ===================================================================
const nfResp = await page.goto(notFoundUrl, { waitUntil: 'networkidle' });
report.notFound.status = nfResp?.status();
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/iter-5-404.png`, fullPage: false });
const nfInfo = await page.evaluate(() => {
	const body = document.body;
	const hasWindow = !!document.querySelector('.window, [class*="window"]');
	const hasAstroDefault = /cannot get|not found/i.test(body.innerText) && !/fig|branch|tree/i.test(body.innerText);
	const hasFigLeafSvg = !!document.querySelector('svg');
	const bg = getComputedStyle(body).backgroundColor;
	const textSample = body.innerText.replace(/\s+/g, ' ').slice(0, 300);
	const hasHomeLink = Array.from(document.querySelectorAll('a')).some((a) => /tree|home|\//i.test(a.textContent || ''));
	return { hasWindow, hasAstroDefault, hasFigLeafSvg, bg, textSample, hasHomeLink };
});
report.notFound = { ...report.notFound, ...nfInfo };

// === /notes polish ==========================================================
await page.goto(notesUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/iter-5-notes-index.png`, fullPage: false });
const rows = page.locator('.row, li a, article a').first();
const rowCount = await page.locator('.row').count();
// Check computed bg pre-hover, then hover and re-check.
const firstRow = page.locator('.row').first();
let notesData = {};
if (rowCount > 0) {
	const preHoverBg = await firstRow.evaluate((el) => getComputedStyle(el).backgroundColor);
	await firstRow.hover();
	await page.waitForTimeout(200);
	const hoverBg = await firstRow.evaluate((el) => getComputedStyle(el).backgroundColor);
	const excerptPresent = await page.locator('.excerpt').count();
	const excerptText = excerptPresent ? await page.locator('.excerpt').first().textContent() : null;
	notesData = { rowCount, preHoverBg, hoverBg, hoverChanged: preHoverBg !== hoverBg, excerptPresent, excerptText };
} else {
	notesData = { rowCount, note: 'no .row elements found' };
}
report.notes.index = notesData;

// Notes entry page
await page.goto(notesEntry, { waitUntil: 'networkidle' });
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/iter-5-notes-entry.png`, fullPage: false });
const entryInfo = await page.evaluate(() => {
	const prose = document.querySelector('.prose, .body, article');
	return {
		hasProse: !!prose,
		title: document.title,
		h1Count: document.querySelectorAll('h1').length,
		hasTitleBar: !!document.querySelector('.titlebar, [class*="title"]'),
	};
});
report.notes.entry = entryInfo;

// === REGRESSION: compare iter-5 home to iter-4 home in a key region =========
// Pixel-diff a region centered on the about hotspot (no pulse running at t=3000
// matches t=0 steady-state; but iter-4 baseline has no pulse at all, so compare
// a non-hotspot region of the canopy instead — person + trunk base.)
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const regressionCropBox = { x: 340, y: 580, width: 200, height: 180 }; // person under tree
await page.screenshot({ path: `${outDir}/iter-5-regression-crop.png`, clip: regressionCropBox });
// Also capture iter-4 equivalent crop from stored image for visual compare;
// we leave that to the human verifier reader but note the crop coordinates.
report.regression.cropBox = regressionCropBox;
report.regression.note = 'compare iter-5-regression-crop.png with same-coord crop of iter-4-home.png';

writeFileSync(`${outDir}/iter-5-custom-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
