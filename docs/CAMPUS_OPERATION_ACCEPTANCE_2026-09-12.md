# Campus Operation Acceptance - 2026-09-12

## Status and scope

**Partially verified, not production CRUD acceptance complete.** This document does not grant completion to PHASE 2. PHASE 3/4 implementation remains gated by the requested phase order.

- Main reviewed: `0b572d0999b422da1cc60a66c6807aa916b8ca48` (PR #193).
- Confirmed production Worker: `8ea007b5-3a93-48fd-a54e-d2f03c8a5cf7`, 100%, deployment `74cee16a-3d4c-45dc-bc44-7c4d38126369` at 2026-09-12 02:03 UTC.
- Production build: `3bd6f7cf-72d7-4a0b-9643-67d1069dcb03`, successful. This is the verification baseline, not a claim about a future documentation deploy.
- Existing master/campus accounts, credential fields, original business records and R2 objects were not updated. No production account was disabled or reset for testing.

## Production read-only preflight

`node scripts/provision-campus-accounts.mjs` without `--apply`: **existing=10, toCreate=0, dry-run**. Server membership mappings match the existing campus IDs in `CAMPUS_ACCOUNTS_AND_PRESENCE.md`.

An aggregate-only SELECT against existing auth tables confirmed:

| Existing | Active | First password change pending | Prior successful login timestamp present | Live sessions |
|---|---|---|---|---|
| 10 | 10 | 10 | 10 | 0 |

No passwords, hashes, salts, cookies, session IDs, student records or guardian records were read into this document. The preflight did not perform login or update presence.

| Campus | Code | ID | Production mapping | Current operating CRUD |
|---|---|---|---|---|
| 부천 애니입시관 | BUCHEON_ANI | ba | verified | pending first change |
| 부천 디자인입시관 | BUCHEON_DESIGN | bd | verified | pending first change |
| 부천원종 | WONJONG | wj | verified | pending first change |
| 부천범박 | BEOMBAK | bb | verified | pending first change |
| 부천중동 | JUNGDONG | jd | verified | pending first change |
| 부천옥길 | OKGIL | og | verified | pending first change |
| 광진 | GWANGJIN | gj | verified | pending first change |
| 파주 | PAJU | pj | verified | pending first change |
| 안산 | ANSAN | as | verified | pending first change |
| 울산 | ULSAN | us | verified | pending first change |

## Reconciled evidence, not repeated

[PR #191 production evidence](https://github.com/sss8426-lab/Hi5_ANiHi_ONE/pull/191#issuecomment-5638774303) already records actual 10/10 initial uppercase-ID logins, correct roles/campuses, forced-change protected-data denial, zero remaining verification sessions and preserved MASTER credential fields/business counts. This was not rerun or mislabeled as missing. It is not evidence of post-change production CRUD.

## Current synthetic validation

The complete suite on PR #193 passed **332/332**. `tests/campus-accounts-behavior.test.mjs` runs all ten account mappings in ephemeral local Miniflare D1/R2 with synthetic identities only. Its evidence includes:

| Flow | Local synthetic result | Current production result |
|---|---|---|
| Normalized login, first change, correct campus | 10/10 pass | initial login previously proven; first change pending |
| Counseling/work/curriculum/roadmap/library access | 10/10 pass | public route smoke only; authenticated flow pending |
| Own student create/read/update, stale-write rejection | 10/10 pass | not attempted |
| Campus record and file create/edit/soft-trash | 10/10 pass; original object remains | not attempted |
| Other-campus student query / file read-delete / record edit-delete | denied (403, or 404 after synthetic trash) | not attempted after first change |
| Common university read and write denial | pass | not mutation-tested |
| MASTER scoped/all-campus data | pass | current signed-in browser not used |
| MASTER UI/API denial for campus users | pass | anonymous data/presence APIs 401 |
| Last login, last seen, 5-minute throttle, 15-minute online cutoff | pass | read-only timestamps only |
| Disabled login / session revocation / offline | pass | existing accounts not disabled |
| Totals, today count, recent logins, secret-field exclusion | pass | no authenticated production dashboard claim |

`scripts/check-campus-browser.mjs`: **15 checks**, zero page errors at **1920/1440/1280/1024/768**. MASTER dashboard, campus header, hidden master navigation, direct-route denial and Korean-time display use synthetic local Worker bindings. Existing page visibility/focus refresh remains 60 seconds. Screenshots are local synthetic artifacts, not production screenshots.

## PHASE 1 release and preservation

PR #193: GitHub CI run `34666413316` / job `103479080611` all successful. Cloudflare Preview build `33113b51-21fe-4582-94bf-9d93b0d45b1b`, version `68268f2d-f9c6-4e79-9cd5-3f3d0a8d9259`, successful. Preview asset parity: 26 assets; isolated synthetic browser covers EXIF, WebP, five-image bounded generation, original viewer, source byte preservation and new upload. Existing counseling browser: 330 checks at six widths.

Production read-only smoke: counseling/curriculum and campus registry asset 200; admissions entry redirects through existing auth; anonymous `/api/data`, `/api/auth/campuses`, and student thumbnail endpoint return 401.

The read-only admissions audit before/after release produced identical per-domain fingerprints for students, universities, cases, awardFolders and settings. No production thumbnail backfill was run. No file deletion/replacement, D1 migration, R2 binding change, FAMILY operations or student/campus reassignment occurred.

## Remaining exact human action

Each existing campus account holder must sign in at `/data-core/login` and complete the existing first-login password-change form with their own password of at least 12 characters. Do not send passwords or session values to chat, GitHub or logs. This is the normal first-change flow, not an administrator password reset or account recreation.

Once those authenticated sessions are available, resume only the unverified synthetic production CRUD and MASTER acceptance rows above, using TEST_/VERIFY_/SYNTHETIC_ prefixes and soft-trash cleanup. Do not repeat initial-login acceptance or use real students/files. Until then PHASE 2 stays incomplete, and the requested PHASE 3/4 work must not be represented as finished.

## Technical baseline, not PHASE 4 completion

- Full repository lint: 91 inherited errors. Changed-file comparison for PR #193: baseline31/current31/new0.
- npm audit: 12 advisories (4 moderate, 8 high). No forced dependency changes.
- Detailed classification/remediation and counseling-session implementation remain unstarted under the sequential gate.
