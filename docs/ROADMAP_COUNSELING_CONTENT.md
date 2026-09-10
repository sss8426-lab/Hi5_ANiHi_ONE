# Counseling roadmap content

## Scope

The existing `/data-core/roadmap` uses the supplied 2026-09-03 confirmed screen structure:
two families, 35 career cards, related majors, university information, verified admissions
ratios, a six-stage career path, and four public preparation stages.

The spreadsheet export contains 22 track summaries and the 20 common lesson areas.
The 792 monthly plans, weekly assignments, rubrics and progression scores remain in
the original local workbook. They are not exported to public assets or this public repository.
The UI does not implement student assessment or personal placement from the earlier proposal.

## Source handling

- `전공_실기_웹앱_확정_화면구조.md` is the screen reference.
- `전공_실기_웹앱_정보원_및_데이터설계_v1.md` is the provenance/data-design reference.
- Workbook names and SHA-256 hashes are recorded in `roadmap-content.js`.
- The import is an explicit public allowlist. It does not copy entire source workbooks.
- `scripts/import-roadmap-workbooks.py SOURCE_DIRECTORY public/data-core/roadmap-content.js`
  regenerates it using Python and openpyxl (read-only source access).
- Career descriptions, aliases, track matching and image matching are editorial mappings.
- University examples from the workbook are explicitly reference-only, not verified admissions.
- No database migration, production sync, binding modification, or original record overwrite.

Existing DATA CORE authenticated graph APIs remain the source of connected university
programs. Career matching is exact, including explicit aliases; related major matching
is exact. No admissions student records are requested.

Ratios require a year, HTTPS source, explicit approved/verified status and valid review
date. Invalid or missing numbers never become zero. Displayed averages use the latest
available year, unique program/method rows, and explicitly identify their limited sample.
They are not presented as a whole-major average, ranking, or admission probability.
The original data and API response contracts are unchanged.

## Design and navigation

The full-width hero and two family cards use approved bright photorealistic scenes.
Each of the 35 occupations has its own optimized WebP and job-specific tools/action,
mapped by `occupation-image-concepts.js`. `visual-assets.json` records the shared
page and occupation asset metadata. The old atlas is not used by these cards.
All people in these generated scenes are fictional. The images are visual examples,
not evidence of actual students, staff, campuses, admissions or professional outcomes.
The common token/presentation layer is isolated from the existing content and routing.

Hash links preserve family and career selection for refresh, sharing and browser history.
Educational assets contain only the public summaries. The production page's existing
staff authentication guard is unchanged; the renderer also handles missing/expired API
authentication. Authenticated results are never persisted in local/session storage.
Requests are aborted on navigation and stale responses cannot replace a newer career.
Print produces the chosen counseling guide. The consultation action returns to the existing
counseling home; no fake trial-booking endpoint or personal data form is introduced.

## Verification

Behavior coverage includes source counts and internal-content exclusion, career aliases,
exact graph matching, admissions verification requirements, invalid ratio cases, combined
filters, year/sample handling and output-field allowlisting. Browser checks additionally
cover both families, career selection/search, history, slow requests, unauthenticated
fallback, synthetic authenticated data, all 35 cards and desktop/tablet/mobile layouts.

Production verification exposed an existing D1 `exec()` multiline-DDL failure in
`ensureKnowledgeSchema`: `CREATE TABLE IF NOT EXISTS knowledge_nodes (` was parsed
as an incomplete statement. The two table statements now use `prepare().run()`;
their definitions, indexes, bindings and existing records remain unchanged.
The Miniflare regression test covers fresh initialization, repeated goals/detail
reads, unauthenticated denial and preservation of an existing synthetic node.

Authenticated production goals/detail calls then returned 200, but repeated schema
DDL inside graph traversal made the detail response take about 24 seconds including
tail delivery. Successful schema initialization is now memoized per D1 binding in
a WeakMap; failures evict the promise so the next request can retry. This caches
only schema readiness, never user authorization or knowledge/API results. The D1
regression also injects a failed initialization and asserts retry and no repeated DDL.

The sequential goals + graph UI request budget is 45 seconds (not 15 seconds),
bounded by the same navigation cancellation and stale-response guard. Production
cold requests can each take several seconds even after removing repeated DDL.
A synthetic browser case holds a successful response beyond the old 15-second
limit and checks that loading continues and the eventual result renders.
