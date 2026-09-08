# Admissions Catalog and Counseling Roadmaps

## Scope and Preservation

The university admission app retains its existing students, universities, cases,
award folders, settings, admission calculations and legacy API. A scoped bright
theme reuses the approved counseling and sidebar artwork. Navigation now uses
the top-level same-origin hash, including refresh/back/forward and links from
the dream roadmap. No binding, FAMILY data, analytics flag or migration changes.

## University Connection

`GET /api/data-core/roadmap/programs?careerId=D001` is an authenticated staff-only,
private/no-store projection. It reads the existing R2 admissions state (or its
existing D1 fallback) without writing or initializing that state. Only university
fields needed for counseling leave the server. Student arrays, cases, notes,
conversion rules and accepted-student statistics are never projected.

All 35 career IDs have explicit department-name associations in
`public/data-core/admissions-model.js`. These associations describe related fields
of study, not guaranteed eligibility. University/department names do not become
verified admissions numbers automatically. Existing knowledge graph APIs remain
available and untouched; no graph synchronization or student migration is needed
for this direct university catalog read-through.

Stored public guidelines are also connected through the same department rules.
They retain public-source-unverified status. Official-source/year/review/date
checks in the dream roadmap still gate numeric ratios and trend calculations.
The source detail link opens either the existing university editor or the local
guideline detail, with no iframe of the external source.

## Public Guideline Sources

Public pages inspected without login on 2026-09-08:

- https://grinalda.net/univ-info-susi/
- https://grinalda.net/univ-info-jungsi/

The pages themselves reference anonymous string-pool JSON at:

- https://grinalda.net/wp-content/uploads/grinalda/grinalda-susi-2027-data.json
- https://grinalda.net/wp-content/uploads/grinalda/grinalda-jeongsi-2027-data.json

Both returned HTTP 200. The source files contain multiple academic years; the
filename is not treated as the academic year. Only columns actually exposed by
the anonymous public tables are mapped. Member-only admission-result statistics,
articles, editorial analysis, images, branding and page styling are excluded.
No login cookies or authentication headers are sent, redirects are rejected,
source URLs are fixed, response size and timeout are bounded.

Unknown fields stay null. A complete single-stage percentage formula may be
parsed; staged, conditional, points-based, incomplete or contradictory formulas
stay as their public selection-method text and do not yield invented ratios.
Changed formulas invalidate earlier derived ratios. Public JSON Last-Modified is
shown as the source-file timestamp, not as a claim that each university updated
its official guidelines then.

## Storage and Synchronization

Reuse `data_records` with `source_app=admissions` and record types
`university-admission-susi` / `university-admission-jungsi`.

`POST /api/data-core/admin/admissions/guidelines/sync` accepts:

- `{mode: "preview"}`: fetch both public sources, normalize, compare, return
  counts and a SHA-256 plan token. No guideline writes. Approved public-source
  rows are held for ten minutes in the existing Worker Cache API, not DB/R2.
- `{mode: "apply", token, offset}`: validate the approved snapshot, apply at most
  100 records per request, atomically with a count-only audit entry. The UI
  advances until done. A failure reports incomplete state; retry starts with
  another preview and preserves already applied rows.

Apply never re-fetches/rebuilds the full source. It validates snapshot TTL/token,
the selected rows' SHA-256 identities/fingerprints and current university/campus
mapping, then reads only the selected existing guideline rows in 50-ID query
chunks. The same priority/tombstone/optimistic-concurrency guards still apply.
Eviction, expiry, tampering or changed mapping fails closed with 409 and asks for
a fresh preview. Cached rows contain only the public source projection and its
university mapping, never existing metadata, legacy state, student records,
credentials or request headers. The cache-key URL still hits the authenticated
POST-only admin handler; it is not a public data route. No binding was added.

Requires SUPER_ADMIN, first-password-change completion and exact same-origin
mutation. Each plan token binds identities, source fingerprints and university
mapping. Optimistic metadata comparison prevents concurrent edits from being
overwritten. Stable identity includes year, season, normalized university,
campus, department, admission name/category and group. Duplicate conflicting
identities, tombstones and sourcePriority > 50 are withheld from application.
Source failure/empty schema aborts before writes; missing values do not erase
known facts. Mapping ambiguities never choose an arbitrary university ID.
No new university is created and no original university is overwritten.

## Mapping Review Pass

The mapping review extends exact matching only for the terminal generic label
`전형` (for example `실기우수자` / `실기우수자전형`). Additional links require the
same school, unambiguous campus, exact department, explicit matching academic
year and one unique candidate ID. Hidden duplicate candidates, different
departments/years/campuses, special eligibility words and multiple candidate IDs
are not collapsed. Original exact-match compatibility is retained. Stable source
identities and admissions numbers do not change; this is not official verification.

The stored catalog supports `mappingStatus` and `mappingReason` filters. Reasons
are computed server-side from current university candidates, never accepted from
arbitrary saved metadata. Only fixed reason codes leave the server, not candidate
rows or notes. An available but unapplied link is `pending-sync`; legacy-source
failure leaves stored catalog browsing available with `source-unavailable`.
The normal admin preview/apply workflow persists reviewed links; reads never write.

Read-only production audit before this change: 3826 source rows, 2604 linked and
1222 needing review. The conservative rule proposes 59 new links, zero changed
links and zero removed links. Remaining 1163: admission-name mismatch 738,
department mismatch 169, campus ambiguity 153, duplicate candidates 72, academic
year mismatch 27 and campus mismatch 4. These remain unresolved, not fabricated.
The local audit script requires `--remote-read-only`, reads Wrangler output in
memory with Wrangler disk logging disabled, selects only mapping identity columns
from D1, and emits counts plus whole-domain preservation hashes only. No payload,
PII, credentials or backup files are written. Production application of this pass
must be recorded after CI/Preview, merge/deploy and a fresh idempotency preview.

