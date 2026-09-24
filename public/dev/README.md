# Dev Center

A self-contained, static showcase of Ryo's projects. No build step, no framework,
no third-party requests. Every path is relative, so the folder works unchanged at
any mount point: `ryo-nd.com/dev/`, `ryo.is/dev/`, `dev.ryo.is/`, and so on.

It is live at **https://ryo-nd.com/dev/** (Vite copies `public/dev/` verbatim into `dist/dev/`).

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell, SVG icon sprite, dialogs (command palette, project sheet) |
| `dev.css` | Design tokens (the AI Visualizer look), layout, mini-demo styles |
| `dev.js` | ES module: grid, filters, palette, sheet, deep links, progress, hero field |
| `projects.js` | **The data.** Projects, filter chips, hero stats, "now building", build log |
| `demos.js` | Mini-demo renderers (one per project, DOM/CSS or a small canvas) |
| `favicon.svg` | Tab icon |

## Editing content

Everything visible comes from `projects.js`:

- `projects`: one object per card. Fields are documented at the top of the file.
  `size` controls the bento footprint (`xl`, `tall`, `wide`, or omit for standard).
  `demo` picks a renderer key from `demos.js`.
- `filters`: the chips above the grid. Each has a `match(project)` function.
- `heroStats`, `nowBuilding`, `buildLog`, `profile`: the hero numbers, the ticker,
  the timeline and the footer/reward links.

To add a mini-demo, add a function to `renderers` in `demos.js` that fills the given
element and returns `{ play, pause, destroy }` (the `stepper()` and `canvasLoop()`
helpers cover most cases), then add its styles under "Mini-demos" in `dev.css`.
Demos only animate while on screen and never under `prefers-reduced-motion`; the
initial frame should make sense on its own.

## Look

The page shares the AI Visualizer's look: near-black `#050506`, frosted glass chrome,
white at different opacities, white pill primary buttons, tiny wide-tracked uppercase
labels and the system font stack (no web fonts). The only colours are the Visualizer's
live green (`--live`, for things that are literally live or running) and one pastel
warm tone (`--attn`, for "needs you" and alerts). Status is always a word plus a glyph
shape, never colour alone. The `accent` field in `projects.js` is not used by this theme.

## Deep links

`<dev-center-url>#p=<project id>` opens that project's sheet on load, for example
`https://ryo-nd.com/dev/#p=riff`. The ids are the `id` fields in `projects.js`.

## Putting it behind ryo.is

Pick one:

1. **Link to it (simplest).** Point the "Dev Center" button on ryo.is at
   `https://ryo-nd.com/dev/`. Nothing else to maintain.
2. **Cloudflare redirect rule.** In the ryo.is zone: Rules → Redirect Rules → create a
   rule matching `http.request.uri.path wildcard "/dev*"` with a static target of
   `https://ryo-nd.com/dev/` (302 while testing, 301 once happy). Browsers keep the
   `#p=...` fragment across the redirect, so `ryo.is/dev/#p=riff` still deep-links.
3. **Copy the folder.** Copy `public/dev/` (or `dist/dev/` after a build) into whatever
   serves ryo.is. It must be served over http(s), not opened as a `file://` path
   (ES modules need a server). Serve it at a URL ending in `/`: most hosts redirect
   `/dev` to `/dev/` automatically, and an inline guard in `index.html` fixes it
   otherwise.

   Project links are absolute `https://ryo-nd.com/...` URLs, so the folder works
   unchanged on any domain.

## Privacy

No cookies, analytics or network calls. "Explored N/12" progress and the
"Continue" chip use one `localStorage` key (`ryo-dev-center:v1`) on the visitor's
device. If storage is blocked, the page works the same without remembering.

## Local preview

From the repo root: `npm run build && npm run preview`, then open
`http://localhost:4173/dev/`. Or serve the folder directly with any static
server, for example `npx serve public` and open `/dev/`.
