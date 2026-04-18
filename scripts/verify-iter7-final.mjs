import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:4321';
const OUT = '/tmp/figs-loop';
const report = { viewports: {}, routes: {}, meta: null, aria: null, errors: [] };

function collect(page, tag) {
    page.on('console', (m) => { if (m.type() === 'error') report.errors.push({ tag, type: 'console', text: m.text() }); });
    page.on('pageerror', (e) => report.errors.push({ tag, type: 'pageerror', text: String(e) }));
}

const browser = await chromium.launch();

// --- Desktop audit
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    collect(page, 'desktop');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    const svg = await page.$('svg.scene-svg, svg#scene-svg, svg');
    const svgAttrs = await page.$eval('svg', (el) => ({
        viewBox: el.getAttribute('viewBox'),
        par: el.getAttribute('preserveAspectRatio'),
    })).catch(() => null);

    const hotspots = await page.$$eval('[data-window]', (els) =>
        els.map((el) => ({
            w: el.getAttribute('data-window'),
            aria: el.getAttribute('aria-label'),
            role: el.getAttribute('role'),
            tabindex: el.getAttribute('tabindex'),
        }))
    );

    // open each window and check in-viewport
    const windowChecks = [];
    for (const h of hotspots) {
        await page.click(`[data-window="${h.w}"]`, { force: true });
        const r = await page.$eval(`#window-${h.w}`, (el) => {
            const b = el.getBoundingClientRect();
            return { visible: !el.hidden, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
        });
        windowChecks.push({ w: h.w, ...r });
        // close via ×
        await page.click(`#window-${h.w} .close`, { force: true });
    }

    const noWordmark = await page.evaluate(() => !document.body.innerText.match(/figtre\.es/i) || document.title === 'figtre.es');
    await page.screenshot({ path: `${OUT}/iter-7-final-desktop.png`, fullPage: false });
    report.viewports.desktop = { svgAttrs, hotspots, windowChecks };
    await ctx.close();
}

// --- Mobile audit
{
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    collect(page, 'mobile');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const svgAttrs = await page.$eval('svg', (el) => ({
        viewBox: el.getAttribute('viewBox'),
        par: el.getAttribute('preserveAspectRatio'),
    }));
    const hotspotRects = await page.$$eval('[data-window]', (els) =>
        els.map((el) => {
            const b = el.getBoundingClientRect();
            return { w: el.getAttribute('data-window'), width: b.width, height: b.height, top: b.top, left: b.left };
        })
    );
    const windowChecks = [];
    for (const h of hotspotRects) {
        await page.tap(`[data-window="${h.w}"]`, { force: true });
        const r = await page.$eval(`#window-${h.w}`, (el) => {
            const b = el.getBoundingClientRect();
            return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
        });
        const inView = r.left >= 0 && r.top >= 0 && r.right <= 375 && r.bottom <= 812;
        windowChecks.push({ w: h.w, ...r, inView });
        await page.tap(`#window-${h.w} .close`, { force: true });
    }
    await page.screenshot({ path: `${OUT}/iter-7-final-mobile.png`, fullPage: false });
    report.viewports.mobile = { svgAttrs, hotspotRects, windowChecks };
    await ctx.close();
}

// --- Routes
{
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    collect(page, 'routes');
    for (const path of ['/', '/notes', '/notes/hello', '/this-does-not-exist', '/og-card.png', '/favicon.svg']) {
        const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' }).catch((e) => ({ err: String(e) }));
        report.routes[path] = { status: resp?.status?.() ?? null, contentType: resp?.headers?.()?.['content-type'] ?? null };
    }
    // meta head
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    report.meta = await page.evaluate(() => {
        const get = (sel) => document.querySelector(sel)?.getAttribute('content') ?? document.querySelector(sel)?.getAttribute('href') ?? null;
        return {
            ogImage: get('meta[property="og:image"]'),
            ogImageW: get('meta[property="og:image:width"]'),
            ogImageH: get('meta[property="og:image:height"]'),
            twitterCard: get('meta[name="twitter:card"]'),
            twitterImage: get('meta[name="twitter:image"]'),
            canonical: get('link[rel="canonical"]'),
            themeColor: get('meta[name="theme-color"]'),
            title: document.title,
        };
    });
    // scene landmark
    report.aria = await page.evaluate(() => {
        const scene = document.querySelector('#scene');
        return { role: scene?.getAttribute('role'), ariaLabel: scene?.getAttribute('aria-label') };
    });
    await ctx.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/iter-7-verifier-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
