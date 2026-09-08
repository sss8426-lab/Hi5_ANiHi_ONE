# Dream Family Web Push

Issue #102 adds opt-in Web Push for the guardian PWA. It uses `FAMILY_DB` only.
It does not read, write, or fall back to DATA CORE `DB` / `FILES`.

## Safe defaults

- `/api/family/push/status`, `/subscribe`, and `/unsubscribe` require an active guardian session.
- A guardian who must change their password cannot use the Push API.
- Mutations require same-origin requests.
- Subscription endpoint and browser keys are encrypted at rest. Raw values are not returned, logged, or audited.
- Notice publishing is committed before delivery is attempted. Delivery failure never rolls back a notice.
- The payload is always generic: `꿈이음 새 소식이 도착했습니다.` It contains only an opaque notice id and `/family` route.
- A disabled guardian, a revoked subscription, a guardian without notice visibility, or a guardian blocked by the active consent policy is not a delivery target.
- No Push permission prompt appears at page load. The guardian explicitly presses `알림 받기` in `/family` > `더보기`.

## Production configuration

Until the four settings below exist, the API intentionally reports `push_not_configured` and does not pretend that delivery succeeded. This is the expected production smoke state before an opt-in pilot.

1. `PUSH_VAPID_PUBLIC_KEY`: URL-safe base64 VAPID public key. This can be exposed to the browser through the authenticated status API.
2. `PUSH_VAPID_PRIVATE_JWK`: JSON JWK private signing key. Store only as a Cloudflare secret.
3. `PUSH_VAPID_SUBJECT`: a monitored `mailto:` contact value. Store as a Cloudflare secret or protected environment value.
4. `PUSH_SUBSCRIPTION_ENCRYPTION_KEY`: a randomly generated 32-byte URL-safe base64 key. Store only as a Cloudflare secret. It encrypts subscription endpoint and browser keys in `FAMILY_DB`.

Do not put any of these values in Git, GitHub Issue/PR comments, browser code, D1 rows, logs, or a Worker response. A real Push test also requires a human-operated browser subscription, so it is intentionally separate from CI and this deployment.

## Schema

`drizzle/0007_kkumeum_family_push.sql` is schema-only and is for the isolated `FAMILY_DB` binding. The Worker also performs compatible lazy `CREATE TABLE IF NOT EXISTS` / additive-column setup the first time the Push API or delivery path is used, so deployment alone does not create guardian records or send notifications.
