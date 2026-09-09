# FAMILY shell freshness

Issue #43 production acceptance found an existing PWA install serving an old
cache-first HTML shell without `family-growth-labels.js`, although the deployed
HTML included it. The report could render without its confirmation button.

The v3 shell cache includes that script and revalidates allowlisted static shell
requests online. Network failures may use only the current FAMILY shell cache.
HTTP failures remain failures. Cache keys exclude query parameters, and cache
activation removes only obsolete `kkumeum-family-shell-` caches.

All `/api/` requests remain network-only. Student images, reports, authentication,
subscriptions and other private responses are never cached. No D1/R2 data,
bindings, credentials, pilot settings or analytics flags change with this fix.

Existing installs receive the updated service worker through normal registration
and navigation. After activation, reload the PWA to render the fresh shell.
Registration uses `updateViaCache: 'none'`; no subscription reset is required.

`tests/kkumeum-family-shell-cache.test.mjs` exercises installation, scoped cache
cleanup, stale HTML/scripts, offline fallback, HTTP failure and API isolation
with synthetic in-memory responses only. Production acceptance is recorded in
Issue #43 separately; passing these tests is not proof of device notification
receipt or guardian read confirmation.
