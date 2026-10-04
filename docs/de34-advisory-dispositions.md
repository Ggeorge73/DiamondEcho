# DE-34 advisory dispositions

Prepared by Claude acting as the Engineering agent on 2026-10-03. This table records a disposition for every advisory in the dependency audit. It began as a proposal that accepted no risk. The decisions since then are recorded in the dated updates below, and the disposition column was brought up to date when decisions 3 and 4 were made.

## Source

- Lockfile: this branch, package versions as tested at `c23522c`.
- Commands, npm 10.9.3: `npm audit --json` for the whole lockfile, and `npm audit --omit=dev --workspace staff-queue --json`.
- The same counts appear in the audit workflow run on PR #22 (run 37134363124, artifact `build-toolchain.json`).
- Installed versions and dev flags are read from `package-lock.json`. "Pulled in by" comes from `npm explain`.
- The release-candidate rerun that DE-34 requires is still outstanding. This table must be re-checked against that commit.

## Counts

- 87 vulnerable packages in the whole lockfile (73 high, 11 moderate, 3 low).
- 20 of them carry advisories of their own. The other 67 are flagged only because they depend on one of those 20.
- 47 distinct advisories.
- 4 packages in the shipped staff scope, all from one root package (`@grpc/grpc-js`). 0 in the shipped frontend scope and 0 in the backend.
- Every installed copy of the other 19 root packages is marked `dev` in the lockfile, so none is installed by a production install.

## Update, 2026-10-03: decision 1 applied

Gbenga decided to apply the override. The root `package.json` now has an `overrides` entry setting `@grpc/grpc-js` to `^1.13.6`, and the lockfile resolves it to 1.14.5. Firebase 12.19.0 still declares `~1.9.0`, so this runs a newer gRPC client than Firebase tested with. The only code path that uses it is the Firestore rules test in the emulator job, so that job is the retest evidence.

Counts with the override, npm 10.9.3:

- Staff scope: 0 packages (was 4).
- Whole lockfile: 82 packages (68 high, 11 moderate, 3 low), down from 87. The five removed are `@grpc/grpc-js`, `@firebase/firestore`, `@firebase/firestore-compat`, `@firebase/rules-unit-testing` and `firebase`.
- 19 root packages and 45 distinct advisories remain, all in the build and test toolchain.

The tables below list the packages and versions as triaged at `c23522c`; versions shown are the ones installed then. The disposition column is current. At the time of this update decisions 2, 3 and 4 were still pending; see the later updates.

## Update, 2026-10-03: decision 2 prepared, not made

The in-range updates are proposed on their own, on top of the override. `npm audit fix` without `--force` changes 18 lockfile entries. With them the whole lockfile reports 72 packages (64 high, 5 moderate, 3 low), 11 root packages and 23 distinct advisories.

The eight root packages it clears are `ajv`, `baseline-browser-mapping`, `brace-expansion`, `browserslist`, `colord`, `fast-uri`, `js-yaml` and `qs`. `body-parser` and `express` stop being reported because they inherited from `qs`.

Correction: the table below says `underscore` has an in-range fix. It does not. `jsonpath` 1.3.0, the latest release, pins `underscore` to exactly 1.13.6. It belongs with decision 3, or needs its own override.

What the update changes in the shipped site, and the visual check, are in [de34-dependency-triage.md](de34-dependency-triage.md).

## Update, 2026-10-03: `underscore` override applied

On Engineering's recommendation, Gbenga chose on 2026-10-03 to handle `underscore` on its own instead of holding it for decision 3. Root `overrides` now sets `underscore` to `^1.13.8`; the lockfile resolves 1.13.8, the first release outside the advisory's range. No other lockfile entry changes.

Counts with the override, npm 10.9.4:

- Whole lockfile: 69 packages (61 high, 5 moderate, 3 low), down from 72. The three removed are `underscore`, `jsonpath` and `bfj`.
- 10 root packages and 22 distinct advisories remain, all in the build and test toolchain. Frontend, staff and backend scopes stay at 0.

Risk recorded: `jsonpath` 1.3.0 declares `underscore` as exactly 1.13.6, so this runs a patch release that `jsonpath` did not declare. `jsonpath` uses one function from it, `uniq`; the advisory concerns `flatten` and `isEqual`, which `jsonpath` does not call. `react-scripts` loads `bfj` only to write build statistics, and only when the build is run with `--stats`, which this repository's build script does not do.

If decision 3 is to replace `react-scripts`, this override stops matching anything and should be removed in the same change.

The `underscore`, `bfj` and `jsonpath` rows in the inherited-packages list describe the state before this override.

## Update, 2026-10-03: decisions 3 and 4

Gbenga asked Engineering to make the call on decisions 3 and 4 and confirmed it by merging the pull request that added this section. This is an acceptance of specific build-time findings on stated conditions. It is not a launch approval; the go/no-go on DE-27 is separate.

