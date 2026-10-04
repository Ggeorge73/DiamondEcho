# DE-34 dependency triage: direct high-severity packages

Prepared by Claude acting as the Engineering agent on 2026-10-03. This is the first triage pass, covering the direct high-severity packages, and a set of proposed changes. The disposition of every advisory, with owner and retest evidence, is in [de34-advisory-dispositions.md](de34-advisory-dispositions.md). It does not accept risk or clear a launch gate; Gbenga decides both. The run of the **Production dependency audit** workflow on this PR is the evidence of record. The figures below come from the same commands run locally with npm 10.9.3 against `main` at `1c94874` and against this branch.

## Result

| Scope | Command | `main` (`1c94874`) | This branch |
| --- | --- | --- | --- |
| Frontend, shipped to visitors | `npm audit --omit=dev --workspace frontend` | 85 packages (72 high, 10 moderate, 3 low) | 0 |
| Staff queue, shipped to staff | `npm audit --omit=dev --workspace staff-queue` | 7 packages (4 high, 3 low) | 4 packages (4 high) |
| Backend runtime | `pip-audit` on the frozen runtime inventory | 0 advisories in 47 packages | unchanged |
| Every npm package, devDependencies included | `npm audit` | 91 packages (77 high, 11 moderate, 3 low) | 87 packages (73 high, 11 moderate, 3 low) |

Read the first row with care. Only two of the changes fix vulnerable code that reaches a browser (axios and react-router). Most of the drop from 85 to 0 comes from recording build tools as devDependencies, which is a correction to how they were classified and not a fix. The last row is the honest measure of what was repaired: 91 to 87. npm counts every package that depends on a vulnerable one, so the 87 trace back to 20 root packages, listed at the end.

The local backend scan resolved packages on Python 3.13; CI resolves on 3.12 and is authoritative.

## The seven direct high-severity packages

| Package | Where it runs | Finding | Action here | State after |
| --- | --- | --- | --- | --- |
| `axios` 1.18.1 | Visitor's browser (inquiry form, assistant, calculator) | 12 advisories, 7 high, all fixed in 1.20.0. Several concern Node-only adapters and proxy handling; the fetch-adapter and prototype-pollution items apply in a browser | Upgraded to 1.20.0 | Fixed |
| `react-router-dom` 7.18.1 | Visitor's browser | `react-router` GHSA-qwww-vcr4-c8h2, CSRF bypass in RSC mode. The site is a client-side app and does not use RSC mode | Upgraded to 7.18.4 | Fixed |
| `postcss` 8.5.16 | Build only | GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp. Needs attacker-controlled CSS or source maps; the build processes only this repository's CSS | Upgraded to 8.5.28, which also moves `nanoid` to 3.3.19 | Fixed for the top-level copy. `postcss` 7.0.39 nested under `react-scripts` remains |
| `react-scripts` 5.0.1 | Build and test only | Parent of most findings. Create React App is unmaintained and npm offers no fixed release | Moved from `dependencies` to `devDependencies` | Unfixed, now reported under the build toolchain scope |
| `tailwindcss` 3.4.x | Build only | High through `chokidar`, `fast-glob` and `micromatch` to `braces` (GHSA-vfj7-8cjw-p6xm); npm reports no fix in range | None; already a devDependency | Unfixed |
| `tailwindcss-animate` 1.0.7 | Build only; used in `tailwind.config.js` | Inherits the `tailwindcss` finding through its peer dependency | Moved to `devDependencies` | Unfixed, build toolchain scope |
| `firebase` 12.19.0 (staff) | Staff browser | High through `@firebase/firestore` to `@grpc/grpc-js` 1.9.16 (GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4, fixed in 1.13.6). 12.19.0 is the latest release and pins `@grpc/grpc-js` to `~1.9.0` | None | **Open: needs Gbenga's decision** |

### The open staff finding

The staff bundle imports only `firebase/app` and `firebase/auth`. `dist/app.js` contains no gRPC code in either the disabled or the configured build (`grep -c grpc` returns 0 for both). Firestore is imported only by `firestore-rules.test.mjs`, which runs in Node against the emulator. Both advisories describe gRPC server behaviour. On that evidence the vulnerable code is not shipped and not reachable by staff or visitors.

The report will keep showing four high packages until Firebase raises its pin. Two ways to close it:

1. Accept it as not reachable and record that decision on DE-34.
2. Force the fixed version with a root `overrides` entry for `@grpc/grpc-js` (`^1.13.6`). That goes against Firebase's own pin and affects only the test path, so the Firestore emulator job in CI would have to pass before it is trusted.

The PR that introduced this document did neither.

**Decided on 2026-10-03.** Gbenga chose option 2. The root `package.json` now carries the override, the lockfile resolves `@grpc/grpc-js` to 1.14.5, and the staff scope of the audit returns 0. The Firestore emulator job in CI is the evidence that the test path still works with the newer gRPC client.

