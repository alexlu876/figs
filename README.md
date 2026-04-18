# figtre.es

Personal site for Alex, live at [figtre.es](https://figtre.es). Astro 6 + strict TS, a single hand-drawn SVG scene of a fig tree as the home page, plus a `/notes` content collection for future writing.

## Run locally

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # static build → ./dist
npm run preview    # serve ./dist locally
```

Requires Node 22.12+ (see `package.json` → `engines.node`).

## Project shape

```
src/
  layouts/Base.astro       # <html>, head meta (OG, canonical, theme-color), global styles
  pages/
    index.astro            # the scene — inline SVG + 5 clickable fig/leaf hotspots
    404.astro
    notes/
      index.astro          # list of notes
      [...slug].astro      # single note page
  components/
    RetroWindow.astro      # the retro-OS popup windows opened by each hotspot
  content/
    notes/                 # markdown entries (Astro content collection)
public/
  favicon.svg              # sage fig-leaf favicon (the only Astro-artifact-free branding)
  og-card.png              # 1200×630 social share image (see below)
scripts/
  generate-og-card.mjs     # regenerate public/og-card.png from the live dev server
  verify*.mjs              # Playwright checks used during the design iteration loop
```

## The scene

`src/pages/index.astro` is a single large inline SVG: muted-blue sky with turbulence noise, muted sage hills with texture, fig tree anchored to the left edge, person sitting under the trunk, and five interactive hotspots (`about` / `notes` / `projects` / `contact` / `now`). Tapping a hotspot opens a `RetroWindow` — cream fill, thin black border, italic title between double rules, square × close, "Ack" footer button.

The scene has two responsive modes, both in `index.astro`:

- **Desktop (≥ 641px)**: `viewBox="0 0 1440 900"`, `preserveAspectRatio="xMinYMid slice"` — tree dominates the left side, hills + sky fill the rest.
- **Mobile (≤ 640px)**: `viewBox="-20 -30 720 930"`, `preserveAspectRatio="xMidYMid meet"` — zooms in on the left slab so the tree + all 5 hotspots stay visible, letterbox blends via a sky→hill CSS gradient on `.scene`.

`matchMedia('(max-width: 640px)')` swaps the attributes at runtime. Windows re-center and grow tap targets on mobile (see `RetroWindow.astro`).

Copy for each window is placeholder — fill it in directly in `index.astro`. Content for `/notes` goes in `src/content/notes/*.md` (frontmatter: `title`, `date`, `description?`).

## OG / social card

The social share card (`public/og-card.png`, 1200×630) is rendered from the live desktop scene by Playwright. To regenerate after changing the illustration:

```sh
npm run dev                             # terminal 1
node scripts/generate-og-card.mjs       # terminal 2
```

`Base.astro` points `og:image` and `twitter:image` at `https://figtre.es/og-card.png` with `twitter:card=summary_large_image`.

## Playwright verify scripts

During the design loop, several `scripts/verify*.mjs` files were used to sanity-check the site against the brief after each iteration. They all expect `npm run dev` to be running at `:4321` and write screenshots + JSON reports under `/tmp/figs-loop/`. Useful as a reference when touching the scene.

- `scripts/verify.mjs` — original smoke test (desktop home + a window + `/notes`).
- `scripts/verify-custom.mjs` — iter-5 independent verifier (brief checklist).
- `scripts/verify-iter6.mjs` — mobile usability + head meta + focus outline.
- `scripts/verify-mobile.mjs` — mobile-only hotspot tap & window-in-viewport check.
- `scripts/verify-iter2.mjs`, `scripts/verify-iter4.mjs` — historical, kept for reference.

Run any of them with `node scripts/<name>.mjs`.

## Deploy (Cloudflare Pages)

The repo is wired to Cloudflare Pages. Pushes to `main` (on the remote git host) trigger a Pages build:

- Build command: `npm run build`
- Output directory: `dist`
- Node version: 22

Custom domain `figtre.es` is attached to the Pages project. No server runtime — everything is static, which means adding new notes is just `src/content/notes/<slug>.md` + a push.
