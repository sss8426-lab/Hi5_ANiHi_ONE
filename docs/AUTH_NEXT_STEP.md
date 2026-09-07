# Next work package: standalone login

현재 production Worker는 배포/렌더링/D1/R2 연결까지 정상이다.

하지만 일반 workers.dev 브라우저 요청에는 OpenAI 인증 헤더가 없으므로 DATA CORE 실제 업무 기능을 사용할 수 없다.

다음 작업은 standalone session login 추가다. 구현 기준은 다음 문서를 따른다.
- `docs/AUTH_ARCHITECTURE_GAP_2026-09-07.md`
- `docs/STANDALONE_AUTH_IMPLEMENTATION.md`
- `docs/AUTH_BOOTSTRAP_SAFETY.md`
- `docs/STANDALONE_AUTH_ACCEPTANCE.md`