## Why moving packages to devDependencies is legitimate, and what it hides

`react-scripts` and `tailwindcss-animate` run during `craco build` and `craco test`. None of their code is in `frontend/build`. `@craco/craco`, `tailwindcss`, `postcss` and `autoprefixer` were already devDependencies, so the production build already needed devDependencies installed and nothing changes for the Pages build. The lockfile change for this step marks 1,283 packages as `dev` and changes no versions.

The cost is that those packages stop appearing in the two production scopes. To keep them on the record, the audit workflow now also captures `npm audit` for the whole lockfile as `build-toolchain.json` and the summary reports it as a separate scope. These packages still run on developer machines and in CI, and the `webpack-dev-server` advisories in particular apply to anyone running `npm run dev`.

## In-range fixes to the build toolchain

The first triage pass left these out because they change what is shipped. They are now proposed on their own, on top of the `@grpc/grpc-js` override, so the change can be reviewed by itself. Merging that PR is decision 2; it is not made until then.

`npm audit fix` without `--force`, npm 10.9.3, changes 18 lockfile entries and nothing in any `package.json`:

| Package | From | To |
| --- | --- | --- |
| `ajv` | 8.17.1 | 8.20.0 |
| `baseline-browser-mapping` | 2.10.42 | 2.11.27 |
| `body-parser` | 1.20.6 | 1.20.8 |
| `brace-expansion` | 1.1.16 and 2.1.2 | 1.1.21 and 2.1.7 |
| `browserslist` | 4.28.5 | 4.29.3 |
| `caniuse-lite` | 1.0.30001803 | 1.0.30001814 |
| `colord` | 2.9.3 | 2.10.0 |
| `electron-to-chromium` | 1.5.389 | 1.5.444 |
| `express` | 4.22.2 | 4.22.3 |
| `fast-uri` | 3.1.3 | 3.1.8 |
| `js-yaml` | 3.15.0 (two copies) and 4.3.0 | 3.15.2 and 4.3.2 |
| `node-releases` | 2.0.51 | 2.0.57 |
| `qs` | 6.15.3 | 6.16.0 |
| `svgo` (the 2.x copy under `postcss-svgo`) | 2.8.2 | 2.8.4 |
| `update-browserslist-db` | 1.2.3 | 1.3.3 |

Audit result: the whole lockfile goes from 82 packages (68 high, 11 moderate, 3 low) to 72 (64 high, 5 moderate, 3 low). Distinct advisories go from 45 to 23 and root packages from 19 to 11. The frontend and staff scopes stay at 0.

### What it changes in the shipped site

The update refreshes the browser-usage data that the build reads. The production target is `>0.2%, not dead, not op_mini all`, so the list of supported browsers moves with that data:

| Browser | Oldest version targeted before | After |
| --- | --- | --- |
| iOS Safari | 11.0 | 15.6 |
| Chrome | 103 | 109 |
| Edge | 148 | 119 |
| Firefox | 121 | 120 |
| Safari (desktop) | 18.5 | 18.5 |
| Samsung Internet | 30 | 30 |

Two build outputs change as a result:

- Stylesheet: 123,309 to 122,423 bytes. The only differences are 18 legacy `-webkit-` fallbacks that are no longer written: `position: -webkit-sticky` (3), `-webkit-max-content` (2), `-webkit-min-content` (1), `-webkit-appearance` on two rules, `-webkit-text-decoration-line` and `-webkit-text-decoration-color` (5), and five rules that existed only for the `::-webkit-file-upload-button` selector. The standard property or selector stays in every case.
- JavaScript bundle: 140.76 kB to 137.41 kB gzipped, because fewer syntax transforms are needed for the newer target list.

Visual check: seven routes (`/`, `/search`, `/search?status=rent`, `/investment-calculator`, `/inquire?type=tour`, `/agents`, `/about`) at 1280 px and 390 px, full-page screenshots in headless Chromium from both builds. All 14 pairs are pixel-identical. That covers a current Chromium only. It says nothing about Safari, Firefox or a real phone.

Who could see a difference: someone on iOS Safari older than 15.6 or Chrome older than 109. On those, sticky side panels may scroll with the page and some form fields may show the system's default styling. The site would still work.

### Not fixed by this update

`underscore` 1.13.6 stays. The earlier pass listed it as fixable in range; that was wrong. `jsonpath` 1.3.0, the latest release, pins `underscore` to exactly 1.13.6, so it needs an override or the removal of `react-scripts`.

## Third pass: `underscore` override (2026-10-03)

Gbenga chose to handle `underscore` separately from the `react-scripts` decision. Root `overrides` sets `underscore` to `^1.13.8`; the lockfile moves that one entry from 1.13.6 to 1.13.8 and nothing else.

