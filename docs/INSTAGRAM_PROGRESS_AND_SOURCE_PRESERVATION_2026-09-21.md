# Instagram progress and protected-source production

## Scope

- Extends PR #242 on `feat/instagram-carousel`, which already contains the current
  main and the previously reviewed content/calendar/navigation/performance work.
- User approved main merge and production deployment on 2026-09-21.
- The reported source was student artwork. The old server 403 was an intentional
  external-image privacy/artwork gate, not a PNG encoding or provider failure.

## Behavior

- Library metadata includes a server-derived `instagramPreserveReason` without
  changing existing file/folder IDs, records, visibility, or original R2 objects.
- All accessible source images remain usable in Instagram production. Student
  artwork, award work, documents, logos, counseling and explicitly private files
  use contain-fit, original-preserving composition even when Photo/AI is selected.
- Eligible ordinary campus photos retain opt-in external AI correction. Mixed
  selections choose the processing mode per source. Protected-image pixels never
  reach the image provider; captions for mixed/protected selections are text-only.
- Missing legacy metadata defaults to preservation. Server authorization remains
  authoritative; forged client material/consent cannot bypass the protection gate.
- FAMILY, inaccessible campuses/files and private areas are not made public.
- The percentage is completed workflow stages, not an invented provider percentage.
  AI wait holds at its current stage; a single image shows 10% while awaiting AI,
  75% during composition, 90% during persistence, and 100% only after success.
  Multiple images scale those stages across the selected count. Cancel/failure
  retains the last stage; changing inputs resets the progress display.
- The verified existing OpenAI project ID is retained in deployment configuration.
  Admin/generation keys stay in existing Worker secrets, never in source control.
  No budget, spend limit, database, bucket or original file is changed.

## Verification

- Policy unit tests cover photo eligibility and protected categories/visibility.
- Synthetic D1/R2 integration tests check listing metadata and server-side 403
  before any external request, even with forged real-photo material metadata.
- Browser replay covers protected student-private artwork in Photo/AI mode,
  corner-pixel preservation, text-only caption, percentage completion, AI wait,
  cancellation/reset, image sets, formats, download and responsive layout.
- Final local/CI/Preview/production results are recorded in PR #242.
