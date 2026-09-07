# DATA CORE standalone authentication gap

기준일: 2026-09-07

## 확인된 사실

현재 `workers.dev` 운영 배포는 성공했지만 DATA CORE 사용자 인증은 OpenAI/ChatGPT 호스트가 주입하는 아래 헤더에 의존한다.

- `oai-authenticated-user-id`
- `oai-authenticated-user-email`
- `oai-authenticated-user-full-name`

일반 브라우저로 `https://hi5-anihi-one.sss8426.workers.dev`에 직접 접속하면 위 헤더가 존재하지 않으므로 `resolveDataCoreAccess()`는 항상 `authenticated=false`가 된다.

따라서 현재 운영 URL에서는 화면 렌더링과 공개/health 확인은 가능하지만 자료보관함 파일 열기·업로드·휴지통·관리자 기능 등 로그인 권한이 필요한 실제 사용을 완료할 수 없다.

## 결론

이 문제는 배포 실패가 아니라 **standalone 웹앱 로그인 계층 부재**다.

다음 단계는 기존 OpenAI 헤더 인증을 호환용으로 유지하면서, Workers 직접 접속에서도 사용할 수 있는 DATA CORE 자체 로그인/세션을 추가하는 것이다.

## 목표

- 마스터 관리자 로그인
- 캠퍼스별/직원별 로그인 계정 발급
- 기존 역할 `SUPER_ADMIN`, `CAMPUS_DIRECTOR`, `TEACHER`, `STAFF` 재사용
- 서버에서 campus/owner 권한 검사 유지
- Secure/HttpOnly session cookie
- 비밀번호 원문 저장 금지
- 첫 마스터 계정 생성 시 비밀번호/API token을 GitHub나 ChatGPT 대화에 남기지 않는 안전한 bootstrap 흐름
- 상담용 공개 화면과 업무용 로그인 화면의 경계 유지

이 문서는 후속 standalone auth 구현의 근거 문서다.