Audit result, npm 10.9.4: the whole lockfile goes from 72 packages (64 high, 5 moderate, 3 low) to 69 (61 high, 5 moderate, 3 low). Distinct advisories go from 23 to 22 and root packages from 11 to 10. The frontend and staff scopes stay at 0.

What it changes in the shipped site: nothing. `main.deeae902.js`, `main.636eb94f.css` and `index.html` built from this branch have the same SHA-256 as the ones built from `main` at `1418279`.

Checks on this branch:

- Clean `npm ci` from the new lockfile. `npm ls underscore` shows 1.13.8, marked overridden.
- Frontend: 22 suites, 126 of 126 tests pass. Staff: 7 of 7. Audit summary script: 7 of 7. Staging smoke contract: 3 of 3.
- `jsonpath` queries return correct results with 1.13.8, and a build run with `--stats` writes `bundle-stats.json`, which is the only path through `bfj`.
- Staff build succeeds.
- Not run locally: backend tests (no backend change), the Firestore emulator job and the container build. CI on the PR covers them.

Risk: `jsonpath` 1.3.0 declares exactly 1.13.6, so it runs with a patch release it did not declare. It uses only `uniq` from `underscore`. If `react-scripts` is replaced under decision 3, remove this override in the same change.

## What cannot be fixed by an upgrade

Eight root packages have no fix while `react-scripts` 5.0.1 is in use: `nth-check`, `svgo` (its 1.x copy), `serialize-javascript`, `webpack-dev-server`, `webpack-dev-middleware`, `node-forge`, `uuid` and the nested `postcss` 7. Clearing them means replacing Create React App with a maintained build tool, which is a migration with its own regression risk. `braces` is separate: it also arrives through `tailwindcss` and Jest, and npm offers no patched release.

Whether to replace the build tool before launch, or to accept these build-time findings for launch, was Gbenga's decision. On 2026-10-03 he asked Engineering to make the call and confirmed it by merging the pull request that recorded it: accept for launch on conditions, and replace `react-scripts` afterwards under DE-36. `braces` and `@tootallnate/once` are accepted on the same day. The conditions and the reasoning are in [de34-advisory-dispositions.md](de34-advisory-dispositions.md).

One of those conditions needed a code change. `npm run dev` bound the dev server to every network interface, so the dev-server findings were reachable from the local network while it ran. `scripts/dev.mjs` now defaults `HOST` to `127.0.0.1`. Checked by connecting to the dev server on the loopback address and on the machine's network address: before the change both answered; after it only loopback answers; with `HOST=0.0.0.0` set both answer again.

This is not a launch approval. DE-13 and DE-27 stay gated on their own evidence and on the release-candidate rerun of the audit.

## Verification on this branch

- Clean `npm ci` from the new lockfile with npm 10.9.3.
- Frontend: 16 suites, 60 of 60 tests pass. Staff: 7 of 7. Audit summary script: 7 of 7.
- `npm run build` compiles. `build/static/css/main.af6ad9c6.css` is byte-identical to the stylesheet built from `main`. The JavaScript bundle goes from 138.63 kB to 140.72 kB gzipped because of the two runtime upgrades.
- Staff build succeeds in both disabled and configured modes.
- Not run locally: backend tests (no backend change), the Firestore emulator job and the container build. CI on the PR covers them.

No deployed environment was tested. A green CI run on this PR is code evidence, not release acceptance.

## Decisions

All four have been made.

1. Staff queue: accept `@grpc/grpc-js` as not reachable, or apply an override. **Decided on 2026-10-03: override applied.**
2. Apply the in-range build-tool updates after a visual check of the stylesheet. **Decided on 2026-10-03 by merging PR #27.** `underscore`, which that update could not reach, was handled by its own override on the same day.
3. Replace `react-scripts`, or accept its build-time findings. **Decided on 2026-10-03: accept for launch on conditions; replace under DE-36.**
4. Accept `braces` and the low-severity test-only `@tootallnate/once` finding, or upgrade staff `jsdom`. **Decided on 2026-10-03: accept both. The `jsdom` upgrade does not clear the finding.**

The release-candidate rerun of the audit, with command, date and commit, is also still outstanding.

## Root packages still reported after this branch (all npm scope)

| Severity | Packages |
| --- | --- |
| High, no fix without replacing `react-scripts` | `node-forge`, `nth-check`, `postcss` (7.x, nested), `serialize-javascript`, `svgo`, `webpack-dev-middleware`, `webpack-dev-server` |
| High, no patched release | `braces` |
| High, fixed by the proposed in-range update | `brace-expansion`, `browserslist`, `fast-uri`, `js-yaml` |
| High, closed by the `underscore` override of 2026-10-03 | `underscore` |
| High, closed by the override of 2026-10-03 | `@grpc/grpc-js` |
| Moderate | `ajv`, `baseline-browser-mapping`, `colord`, `qs`, `uuid` |
| Low | `@tootallnate/once` |
