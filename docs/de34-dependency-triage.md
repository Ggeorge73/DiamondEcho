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

## Deferred: in-range fixes to the build toolchain

`npm audit fix` without `--force` updates 20 packages inside their existing ranges (`brace-expansion`, `js-yaml`, `fast-uri`, `browserslist`, `caniuse-lite`, `underscore`, `qs`, `colord`, `baseline-browser-mapping`, `ajv` and others). In a trial on this branch it took the all-npm count from 87 to 77.

It is left out because it changes the shipped stylesheet. Newer browser-support data makes autoprefixer drop three legacy prefixes (`-webkit-appearance`, `-webkit-text-decoration-line`, `-webkit-min-content`), and `main.css` shrinks from 123,279 to 122,393 bytes. That is probably harmless on current browsers, but it is a visual change that should go through QA on its own and not ride along with a security fix.

## What cannot be fixed by an upgrade

Eight root packages have no fix while `react-scripts` 5.0.1 is in use: `nth-check`, `svgo` (its 1.x copy), `serialize-javascript`, `webpack-dev-server`, `webpack-dev-middleware`, `node-forge`, `uuid` and the nested `postcss` 7. Clearing them means replacing Create React App with a maintained build tool, which is a migration with its own regression risk. `braces` is separate: it also arrives through `tailwindcss` and Jest, and npm offers no patched release.

Whether to replace the build tool before launch, or to accept these build-time findings for launch, is Gbenga's decision. It has not been made, and nothing in this document makes it. Until a decision is recorded on DE-34, these findings stay open and DE-13 and DE-27 stay gated.

## Verification on this branch

- Clean `npm ci` from the new lockfile with npm 10.9.3.
- Frontend: 16 suites, 60 of 60 tests pass. Staff: 7 of 7. Audit summary script: 7 of 7.
- `npm run build` compiles. `build/static/css/main.af6ad9c6.css` is byte-identical to the stylesheet built from `main`. The JavaScript bundle goes from 138.63 kB to 140.72 kB gzipped because of the two runtime upgrades.
- Staff build succeeds in both disabled and configured modes.
- Not run locally: backend tests (no backend change), the Firestore emulator job and the container build. CI on the PR covers them.

No deployed environment was tested. A green CI run on this PR is code evidence, not release acceptance.

## Decisions pending

The first has been made. The other three each need Gbenga's recorded decision on DE-34.

1. Staff queue: accept `@grpc/grpc-js` as not reachable, or apply an override. **Decided on 2026-10-03: override applied.**
2. Apply the in-range build-tool updates after a visual check of the stylesheet.
3. Replace `react-scripts`, or accept its build-time findings.
4. Accept `braces` and the low-severity test-only `@tootallnate/once` finding, or upgrade staff `jsdom`.

The release-candidate rerun of the audit, with command, date and commit, is also still outstanding.

## Root packages still reported after this branch (all npm scope)

| Severity | Packages |
| --- | --- |
| High, no fix without replacing `react-scripts` | `node-forge`, `nth-check`, `postcss` (7.x, nested), `serialize-javascript`, `svgo`, `webpack-dev-middleware`, `webpack-dev-server` |
| High, no patched release | `braces` |
| High, fixed by the deferred in-range update | `brace-expansion`, `browserslist`, `fast-uri`, `js-yaml`, `underscore` |
| High, closed by the override of 2026-10-03 | `@grpc/grpc-js` |
| Moderate | `ajv`, `baseline-browser-mapping`, `colord`, `qs`, `uuid` |
| Low | `@tootallnate/once` |
