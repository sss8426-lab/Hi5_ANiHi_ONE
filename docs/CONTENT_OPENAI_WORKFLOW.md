# Blog / Instagram OpenAI Workflow

## Scope and Deployment Gate (2026-09-13)

Extends existing provider contract, drafts, library folders and Instagram derivatives. No migration, new bucket, account change, folder re-creation, original replacement or FAMILY modification.

Two name-only production checks (default and explicit Worker `hi5-anihi-one`) returned five secret names, with **no OpenAI secret**. Values were not retrieved. No key was created, rotated, removed or committed. Until an administrator connects their existing key as `OPENAI_API_KEY`, model access, live generation, quality and billing remain **unverified**. Synthetic adapter tests are not production OpenAI acceptance.

## Teacher Workflow

- Both pages and the library browser share `library-client.js` and existing `/api/data-core/library/folders` / `library/files` endpoints. Folder IDs, server order, nested breadcrumbs, scopes and thumbnails remain authoritative.
- Photos first: six for blog, one representative original for Instagram. Documents are not selectable. Selection survives folder pages; changing campus resets it.
- One command, campus hashtags/footer, one explicit AI command. No paid calls on load, refresh, photo selection or defaults editing.
- Editable title/body/hashtags/CTA. Default hashtags are merged locally; fixed footer is retained without sending campus contacts to OpenAI.
- Instagram saves the normalized image before caption generation. Caption failure preserves that image; caption-only retry does not rerun paid editing.
- Copy, draft save, compare and authenticated download are explicit. Nothing publishes to Naver/Instagram.
- Manual drafting and deterministic crop editor remain collapsed. Existing drafts/status/purpose/search remain under “지난 작업” and draft details; legacy CTA metadata remains readable.

## Provider and Limits

Worker-only `OPENAI_API_KEY`. Central `aiModels` respects `OPENAI_TEXT_MODEL` (legacy `OPENAI_MODEL`) and `OPENAI_IMAGE_MODEL`. Documented defaults: `gpt-5.6-luna` and `gpt-image-2.5-flare`; account access is not assumed.

- Responses endpoint: selected sanitized R2 bytes as base64 `input_image`, low detail, `store:false`, strict JSON schema, 4,000 output tokens. Filenames, internal IDs, campus context and R2 keys never enter provider payloads.
- Image Edit endpoint: actual selected image in multipart with anonymous filename; one medium-quality PNG requested at 1024x1536. No automatic paid retries.
- Response bounds: 128KiB text / 12MiB image JSON; image <=8MiB and <=4,194,304 output-input pixels before bounded decompression. Timeouts: text 90s, image 180s. Client abort stops waiting but cannot guarantee cancellation/refund of accepted provider work.
- Product budget: six photos, <=8MiB each, <=16MiB total. This is **not** the platform maximum. Current official vision guidance lists 512MB / 1,500 images; those maxima do not fit this bounded Worker/teacher workflow. Low detail and conservative byte/pixel budgets are exercised by synthetic tests; live throughput/quality awaits credentials.
- PNG strips text/EXIF; rotated-EXIF PNG and animated formats fail closed. JPEG/WebP retain only a fresh orientation-only EXIF block, not original metadata/GPS. Originals are untouched.
- Image Edit output is checked, center cover-cropped, resized with Pica pure JS, and encoded with existing fast-png to 2160x2700, 4:5. No image binding/billing change. Prompt guards cannot guarantee identity/artwork fidelity: teacher comparison remains necessary.

Official references checked September 13:

- [Vision requirements](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Image generation/editing](https://developers.openai.com/api/docs/guides/image-generation)
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT Image 2.5 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
- [Pica resizeBuffer](https://github.com/nodeca/pica)

## Authority, Storage and Cost Guard

- Mutations require authenticated writer and exact same-origin. Selection reuses `canReadRegisteredFile`, including restricted/deleted library ancestry, plus campus checks. Only selected FILES objects are read for AI.
- Reuses `persistImageDerivative`, rechecking source before commit; inherits source campus/owner/visibility, ignoring client flags.
- Existing `instagram-derived-file` metadata accepts deterministic `instagram-4x5` or server-created `instagram-ai-edit`. AI adds provider/model/generatedAt/aiEdited while retaining schemaVersion, createdBy, IDs and dimensions. Generic mutations cannot forge/change reserved provenance.
- `content-defaults` records use deterministic channel/campus IDs and existing JSON metadata. Dedicated GET/PUT validates scope; generic mutations are blocked.
- `content-ai-request` records provide atomic per-user leases and request-ID deduplication across isolates. No prompt/photo/key/provider response is retained. Completed/failed leases are soft-trashed; their unique IDs remain to prevent duplicate charges. Processing leases expire after five minutes if a Worker dies.
- Safe Korean errors and allowlisted categories only. No raw provider body, authorization, image or prompt logging. MASTER diagnostics show configured/model names only, not key fragments or a fabricated healthy probe.

## Verification and Remaining Gate

Local gates: npm ci, build, typecheck, all 57 public JavaScript syntax checks, targeted ESLint, 355 tests, frozen pnpm lockfile and Wrangler dry-run passed. Cross-service synthetic browser regression passed 1,479 checks at seven widths with no page/console errors or broken assets. Library folder/thumbnail regression also passed. No production business-data mutation was used for these checks.

`tests/content-openai.test.mjs`: real built Worker + isolated Miniflare D1/R2 with intercepted provider responses. Covers selected image payloads, schema parsing, edit contract, EXIF/orientation, campus/defaults/drafts, private/cross-campus denial, deduplication, provenance, original bytes/rows, dimensions, authenticated read and soft trash.

`tests/content-ai-runtime.test.mjs`: 1024x1536 synthetic portrait normalization inside actual workerd, without browser globals. Concurrent different request IDs and six-photo/byte budget tests check cost guards without paid requests.

`scripts/check-content-ai-browser.mjs`: isolated APIs at 1920/1440/1280/1024/768/390/320; both flows, editing, defaults, copy/save, representative selection, compare and downloaded PNG dimensions. Mock responses exist only in the local harness and are never deployed as fallback.

`--preview <origin>` additionally checks deployed asset bytes against the checkout. All authenticated API fixtures and mutations remain isolated locally; this is not live Preview/provider or production data acceptance. Manual deterministic save is covered without OpenAI calls.

Production smoke is credential-gated: new synthetic source only; verify text/image access, persisted derivative and download, then soft-trash exact synthetic draft/output/source. Never real student photos, existing folders or account changes. Missing Preview secrets must show genuine unavailability.
