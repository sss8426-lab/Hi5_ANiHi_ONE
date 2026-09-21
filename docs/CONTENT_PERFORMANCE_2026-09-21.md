# Shared Navigation, Calendar, and Content Performance

## Scope and Release Boundary

- Baseline: `818dbc92c11a6905225dc49eebd833a55686478e`, existing PR #242, `feat/instagram-carousel`.
- Main `e5f1eefecb68326acaac2a927aae844e78eb9eeb` was already included. Existing work was preserved.
- Preview target: `https://feat-instagram-carousel-hi5-anihi-one.sss8426.workers.dev`.
- No production deployment or main merge is authorized in this change.
- No new DB, bucket, schema migration, model, generation key, or billing setting. No production data writes or paid provider calls used for tests.

## Implementation

1. `work-navigation.js` defines the work menus once for `index.html` and `content.html`. Home, library, blog, Instagram, Kkumeum, attendance, mode navigation and existing master menus share order, paths, icons and selection. Content pages do not import `app.js`. Sidebar scroll remains available on short viewports.
2. `content.js` starts the picker independently of Instagram imports, diagnostics and history. Blog no longer loads the old Instagram-only module. Actual unsaved content/defaults are the basis for exit protection.
3. `#aiDiagnosticsMount` is the final DOM footer. `ai-usage.js` stays collapsed and fetches near the viewport or when opened. The OpenAI link uses `target=_blank` and `rel=noopener noreferrer`.
4. `calendar.js` owns root-scoped controls, idempotent dynamic mounting and one shared in-flight query per identity/filter/month. Writes invalidate pending reads. Work and counseling share detail/editor/filter/list/copy code; no separate calendar was created.
5. `library-client.js` delivers file and folder responses independently. Only known virtual roots skip empty file requests. `data-core-library.ts` applies file ACL before the 50-visible-file page limit; a private first page cannot hide later permitted files.
6. Existing private caches and thumbnail endpoints are reused. Registered thumbnails never load originals in the picker. Legacy previews have a two-request queue, serialized decoding, bounded bytes, cancellation and writer-only persistence. Read-only users get a local thumbnail, not new write permission. No blanket processing of existing files.
7. `instagram-carousel.js` overlaps one image composition with its draft metadata request. The same PNG Blob is used for preview and upload. Caption state is separate from image state and bound to its original set/selection; changing selection aborts and rejects stale caption results.
8. `instagram-production.ts` shares metadata within a read phase, discards phase caches after writes/conversion, and checks conditional updates atomically. A version conflict rolls back the set/audit instead of reporting success.
9. Export checks an existing authorized, provenance-matched 1080x1350 PNG before reading the master. Valid exports stream directly. A D1 CAS lease prevents simultaneous duplicate initial conversion. No public R2 URL is introduced.
10. Stable, non-identifying `Server-Timing` fields cover master storage, set completion and export conversion/reuse. Browser measures separate source, composition and PNG stages. They contain no names, prompts, IDs or keys.

## Account Usage Setup

Read-only checks of the existing Worker secret names and version bindings found `OPENAI_API_KEY`, but not `OPENAI_ADMIN_KEY` or `OPENAI_PROJECT_ID`. No secret value was displayed. The proposed project ID has not been assumed to match the generation key.

The existing official Costs integration can read account-project spending. A configured official monthly project spend limit can supply the denominator. If no limit is available, spending can still be shown, but a percentage requires an explicitly chosen app budget. The user prefers account data, so no arbitrary app budget is set.

Safe registration location: Cloudflare dashboard > Workers & Pages > `hi5-anihi-one` > Settings > Variables and Secrets. Use a **secret** named `OPENAI_ADMIN_KEY` for the authorized admin credential, and `OPENAI_PROJECT_ID` for the project actually used by the existing generation key. Do not paste credentials in chat, code, logs or documentation. Do not replace `OPENAI_API_KEY`. Missing settings display unknown, not zero percent. This is API spending, not ChatGPT/Codex subscription usage.

Official references:
- https://developers.openai.com/api/docs/guides/admin-apis
- https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs

## Measurement Method

All measurements below are **local synthetic**, not production latency. Windows, Node 24, headless Chrome, actual built Worker with isolated Miniflare D1/R2. The provider is mocked: caption timings do not establish live OpenAI speed. Do not reuse the older `af4a61d` measurements as this baseline.

- `scripts/measure-content-server.mjs`: baseline Worker versus changed Worker, identical fixtures; actual DB and R2 method counters. Set completion repeats three times for 1/5/10 masters. Exports use three different first exports and their repeats.
- `scripts/check-instagram-carousel-browser.mjs --measure-only [--baseline]`: baseline frontend assets versus changed assets, both against the same changed Worker to isolate frontend effects. Three repetitions per image count. Includes the cost of real legacy thumbnail creation introduced here.
- `scripts/check-content-navigation.mjs`: baseline/current assets against the same Worker, 50 registered thumbnails, 30 return visits, AI usage response intentionally delayed 4 seconds. No artificial folder/health/file latency. Initial visit numbers are a single observation, not a statistical median.
- With only three repetitions, nearest-rank p95 is the maximum. These small samples are directional, not an SLA.

