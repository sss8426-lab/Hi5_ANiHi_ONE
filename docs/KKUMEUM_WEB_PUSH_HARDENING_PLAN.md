# 꿈이음 Web Push 하드닝 계획

실제 VAPID/provider secret 활성화 전에 다음 항목을 코드에서 보완한다.

1. VAPID public/private keypair 일치 검증
2. P-256 JWK 구조 검증 (`kty=EC`, `crv=P-256`, private `d` 존재)
3. VAPID subject를 `mailto:` 또는 `https:`로 제한
4. `configured` 판정을 단순 값 존재 여부가 아니라 실제 키 검증 성공 여부로 계산
5. subscription encryption key fingerprint/version을 저장하거나 최소한 mismatch를 명확히 탐지
6. 현재 기기 subscription 상태와 guardian-level 전체 구독 상태를 UI에서 분리
7. invalid/expired subscription 및 encryption-key mismatch error code를 일반 provider failure와 분리
8. 실제 key rotation 전 기존 subscription 재등록/previous-key 지원 정책 마련

대량 fan-out은 현재 pilot 범위 밖이다. 보호자 수가 늘어날 때 Cloudflare Queue 등 비동기 fan-out을 별도 검토한다.
