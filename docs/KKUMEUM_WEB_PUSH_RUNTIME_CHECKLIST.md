# 꿈이음 Web Push 운영 체크리스트

이 문서는 실제 Web Push secret을 production에 넣기 전/후 확인할 런타임 안전 기준을 기록한다.

## 현재 production env 계약

- `PUSH_VAPID_PUBLIC_KEY`: 브라우저에 전달되는 공개 VAPID 키. secret 아님.
- `PUSH_VAPID_PRIVATE_JWK`: P-256 ES256 private JWK. Cloudflare secret.
- `PUSH_VAPID_SUBJECT`: `mailto:` 또는 `https:` VAPID subject.
- `PUSH_SUBSCRIPTION_ENCRYPTION_KEY`: 32-byte random key를 base64url(no padding)로 인코딩. Cloudflare secret.

private JWK와 subscription encryption key는 Git/Issue/로그/스크린샷/명령행 인자로 노출하지 않는다. `wrangler secret put`의 stdin prompt로만 입력한다.

## 활성화 전 확인

1. VAPID public key가 65-byte uncompressed P-256 public point인지 확인한다.
2. private JWK가 P-256/EC signing key인지 확인한다.
3. public key와 private JWK가 같은 keypair인지 검증한다.
4. subject가 `mailto:` 또는 `https:` 형식인지 검증한다.
5. subscription encryption key가 정확히 32 bytes인지 확인한다.
6. encryption key는 이미 저장된 subscription이 생긴 뒤 임의 교체하지 않는다. 새 구독 row에는 non-secret SHA-256 key id가 기록되며, 일치하지 않는 row는 `subscription_key_mismatch`로 안전 실패한다. 기존 key id 없는 row는 현재 key로 한 번의 복호화/전송이 성공했을 때만 key id를 backfill한다.
7. provider 설정이 일부만 존재할 때 `configured=true`로 표시하지 않는다.

## 운영 smoke

- guardian-authenticated `/api/family/push/status` => `subscriptionReady=true`, `configured=true`.
- 보호자 PWA는 사용자가 `알림 받기`를 직접 눌렀을 때만 permission prompt.
- 실제 browser subscription 전에는 push delivery 성공으로 보고하지 않는다.
- test notification payload는 `꿈이음 새 소식이 도착했습니다.` 등 generic text만 사용한다.
- 학생/보호자 이름, 학교/반, 평가 전문, 작품 URL, R2 key는 push payload에 넣지 않는다.

## 구독 상태 의미

서버의 guardian-level active subscription 존재 여부와 **현재 브라우저 기기의 PushSubscription 존재 여부는 다르다**. UI는 현재 기기의 `registration.pushManager.getSubscription()`을 기준으로 버튼 문구를 결정하고, 서버는 계정 단위 active subscription 집계와 endpoint ownership을 검증한다.

## 키 회전

초기 production에서는 subscription encryption key를 안정적으로 보존한다. key id는 회전 감지와 안전 실패를 위한 것이며, 자체로 previous key를 복구하거나 plaintext를 노출하지 않는다. 회전이 필요하면 current/previous key를 제한된 기간 지원하거나 기존 구독을 명시적으로 revoke하고 재구독을 요청하는 운영 절차를 먼저 승인한 뒤 수행한다.