**Decision 3: accept the `react-scripts` build-time findings for launch, and replace `react-scripts` afterwards under DE-36.**

It covers 20 advisories in 8 root packages: `node-forge` (1), `nth-check` (1), the nested `postcss` 7 (5), `serialize-javascript` (2), `svgo` 1.x (3), `uuid` (1), `webpack-dev-middleware` (1) and `webpack-dev-server` (6).

Why accept instead of replacing the build tool before launch:

- None of the 20 is in what visitors or staff receive. The frontend and staff production scopes are 0.
- Each one needs input an outsider cannot supply here. The build reads only this repository's own CSS, SVG and configuration, and the dev-server findings need a connection to a developer's machine while the dev server is running.
- Replacing the build tool changes every file visitors receive. Doing that before launch would reset the exact-build evidence on the tickets already Done and adds more regression risk than the findings carry.

Conditions. The acceptance lapses, and this section must be revisited, if any of them stops being true:

1. The frontend and staff production scopes of the audit stay at 0.
2. The dev server listens on this machine only. `npm run dev` used to bind to every network interface (`HOST` was fixed at `0.0.0.0`), which made the dev-server findings reachable from the local network. It now defaults to `127.0.0.1`; setting `HOST` opts in to wider exposure and should be done only on a trusted network.
3. Builds install from the committed lockfile with `npm ci`, as CI does.
4. The build processes only files in this repository. If it ever processes uploaded or third-party SVG or CSS, the `svgo`, `nth-check` and `postcss` findings need a fresh look.
5. No critical advisory appears, and no remaining advisory becomes reachable in shipped code.
6. DE-36 stays open and scheduled. The acceptance ends when it is done, and is reviewed at each run of the audit workflow until then.

**Decision 4: accept `braces` and `@tootallnate/once`.**

- `braces` 3.0.3 (high): there is no patched release. 3.0.3 is the latest and the advisory covers it. It expands glob patterns written in this repository's own tool configuration. Recheck at each audit run and update when a fix is published.
- `@tootallnate/once` 1.1.2 (low): test-only, on a code path used when jsdom fetches through a proxy, which the tests do not do. The earlier option of upgrading the staff `jsdom` does not clear it: a lockfile dry run with staff `jsdom` 30.1.1 still reports the package, because Jest under `react-scripts` keeps `jsdom` 16. It also adds a Node engine requirement. It clears with DE-36.

After these two decisions every one of the 22 remaining advisories has a recorded disposition. Still outstanding on DE-34: the release-candidate rerun of the audit.

## Decisions

| # | Decision | Covers | Status |
| --- | --- | --- | --- |
| 1 | Staff queue: accept `@grpc/grpc-js` as not reachable, or apply an override | 2 advisories | Decided by Gbenga on 2026-10-03: apply the override. See the update below |
| 2 | Apply the in-range build-tool updates after a visual check of the stylesheet | 22 advisories in 8 packages, plus the 2.x copy of `svgo`. An earlier version of this row counted `underscore` too; see the update above | Decided by Gbenga on 2026-10-03 by merging PR #27 |
| 2a | `underscore`: handle on its own with an override, or leave for decision 3 | 1 advisory | Decided by Gbenga on 2026-10-03: apply the override. See the update above |
| 3 | Replace `react-scripts`, or accept its build-time findings | 20 advisories in 8 packages | Decided on 2026-10-03: accept for launch on conditions; replace under DE-36. See the update above |
| 4 | Accept `braces` (no patched release) and the low-severity `@tootallnate/once` test finding, or upgrade staff `jsdom` | 2 advisories | Decided on 2026-10-03: accept both. The `jsdom` upgrade does not clear the finding. See the update above |

## Disposition by root package

