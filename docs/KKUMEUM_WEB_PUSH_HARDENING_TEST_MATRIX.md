# 꿈이음 Web Push 하드닝 테스트 매트릭스

- valid matching VAPID pair -> configured true
- mismatched public/private pair -> configured false + explicit code
- malformed/non-P256 private JWK -> configured false
- invalid subject scheme -> configured false
- invalid encryption key length -> subscriptionReady false
- current device no subscription but guardian has other-device subscription -> button shows `알림 받기`
- current device subscription exists -> button shows `알림 끄기`
- encryption key mismatch on existing row -> deterministic safe failure, no plaintext/log leakage
- 404/410 push endpoint -> subscription inactive
- provider failure does not roll back announcement
- push payload contains no student/guardian/school/class/report/artwork/R2 data
- all private APIs stay no-store; no generic DB/FILES fallback
