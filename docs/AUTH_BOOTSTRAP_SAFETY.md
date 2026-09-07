# DATA CORE auth bootstrap safety

## 목적
최초 마스터 로그인 계정을 만들 때 비밀번호, Cloudflare API token, setup token 같은 credential을 코드/문서/ChatGPT 대화에 남기지 않는다.

## 원칙
- 기본 비밀번호 금지
- `master1234` 같은 샘플 실사용 금지
- GitHub commit/Issue/PR에 credential 금지
- ChatGPT/Codex 대화에 credential 붙여넣기 금지
- production D1에 password hash/salt만 저장
- CLI bootstrap은 interactive stdin 방식 우선
- remote D1 write는 Cloudflare import 경로를 사용하고, hash/salt만 담긴 임시 SQL 파일은 실행 직후 삭제
- temporary password를 발급하는 경우 사용자 브라우저의 authenticated admin UI에 1회만 표시
- server log에 password/session token 출력 금지
- 새 D1/R2/Worker를 auth 작업 때문에 생성하지 않음

## 권장 bootstrap 흐름
1. `wrangler whoami`로 기존 production 계정 인증 확인
2. Windows에서는 `npm run auth:create-master:windows`를 실행하고, 다른 terminal에서는 `npm run auth:create-master`를 실행
3. terminal prompt에서 login ID/password 입력 (Windows wrapper는 `Read-Host -AsSecureString`으로 비밀번호 표시를 막음)
4. script가 locally Worker-compatible PBKDF2-HMAC-SHA-256 hash를 100,000회 반복으로 생성
5. existing production D1 `DB`에 account + SUPER_ADMIN membership 연결
6. raw password를 파일/로그/DB에 저장하지 않음
7. 브라우저 `/login`에서 로그인
8. 로그인 후 필요 시 비밀번호 변경

## 운영 PBKDF2 호환 재설정
Cloudflare Workers의 Web Crypto는 PBKDF2 반복 횟수를 100,000회까지만 지원한다. 이전에 더 높은 횟수로 만들어진 계정은 일반 500 대신 비밀번호 재설정 필요 응답을 받는다.

Windows에서는 `npm run auth:reset-standalone-password:windows`를 실행한다. 로그인 ID와 새 임시 비밀번호는 PowerShell 프롬프트에 직접 입력하며, 비밀번호는 화면에 표시되거나 스크립트 출력에 기록되지 않는다. 재설정 후 첫 로그인에서 다시 비밀번호를 변경한다.

## 실패 시
Cloudflare CLI 인증이 없으면 사용자가 `npx wrangler login`을 실행하고 브라우저 권한 승인만 수행한다. 비밀번호나 API token을 대화창에 전달하지 않는다.