| Package | Pulled in by | Where it runs | Reachability | Fix or mitigation | Disposition | Owner | Retest evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `@grpc/grpc-js` 1.9.16 | `firebase` 12.19.0 > `@firebase/firestore` 4.17.2 (pins `~1.9.0`); also `@firebase/rules-unit-testing` | Node only: the Firestore rules test run by the emulator job. Listed as a production dependency of the staff workspace. | Not in the shipped staff bundle (`grep -c grpc dist/app.js` is 0 for the disabled and the configured build). The staff app imports only `firebase/app` and `firebase/auth`. Both advisories describe gRPC server behaviour; no file in this repository uses gRPC directly. | `@grpc/grpc-js` 1.13.6 or later. Firebase 12.19.0 is the latest release and does not allow it. A root `overrides` entry would force it; the Firestore emulator job would then have to pass. | Override applied, by Gbenga's decision of 2026-10-03. Root `overrides` sets `^1.13.6`; the lockfile resolves 1.14.5. | Decision: Gbenga. Change: Engineering agent. | Staff scope of the audit workflow returns 0, and the Firestore emulator job passes. |
| `@tootallnate/once` 1.1.2 | `http-proxy-agent` > `jsdom` 16.7.0 (staff tests) and `jest-environment-jsdom` (frontend tests through `react-scripts`) | Tests only. | Used when jsdom fetches through a proxy. The tests make no proxied requests. | Staff: `jsdom` 29.1.1, a major upgrade. Frontend: none while `react-scripts` 5.0.1 supplies Jest. | Accepted under decision 4 (2026-10-03). A staff `jsdom` upgrade was dry-run and does not clear it. Clears with DE-36. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `ajv` 8.17.1 | direct devDependency `ajv`; also `schema-utils` > `webpack` | Build only. Validates loader and plugin option schemas. | ReDoS needs the `$data` option with attacker-supplied patterns. Schemas here come from build tools and this repository. | 8.18.0 or later, inside the declared range. | Closed. Updated in range by PR #27 (decision 2, 2026-10-03). | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `baseline-browser-mapping` 2.10.42 | `browserslist` > `autoprefixer`, `react-scripts`, `webpack` | Build only. | Crash on invalid input. Input is this repository's browserslist configuration. | 2.11.0 or later, inside range. This is the update that changes generated CSS prefixes. | Closed. Updated in range by PR #27 (decision 2, 2026-10-03). | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. Stylesheet diff reviewed. |
| `brace-expansion` 1.1.16, 2.1.2 | `minimatch` > `eslint`, `glob`, Jest; `filelist` > `jake` > `ejs` | Build, lint and test only. | Denial of service through crafted brace patterns. Patterns come from tool configuration in this repository. | 1.1.21 and 2.1.7, inside range. | Closed. Updated in range by PR #27 (decision 2, 2026-10-03). | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `braces` 3.0.3 | `chokidar` and `micromatch` > `tailwindcss`, Jest | Build and test only. | Stack exhaustion through deeply nested patterns. Patterns come from tool configuration in this repository. | npm offers no patched release. 3.0.3 is installed and the advisory covers 3.0.3 and earlier. | Accepted under decision 4 (2026-10-03) until a patched release is published. Rechecked at each audit run. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `browserslist` 4.28.5 | `autoprefixer`, `react-scripts`, `webpack`, Babel | Build only. | Memory growth and a crash through untrusted browserslist queries. Queries come from `frontend/package.json`. | 4.28.7 or later, inside range. Updating also refreshes browser data and changes generated CSS prefixes. | Closed. Updated in range by PR #27 (decision 2, 2026-10-03). | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. Stylesheet diff reviewed. |
| `colord` 2.9.3 | `postcss-colormin` and `postcss-minify-gradients` > `cssnano` > `css-minimizer-webpack-plugin` > `react-scripts` | Build only. | Slow parsing of oversized colour strings. Input is this repository's CSS. | 2.9.4 or later, inside range. | Closed. Updated in range by PR #27 (decision 2, 2026-10-03). | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `fast-uri` 3.1.3 | `ajv` (direct devDependency and through `schema-utils` > `webpack`) | Build only. | Host-confusion and request-forgery issues matter where the library parses untrusted URLs to route requests. Here it resolves schema identifiers inside build configuration; nothing is fetched from them. | 3.1.8 or later, inside range. | Closed. Updated in range by PR #27 (decision 2, 2026-10-03). | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `js-yaml` 3.15.0, 4.3.0, 3.15.0 | `eslint` (4.3.0); `svgo` 1.3.2 and `@istanbuljs/load-nyc-config` (3.15.0) | Build, lint and test only. | CPU exhaustion through crafted YAML. YAML read here is tool configuration in this repository. | 3.15.2 and 4.3.2, inside range. | Closed. Updated in range by PR #27 (decision 2, 2026-10-03). | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `node-forge` 1.4.0 | `selfsigned` > `webpack-dev-server` > `react-scripts` | Local dev server only (`npm run dev`). Not run in CI. | Signature-verification flaw. The dev server uses the library only to generate a self-signed certificate when HTTPS is switched on locally. | npm offers no patched 1.x release that `selfsigned` accepts. | Accepted for launch on the conditions of decision 3 (2026-10-03). Clears with DE-36. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `nth-check` 1.0.2 | `css-select` > `svgo` 1.3.2 > `@svgr/webpack` > `react-scripts` | Build only. | ReDoS through crafted CSS selectors in SVG files. SVGs processed are those in this repository. | 2.0.1 or later, which `svgo` 1.3.2 does not accept. | Accepted for launch on the conditions of decision 3 (2026-10-03). Clears with DE-36. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `postcss` 7.0.39 | `resolve-url-loader` > `react-scripts` (nested copy 7.0.39) | Build only. | File disclosure and parsing issues need attacker-controlled CSS or source maps. The build processes this repository's CSS. The top-level copy is fixed at 8.5.28 by this PR. | 8.5.23 or later, which `resolve-url-loader` 4 does not accept. | Accepted for launch on the conditions of decision 3 (2026-10-03). Clears with DE-36. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `qs` 6.15.3 | `express` and `body-parser` > `webpack-dev-server` > `react-scripts` | Local dev server only. Not run in CI. | Denial of service through crafted query strings sent to the dev server on a developer machine. | 6.16.0 or later, inside range. | Closed. Updated in range by PR #27 (decision 2, 2026-10-03). | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `serialize-javascript` 4.0.0, 6.0.2 | `css-minimizer-webpack-plugin` (6.0.2); `rollup-plugin-terser` > `workbox-build` (4.0.0), both under `react-scripts` | Build only. | Code execution and CPU exhaustion need attacker-controlled objects to be serialized. The plugins serialize their own build options. | 7.0.5 or later, a major upgrade the plugins do not accept. | Accepted for launch on the conditions of decision 3 (2026-10-03). Clears with DE-36. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `svgo` 2.8.2, 1.3.2 | `@svgr/webpack` (1.3.2) and `postcss-svgo` > `cssnano` (2.8.2), both under `react-scripts` | Build only. | The `removeScripts` plugin can leave script content in an SVG. That matters when optimizing untrusted SVGs; the build processes this repository's own files. | 2.8.4 fixes the 2.x copy inside range. The 1.3.2 copy has no fix while `react-scripts` 5.0.1 is in use. | The 2.x copy was updated in range by PR #27. The 1.x copy is accepted for launch on the conditions of decision 3 (2026-10-03) and clears with DE-36. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `underscore` 1.13.6 | `jsonpath` > `bfj` > `react-scripts` | Build only. `bfj` writes build statistics. | Unbounded recursion on deeply nested input. Input is build output generated locally. | 1.13.8 or later. Not reachable in range: `jsonpath` pins 1.13.6 exactly. A root `overrides` entry forces it. | Override applied, by Gbenga's decision of 2026-10-03. Root `overrides` sets `^1.13.8`; the lockfile resolves 1.13.8. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `uuid` 8.3.2 | `sockjs` > `webpack-dev-server` > `react-scripts` | Local dev server only. Not run in CI. | Missing bounds check when a caller passes its own buffer to v3, v5 or v6. `sockjs` generates v4 identifiers. | 11.1.1 or later, a major upgrade `sockjs` does not accept. | Accepted for launch on the conditions of decision 3 (2026-10-03). Clears with DE-36. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `webpack-dev-middleware` 5.3.4 | `webpack-dev-server` > `react-scripts` | Local dev server only. Not run in CI. | Path traversal against a running dev server. Reachable only by something that can connect to a developer's machine while `npm run dev` is running. | 7.4.5 or later, a major upgrade. | Accepted for launch on the conditions of decision 3 (2026-10-03). Clears with DE-36. Mitigation: the dev server now binds to `127.0.0.1` by default. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |
| `webpack-dev-server` 4.15.2 | `react-scripts` | Local dev server only. Not run in CI. | A malicious site visited while the dev server runs could read served source or interfere with hot reload. The repository is public, which limits what source disclosure exposes. | 5.2.6 or later, a major upgrade. | Accepted for launch on the conditions of decision 3 (2026-10-03). Clears with DE-36. Mitigation: the dev server now binds to `127.0.0.1` by default; avoid browsing untrusted sites while it runs. | Decision: Gbenga. Change: Engineering agent. | Build-toolchain scope of the audit workflow no longer lists the package. |

