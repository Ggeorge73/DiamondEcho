# DiamondEcho frontend workspace

Install dependencies from the repository root with `npm ci`. The canonical
lockfile is `../package-lock.json`; do not generate a separate lockfile in
this directory. Run `npm run test --workspace frontend` and `npm run build`
from the repository root to reproduce CI.

## Tooling (DE-36)

The site is built by [Vite](https://vite.dev) and tested with
[Vitest](https://vitest.dev) in jsdom. Create React App (`react-scripts`) and
CRACO were removed under DE-36. Settings live in `vite.config.mjs`.

| Command (from the repository root) | What it does |
| --- | --- |
| `npm run start --workspace frontend` | Development server on `127.0.0.1:3000` (`HOST` and `PORT` override it) |
| `npm run test --workspace frontend` | All tests, once |
| `npm run build` | Production build in `frontend/build`, copied to `build/` |

What stayed the same, so hosting settings do not change:

- Output folder `build`, with `404.html` written after the build by `scripts/make-404.mjs`.
- Settings are still read as `process.env.REACT_APP_*` (for example
  `REACT_APP_BACKEND_URL`), from the environment or a `.env` file, and fixed
  into the build.
- `public/` is copied as is (`_headers`, `_redirects`, `robots.txt`, `sitemap.xml`).

What changed:

- The page shell is `index.html` in this folder, not `public/index.html`.
- Built files are in `build/assets/` instead of `build/static/`.
- Tests use `vi.fn`, `vi.mock` and so on instead of `jest.*`. A mocked module
  that the code imports as a default export (for example `axios`) must return
  `default` from its factory.
- The Emergent visual-edits and health-check dev-server plugins were removed.
  They only worked inside the old webpack dev server, and never reached the
  built site.
