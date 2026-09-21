# Instagram AI Photo Correction Follow-up

## Reproduction and Cause

The user reported that deterministic modes worked but photo correction / AI failed
with the generic provider-error message. The current main base is
`e5f1eefecb68326acaac2a927aae844e78eb9eeb`; this extends PR #242 without merging it.

The image-edit adapter resized the provider's PNG to a 2160x2700 RGBA master on the
server, even though carousel composition resizes and adds the logo again in the
browser. Its 8MiB cap then rejected valid detailed images. In actual built Worker
code running in workerd, a deterministic 1024x1536 / 4,721,151-byte PNG returned
502 with exactly the reported message. The legacy upscale produces 20,015,677
bytes, over the cap. Earlier tiny flat-image mocks did not exercise this case.

This proves a reproducible application defect, not that the user's unobserved
provider response had exactly the same dimensions or size. The live retry before
the fix produced no upstream-error log; the old normalization catch logged nothing.

## Change

- For the authenticated, consent-checked `carousel-v2` request only, validate and
  retain provider resolution for the AI intermediate. Do not resize/crop twice.
- Keep existing 8MiB provider/input limits, pixel budget, 8-bit RGB/RGBA checks,
  bounded inflation, CRC checking and metadata stripping. No extra paid retry.
- Record actual dimensions and the `provider-resolution` marker. The protected
  derivative reader accepts this bounded shape only for server-created OpenAI
  AI intermediates; source access, campus, deletion, provenance and auth checks
  still run. Final masters and exports retain their strict original dimensions.
- The browser still produces 2160x2700 logo-composited masters and downloadable
  1080x1350 PNGs. Legacy callers retain the previous 2160x2700 normalization.
- Distinguish invalid AI payload from normalization failure using safe error
  codes/messages and logs. Never log keys, image bytes, prompts or raw API errors.

Existing API key/model, source files, IDs, D1/R2 bindings and permissions are
preserved. There are no migrations or production data mutations in automated tests.

## Verification

- `tests/instagram-ai-edge.test.mjs`: actual built Worker in workerd, isolated
  D1/R2 and mocked external API. Detailed intermediate creation/download and
  pixel identity, original bytes, corrupt/oversize rejection, legacy dimensions,
  consent denial, forged metadata and deleted-source protection.
- Browser harness now supplies the detailed image instead of a tiny flat mock
  to photo/AI mode, covering composition, protected read, saving and export.
- Tests establish the application path, not live OpenAI output quality. User's
  live confirmation and final CI/Preview status are reported separately in PR #242.
- Official image edit request contract checked without changing the model:
  <https://developers.openai.com/api/reference/resources/images/methods/edit>.

Main/production are not changed by this follow-up. The preview alias is
`https://feat-instagram-carousel-hi5-anihi-one.sss8426.workers.dev`.

## Live Confirmation and Speed Follow-up

The user retried on the updated preview and confirmed successful generation.
The same live browser visibly advanced through image saving to `1장 제작 완료`
and the final image preview. No claim is made about unobserved downloads or quality.

After that confirmation the user requested faster generation. In addition to the
removed server upscale, the browser now reuses the just-encoded PNG for preview
after successful save, instead of downloading the identical multi-MB master again.
Only one local blob URL is retained; it is revoked on the next frame or invalidation.
History/older slides still use authenticated file reads. Final PNG pixels, model,
quality setting, consent/cost controls and server save validation are unchanged.
The browser harness checks zero redundant master GETs and blob URL cleanup.
This reduces application overhead, not the OpenAI model's own inference time.
