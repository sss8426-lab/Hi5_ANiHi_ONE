# Campus Password Recovery (2026-09-21)

## Scope and evidence

The reported campus is Ansan (`as`). Production inspection was SELECT-only and excluded password hashes, salts, session tokens and plaintext passwords. Audit timestamps show a past password change followed by later successful logins; recent failures were followed by repeated administrator updates. These records do not establish that the password hashing algorithm failed. The exact error shown to the user was unavailable.

Confirmed code issues corrected:

- An existing forced-change session blocked POST login before checking the supplied credentials. Credential login now remains available; protected business APIs still require completing the password change.
- An expired lock reused its old failure count, causing immediate relocking after one mistake. Expiration now starts a fresh five-attempt window; the 15-minute lock policy remains.
- The reset button changed credentials immediately and showed the new value far below the campus card. Reset and direct change now require an account-labelled dialog and explicit submission, with duplicate submission blocked.
- Self-change previously saved the hash before revoking/creating sessions and writing audit. These writes now share a D1 transaction so a write failure cannot leave a partially completed change. Administrator changes/revocation/audit are atomic too.

## Master controls

Existing PATCH `/api/auth/accounts/:id` supports `newPassword` (12+ characters) and optional `mustChangePassword` (boolean, default true). This new direct-change mode requires same-origin, authenticated MASTER/SUPER_ADMIN and an organization campus membership on the target. It excludes MASTER/SUPER_ADMIN targets. The existing temporary-password reset contract and last-master/self-revocation protections remain.

The master enters and confirms a new value, can reveal only that current input, and may explicitly uncheck the next-login-change requirement. The default still requires a first change. All old sessions are revoked and failure/lock counters cleared; disabling remains independent. Existing stored passwords cannot be viewed or recovered. No plaintext/reversible password store, password GET endpoint, secret audit metadata, migration, bulk reset or account recreation is introduced.

Closing the dialog clears its secret fields. Password fields cannot change during a pending request. Cancel/open does not issue a credential mutation. Account cards show change-pending/configured/locked status without exposing secrets. The login page supports leaving a pending-change session, identifies the login ID for password-manager association, discards stale session-resume responses after a new login attempt, and clears secrets after successful change.

## Verification

- `tests/campus-password-relogin.test.mjs`: pending-cookie login, exact Unicode/spaced password round-trip, logout/relogin, old-password/session rejection, transaction rollback, master setting, forced-change default, lock recovery, campus/cross-origin rejection, secret-free response/audit and FAMILY sentinel preservation.
- `tests/campus-accounts-behavior.test.mjs`: all ten synthetic campus IDs now explicitly log out and log in again with their changed password. Recent-login expectation is 20 (two successes per campus).
- `tests/login-editorial.test.mjs`: existing login flow plus pending-account identity and switch/secret-clear behavior.
- `scripts/check-campus-password-browser.mjs`: isolated synthetic Worker/D1/R2 only, real browser login/change/relogin and master dialog, duplicate click, reset cancellation, 1920/1440/1024/768/390/320 layouts. Screenshot fields are masked.
- Build/typecheck/public JS syntax, full-suite/CI, Preview and deployment outcomes are recorded in the PR. Do not equate synthetic tests with using the real campus password.

## Operational recovery

MASTER opens campus accounts, selects Ansan **비밀번호 변경**, enters a new 12+ character value twice and submits. To use that value directly, explicitly uncheck **다음 로그인 시 비밀번호 변경 필요**; otherwise the campus completes the next-login change. Confirm completion before sharing it through the academy's approved private channel. Existing values are not recoverable and should not be sent to Codex chat. No real campus or MASTER credential was changed by this implementation task.
