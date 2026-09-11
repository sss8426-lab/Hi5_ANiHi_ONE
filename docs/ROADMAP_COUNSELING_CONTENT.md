# Counseling roadmap content

## Scope

The existing `/data-core/roadmap` uses the supplied 2026-09-03 confirmed screen structure:
two families, 35 career cards, related majors, university information, verified admissions
ratios, five skill-growth stages under `실기향상 로드맵`, and four public lesson groups.

The 2026-09-11 career audit supersedes the original time-based progression. Stages are
기초 표현력 / 전공 기초 / 전공 심화 / 입시 실기 적용 / 실전 완성도, not school years,
employment milestones or a promised completion period. All 35 summaries, distinct
outcomes, neighboring-role explanations and final skill checks are reviewed in
`scripts/roadmap-career-review.json`. The workbook importer reapplies that allowlisted
editorial layer so regeneration preserves it and keeps former names in aliases.
See `ROADMAP_CAREER_AUDIT_2026-09-11.md` for the complete review and limitations.

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

The authenticated DATA CORE admissions catalog supplies connected university programs.
Department-name associations are explicit keywords, not exact curriculum equivalence.
Game arts no longer suggest explicitly named game engineering/software degrees unless
the name also identifies an arts track. Broad/mixed names still need curriculum review.
No canonical university mapping is changed or forced. Paginated results put readable
saved guidelines before legacy reference rows; neither source is overwritten.
The API does not expose admissions student records.

Legacy verified ratios require a year, HTTPS source, approved status and valid review
date. Stored public guidelines also display strict parsed ratios, with an explicit
unverified-public-source warning. Incomplete/staged formulas remain unknown.
Invalid or missing numbers never become zero. Displayed averages use the latest
available year, unique program/method rows, and explicitly identify their limited sample.
They are not presented as a whole-major average, ranking, or admission probability.
The original data and API response contracts are unchanged.

## Exact admissions ratio filters (2026-09-11)

The connected university section replaces its former emphasis selector with `성적 %`
and `실기 %`. The paginated `/api/data-core/roadmap/programs` read endpoint accepts
`academicRatio` and `practicalRatio` as exact percentages, ANDed with region,
schoolType and admission/season. Empty values do not constrain results; zero is a
real value. The obsolete roadmap-only `focus` parameter is no longer used. Other
admissions pages retain their existing source fields and filters.

Cards, filtering and facets use the same `programView` / `selectionRatios` projection.
Academic percentage sums school record and CSAT only when the existing complete
single-stage parser succeeds. Interview/document/other factors stay separate.
Staged, point-based, ambiguous and incomplete formulas never match numeric filters;
an explicit formula also invalidates stale legacy percentages. Existing reviewed
numeric-only legacy pairs retain their verification requirements. No source rows,
mapping status or DB/R2 data are rewritten. Missing school type is not inferred;
such rows cannot match a selected school type.

The additive `facets.academicRatio` and `facets.practicalRatio` arrays contain sorted
distinct numbers from the entire career's current region/type/season subset, not
just its four visible rows. Both ratio facets intentionally ignore the ratio pair
itself, so an impossible pair can be corrected without hiding other available values.
An unavailable selection resets to All and page 1; if a server page was requested
with an obsolete value, the client refetches that corrected state before showing cards.

The existing career hash additionally carries region, schoolType, admission,
academicRatio, practicalRatio and page. Each user change is one history entry;
refresh/back/forward restore the selection. Server clamping and invalid-choice resets
replace that entry. Only filter values are stored in the URL, never API results,
credentials or student records. Pagination remains four per page. In-flight changes
clear obsolete cards and cancel stale program/detail responses.

Synthetic behavior and browser checks are in `tests/roadmap-ratio-filters.test.mjs`
and `scripts/check-roadmap-ratio-browser.mjs`. The browser runner refuses production
and intercepts every API request; required viewports are 1920/1440/1024/820/390/320.
Production acceptance is a separate read-only public-guideline check, recorded on
the PR only after CI, Preview and production deployment have succeeded.

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
Guideline detail requests also use cancellation plus generation checks: only the last
selected guideline may open, its returned ID must match the requested ID, and a career,
program page or filter change closes/cancels the old dialog. A 45-second timeout releases
the button for retry; obsolete request errors never overwrite the current notice.
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
