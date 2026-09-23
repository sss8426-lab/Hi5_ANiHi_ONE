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

## Follow-up: campus logos and input/PNG compatibility

The user reported empty logos after choosing a campus and the save error
`2160 x 2700 크기의 올바른 PNG 이미지만 저장할 수 있습니다.`

- Confirmed: the MASTER landing selection is organization scope (empty campus),
  and neither campus change nor library navigation refreshed logo policy. Both
  paths now refresh it. A stale policy response cannot replace the current campus.
- Render logo buttons independently; one unavailable preview no longer hides
  all five choices. The server remains authoritative for campus access and labels.
- The PNG error was a generic catch for dimensions, PNG chunk types, decompression
  and CRC, not evidence that the input photograph had to be 2160x2700 or PNG.
  The exact rejected user PNG bytes were not supplied. Rather than weaken CRC or
  pixel checks, the compositor now encodes RGB pixels using the same locked codec
  as the server, in a separate browser Worker. Native browser metadata/chunk
  variants are no longer passed through to the strict validator.
- The reviewed-render endpoint accepts up to 16MiB (previously 8MiB), with both
  bounded request reading and per-file checks. Other derivative/AI/thumbnail
  budgets are unchanged. Worst-case detailed synthetic frames above 8MiB pass
  actual workerd validation; corrupted/wrong-dimension outputs still fail.
- Export reuses the validation decode instead of decoding the same master twice.
- Shared raster metadata detection supports PNG, JPG/JPEG, WebP, GIF, AVIF and
  BMP, including common legacy JPEG aliases and generic MIME + image extension.
  Explicit SVG/HTML/document types are not reinterpreted as images. All existing
  source/campus/private permission checks remain. Animated inputs become a still.
- Deterministic auto-fit does not require a direction prompt. Artwork is contained
  without cutting edges; academy-photo mode fills the frame with proportional crop.
  Input safety bounds are 20MiB / 100 megapixels, not unlimited allocation. Phone
  EXIF orientation is decoded by the browser. Outputs are still 2160x2700 masters
  and 1080x1350 downloadable PNGs.
- AI photo correction retains the existing supported JPEG/PNG/WebP and provider
  budgets/consent gates. No key replacement or model change. No paid provider call
  was made in this follow-up; image/caption provider responses in tests are mocks.

Additional browser coverage: MASTER organization -> campus, campus folder navigation,
rapid campus switching with a delayed stale response, six real encoded raster formats
at portrait/landscape/square ratios, prompt-free deterministic generation, and existing
1/5/10 image sets plus downloads/permissions/preview identity. Synthetic only, isolated
D1/R2. No migrations, real-file edits, IDs changed or production content writes.

## Follow-up: AI photo correction

Detailed AI results could exceed the 8MiB limit after a redundant server-side
2160x2700 upscale. Carousel AI intermediates now retain validated provider pixels;
only the final browser composition resizes them. Final master/export contracts,
legacy callers, key/model and original permissions remain unchanged. Reproduction,
protected intermediate metadata and verification boundaries are documented in
`docs/INSTAGRAM_AI_PHOTO_FIX_2026-09-21.md`.

## Follow-up (2026-09-24): automatic captions and user image layers

Caption root cause (reproduced on production data, not assumed):
- The server path was healthy: the exact text-only request for an uncaptioned
  10-photo set returned 200 in ~8s, and the full 3-photo flow captioned itself.
- The caption only started from "완료 및 저장", which stayed disabled unless every
  selected photo succeeded. After partial results became downloadable (#252), a
  single failed photo meant no caption at all.
- A set reopened from "저장한 이미지 세트" with no caption offered no way to write one.
- Failures before/around the request were silent: `policy.campusLogoLabel` was read
  outside the try, and a 401/403 went through `api()`, which wipes the page (and so
  the caption message with it).
- One uncaptioned production set was made from a tab still running pre-#253 code
  (its drafts lack `instagramBatch`); such tabs pick up fixes only after a reload.

Now: when a batch (or a retry) finishes, the finished photos are saved as the set —
failed ones are simply not in it — and the caption is written once for that set.
States: 작성 전 / 작성 중 / 작성 완료 / 작성 실패 / 변경사항 미저장, with [홍보글 작성] /
[홍보글 다시 작성] (text only; images are never redone). Caption calls never go through
`api()`. An empty AI answer is a failure. The automatic write is conditional on the set
still having no text (`previousCaption`), so a late answer or another tab can't overwrite
saved text. `captionSources` records which photos the text was written for.
Assembly order is unchanged: AI body → 고정 마지막 문구 → verified contact → hashtags.

A saved set is now updated in place (`PATCH /instagram-sets/:id` with `items` +
`version`) when retried photos join it or a photo's layers are re-composited; every
item is re-validated like a fresh completion, and a stale version is 409.

나만의 로고 are overlay layers, no longer a replacement for the official logo:
- Chosen images in 양식 수정 go on every photo of the next batch, placed in free space
  beside the artwork when there is room (never over the logo band), otherwise small in
  the bottom-right corner.
- "사용자 이미지 편집" on the result preview: add, drag, resize with a locked ratio,
  front/back, remove; apply to the current photo or all finished photos.
- The browser composites layers into the real 2160×2700 master from a layer-free base,
  so edits never stack. Each apply is a new render (new renderId → a fresh 1080×1350
  export, no stale cache), and no AI call is involved.
- The render stores its layers (id, assetId, assetVersion, x/y/w/h in master pixels,
  z). Only live uploads of the draft's own campus are accepted; a deleted or foreign
  asset is 403, never dropped. Reopening restores the layers. A missing asset is shown
  as a marked box and blocks applying until the user removes it.
- The image list supports rename (`PATCH /instagram-logos/:id`), name search (`q`,
  wildcards literal), 더 보기 paging, and soft delete that never touches finished
  composites.

Also fixed: 이어서 하기 restored at most 10 photos (left over from the old limit);
set/caption JSON bodies were capped at 16KB (a 12,000-character Korean caption is
~36KB), now 64KB.
