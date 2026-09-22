# Library Navigation and R2 Usage

## Scope and Preservation

Based on main `5c4e674999f32c671b813dd95a4f97f3eaf4e98a` (merged PR #242).
The `libraryHq` toolbar link is removed. Server-resolved HQ lineage carries
`navigationHidden`; the shared library/blog/Instagram client omits those folders
and resolves old HQ navigation to the library root. Recent uploads exclude that
same lineage. Campus/custom folders with identical names remain visible.
The script `hq-library.js` remains the normal library implementation.

No migration, folder/file rewrite, ID replacement, R2 listing, object deletion,
bucket change or permission expansion. Direct authorized file reads/downloads,
trash/restore and historical folder APIs remain available. Display hiding is not
an authorization rule. Existing private, director-only and FAMILY ACLs remain.

## Sources and Accounting Contract

Official documentation verified 2026-09-22:

- [R2 Metrics and Analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/):
  `r2StorageAdaptiveGroups` latest `dimensions.datetime`, `max.payloadSize` and
  `max.metadataSize` per bucket. Seven-day bounded lookback, at most 24 samples
  per bucket, latest valid sample only. No sum across timestamps.
  `r2OperationsAdaptiveGroups` exposes operations and `sum.requests`; its query
  was checked read-only but is not converted to estimated billable requests.
- [Billable Usage info v1](https://developers.cloudflare.com/api/resources/billing/subresources/usage/methods/get_account_usage_info_v1/):
  verify coverage and subscription IDs/anchors.
- [Billable Usage v1](https://developers.cloudflare.com/api/resources/billing/subresources/usage/methods/get_account_usage_v1/):
  omitted dates request provider-current billing periods. Filter exact R2 family,
  validate account, subscription, period and currency. Sum daily ContractedCost,
  never CumulatedContractedCost. Repeats are deduplicated; inconsistent duplicate
  identities fail closed. Distinct correction classes remain separate.
- [Billable Usage dashboard](https://developers.cloudflare.com/billing/manage/billable-usage/):
  ongoing, daily-updated metered charges, not a final invoice or fixed plan fees.

`BillingPeriodEnd` is explicitly absent in the v1 schema. We show provider-supplied
start/charge-through and label the end unavailable. Subscription cancellation end
is NOT substituted for billing-period end. Multiple subscriptions/currencies stay
separate in details; no currency conversion. No R2 rows/missing cost is not zero.
Zero appears only from validated rows/snapshots. Partial storage has no complete
total; details show available bucket values and timestamps, including >24h delay.
GB = bytes / 1,000,000,000; GiB = bytes / 1,073,741,824. Metadata bytes are separate
from the displayed object payload. No D1 file-size fallback is presented as R2.

No pricing estimate is computed: storage-class/time/GB-month history, account-wide
free-tier allocation and chargeable request history are not sufficiently known.
There is therefore no speculative tariff, exchange rate or current-GB multiplication.
Aggregation version is `2026-09-22-v1`; v2 is not a cost fallback.

## Scope and Configuration

`CORE 연결 R2 저장량` includes physical `FILES=anihi-admissions-images` and
`FAMILY_FILES=hi5-anihi-family-files`, verified against Vite-generated Wrangler
bindings. Duplicate names are collapsed. Logical DATA CORE areas are not buckets.
`Cloudflare 계정 전체 R2 비용` explicitly covers the wider Cloudflare account,
including other buckets/projects. It is not attributed to the current folder.

Non-secret Worker vars in `wrangler.jsonc`:

- `CLOUDFLARE_USAGE_ACCOUNT_ID`: existing deployment account.
- `CORE_R2_USAGE_BUCKETS`: comma-separated physical bucket names above.

Required server-only secret: `CLOUDFLARE_USAGE_API_TOKEN`.
No equivalent existing runtime secret was found. Existing OpenAI secrets unchanged.
Register a dedicated read-only credential in Cloudflare Dashboard > Workers & Pages
> target Worker > Settings > Variables and Secrets > Secret. Configure the intended
production and Preview Worker independently if Preview is a separate Worker.
Analytics needs Account Analytics Read for this specific account. Billing read
support/credential permissions must be verified separately against both v1 endpoints.
Do not grant write/delete, use Global API Key, paste secrets in chat, or copy local
deployment OAuth credentials into runtime. Token issuance/scope expansion requires
the account owner's action; this change does not create or rotate tokens.

Read-only live diagnostic (`node scripts/check-r2-usage-connection.mjs`) on 2026-09-22:

- Existing local Wrangler auth: GraphQL HTTP 200, storage and operations groups read.
- Billable Usage info and usage v1: both HTTP 403, error code 10000.
- Runtime usage secret absent. App integration is **not connected**; shows setup
  required, not a fabricated zero. Local Analytics success is not runtime success.
- No raw key/provider error text is logged; no settings or billing writes performed.

After registration, verify both authenticated `/api/data-core/library/usage/storage`
and `/api/data-core/library/usage/billing`, dataset scope/timestamps, subscription
IDs, currency, no-data vs zero, and a second cached call. Do not declare billing
connected until the actual account responds with a validated contract.

## Authorization and Performance

MASTER/SUPER_ADMIN only, checked server-side before cache/config access.
Anonymous 401; campus/admin/director/teacher/staff/outsider 403. Generic record
read/mutation APIs reject `library-r2-usage`; no token stored in these records.
HTTP responses are `private, no-store`, not CDN cached.

Storage and billing use independent endpoints, background UI requests and 15-minute
D1 caches. A scoped current-query locator points to a version/account/buckets/kind/
provider-period-key snapshot. Currency/subscription/start are part of the period
fingerprint. Last-good data survives midnight and provider failure, labeled stale.
An atomic 45-second D1 lease coalesces cross-isolate work; in-isolate promises also
coalesce. Provider timeout 12 seconds/request; response cap 4 MiB. Failures back off
15 minutes. A lease contender can poll metadata at most six times (5 seconds apart),
never loop endlessly. Folder refresh never forces stats refresh. Leaving the view
aborts requests and prevents old UI updates. No stats re-fetch on folder navigation.

## Verification

- `npm ci`, build, TypeScript, 82 public browser JS checks and Wrangler dry-run pass.
- 33 focused API/regression tests pass: read/write roles, original byte and ID
  preservation, same-name campus folders, HQ deep links, upload/download/move/trash/
  restore, parallel file-first rendering, exact zero/missing/partial/stale, cost
  deduplication, generic cache protections and cross-binding D1 lease coalescing.
- Existing synthetic library browser suite passes six sizes, upload eight files,
  JPEG/PNG/WebP/AVIF/GIF/PDF handling, lazy max-3 image loading and 304 revalidation.
- Usage browser suite tests 320/390/768/1024/1440/1920 widths, long numeric values,
  dialogs, no overlap/overflow, HQ redirect and 30 SPA folder moves without extra
  stats requests. All writes use disposable local synthetic D1/R2 only.
- Full Windows `npm test` encountered local Miniflare RPC `EADDRINUSE` while several
  large suites were active; stopped instead of reporting false success. The genuine
  file-first regression exposed by that run was fixed and focused tests rerun.
  Full Linux CI and final deployment evidence are recorded on the PR.

Performance harness: `scripts/library-usage-smoke.mjs --baseline` serves origin/main
assets; current mode serves changed assets. Both use the same isolated API/data and
in-memory asset serving after one warm-up. Five navigations, median, no production
speed claim. Statistics are deliberately delayed 3500ms. JSON/screenshots are in
ignored `outputs/library-usage/`; deployment/CI evidence is separate.
Controlled local medians: baseline 311.8ms, changed 263.6ms (five measured runs
each). Normal run-to-run variation applies; the verified property is that folder
display does not wait for the 3500ms statistics delay, not a production speedup.