### Browser Results

Times are milliseconds; paired values are median / p95 unless marked single sample.

| Function | Before | After | Samples per version | Remaining work |
|---|---:|---:|---:|---|
| Initial folders, single sample | 350 | 318 | 1 | Actual network/auth latency |
| File tiles, single sample | 259 | 255 | 1 | File metadata is little changed |
| First real registered thumbnail, single sample | 450 | 398 | 1 | Authenticated thumbnail request |
| Return to parent folder | 352 / 417 | 347 / 389 | 30 | Server folder query remains |
| Compose + upload 1 image | 859 / 1044 | 1076 / 1500 | 3 | New legacy thumbnails add first-visit work; not improved |
| Compose + upload 5 images | 4162 / 4211 | 3199 / 3539 | 3 | PNG encoding + individual writes |
| Compose + upload 10 images | 8230 / 8264 | 6412 / 6477 | 3 | PNG encoding + individual writes |
| Mocked caption 1 image | 303 / 358 | 264 / 276 | 3 | Real provider time unmeasured |
| Mocked caption 5 images | 886 / 921 | 846 / 862 | 3 | Current source ACL metadata |
| Mocked caption 10 images | 1620 / 1641 | 1595 / 1610 | 3 | Current source ACL metadata |

30 visits: API requests 243 -> 240, response bytes 946991 -> 945842; original image requests **0 -> 0** for registered thumbnails. After-change listeners 202 -> 202; cached thumbnail entries 18, bytes 3600. Heap changed 2.43 -> 2.58 MB during the test; this is not proof of zero long-term memory growth. Late pending queues drained.

### Server Results and Limits

All rows below use the actual baseline/changed Worker separately, three local synthetic samples each. Times are median / p95 milliseconds.

| Function | Before | After | Remaining bottleneck |
|---|---:|---:|---|
| Complete 1 stored master | 448 / 467 | 452 / 460 | No meaningful latency improvement; current-version checks |
| Complete 5 stored masters | 1932 / 1971 | 1751 / 1792 | Per-source ACL and post-write review |
| Complete 10 stored masters | 3748 / 3790 | 3531 / 3754 | Per-source ACL and post-write review |
| First publish download | 1094 / 1112 | 1253 / 1297 | Slower: conversion lease and fresh permission checks |
| Repeat publish download | 983 / 1066 | 488 / 532 | Fresh metadata validation and one R2 stream |
| 10-file metadata list | 64 / 65 | 68 / 111 | Not improved in this small sample; existing query |

The complete-set read count decreased from 54/246/486 to 38/142/272 for 1/5/10 images, plus one atomic D1 batch. Batch statements are counted separately, not hidden in the SELECT totals. Completion and caption tests measured **zero R2 reads/writes** after master creation.

Cached export tests measured **zero PNG encodes**, one R2 stream read and zero new writes. Concurrent first downloads measured one encode/write, with the second request reusing it. Initial export does extra lease/current-version validation and can be slower; do not describe every path as faster.

Repeat-download DB statements decreased from 78 to 50. The extra final file ACL check is intentionally retained. The actual after-change file-list SQL `EXPLAIN QUERY PLAN` uses `file_objects_category_idx`, primary-key lookup for the correlated record subquery and user join, and a temporary ORDER BY B-tree. The old baseline plan artifact was a narrower representative query and is not a like-for-like plan comparison. No production index/migration was applied.

Fresh post-write source/render validation remains in completion, and caption saving still validates current image metadata. Replacing this with a pre-write snapshot would weaken concurrent-change protection; that further optimization is not claimed complete. No master pixels are reread. Deep numbered pages still scan preceding authorized metadata; no new index is applied without a measured production query plan.

## Verification and Evidence

Synthetic fixtures only: cross-campus ACL, private rows preceding 51 visible rows, role-filtered menus, missing-thumbnail previews, original raster formats, 1/5/10 image order, no-logo, source byte preservation, 2160x2700 masters, 1080x1350 exports, replayed save idempotency, CAS conflict rollback, concurrent conversion, cached export refusal after version change, and caption-only save with no image transfer.

Browser evidence is under ignored `outputs/instagram-carousel`, `outputs/calendar-browser`, `outputs/content-navigation`, and `outputs/content-performance`. Preview asset hash checks establish deployed assets, not production write verification. Live authenticated page checks and final CI/release results are recorded below after execution.

Calendar browser tests passed at 320/390/430/768/820/1024/1280/1440/1920: work-created events edited in counseling and reflected back in work, create/edit/copy/search/filter/list/detail, dynamic late roots, 30 round trips with one expected query set per navigation and no duplicate controls. Synthetic date input took 6-16 ms; this is not real network save latency. Screenshot review included 320px editor and 1440px long-detail layout.
