# 꿈이음 FAMILY synthetic backup/restore drill

`FAMILY_DB`와 `FAMILY_FILES`만 백업 매니페스트 대상으로 삼는다. 기존 `DB`와 `FILES`는 읽기, 쓰기, fallback 어느 경우에도 사용하지 않는다.

- 상세 R2 key/size/etag는 `POST /api/kkumeum/admin/family-backups/manifest`의 SUPER_ADMIN `private, no-store` 생성 응답에서만 확인한다. 매니페스트와 객체 키는 저장하지 않으며, 감사 로그에는 스키마 버전과 집계된 객체 수·총 바이트만 남긴다. 기존 `/api/kkumeum/admin/family-backups` POST는 같은 생성 동작의 호환 경로다.
- 비밀번호, 비밀번호 hash/salt, 세션 token/hash, 임시 비밀번호와 보호자 연락처는 내보내지 않는다.
- 매니페스트 목록 또는 공개 URL은 제공하지 않으며, 같은 출처의 SUPER_ADMIN POST만 허용한다.
- production overwrite restore API는 제공하지 않는다. 복원 대상은 `KKUMEUM_SYNTHETIC_RESTORE_ONLY` marker가 있는 test/staging 환경만 허용한다.
- `scripts/kkumeum-synthetic-restore-drill.mjs`는 Miniflare FAMILY source/target에 synthetic class, student, guardian link, sent report, artwork, announcement, consent, retention-policy 관계와 파일 1개를 왕복 검증한 뒤 두 객체를 정리한다.
- 내부 guardian closed beta와 1개 campus pilot은 기본 비활성이다. SUPER_ADMIN이 명시적으로 선택한 campus만 활성화할 수 있다.

실제 학생·보호자 데이터 파일럿은 별도 승인, 동의 문구 확정, 내부 beta 기록 및 독립된 synthetic drill 결과가 갖춰진 뒤에만 진행한다.
