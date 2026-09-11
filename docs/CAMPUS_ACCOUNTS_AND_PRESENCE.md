# Campus Accounts and Presence

## Compatibility and Ownership

- `MASTER` is equivalent to the existing `SUPER_ADMIN`; existing accounts and passwords are not rewritten.
- `CAMPUS_ADMIN` manages operating records and files in exactly one campus. Legacy roles remain supported.
- Public codes below resolve to existing campus primary keys. No campus or existing data is reassigned.
- Client campus/owner/role fields never grant authority. The authenticated session, stored membership and resource campus are checked by the Worker.
- Common admissions/catalog/knowledge information remains readable, but campus administrators cannot mutate it. Accounts, system settings, backup, restore and permanent file deletion remain master-only.
- FAMILY pilot/consent guards and separate FAMILY_DB/FAMILY_FILES bindings remain unchanged; the role does not activate any campus or send messages.

| Login | Public Code | Existing Campus ID | Campus |
| --- | --- | --- | --- |
| ba | BUCHEON_ANI | campus-anihi-admission | 부천 애니입시관 |
| bd | BUCHEON_DESIGN | campus-design-admission | 부천 디자인입시관 |
| wj | WONJONG | campus-wonjong | 부천원종 |
| bb | BEOMBAK | campus-beombak | 부천범박 |
| jd | JUNGDONG | campus-jungdong | 부천중동 |
| og | OKGIL | campus-okgil | 부천옥길 |
| gj | GWANGJIN | campus-gwangjin | 광진 |
| pj | PAJU | campus-paju | 파주 |
| as | ANSAN | campus-ansan | 안산 |
| us | ULSAN | campus-ulsan | 울산 |

## Admissions Compatibility

The legacy `/api/data`, `/api/upload` and `/api/files` paths require authentication. Unsigned OAI identity headers are accepted only by local/test development hosts, never by production or Cloudflare Preview hosts. Direct access to the packaged default data is master-only.

The existing R2 `state/admissions-data.json` is preserved. Campus changes live in an additive `campus_admissions_state` table in the existing D1 DB, not in a new database/bucket. Unassigned legacy rows remain master-only. Explicitly campus-owned legacy rows are projected into their campus without a migration or copying students to FAMILY. Updates use revision compare-and-swap; stale writes return 409. New numeric IDs have disjoint campus ranges for legacy UI compatibility.

Masters select a campus to edit campus-owned records; the all-campus view combines original data and campus overlays. Campus edits cannot replace universities, settings or admission grade rules. Private browser IndexedDB fallback is disabled to avoid retaining another account's snapshot or falsely reporting an offline save. Operational backups include the additive campus state section when present. Existing backup manifests remain readable.

New artwork uploads use registered DATA CORE authenticated file URLs. Existing legacy artwork read-through retains its stored original references and campus checks. No R2 original is renamed or deleted. Campus award deletion uses soft-trash; the existing master-only permanent-delete flow remains explicitly confirmed.

## Authentication and Provisioning

`scripts/provision-campus-accounts.mjs` defaults to a read-only preflight. `--apply` accepts the authorized ten-account input through stdin. Passwords are never arguments, output or committed fixtures. Existing ID/membership conflicts abort instead of resetting anything. Matching accounts are skipped on repeat execution.

Hashing reuses PBKDF2-HMAC-SHA256, 100,000 iterations, a random 16-byte salt and 32-byte hash. Sessions store SHA-256 token hashes, with Secure/HttpOnly/SameSite cookies. The supplied short bootstrap credentials are accepted only by this one-time provisioning path. First login must change the password to at least 12 characters before accessing protected data; ordinary account creation/reset keeps the existing policy. Account disabling revokes sessions without deleting business data.

## Presence

- `last_login_at` updates only on successful login. Existing audit events supply the latest 20 logins, without adding IP/device collection.
- Existing `auth_sessions.last_seen_at` is updated by `POST /api/auth/activity`, at most once per five minutes per session. Ordinary GET requests do not update presence.
- The client sends activity on trusted interaction while visible, not on an idle interval. Initial visible entry counts as activity.
- `ACTIVE_SESSION_MINUTES = 15` and `HEARTBEAT_MINUTES = 5` live in `worker/campus-directory.ts`.
- Online requires a live, non-revoked, non-expired session with password change completed and active account/user/campus. Idle, disabled and logged-out sessions are offline.
- Master-only `GET /api/auth/campuses` returns ten public campus labels, account management references, last-login/activity timestamps, totals and recent login events. No password, token, hash or student/guardian fields are returned.
- `/data-core/accounts` polls every 60 seconds while visible and on focus; timestamps use Asia/Seoul. Online campuses sort first; offline campuses sort by recent login.

## Validation

`tests/campus-accounts-behavior.test.mjs` uses isolated Miniflare databases/buckets and synthetic accounts. It covers all ten mappings, case normalization, forced change, campus CRUD, global write denial, cross-campus denial, master routes, presence throttling, disable/revocation and original R2 preservation. Existing FAMILY/content/library tests remain regression coverage.

`scripts/check-campus-browser.mjs` uses synthetic local Worker bindings and browser login. It checks the master dashboard at 1920/1440/1280/1024/768, campus header, hidden master navigation and direct-route denial. It never uses production students or operator credentials. `scripts/check-campus-lint-baseline.mjs BASE_SHA` distinguishes new lint errors from inherited lint debt.

The new migration `drizzle/0010_campus_accounts.sql` is additive and idempotent: one new table and presence/audit indexes. It contains no credentials or seeds. Runtime schema initialization is compatible with the current deployment mechanism.