## All 47 package and advisory pairs (47 distinct advisories)

Each advisory takes the disposition of its package in the table above. "Affected copies" lists the installed versions inside the advisory's vulnerable range.

| # | Advisory | Package | Affected copies | Severity | Vulnerable range | Summary |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j) | `@grpc/grpc-js` | 1.9.16 (`@grpc/grpc-js`) | high | &lt;1.13.6 | @grpc/grpc-js: In certain configurations, getAuthContext can return unauthorized certificates as though they were authorized |
| 2 | [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | `brace-expansion` | 1.1.16 (`brace-expansion`); 2.1.2 (`filelist/node_modules/brace-expansion`) | high | &lt;1.1.19 or >=2.0.0 &lt;2.1.5 | brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion |
| 3 | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | `brace-expansion` | 1.1.16 (`brace-expansion`); 2.1.2 (`filelist/node_modules/brace-expansion`) | high | &lt;1.1.17 or >=2.0.0 &lt;2.1.3 | brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash |
| 4 | [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | `brace-expansion` | 1.1.16 (`brace-expansion`); 2.1.2 (`filelist/node_modules/brace-expansion`) | high | &lt;1.1.20 or >=2.0.0 &lt;2.1.6 | brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion |
| 5 | [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | `brace-expansion` | 1.1.16 (`brace-expansion`); 2.1.2 (`filelist/node_modules/brace-expansion`) | high | >=2.0.0 &lt;2.1.4 or &lt;1.1.18 | brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation |
| 6 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` | 3.0.3 (`braces`) | high | &lt;=3.0.3 | braces vulnerable to stack-exhaustion denial of service through deeply nested patterns |
| 7 | [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | `browserslist` | 4.28.5 (`browserslist`) | high | &lt;=4.28.6 | Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats) |
| 8 | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | `browserslist` | 4.28.5 (`browserslist`) | high | &lt;=4.28.6 | Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM |
| 9 | [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8) | `fast-uri` | 3.1.3 (`fast-uri`) | high | >=3.1.3 &lt;3.1.6 | fast-uri vulnerable to host confusion via skipped IDN canonicalization on scheme-relative references |
| 10 | [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) | `fast-uri` | 3.1.3 (`fast-uri`) | high | >=3.0.0 &lt;3.1.5 | fast-uri vulnerable to host confusion via backslash authority introducer |
| 11 | [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) | `fast-uri` | 3.1.3 (`fast-uri`) | high | >=3.0.0 &lt;3.1.6 | fast-uri vulnerable to server-side request forgery via malformed IPv6 normalization |
| 12 | [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf) | `fast-uri` | 3.1.3 (`fast-uri`) | high | >=3.1.2 &lt;3.1.6 | fast-uri vulnerable to server-side request forgery via repeated hostname percent-decoding |
| 13 | [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) | `fast-uri` | 3.1.3 (`fast-uri`) | high | >=3.0.0 &lt;3.1.6 | fast-uri vulnerable to host confusion via percent-encoded scheme normalization |
| 14 | [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) | `fast-uri` | 3.1.3 (`fast-uri`) | high | >=3.0.0 &lt;3.1.7 | fast-uri vulnerable to authority injection via an unvalidated port in serialize |
| 15 | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) | `fast-uri` | 3.1.3 (`fast-uri`) | high | >=3.0.0 &lt;=3.1.3 | fast-uri vulnerable to host confusion via literal backslash authority delimiter |
| 16 | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | `js-yaml` | 3.15.0 (`@istanbuljs/load-nyc-config/node_modules/js-yaml`); 4.3.0 (`js-yaml`); 3.15.0 (`svgo/node_modules/js-yaml`) | high | >=3.0.0 &lt;3.15.2 or >=4.0.0 &lt;4.3.2 | js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources |
| 17 | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) | `js-yaml` | 3.15.0 (`@istanbuljs/load-nyc-config/node_modules/js-yaml`); 4.3.0 (`js-yaml`); 3.15.0 (`svgo/node_modules/js-yaml`) | high | >=3.0.0 &lt;3.15.1 or >=4.0.0 &lt;4.3.1 | JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported |
| 18 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | `node-forge` | 1.4.0 (`node-forge`) | high | &lt;=1.4.0 | node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements |
| 19 | [GHSA-rp65-9cf3-cjxr](https://github.com/advisories/GHSA-rp65-9cf3-cjxr) | `nth-check` | 1.0.2 (`svgo/node_modules/nth-check`) | high | &lt;2.0.1 | Inefficient Regular Expression Complexity in nth-check |
| 20 | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | `postcss` | 7.0.39 (`resolve-url-loader/node_modules/postcss`) | high | &lt;=8.5.11 | PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments |
| 21 | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | `postcss` | 7.0.39 (`resolve-url-loader/node_modules/postcss`) | high | &lt;=8.5.17 | PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure |
| 22 | [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq) | `serialize-javascript` | 4.0.0 (`rollup-plugin-terser/node_modules/serialize-javascript`); 6.0.2 (`serialize-javascript`) | high | &lt;=7.0.2 | Serialize JavaScript is Vulnerable to RCE via RegExp.flags and Date.prototype.toISOString() |
| 23 | [GHSA-2p49-hgcm-8545](https://github.com/advisories/GHSA-2p49-hgcm-8545) | `svgo` | 2.8.2 (`postcss-svgo/node_modules/svgo`); 1.3.2 (`svgo`) | high | >=1.0.0 &lt;2.8.3 | SVGO removeScripts plugin leaves some executable scripts intact |
| 24 | [GHSA-w27v-7q3p-w38r](https://github.com/advisories/GHSA-w27v-7q3p-w38r) | `svgo` | 2.8.2 (`postcss-svgo/node_modules/svgo`); 1.3.2 (`svgo`) | high | >=1.0.0 &lt;2.8.4 | SVGO: removeScripts allows executable links through namespace and control-character bypasses |
| 25 | [GHSA-qpx9-hpmf-5gmw](https://github.com/advisories/GHSA-qpx9-hpmf-5gmw) | `underscore` | 1.13.6 (`underscore`) | high | &lt;=1.13.7 | Underscore has unlimited recursion in _.flatten and _.isEqual, potential for DoS attack |
| 26 | [GHSA-g84c-rxfj-3j2c](https://github.com/advisories/GHSA-g84c-rxfj-3j2c) | `webpack-dev-middleware` | 5.3.4 (`webpack-dev-middleware`) | high | &lt;7.4.5 | webpack-dev-middleware vulnerable to Path Traversal via non-slash-terminated publicPath |
| 27 | [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) | `ajv` | 8.17.1 (`ajv`) | moderate | >=7.0.0-alpha.0 &lt;8.18.0 | ajv has ReDoS when using `$data` option |
| 28 | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) | `baseline-browser-mapping` | 2.10.42 (`baseline-browser-mapping`) | moderate | >=2.0.0 &lt;2.11.0 | baseline-browser-mapping process termination on invalid input causes denial of service |
| 29 | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | `brace-expansion` | 1.1.16 (`brace-expansion`); 2.1.2 (`filelist/node_modules/brace-expansion`) | moderate | &lt;1.1.21 or >=2.0.0 &lt;2.1.7 | brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service |
| 30 | [GHSA-2wm5-q62r-hmrv](https://github.com/advisories/GHSA-2wm5-q62r-hmrv) | `colord` | 2.9.3 (`colord`) | moderate | &lt;2.9.4 | Colord: Slow rejection of oversized malformed color strings |
| 31 | [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) | `fast-uri` | 3.1.3 (`fast-uri`) | moderate | >=3.0.0 &lt;3.1.8 | fast-uri vulnerable to inconsistent host case normalization via percent-encoded octets |
| 32 | [GHSA-7fh5-64p2-3v2j](https://github.com/advisories/GHSA-7fh5-64p2-3v2j) | `postcss` | 7.0.39 (`resolve-url-loader/node_modules/postcss`) | moderate | &lt;8.4.31 | PostCSS line return parsing error |
| 33 | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | `postcss` | 7.0.39 (`resolve-url-loader/node_modules/postcss`) | moderate | &lt;=8.5.22 | PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset |
| 34 | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | `postcss` | 7.0.39 (`resolve-url-loader/node_modules/postcss`) | moderate | &lt;8.5.10 | PostCSS has XSS via Unescaped &lt;/style> in its CSS Stringify Output |
| 35 | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | `qs` | 6.15.3 (`qs`) | moderate | >=2.2.5 &lt;6.16.0 | qs: Denial of Service via Attacker Controlled isBuffer |
| 36 | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) | `qs` | 6.15.3 (`qs`) | moderate | >=6.14.2 &lt;=6.15.3 | qs array-limit bypass via bracket-key comma parsing |
| 37 | [GHSA-qj8w-gfj5-8c6v](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v) | `serialize-javascript` | 6.0.2 (`serialize-javascript`) | moderate | >=5.0.0 &lt;7.0.5 | Serialize JavaScript has CPU Exhaustion Denial of Service via crafted array-like objects |
| 38 | [GHSA-4vpr-x523-8j87](https://github.com/advisories/GHSA-4vpr-x523-8j87) | `svgo` | 2.8.2 (`postcss-svgo/node_modules/svgo`); 1.3.2 (`svgo`) | moderate | >=1.0.0 &lt;2.8.4 | SVGO: removeScripts incompletely sanitizes executable HTML in SVG foreignObject elements |
| 39 | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | `uuid` | 8.3.2 (`uuid`) | moderate | &lt;11.1.1 | uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided |
| 40 | [GHSA-4v9v-hfq4-rm2v](https://github.com/advisories/GHSA-4v9v-hfq4-rm2v) | `webpack-dev-server` | 4.15.2 (`webpack-dev-server`) | moderate | &lt;=5.2.0 | webpack-dev-server users' source code may be stolen when they access a malicious web site |
| 41 | [GHSA-79cf-xcqc-c78w](https://github.com/advisories/GHSA-79cf-xcqc-c78w) | `webpack-dev-server` | 4.15.2 (`webpack-dev-server`) | moderate | &lt;=5.2.3 | webpack-dev-server vulnerable to cross-origin source code exposure on non-HTTPS origins |
| 42 | [GHSA-9jgg-88mc-972h](https://github.com/advisories/GHSA-9jgg-88mc-972h) | `webpack-dev-server` | 4.15.2 (`webpack-dev-server`) | moderate | &lt;=5.2.0 | webpack-dev-server users' source code may be stolen when they access a malicious web site with non-Chromium based browser |
| 43 | [GHSA-f5vj-f2hx-8m93](https://github.com/advisories/GHSA-f5vj-f2hx-8m93) | `webpack-dev-server` | 4.15.2 (`webpack-dev-server`) | moderate | &lt;=5.2.5 | webpack-dev-server vulnerable to cross-site request forgery via internal developer endpoints |
| 44 | [GHSA-m28w-2pqf-7qgj](https://github.com/advisories/GHSA-m28w-2pqf-7qgj) | `webpack-dev-server` | 4.15.2 (`webpack-dev-server`) | moderate | &lt;=5.2.5 | webpack-dev-server vulnerable to denial of service via a malformed Host or Origin header |
| 45 | [GHSA-mx8g-39q3-5c79](https://github.com/advisories/GHSA-mx8g-39q3-5c79) | `webpack-dev-server` | 4.15.2 (`webpack-dev-server`) | moderate | &lt;5.2.5 | webpack-dev-server vulnerable to HMR WebSocket interception via permissive user proxies |
| 46 | [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4) | `@grpc/grpc-js` | 1.9.16 (`@grpc/grpc-js`) | low | &lt;1.13.6 | @grpc/grpc-js: The server transmits some error messages thrown by method handlers to the client in status messages |
| 47 | [GHSA-vpq2-c234-7xj6](https://github.com/advisories/GHSA-vpq2-c234-7xj6) | `@tootallnate/once` | 1.1.2 (`@tootallnate/once`) | low | &lt;2.0.1 | @tootallnate/once vulnerable to Incorrect Control Flow Scoping |

## Advisories fixed by the version upgrades in PR #22 (15)

Taken from the scan of `main` at `1c94874`. None appears in the branch report. `axios` and `react-router` run in the visitor's browser; `nanoid` is a build-time dependency of `postcss`. Retest evidence: the audit workflow on PR #22 no longer lists these packages in any scope.

| Advisory | Package | Fixed by | Runs in | Severity | Summary |
| --- | --- | --- | --- | --- | --- |
| [GHSA-vh66-26gq-q6x8](https://github.com/advisories/GHSA-vh66-26gq-q6x8) | `axios` | 1.20.0 | Visitor's browser | moderate | Axios: Prototype pollution gadget in fetch adapter can alter outbound requests |
| [GHSA-9fr6-4gfg-395g](https://github.com/advisories/GHSA-9fr6-4gfg-395g) | `axios` | 1.20.0 | Visitor's browser | moderate | Axios: Prototype-Pollution Gadget in the Default Instance Allows Inherited Object.prototype.method to Override HTTP Method |
| [GHSA-c29m-xwm3-cm6r](https://github.com/advisories/GHSA-c29m-xwm3-cm6r) | `axios` | 1.20.0 | Visitor's browser | high | Axios: ReDoS in fromDataURI data: URL parser freezes the Node event loop (DoS) |
| [GHSA-mghh-pgcx-3jjj](https://github.com/advisories/GHSA-mghh-pgcx-3jjj) | `axios` | 1.20.0 | Visitor's browser | high | Axios: ReDoS (O(N²)) in shouldBypassProxy host normalization, reachable via untrusted redirect Location |
| [GHSA-x97p-jq2g-jp4f](https://github.com/advisories/GHSA-x97p-jq2g-jp4f) | `axios` | 1.20.0 | Visitor's browser | high | Axios: Prototype Pollution Gadget in axios toFormData Options |
| [GHSA-3pq3-5fj3-cg6v](https://github.com/advisories/GHSA-3pq3-5fj3-cg6v) | `axios` | 1.20.0 | Visitor's browser | high | Axios: HTTP/2 adapter bypasses configured DNS lookup and proxy controls |
| [GHSA-542g-h47m-68v8](https://github.com/advisories/GHSA-542g-h47m-68v8) | `axios` | 1.20.0 | Visitor's browser | high | Axios: Denial of Service via Unhandled 'error' Event in HTTP/2 ClientHttp2Session Initialization |
| [GHSA-j8rh-479h-cp32](https://github.com/advisories/GHSA-j8rh-479h-cp32) | `axios` | 1.20.0 | Visitor's browser | moderate | Axios: Header Injection via Inherited headers After Minimal Interceptor |
| [GHSA-4hqw-qxg8-jxx2](https://github.com/advisories/GHSA-4hqw-qxg8-jxx2) | `axios` | 1.20.0 | Visitor's browser | moderate | Axios: Fetch Adapter Header Injection via Inherited FormData getHeaders |
| [GHSA-m8m8-qj5v-23w3](https://github.com/advisories/GHSA-m8m8-qj5v-23w3) | `axios` | 1.20.0 | Visitor's browser | high | Axios: Node HTTP adapter prototype-pollution gadget allows request socket hijack via inherited createConnection |
| [GHSA-44g4-m2mj-wpvx](https://github.com/advisories/GHSA-44g4-m2mj-wpvx) | `axios` | 1.20.0 | Visitor's browser | moderate | Axios: CIDR-form NO_PROXY entries are ignored, causing proxy exclusion bypass for internal IP ranges |
| [GHSA-r4gj-5m52-g5wh](https://github.com/advisories/GHSA-r4gj-5m52-g5wh) | `axios` | 1.20.0 | Visitor's browser | high | Axios: maxRedirects: 0 is not enforced by the fetch adapter, allowing redirect-based SSRF |
| [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) | `react-router` | 7.18.4 | Visitor's browser | high | React Router: RSC Mode CSRF Bypass Allows Action Execution Before 400 Response |
| [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) | `nanoid` | 3.3.19 | Build only | high | nanoid: non-secure generators can loop indefinitely with negative size |
| [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | `nanoid` | 3.3.19 | Build only | high | nanoid: custom generators can loop indefinitely when size is zero |

## Inherited packages (67)

These carry no advisory of their own. Each takes the disposition of the root package or packages it depends on.

| Package | Reported severity | Root package(s) |
| --- | --- | --- |
| `@craco/craco` | moderate | `@tootallnate/once`, `braces`, `node-forge`, `nth-check`, `postcss`, `serialize-javascript`, `svgo`, `uuid`, `webpack-dev-middleware`, `webpack-dev-server` |
| `@firebase/firestore` | high | `@grpc/grpc-js` |
| `@firebase/firestore-compat` | high | `@grpc/grpc-js` |
| `@firebase/rules-unit-testing` | high | `@grpc/grpc-js` |
| `@jest/console` | high | `braces` |
| `@jest/core` | high | `@tootallnate/once`, `braces` |
| `@jest/environment` | high | `braces` |
| `@jest/fake-timers` | high | `braces` |
| `@jest/globals` | high | `braces` |
| `@jest/reporters` | high | `braces` |
| `@jest/test-result` | high | `braces` |
| `@jest/test-sequencer` | high | `braces` |
| `@jest/transform` | high | `braces` |
| `@svgr/plugin-svgo` | high | `nth-check`, `svgo` |
| `@svgr/webpack` | high | `nth-check`, `svgo` |
| `@typescript-eslint/eslint-plugin` | high | `braces` |
| `@typescript-eslint/experimental-utils` | high | `braces` |
| `@typescript-eslint/parser` | high | `braces` |
| `@typescript-eslint/type-utils` | high | `braces` |
| `@typescript-eslint/typescript-estree` | high | `braces` |
| `@typescript-eslint/utils` | high | `braces` |
| `babel-jest` | high | `braces` |
| `bfj` | high | `underscore` |
| `body-parser` | moderate | `qs` |
| `chokidar` | high | `braces` |
| `css-minimizer-webpack-plugin` | moderate | `serialize-javascript` |
| `css-select` | high | `nth-check` |
| `eslint-config-react-app` | high | `braces` |
| `eslint-plugin-testing-library` | high | `braces` |
| `eslint-webpack-plugin` | high | `braces` |
| `expect` | high | `braces` |
| `express` | moderate | `qs` |
| `fast-glob` | high | `braces` |
| `firebase` | high | `@grpc/grpc-js` |
| `fork-ts-checker-webpack-plugin` | high | `braces` |
| `globby` | high | `braces` |
| `http-proxy-agent` | low | `@tootallnate/once` |
| `http-proxy-middleware` | high | `braces` |
| `jest` | high | `@tootallnate/once`, `braces` |
| `jest-circus` | high | `braces` |
| `jest-cli` | high | `@tootallnate/once`, `braces` |
| `jest-config` | high | `@tootallnate/once`, `braces` |
| `jest-environment-jsdom` | high | `@tootallnate/once`, `braces` |
| `jest-environment-node` | high | `braces` |
| `jest-haste-map` | high | `braces` |
| `jest-jasmine2` | high | `braces` |
| `jest-message-util` | high | `braces` |
| `jest-resolve` | high | `braces` |
| `jest-resolve-dependencies` | high | `braces` |
| `jest-runner` | high | `@tootallnate/once`, `braces` |
| `jest-runtime` | high | `braces` |
| `jest-snapshot` | high | `braces` |
| `jest-watch-typeahead` | high | `@tootallnate/once`, `braces` |
| `jest-watcher` | high | `braces` |
| `jsdom` | low | `@tootallnate/once` |
| `jsonpath` | high | `underscore` |
| `micromatch` | high | `braces` |
| `react-dev-utils` | high | `braces` |
| `react-scripts` | high | `@tootallnate/once`, `braces`, `node-forge`, `nth-check`, `postcss`, `serialize-javascript`, `svgo`, `uuid`, `webpack-dev-middleware`, `webpack-dev-server` |
| `resolve-url-loader` | moderate | `postcss` |
| `rollup-plugin-terser` | high | `serialize-javascript` |
| `selfsigned` | high | `node-forge` |
| `sockjs` | moderate | `uuid` |
| `tailwindcss` | high | `braces` |
| `tailwindcss-animate` | high | `braces` |
| `workbox-build` | high | `serialize-javascript` |
| `workbox-webpack-plugin` | high | `serialize-javascript` |
