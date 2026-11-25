# ryo-nd.com

Source for ryo-nd.com, Ryo Nagaki-DiLazzaro's earlier personal site. The deployed site is now
behind a sign-in; the public portfolio is [ryo.is](https://ryo.is).
Deployed to GitHub Pages (`gh-pages` branch) by `.github/workflows/deploy.yml` on every push to `main`.

## What lives where

| Path | Served at | What |
| --- | --- | --- |
| `src/` | `/` | Home page (React 19 + Vite), including the DreamField experiment |
| `public/dev/` | `/dev/` | Dev Center: a self-contained static project showcase (see its [README](public/dev/README.md)) |
| `public/visualizer/` | `/visualizer/` | AI Visualizer (vanilla JS, its own docs in `docs/visualizer/`) |
| `public/SpamShredder/` | `/SpamShredder/privacy.html` | Older copy of the SpamShredder privacy policy (the store links the [public Gist](https://gist.github.com/rdilaz/5ebdc944f4a1cfa7f6f4547e7cb08448)) |

Design tokens (colors, type, motion) are shared between the home page (`src/index.css`)
and the Dev Center (`public/dev/dev.css`), and both follow the AI Visualizer's look
(`public/visualizer/styles.css`): near-black, frosted glass, white at different opacities.
No web fonts: everything uses the Visualizer's system font stack.

## Scripts

```sh
npm ci            # install
npm run dev       # local dev server
npm run build     # production build into dist/
npm run preview   # serve dist/ (home at /, Dev Center at /dev/)
npm run lint      # ESLint
```

Visualizer contract tests and the Playwright suite run in CI (`.github/workflows/visualizer-check.yml`).
