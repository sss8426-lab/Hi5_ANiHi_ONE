# Private Library Image Thumbnails

## Contract

- Original files, IDs, filenames, R2 keys and bytes are never modified by thumbnail creation.
- Only new library JPEG/PNG/WebP/AVIF/GIF uploads attempt a derivative. No backfill, new binding, schema migration or paid service.
- Browser uses the selected local File, one decode at a time, Canvas WebP quality 0.76, aspect-preserving long edge at most 480px (no upscaling).
- After original upload success, POST `/api/data-core/library/files/:sourceId/thumbnail` with a WebP `file`. Failure is optional and never retries or rolls back the original upload.
- Server requires same-origin mutation, existing library write/read rights, original R2 existence, one-hop source, and server-validated WebP dimensions. Input is bounded to 256KB plus 64KB multipart overhead. Container/header validation is not a full pixel decode.
- Existing derivative persistence is reused: a new `file_objects` row, a new private `data_records` JSON record, and a new R2 key in existing FILES. Batch failure compensates only a new uncommitted derivative object; never original or committed bytes.
- Reserved record type/category `image-thumbnail`, sourceApp `data-core-thumbnail`. General upload/record mutation cannot forge these relations. Generic file lists/search exclude these internal thumbnails.

```json
{
  "schemaVersion": 1,
  "derivativeType": "thumbnail",
  "derivedFromFileId": "source-file-id",
  "derivativeFileId": "new-file-id",
  "width": 376,
  "height": 480,
  "format": "webp",
  "createdBy": "library-upload"
}
```

Library list adds nullable `thumbnailUrl`. A single batched lookup covers the current 50-item page; only valid, active, matching-source relations are returned. The thumbnail inherits campus, owner and visibility, with source folder ancestry checked afresh on every read. The narrowly scoped shared-campus library read exception is retained; generic file access is not broadened. Source/thumbnail trash, malformed relation, restricted parent or missing original R2 object denies access before ETag evaluation.

## Browser and Cache

- Thumbnail box: 112 x 84px, cover, 7px radius. Mobile stacks thumbnail, metadata and actions. Click reuses the original preview link.
- IntersectionObserver margin 400px, lazy/async images, three fetches maximum, deduplicated pending requests. No broken-image symbol on failure; fallback to original then image icon.
- DATA CORE staff library memory cache only: 32MB, 24 entries, 5-minute TTL, LRU, AbortController and revoked object URLs. Cleared on new folder/search/refresh, logout, pagehide and 401/403. No FAMILY use, localStorage, IndexedDB or Service Worker cache.
- Image GETs on generic DATA CORE and library preview APIs: `private, no-cache`, ETag and conditional 304 **after** current authentication, authorization, row/lineage and R2 checks. Downloads and nonimages remain `private, no-store`. No public or shared CDN cache.
- Existing award cache remains 128MB/24 entries/5 minutes with its existing concurrency/deduplication; HTTP misses now revalidate. Admissions artwork Worker security/cache unchanged. Missing admissions gallery and content preview async/lazy hints added; existing optimized static WebP assets are not re-encoded.

## Verification Boundary

`tests/library-thumbnails.test.mjs` exercises real built Worker code against ephemeral synthetic D1/R2, including authorization-before-304, relation forgery, deleted/missing source and byte preservation. Cache unit tests cover dedupe, LRU/TTL, concurrency, abort and auth revocation.

`scripts/library-browser-smoke.mjs` tests the real UI and Worker using only ephemeral synthetic storage, including ten 3MB-class JPEG fixtures, local-File derivative generation, repeat HTTP transfer counts, failure fallback and six widths. `--preview URL` also verifies deployed static-asset parity, but deliberately sends no mutations to shared Cloudflare Preview bindings. It does not claim a remote synthetic write test.

Production validation is read-only. Existing production assets must never be used for write/delete/backfill tests. Evidence records aggregate bytes/statuses only, never original payloads, filenames, credentials or personal data.

The browser harness stubs the unrelated external competition-news preview provider with an empty synthetic response. External provider uptime is not part of the thumbnail acceptance. Expected injected 400 thumbnail failure and 409 nonempty-folder rejection are checked separately from unexpected console errors.

Local measurement (2026-09-11): ten synthetic JPEG originals of 3,421,543 bytes each. First viewport began with three requests, maximum three concurrent. New local-file thumbnail: 376 x 480 WebP, 57,410 bytes. Repeated thumbnail request: HTTP 304, zero response body bytes. These are byte/status measurements, not a claimed speed multiplier.
