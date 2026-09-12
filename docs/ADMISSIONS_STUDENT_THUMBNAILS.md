# Admissions Student Thumbnails

## Preserved Originals

Existing originals, student rows, filenames and R2 keys are untouched. No bulk job runs at deploy, GET, or page load. No new DB/R2/binding/migration. Browser Canvas reuses the library implementation: aspect-preserving long edge <=480px, WebP quality .76, <=256KB, no upscale, EXIF orientation honored by createImageBitmap. Server validates bounded single-frame WebP container/dimensions; no AI or paid image service.

New student upload: original DATA CORE upload succeeds first; optional thumbnail POST follows. Failure records failed in the returned upload shape, never retries/deletes the original. Registered source ID is retained. `/api/admissions/files/:id/thumbnail` verifies sourceApp/category/campus/read/write permission server-side and uses existing file_objects/data_records derivative provenance. Repeated/concurrent creation reuses a committed source relation. Trashed registered derivatives can get a new successor without replacing bytes. Missing/corrupt committed objects fall back to original and require metadata repair/soft-trash before regeneration; they are never silently overwritten.

Legacy originals have no file_objects ID. MASTER's explicit **기존 썸네일 생성 (최대 5장)** uses only the currently selected student's first five stored image references. A SHA-256 identity covers student slot, campus, exact original key and original ETag; private metadata's derivedFromFileId is `legacy-artwork:<digest>`. It is a legacy identity, not a fabricated file_objects FK. A new reserved `admissions-legacy-thumbnail` data_record/file row tracks the new output. No alias row pointing to the original R2 key is created, avoiding an accidental generic purge of the original. Each POST resolves the stored student again before commit. Future runs skip existing committed outputs; pending errors may be retried. Unknown-campus originals remain MASTER-only.

## Read Security / UX

Gallery uses a stable authenticated thumbnail URL; absent thumbnail falls back to original. Lightbox always uses original. Existing first-five eager/high priority and same-view decoded node reuse remain. GET/HEAD never writes. Thumbnail reads repeat student campus/slot/original-version checks, and missing or changed originals cannot expose old derivatives. Legacy derivatives cannot be fetched through generic file/library APIs; the live student route is mandatory. Reserved metadata cannot be forged by general record APIs. Registered derivatives inherit source permissions. Every mutation requires same origin.

Responses remain private with conditional revalidation after authorization. No public R2 URLs, cross-session storage, student names in logs or production-image tests. The legacy compatibility state is still read to resolve originals; its request cost is not eliminated. Cold original fallback before explicit generation is not instant.

## Tests / Boundary

`tests/admissions-thumbnails.test.mjs`: synthetic registered and legacy generation, dimensions, reuse/concurrency, forged campus/origin, private/foreign denial, reserved relation, source campus change, unchanged source rows/bytes/state/FAMILY.

`scripts/admissions-thumbnail-browser.mjs`: actual browser Canvas and Worker backed by isolated synthetic D1/R2, EXIF6 orientation, five-output bounded job, thumbnail vs original viewer, new upload and six widths. `--preview URL` verifies deployed static parity without sending writes to shared Preview storage. Production backfill is intentionally not run on real student work during acceptance.
# Phase 1 validation (2026-09-12)

- `npm ci`, build, TypeScript, 54 public browser JavaScript syntax checks, 332 behavior tests and Wrangler dry-run passed.
- Existing counseling browser regression: 330 checks, zero page errors at 1920/1440/1280/1024/768/390.
- Isolated D1/R2 browser fixture: EXIF orientation 6, 360x480 WebP, five existing thumbnails, sixth original fallback, new upload status `ready`, original viewer, unchanged source bytes/state. Desktop, tablet and mobile screenshots inspected.
- All mutation tests used synthetic local fixtures. No production backfill or production student/file mutation was performed. Preview, CI and production evidence must be recorded separately after this change is published.
