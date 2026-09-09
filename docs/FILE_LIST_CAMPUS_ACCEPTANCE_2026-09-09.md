# Explicit file-list campus authorization

## Production finding

During Issue #30 acceptance, an authenticated synthetic STAFF session requested
the file list for a campus outside its membership scope. A synthetic-only search
returned HTTP 200 rather than the required HTTP 403. A bounded Wrangler tail
projected only the matching request's response status; credentials, request
headers, response bodies and raw logs were not persisted.

An earlier request in a separate Chrome master session returned 200 as expected
and was excluded from the STAFF acceptance evidence.

## Minimal correction

Both active-file and trash-file listings now call the existing
`requireCampusAccess` guard when the request explicitly specifies `campusId`.
This runs before querying file metadata, including for empty search results.
Requests without a campus filter keep their existing behavior. SUPER_ADMIN and
authorized multi-campus memberships continue to use their permitted scopes.

No schema, bindings, credentials, migrations, file bytes or existing data change.
No admissions mapping or FAMILY pilot/analytics setting changes are included.

## Regression coverage

The real Worker router is tested against isolated Miniflare D1 fixtures:

- STAFF requesting a different campus receives 403 for files and trash.
- Unknown campus IDs receive the same denial, without a file payload.
- Own-campus empty searches, authorized multi-campus users and SUPER_ADMIN work.
- Anonymous requests remain 401; unfiltered requests remain compatible.
- Direct foreign-campus private-file reads remain 403.
- Rejected listings do not change fixture file counts.

The focused regression failed before the fix (200 instead of 403).
Production success must be recorded separately after CI, Preview, merge and
deployment evidence; this document alone does not close Issue #30.
