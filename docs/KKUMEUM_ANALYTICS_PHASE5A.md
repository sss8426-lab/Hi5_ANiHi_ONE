# 꿈이음 Phase 5A — Privacy-safe aggregate analytics

Issue #111 adds a deliberately narrow analytics bridge between `FAMILY_DB` and DATA CORE.

## Boundary

`FAMILY_DB` remains the source of truth for students, guardians, reports, artworks and private files. The preview API calculates aggregate metrics in memory and never returns student IDs/names, school names, guardian/login/contact data, teacher IDs, report IDs or report/free-text fields, artwork/file IDs, URLs or R2 keys.

Current `growth_points_json` is **not** treated as a safe analytics taxonomy because the report editor currently accepts arbitrary keys/string values. Phase 5A therefore does not aggregate or sync growth-point keys/values. A later phase may add a separate reviewed enum/tag contract before those values can be used analytically.

## Preview

`GET /api/kkumeum/analytics/preview?campusId=...&yearMonth=YYYY-MM`

Allowed:
- SUPER_ADMIN for any accessible campus.
- CAMPUS_DIRECTOR for the director's own campus.

Denied:
- TEACHER / STAFF / guardian.

Returned metrics are campus/month aggregates only:
- active student count;
- missing/draft/ready/sent report counts and completion rate;
- monthly artwork count and average per active student;
- stage breakdown only when **every non-empty stage bucket has at least 5 students**.

If any stage bucket is below the minimum cohort size, the whole stage breakdown is suppressed. This conservative rule avoids exposing a small count through subtraction from the campus total.

All responses are `Cache-Control: private, no-store`.

## DATA CORE sync

`POST /api/kkumeum/analytics/sync`

The runtime flag `KKUMEUM_ANALYTICS_SYNC_ENABLED` is absent/false by default. No production configuration in this phase enables it automatically.

When explicitly enabled:
- SUPER_ADMIN only;
- same-origin mutation;
- server recomputes the aggregate from `FAMILY_DB` instead of trusting client metrics;
- one stable `data_records` row per campus/month/schema version is upserted;
- `record_type=kkumeum-growth-aggregate`;
- `source_app=kkumeum-analytics`;
- campus visibility;
- metadata contains only the preview aggregate payload.

No FAMILY table is created in generic DB and no private FAMILY text or file reference is copied to DATA CORE.

## Audit

Each successful sync adds a FAMILY audit row containing only campus, month, schema version and safe suppression/bucket-count metadata. It does not contain student IDs, report text or file keys.

## Production posture

Read-only preview may be deployed without real-data bulk import or all-campus activation. Keep `KKUMEUM_ANALYTICS_SYNC_ENABLED` disabled until a separate operating decision explicitly approves aggregate DATA CORE sync.
