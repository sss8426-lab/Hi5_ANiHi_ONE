# Operational hardening: 2026-09-11

## Reconciled baseline

- Latest main: `ebbcdc4dc441b6851ea67715f4d18e6f0afe84d2`, merged PR #182.
- No open issues or PRs at the start of this audit. Completed parent acceptance is not rerun.
- Prior release evidence: [PR #182](https://github.com/sss8426-lab/Hi5_ANiHi_ONE/pull/182#issuecomment-5622116305).
- The 35-career audit, IDs, five skill stages and conservative admissions candidates remain intact.
- No admissions source sync, mapping override, new occupation, account creation or data mutation.

## Reproduced UI failure

The program-list request already had a valid stale-response/error guard. It was retained.
The separate guideline-detail request did not have cancellation, a deadline or a generation
guard. Delayed A could replace already-open B, or open after moving to another career.
An open dialog also survived hash navigation. These are client presentation defects, not
evidence of a server authorization bypass.

The new behavior tests reproduced five failures on the pre-fix source. The fix:

- Cancels obsolete guideline requests and ignores their late success/error callbacks.
- Closes the old detail on career navigation, program paging or filter refresh.
- Only opens the selected guideline ID; the server remains the authorization authority.
- Bounds lookup at 45 seconds and re-enables the original button after failure/timeout.
- Clears the old error after successful retry. No browser storage is introduced.
- Versions the changed roadmap browser script, retaining the existing URL/hash contract.

`tests/roadmap-request-behavior.test.mjs` runs in regular CI, including a transport that
deliberately ignores AbortSignal. `scripts/check-roadmap-request-browser.mjs` additionally
checks six interaction scenarios at 1920/1440/820/390/320. All API traffic in that script
is synthetic and read-only; production URLs are rejected by the runner.

## Compatible dependency patches

| Dependency | Before | After | Scope |
|---|---|---|---|
| Vite | 8.0.13 | 8.0.16 | Same minor security patch |
| React / React DOM / React server DOM | 19.2.6 | 19.2.8 | Coordinated same-minor security patch |
| Babel, browserslist, brace-expansion, fast-uri, fflate, js-yaml and required dependencies | Existing lock | Compatible versions in lockfile | Existing parent semver ranges |

No forced override, framework beta upgrade or migration-tool downgrade was used.
The lockfile retains Windows/Linux/macOS optional binaries for CI and local development.

Primary security references:

- [Vite Windows filesystem denial bypass, patched in 8.0.16](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff).
- [React Server Functions denial of service, patched in 19.2.8](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g).

`npm audit` snapshot: **23 -> 12** affected dependency entries; high **16 -> 8**,
moderate **6 -> 4**, low **1 -> 0**, critical **0**. Counts include transitive dependants,
not 12 independently reachable production exploits. They can change with new advisories.

### Remaining work, not hidden

- Cloudflare plugin/Wrangler/Miniflare chain: sharp, undici and ws advisories require a
  separately tested deployment-tool update. Bindings and runtime compatibility stay unchanged here.
- vinext/image-size: requires framework/image handling upgrade and dedicated compatibility checks.
- drizzle-kit/esbuild-kit/esbuild: npm suggests an older, breaking migration-tool version;
  do not apply that automatically or execute a migration as a dependency test.
- A devDependency label alone does not prove code is absent from production bundles.
  Remaining exposure has not been declared harmless or fully remediated.
- Uncertain university curriculum matches remain review candidates from the existing career audit.

## Release gates

Run npm ci, build, typecheck, all public JS syntax checks, full behavior tests,
browser regressions and Wrangler dry-run. Merge only after GitHub CI and Cloudflare
Preview pass, then independently confirm the deployed Worker and read-only production smoke.
Record final results and Worker version in this change's PR, not before they occur.

Existing DATA CORE/FAMILY DB and FILES bindings, actual students, guardians, university
records, awards and original files are not modified by this change or its fixtures.
