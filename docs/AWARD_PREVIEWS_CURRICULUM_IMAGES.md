# Award Preview Loading and Curriculum Stage Artwork

## Scope (2026-09-12)

Frontend-only change from main `af1616e`. No Worker API, D1/R2 binding, migration,
production file metadata or original artwork bytes are changed. Upload naming,
folder scope, selection and deletion policies remain unchanged. No production
gallery records are used as test fixtures.

## Award Gallery

- Previously every tile held an original-sized blob URL from the same 24-entry
  LRU as the lightbox. Eviction could revoke URLs still referenced by the gallery.
  Large originals also shared the same FIFO queue with clicked lightbox requests.
- A separate page-memory preview cache now holds up to 100 display-sized WebP
  previews (the current selected-folder API maximum). Long edge is at most 480px,
  each preview at most 256KiB, total at most 32MiB. Original LRU eviction cannot
  revoke these tile URLs. Browser decode requests a reduced bitmap first.
- Original cache remains 24 entries / 128MiB / five-minute lookup TTL. Same-file
  pending requests are deduplicated. Three gallery transfers plus one reserved
  clicked-original slot prevent a lightbox request waiting behind unseen tiles.
- IntersectionObserver loads only the visible region plus 80px. Offscreen queued
  work is cancelled, started transfers complete. A 30-second transfer timeout
  releases stalled slots. Failure has an explicit retry button and no broken
  image symbol. A retained preview appears immediately in the lightbox while an
  evicted original is revalidated and downloaded if required.
- Folder/view change, logout, pagehide/hidden clear and revoke memory. 401/403 also
  clears displayed images, aborts pending work and blocks new cache reads until
  explicit reset. Stale download/encode results cannot repopulate a changed scope.
- Existing authenticated file API, same-origin credentials and private HTTP
  revalidation remain. No public R2/CDN URL, localStorage, IndexedDB or service
  worker image cache is introduced.

### Performance Boundary

This fixes original-cache tile eviction, reduces retained decoded tile size, and
prioritizes clicks. It does **not** reduce an existing original's first network
transfer size: no production backfill or server-side thumbnail persistence is
performed. A cold large original still depends on its byte size and connection.
Do not present the synthetic warm-scroll result as an instant cold-load guarantee.

## Curriculum

The six stage cards use six new original images generated with built-in image_gen:

| Family | Stage | New asset / subject |
| --- | --- | --- |
| content | basic | `content-basic-v1.webp`: human proportion and gesture drawing |
| content | advanced | `content-advanced-v1.webp`: three-point city/background perspective |
| content | admission | `content-admission-v1.webp`: situational narrative expression |
| design | basic | `design-basic-v1.webp`: geometric solids and value drawing |
| design | advanced | `design-advanced-v1.webp`: three-point object perspective |
| design | admission | `design-admission-v1.webp`: basic design composition/materials |

Assets live in `public/data-core/assets/curriculum/`. Exact generation prompts and
provenance are in its `prompts.json`. Generated images are illustrative category
artwork, not real student submissions or verified technical teaching diagrams.
PNG originals remain in the generator output; workspace delivery is 1200x800
WebP (88-320KB). No previous image was copied into these six slots.

`stageImages` in `curriculum.js` holds path/alt/description by family and stage.
Existing routes, history, empty course slots and family selection images remain.
Dark stage surfaces/mint accents are retained. Cards use equal grid sizing,
3:2 cover images, separate readable captions, three desktop/tablet columns,
two below 900px and one below 640px. Static asset versions are deterministic.

## Verification

- Unit tests: distinct optimized assets, unchanged empty slots; original/preview
  isolation over 40 files, priority slot/deduplication, offscreen cancellation,
  retry, permission revocation and stale conversion cancellation.
- `scripts/check-award-curriculum-browser.mjs`: synthetic-only intercepted APIs,
  40 2400x1600 originals, 503 retry, 480px previews, zero warm-scroll downloads,
  lightbox original upgrade/reopen, all six routes, history/reload, logged-out
  render, seven widths (1920/1440/1280/1024/768/390/320), page errors and screenshots.
- Optional `STATIC_PREVIEW_ORIGIN` uses deployed preview static assets while
  keeping every API intercepted locally. This never writes to shared preview DB.
- Existing award-gallery and counseling browser suites remain regression checks.
- Release CI/Cloudflare preview and production deployment evidence belongs in the
  PR; passing local fixtures alone is not production private-data validation.
