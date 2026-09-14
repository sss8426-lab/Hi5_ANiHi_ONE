# Blog / Instagram OpenAI Workflow

## Production Acceptance (2026-09-14)

- Source baseline: `1ea3db84e1e0e12663c8cfbb57efe7ad2de3729d`. Worker tested: `58a9cc6c-783c-4091-b3e8-57b7fbe3c7e8` (100%, deployed 2026-09-14 05:33 UTC).
- Credential presence: **yes**. `wrangler secret list --name hi5-anihi-one` and the MASTER diagnostic confirmed `OPENAI_API_KEY` is configured. No value, fragment, authorization header, or session token was retrieved or recorded. The administrator registered the secret; this check did not create or rotate it.
- Configured models: text `gpt-5.6-luna`, image `gpt-image-2.5-flare`. Configuration is not proof of account/model access.
- Exactly one Instagram image-edit action and one separate blog text action were executed through the authenticated production UI. Instagram failed before its automatic caption step, so the separate blog action did not duplicate a Responses call. No retry was performed.
- Input was a new 256x320 synthetic PNG containing only a blue circle and red rectangle (1,963 bytes), plus a fictional academy announcement/edit instruction. No real student image, identifying text, existing default setting, folder, account, or business record was changed.
- **Image smoke: failed. Text smoke: failed.** Both showed the safe provider-error message, not generated content. The deployed adapter maps that message to `provider_error` / Worker HTTP 502; the raw network status and upstream OpenAI status were not independently captured. Do not interpret this as a confirmed authentication, quota, or model-access error.
- Read-only request-lease evidence: two failed requests, both automatically soft-trashed. Image job ran 05:43:05.437-05:43:05.901 UTC (about 0.46s); the two jobs averaged 0.76s. These are Worker job durations, not measured provider-only latency. Neither hit the configured 90s/180s timeout.
- No generated image or draft was saved. Thus live normalization, 2160x2700 output, provenance, comparison and generated-file download remain **not accepted**. Existing isolated contract tests cover those paths, not live model behavior.
- Synthetic source bytes were read back from R2 and SHA-256 matched the uploaded local PNG. The source was then moved to the normal recoverable trash; no R2 object was permanently deleted. No business data was used for cleanup.
- Next diagnostic must distinguish provider transport, upstream status and output-validation failures using allowlisted codes only. Current safe error handling intentionally discards upstream details, so the cause remains **unconfirmed**. Do not reset the key or billing based on this generic message. Any new paid probe must respect the user's one-call-per-endpoint limit for this run.
- Baseline: npm ci/build/typecheck, 382 tests, all 64 public JS syntax checks and Wrangler dry-run passed. Existing lint: 89 errors; audit: 12 findings (8 high, 4 moderate). No runtime/dependency/schema changes in this acceptance update.

## Scope and Previous Gate (2026-09-13)

Extends existing provider contract, drafts, library folders and Instagram derivatives. No migration, new bucket, account change, folder re-creation, original replacement or FAMILY modification.

Historical state: two name-only production checks on September 13 returned five secret names, with **no OpenAI secret**. This missing-secret gate is superseded by the September 14 result above. Synthetic adapter tests are not production OpenAI acceptance.

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

Production smoke uses a new synthetic source only. Credential presence was confirmed September 14, but both live actions failed as recorded above. Future authorized verification must still check the persisted derivative and download, then soft-trash exact synthetic draft/output/source. Never use real student photos or change existing folders/accounts. Missing Preview secrets must show genuine unavailability.