Local validation for the mapping pass: npm ci, build, typecheck, browser syntax,
187 full behavior tests and Wrangler dry-run passed. Synthetic browser checks:
113 admissions and 103 roadmap; desktop/tablet/mobile/small-mobile layouts,
mapping filters, distinction from official verification, and source navigation.

Source priorities reserved: official-university=100, manual-verified=80,
grinalda=50. This release does not modify any existing priority in bulk.
Public guidelines are organization-visible factual records; no student-level
generic DATA CORE records are created.

`GET /api/data-core/admissions/guidelines` is staff-only and no-store, with
40-row pagination, server-side search/filters, safe projected details and facets.
Hash routes: `/#page=admin`, `/#page=susi`, `/#page=jungsi`.

## Career Images

`occupation-image-concepts.js` is the complete 35-entry inventory: occupation ID,
title, category, action, tools, result, environment, exclusions and unique asset
path. It replaces the previous 12-scene shared career atlas for individual cards.
The old atlas remains only for the two general family entry illustrations.

Images are original built-in image_gen outputs, not downloaded third-party art.
Each prompt combines that occupation's registry action/tools/result/environment
with: portrait 3:4, bright natural daylight, detailed editorial illustration,
contemporary Korean workplace, visible hands/tools/result, no occupation title,
no watermark/brand, no futuristic room. Final assets use stable per-job WebP
names, 600x800, quality 82, lazy loading, fixed dimensions and version 20260909-1.
The optimization script only resizes/encodes generated outputs. A missing
concept is explicit and never borrows another occupation image.

## Verification

Use synthetic fixtures only. Behavior tests cover authorization, origin checks,
source failure, malformed pool/schema, duplicate identity, zero/missing values,
preservation, ambiguity, PII projection and source provenance. Browser scripts
cover desktop/tablet/mobile, existing views, navigation/history, filters,
dialog/preview/apply and career detail. Live source validation prints only
HTTP statuses and counts; no full external or private records are fixtures.

Production deployment and any initial public-source sync require separate
observed evidence. Local tests do not establish production completion.

Local validation (2026-09-09): npm ci, build, typecheck, all public browser
JavaScript syntax checks, 181 behavior tests and Wrangler deploy dry-run passed.
Isolated browser checks passed for admissions (88) and dream roadmap (103),
including 1440/820/390/320px layouts, all 35 decoded unique job images,
authentication states, source links, history and synthetic admin sync.
The 35 WebP assets total 2,831,912 bytes. Public source inspection found 2,643
susi and 1,183 jungsi identities. These are source inspection counts, not proof
of production imports or official university verification.

PR #155 passed CI/Cloudflare Preview and deployed as production Worker
4378d14d-f0d9-44c9-8e2f-f2ffa0476e5e. All 35 production image hashes match;
the authenticated webtoon view renders 318 existing university program rows.
The first production guideline preview failed before any apply. Error responses
now include only a fixed processing stage and allowlisted exception class,
never exception messages, raw source content or credentials. A synthetic
exception containing private markers verifies that diagnostics do not leak it.
Initial production guideline import remains unverified until a successful apply.

Root cause reproduced in workerd: fetch rejects redirect mode `error` with
TypeError before any external response. Node-level fetch mocks had missed this
runtime difference. Use `manual`; the existing non-2xx check rejects redirects
without following them. A real workerd synthetic outbound-service test verifies
one request only and an application behavior test verifies redirected sources
are rejected. No access-control bypass or alternative source is introduced.

Full production preview then reached the configured CPU limit before apply:
filtered Wrangler tail reported outcome exceededCpu, CPU 2010ms. University
matching had repeatedly normalized the entire legacy university array for each
source row. Build a school-name index once per plan and keep the same campus,
department and ambiguity checks within matching buckets. Synthetic 5000-school /
1000-guideline tests bound lookups and confirm identical ambiguity behavior.
Cloudflare limits and bindings are unchanged. Non-JSON gateway error bodies are
not displayed; the UI reports only the HTTP status and a retry message.
The indexed implementation passed npm ci/build/typecheck/browser syntax,
all 183 behavior tests, 89 admissions browser checks (including a synthetic
HTML gateway failure that must not expose its body), and Wrangler dry-run.

The indexed production preview succeeded (2643 susi + 1183 jungsi); one batch
was saved before a later invocation still exceeded CPU. Replace thousands of
per-row asynchronous WebCrypto digests and JS byte-to-hex conversions with
native synchronous node:crypto SHA256 under the existing nodejs_compat flag.
No algorithm/input/ID/fingerprint changes: a workerd test proves byte-identical
digests, allowing the partial import to resume without duplicate records.

The full-source work still repeated on every apply request. Preview now keeps
only freshly projected public rows in the existing Worker Cache API for ten
minutes. Each apply validates the snapshot and current university mapping, reads
only its selected existing IDs, and retains the same scoped optimistic upsert.
Cache expiry/eviction requires a fresh preview; it never silently refetches.
No legacy payload or existing metadata is cached and no binding is added.
Local validation passed build/typecheck/browser syntax, all 185 behavior tests,
and Wrangler dry-run. Tests cover the real workerd Cache API, cache tampering,
expiry, mapping changes, no source refetch during apply, and duplicate retries.
Full production import remains pending the deployed snapshot implementation.
