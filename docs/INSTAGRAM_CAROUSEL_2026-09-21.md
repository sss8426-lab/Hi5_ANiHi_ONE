# Instagram carousel workflow

## Scope and preservation

Started from origin/main `e5f1eefecb68326acaac2a927aae844e78eb9eeb` on `feat/instagram-carousel`.
The calendar work in `E:/codex/attendance-repair` is a separate branch and is not included.
No production database/file writes, migrations, bucket changes, original replacements or deletions.
Reuse the existing configured `OPENAI_API_KEY`; never send it to the browser. No live paid OpenAI call was used for verification.

This workflow replaces the Instagram-facing UI of the earlier brand-review design. The old single-image APIs and approval checks remain compatible; legacy fingerprints use the original three-logo registry, so adding two choices does not revoke previously approved renders. Legacy records/assets are not deleted. The new saved-set list shows new carousel sets, not old single-image drafts.

## User flow

1. Shared DATA CORE library picker, campus/folder/search, 1-10 originals in selection order.
2. Direction input, then five official logo choices with campus display-name projection.
3. Generate each original, sequentially; partial failures do not enable finalization.
4. Preview pages and shared lightbox, then `완료 및 저장` for the whole set.
5. Individual authenticated 1080 x 1350 PNG downloads; no ZIP required.
6. Automatic caption, copy, edit/save, caption-only retry on provider failure.
7. Reload saved sets through `저장한 이미지 세트` (latest 30 in the campus).

Draft details, manual editor, resize controls, review checklists, old intermediate result panels are hidden only on Instagram. Blog retains its shared editor. A single permission confirmation precedes generation; it is not a manufactured review checklist approval.

## Layout and source safety

- Master: 2160 x 2700 PNG. Header box: x=110, y=32, w=1940, h=260.
- Photo box: x=56, y=340, w=2048, h=2304. A single compositor generates the actual saved preview bytes.
- Artwork mode uses contain, retaining all four edges. Landscape artwork necessarily leaves space in a portrait master; it is never filled with invented artwork.
- Space/academy-photo mode uses centered cover without AI, filling the photo box. The user checks crop in the final preview.
- AI photo mode requires separate external processing consent and calls the existing image-edit provider for each selected original. Server restrictions still block protected student/artwork/award/document/logo categories.
- Artwork mode sends no image bytes to AI for captions. Caption context is the user direction and campus label only; it does not claim visual analysis. For photograph mode captions, up to five images are analyzed per request, two requests for 6-10 images, preserving existing provider byte limits.
- Three production modes apply to the selected set. Mixed protected and AI photos must be split into separate sets.
- Official raster marks are not generated or redrawn. New v2 assets retain the supplied reference images; the Ansan lockups use the supplied full references. Other campuses use measured mark/text templates with a tight gap, fixed line positions and an unchanged logo aspect ratio. Campus text is separately rendered, not a replacement drawing of the logo.
- Campus IDs/names remain unchanged; `getInstagramCampusLogoLabel` is the single display projection.
- Inputs and logo/picker navigation are locked during generation. Caption generation does not block saved-image downloads. Cancellation does not promise cancellation of an already billed upstream request.

## Storage and API

Reuse `file_objects`, `data_records`, the existing FILES binding, content drafts, immutable version fingerprints, derivatives and audit log.
Each item references a single-image draft and render. The set stores those references, not duplicate original bytes.

| Endpoint | Contract |
|---|---|
| GET /api/data-core/content/instagram-sets?campusId= | Latest 30 sets; campus and owner/admin scope |
| POST /api/data-core/content/instagram-sets | requestId UUID and 1-10 unique items (draftId, renderId, fingerprint) |
| GET /api/data-core/content/instagram-sets/:id | Revalidates every original/render and current approval |
| PATCH /api/data-core/content/instagram-sets/:id | Caption only, <=12000 characters |
| POST /api/data-core/content/instagram/:draftId/export | Existing authenticated export; current version required |

Completion validates one campus, one logo and distinct originals; creates a private `instagram-carousel-set` and `instagram.complete-set` audit event in a D1 batch. The user-specific UUID key makes retries idempotent; a reused key with different items returns 409. Generic records APIs cannot forge protected sets/approvals. Existing same-origin mutation and campus authorization checks apply. Foreign campuses return 403, anonymous users 401.

The finalization record uses `mode=user-finalized-set`, without pretending seven removed human checklist items were individually checked. Server image dimensions, source access, permission status and current fingerprint remain enforced. Captions are saved separately from image fingerprints, so caption corrections do not discard approved image downloads.

## Verification

- `npm ci`, build, type check, changed-file ESLint and all 73 public browser JS syntax checks passed.
- Focused API suite: 6/6 passed, including existing single-image compatibility and new 1/5/10 sets, 11 rejection, retry idempotency, original byte preservation, restricted access, 1080 x 1350 decoding and no artwork bytes in text-only requests.
- `scripts/check-instagram-carousel-browser.mjs`: passed at 320/390/768/1024/1440/1920 widths. Actual browser + built Worker + isolated synthetic D1/R2. Only external OpenAI responses are mocked.
- Browser checks: selection 1/5/10/11, deselection, persisted item order, 1/5/10 generation/save, preview/download identity, all artwork corners retained, photo box filled, saved-set reload, clipboard, upstream failure/caption-only retry, shared blog picker, no browser JS errors or horizontal overflow.
- Evidence: `outputs/instagram-carousel/` (ignored local synthetic screenshots and decoded PNG).
- Paid live provider quality, actual campus photo/artwork review and production smoke remain unverified. Mock responses prove application wiring, not live image-model quality.
- Production/main are not deployed or merged by this work. Final full-suite and CI results are recorded in the PR and close-out.

## Reproduction

Run `npm test`, `npx tsc --noEmit`, `npx wrangler deploy --dry-run`.
For browser evidence: `node scripts/check-instagram-carousel-browser.mjs` with Playwright available (or set `PLAYWRIGHT_MODULE` to the installed module path). This new harness supersedes the old single-image Instagram assertions in `check-content-ai-browser.mjs`; that older script documents the previous UI contract.

Official v2 source preparation is reproducible with `node scripts/prepare-instagram-v2-assets.mjs <attachment-directory>`. It uses only the explicitly supplied logo references. Keep all prior brand assets for rollback.
