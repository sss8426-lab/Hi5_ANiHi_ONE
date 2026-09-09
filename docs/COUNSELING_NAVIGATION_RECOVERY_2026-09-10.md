# Counseling Navigation Recovery

## Scope and evidence boundary

PR171 already verified the three counseling entry cards, live competition news,
gallery lifecycle, four-per-page university links and enriched guideline details.
Those production CRUD/acceptance checks are not repeated. No source sync,
enrichment, DB/R2 writes, schema, bindings, permissions or real-data fixtures are
part of this follow-up. Competition code is unchanged.

This audit targets previously uncovered navigation/recovery edges:

- A guideline deep link reopened its detail dialog after Reset, in both the
  standalone renderer and admissions iframe. A missing deep-link ID also trapped
  subsequent searches in the nonexistent ID filter.
- During a new guideline search, stale previous results remained clickable.
- A transient roadmap request failure required leaving/reselecting the career;
  the same hash could not retrigger loading. A 403 also showed an inaccurate
  temporary-failure message.

Reset/search/filter changes now clear only the guideline deep-link parameter
and ID filter, preserving the current page, other hash parameters and browser
history state. Explicit reload of an unchanged deep link still opens its detail.
New searches remove stale rows immediately; existing cancellation/request-ID
guards keep out-of-order responses out. No query/API contract changes.

Roadmap transient failures offer an in-place retry using the existing read-only
request and cancellation lifecycle. 401 retains the existing login link; 403
shows a permission message, without a retry button or permission workaround.

## Reproduction and verification

`scripts/check-counseling-recovery-browser.mjs` serves only local static files,
blocks external requests and mutations, and supplies synthetic responses. It
does not start a Worker or open a database. Supply PLAYWRIGHT_MODULE pointing at
the available Playwright runtime; Chrome is the browser channel.

Before the fix, six assertions reproduced the reset/search/stale-result/retry/
403 problems. Afterward, both seasons and standalone/iframe variants, delayed
search, 401/403 and transient-retry recovery are checked. Desktop/mobile retry
screenshots are local outputs. Previously completed real-data acceptance is not
repeated. CI/Preview/deployment and read-only production smoke evidence belongs
on the PR after the checks actually complete.
