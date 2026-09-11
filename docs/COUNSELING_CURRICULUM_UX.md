# Counseling Curriculum and Admissions UX

## Scope and Preservation

- Static curriculum shell only: no new lessons, occupations, DB, migrations or R2 objects.
- Existing admissions candidate selection, score calculation, campus authorization and university/guideline navigation are unchanged.
- No production records or images are used for testing. The browser script intercepts all API calls with synthetic fixtures and rejects mutations (the existing source-preview request is also mocked).

## Curriculum

`/data-core/curriculum` has two approved-image cards. Each family (`content`, `design`) has independent `basic`, `advanced`, `admission` catalog slots in `public/data-core/curriculum.js`. Empty states intentionally remain empty. All nine routes support reload, browser history and explicit return links. Later curriculum data must reuse DATA CORE's existing education source contract rather than a separate store.

## Distance Order

Existing checked, visible, current-year, track/practical-type candidate filtering runs first. No new inferred eligibility threshold is introduced. Candidates are sorted by Haversine straight-line distance, then stable source order; probability is not a tie-breaker. This is not a travel-time estimate or a new official eligibility assessment.

Reference: Seoul City Hall main building, WGS84 latitude `37.5666263`, longitude `126.9783924`, from `map1` on the [official Seoul City Hall directions page](https://www.seoul.go.kr/seoul/map.do), checked 2026-09-12 KST.

Optional per-program university metadata contract:

```json
{
  "campus": "exact stored program campus",
  "campusLocation": {
    "campus": "exact stored program campus",
    "latitude": 37.5,
    "longitude": 127.0,
    "verificationStatus": "verified",
    "sourceUrl": "https://synthetic.example/campus"
  }
}
```

The sample is synthetic, not a real campus. Coordinates require an exact nonempty campus identity, numeric ranges, reviewed status and source URL. No fuzzy school matching, default main-campus coordinates, regional centroids or postcode guesses are used. Invalid/missing coordinates sort last and display `캠퍼스 위치 확인 필요`.

**Remaining data prerequisite:** the existing repository's admissions contract has no populated reviewed campus-coordinate registry. This change provides ordering for verified per-program metadata, but does not claim that all live universities have verified distances. Real campus mapping needs separate source verification; no production coordinate backfill was performed.

## Cases and Images

- Search-first behavior stays intact. Pass/fail columns have independent three-record pages; filters reset both pages. Total record counts are removed, not the records themselves.
- Rejected cases use numeric reserve order descending. Explicit reserve fields, bare numbers and `예비` labels are recognized; dates/grades in prose are not treated as reserve numbers.
- The first five detail images load eagerly with high priority. Redrawing the same student view retains already decoded image nodes at the same data revision. Fresh data invalidates reuse. No localStorage, service-worker or cross-session private-image cache is added.
- Opening/closing the original-image viewer no longer rerenders the student table. Escape, overlay close and focus return work.
- Single exact legacy R2 references skip one HEAD before GET; ambiguous references still fail closed and campus/session checks still precede file access. Multiple HEAD checks run together. Private conditional HTTP caching remains revalidated.
- **Performance limit:** old admissions originals without registered thumbnails still transfer original bytes on the first request. No original was resized, replaced, deleted or bulk-backfilled; do not describe this change as completed thumbnail generation or promise instant cold loading.

## Verification

- `tests/counseling-ux.test.mjs`: distance ordering/invalid coordinate isolation, reserve parsing/order, bounded pagination.
- `tests/data-core-content-behavior.test.mjs`: curriculum routes, protected legacy images, campus denial, ambiguous references, conditional 304, unchanged bytes, skipped redundant HEAD.
- `scripts/check-counseling-ux-browser.mjs`: six viewports (1920, 1440, 1280, 1024, 768, 390), both image cards/all six folders, reload/back/deep links, top 30, guideline navigation, compact inputs, independent case pages, eager images, decoded-node reuse and image-request checks.
- Screenshots and local test logs are ignored under `outputs/counseling-ux*`; they contain only synthetic fixtures.

Local results (2026-09-12 KST): npm ci completed; build/typecheck/52 public browser JS syntax checks passed; npm test 318/318; browser assertions 330 passed across all six widths with no page errors; Wrangler dry-run passed with existing bindings. Desktop/tablet screenshots were inspected. Existing npm audit reports 12 dependency advisories (4 moderate, 8 high); lockfiles/dependencies were not changed or force-upgraded in this UI task.
