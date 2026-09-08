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
- The PWA button reflects the subscription on the **current browser/device**. A subscription on another device does not make this device show `알림 끄기`.

## Production configuration

Until the four settings below exist, the API intentionally reports `push_not_configured` and does not pretend that delivery succeeded. This is the expected production smoke state before an opt-in pilot.

1. `PUSH_VAPID_PUBLIC_KEY`: URL-safe base64 VAPID public key. This can be exposed to the browser through the authenticated status API.
2. `PUSH_VAPID_PRIVATE_JWK`: JSON JWK private signing key. Store only as a Cloudflare secret.
3. `PUSH_VAPID_SUBJECT`: a `mailto:` or `https:` VAPID subject. Store as a Cloudflare secret or protected environment value.
4. `PUSH_SUBSCRIPTION_ENCRYPTION_KEY`: a randomly generated 32-byte URL-safe base64 key. Store only as a Cloudflare secret. It encrypts subscription endpoint and browser keys in `FAMILY_DB`.

Runtime configuration is fail-closed. The Worker validates that the public VAPID key is an uncompressed P-256 point, that the private JWK is an importable `EC` / `P-256` signing key with `d`, `x`, and `y`, and that the public bytes exactly match the private JWK's public coordinates. Invalid or mismatched material returns a secret-free configuration code and never reports the provider as configured.

`PUSH_VAPID_PUBLIC_KEY` is intentionally returned by the authenticated status API because the browser needs it to create a subscription. Do not put the private JWK, subscription encryption key, or their raw derived values in Git, GitHub Issue/PR comments, browser code, D1 rows, logs, or a Worker response. A real Push test also requires a human-operated browser subscription, so it is intentionally separate from CI and deployment verification.

## Subscription encryption-key rotation

`PUSH_SUBSCRIPTION_ENCRYPTION_KEY` protects the stored endpoint, `p256dh`, and `auth` values. Once subscriptions exist, **do not replace this secret casually**.

- Each new/refreshed subscription stores only a short SHA-256-derived `encryption_key_id`. It is a non-secret identifier; the raw encryption key is never stored in D1.
- Delivery compares the stored identifier to the active secret before decrypting. A mismatch produces `subscription_key_mismatch` and leaves the subscription record intact for safe re-enrollment or a future planned migration.
- Legacy rows whose identifier is `NULL` may be decrypted once with the current key for compatibility. A successful verified use backfills the identifier.
- A decryption failure is recorded as a generic `subscription_decrypt_failed`; encrypted endpoint/key material is never logged.
- A future real key rotation should use an explicit previous-key / re-enrollment migration strategy. This implementation does not silently rotate or destroy existing subscriptions.

## Schema

`drizzle/0007_kkumeum_family_push.sql` creates the encrypted subscription/delivery foundation for the isolated `FAMILY_DB` binding. `drizzle/0008_kkumeum_push_key_id.sql` adds only the non-secret encryption-key identifier. The Worker also performs compatible lazy `CREATE TABLE IF NOT EXISTS` / additive-column setup the first time the Push API or delivery path is used, so deployment alone does not create guardian records or send notifications.
