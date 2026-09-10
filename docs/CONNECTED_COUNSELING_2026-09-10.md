# Connected Counseling Update

## Scope

- Preserve all legacy admissions state, R2 originals, DATA CORE and FAMILY bindings.
- Repair student artwork reads using stored references only; no migration, copying, renaming, upload or record rewrite.
- Use the existing anonymous-public Grinalda allowlist, string-pool decoder, stable guideline IDs and source-priority rules. No member-only fields or new importer.
- Present complete single-stage ratios consistently in admissions and dream-roadmap views. School-record plus CSAT is academic; documents, interview, attendance and service remain other. Explicit zero is retained. Staged, incomplete, conditional and point-based formulas stay unresolved with their source text.
- Expose only four programs per requested server page, preserve filters, and open the existing guideline dialog in counseling mode without administrative links.
- Keep common foundational classes expanded, preserve source curriculum objectives and the four preparation stages, add six distinct bright instructional photographs.
- Add supplied university logos through a generated manifest and exact normalized identity resolver. No inferred renames, mergers or campus aliases.

## Artwork Read Contract

`GET|HEAD /api/admissions/students/:studentId/artworks/:slot`

`slot` is the stored array index or the legacy `artworkImage`, `artwork`, `image` field. The server loads the existing state, requires authenticated staff and stored campus membership (SUPER_ADMIN may read unknown-campus legacy rows), and resolves only exact stored image keys beneath `artworks/`.

When obsolete upload URLs do not resolve, original filename fields on the same artwork may resolve an existing object. Multiple distinct matches fail closed. Traversal, arbitrary object keys, unrelated prefixes and non-image extensions are rejected. Only JPEG/PNG/WebP/GIF are served. Permissions precede private ETag/304 handling. Direct generic `/api/files/artworks/...` access is denied so it cannot bypass student authorization.

The browser prefers an existing `dataCoreFileId`. Presentation URLs are non-enumerable and are not serialized into student state. Missing images show a stable fallback. Desktop local-file handling remains supported.

## Assets

- `public/data-core/assets/foundation/*-v1.webp`: six generated classroom photographs; not actual students or real student artwork.
- `foundation-images.js`: image role, alt text and practical learning points; original curriculum goals remain in `roadmap-content.js`.
- `public/data-core/assets/university-logos/*.webp`: 49 optimized assets from the user-supplied ㅎ archive only.
- `university-logo-manifest.js`: generated asset identity metadata.
- `university-logos.js`: exact name normalization, explicit alias table (empty), campus preference and ambiguity refusal.
- Rebuild logo assets with `scripts/extract-university-logos.ps1 -Archive <provided zip>` and `node scripts/prepare-university-logos.mjs`. Extraction validates paths and decodes legacy Korean ZIP names as CP949; original archive remains unchanged.

## Verification

Synthetic automated checks cover ratio ambiguity/zeros, public-vs-official provenance, exact logos, four-item server paging, permission-before-304, same/other/unknown campus access, source-key traversal, unchanged artwork bytes, browser filters/dialogs/history, missing thumbnails and enlarged views.

Read-only production audit evidence is kept outside Git and contains aggregate counts/hashes only. Initial protected state: 158 students, 3,915 universities; 763 objects under the legacy artwork prefix. All 569 stored artwork references resolve uniquely with the resolver (0 missing, 0 ambiguous). Prior migration URLs were stale; original filename fields, including relative folder paths, permit exact recovery without rewriting records.

The supplied archive has 49 images. Exact matching finds 21 logo assets used by the current university catalog. The remaining 28 archive identities are not forced onto renamed or unrelated universities; 265 catalog school-name variants have no supplied matching logo. Missing logos are omitted, not replaced with invented emblems.

Local browser checks: 85 connected-flow checks (including artwork fallback/lightbox), 103 roadmap checks, 113 admissions checks. Desktop, tablet, 390px and 320px mobile checked; 49 logo assets and six foundation photographs decode successfully. All 265 behavior tests pass; build, TypeScript and all 46 public browser JavaScript syntax checks pass. Wrangler dry-run preserves existing bindings.

Production sync must use a new preview and its existing token/100-item batches, preserving higher-priority, deleted and concurrently changed records. Production completion/version is recorded in the PR after the deployment and read-only smoke succeed, not inferred from local tests.
