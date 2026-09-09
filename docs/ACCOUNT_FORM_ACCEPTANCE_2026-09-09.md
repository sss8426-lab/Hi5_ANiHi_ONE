# Account form acceptance continuation

## Regression

The account-create submit handler accessed `event.currentTarget` after awaiting
the create API. Browser dispatch clears `currentTarget` before that continuation.
The server could create the account successfully but the UI then failed to reset
the form or reload the list, presenting a misleading error.

Capture the form during synchronous dispatch and use that reference after the
request. Version the browser asset. No API, authentication, binding, schema or
data-policy changes.

`tests/accounts-form.test.mjs` executes the actual browser script with synthetic
DOM/API fixtures. It clears `currentTarget` before the response resolves and checks
both successful creation and API rejection. The success test fails before the
fix and passes afterwards. These tests do not access production or real accounts.

## Production acceptance boundaries

- The existing master login and synthetic file upload/search/open/trash/restore/
  reopen/final soft-trash cleanup were verified separately in the live browser.
- The completed operational backup manifest was read in memory only. Schema v2,
  3,990 rows, registry match and section-count sum were verified. Identity tables
  and audit logs were excluded. Payloads and private object keys were not logged.
- A dedicated empty synthetic campus was added for the requested account audit;
  existing campuses/accounts were not changed. FAMILY activation was not enabled.
- The new restricted STAFF account form is prepared, not submitted. Account
  creation, first-password change, other-campus rejection, disable and session
  revocation still require actual production verification. Do not close #30.
- Backup integrity here means manifest validation, not a restore drill.

This document is not a deployment-success claim. Record CI, preview and production
evidence in the PR only after those services report success.
