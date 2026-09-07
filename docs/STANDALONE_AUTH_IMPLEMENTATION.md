# DATA CORE standalone auth implementation plan

## 목적

`workers.dev` 운영 주소에서 HI5·ANiHi DATA CORE를 실제 학원용 웹앱으로 사용할 수 있도록 독립 로그인/세션을 추가한다.

기존 OpenAI/ChatGPT 인증 헤더 방식은 호환용으로 유지한다.

## 요구사항

### 로그인
- `/login` 또는 `/data-core/login`
- 로그인 아이디 + 비밀번호
- 업무용 화면은 로그인 필요
- 상담용 공개 정보 화면은 개인정보가 없는 범위에서 로그인 없이 접근 가능
- 로그아웃 제공

### 역할
기존 역할 재사용:
- `SUPER_ADMIN`
- `CAMPUS_DIRECTOR`
- `TEACHER`
- `STAFF`

### 계정
- 마스터가 캠퍼스/직원 계정을 생성, 비활성화, 임시 비밀번호 재설정 가능
- 계정은 특정 campus 및 role에 연결
- 공유 캠퍼스 계정도 만들 수 있지만 가능하면 사람별 계정을 허용
- 임시 비밀번호는 생성 시 1회만 표시하고 첫 로그인 후 변경 요구

### 보안
- password 원문 저장 금지
- PBKDF2-HMAC-SHA256 또는 Workers에서 안전하게 지원되는 검증된 KDF 사용
- salt per account
- session token은 cryptographically random
- DB에는 raw session token 저장 금지, hash만 저장
- cookie: Secure, HttpOnly, SameSite=Lax, Path=/
- 안전하지 않은 method는 same-origin/CSRF 검증
- 반복 로그인 실패 잠금
- logout/세션 revoke
- 비활성 계정 즉시 차단
- auth 관련 audit log 기록

### 스키마 제안
- `auth_accounts`
  - id
  - user_id
  - login_id unique
  - password_hash
  - password_salt
  - password_iterations
  - status
  - must_change_password
  - failed_login_count
  - locked_until
  - last_login_at
  - created_at / updated_at
- `auth_sessions`
  - id
  - token_hash unique
  - user_id
  - created_at
  - expires_at
  - revoked_at
  - last_seen_at

필요 시 forward migration으로 추가한다.

### 인증 해석 우선순위
1. 기존 OpenAI authenticated headers가 있으면 기존 identity 사용
2. 없으면 standalone session cookie 확인
3. 둘 다 없으면 unauthenticated

기존 `resolveDataCoreAccess()`의 membership/campus 권한 계산을 재사용한다.

### 최초 마스터 계정 bootstrap
- default password 하드코딩 금지
- password/token을 GitHub/문서/ChatGPT 대화에 남기지 않음
- authenticated Cloudflare CLI 환경에서 실행하는 interactive bootstrap script를 권장
- 예: `npm run auth:create-master`
- terminal stdin에서 login ID/password를 받아 hash만 D1에 저장
- 이미 SUPER_ADMIN local account가 있으면 중복 생성 방지
- script는 기존 production D1 `DB`만 사용하고 새 D1/R2 생성 금지

### 관리자 UI
SUPER_ADMIN에게만:
- 계정 목록
- 로그인 ID
- 캠퍼스
- 역할
- 상태
- 계정 생성
- 임시 비밀번호 재설정
- 비활성화/재활성화
- 세션 전체 로그아웃

### 사용자 UI
- 로그인 화면
- 비밀번호 변경
- 로그아웃
- 현재 로그인 계정/캠퍼스 표시

## 테스트
- master login success/failure
- temporary password change required
- session cookie attributes
- unauthenticated work route redirect/login 안내
- campus account only sees assigned campus
- 다른 campus 파일 접근 차단
- owner delete rule 유지
- SUPER_ADMIN all access
- disabled account rejected
- failed login lock
- logout revokes session
- OpenAI header auth compatibility preserved
- counseling public routes do not leak private/student data
- existing admissions/competition/roadmap/content/readiness smoke tests 유지

## 운영 완료 조건
- main merge + CI success
- production deploy
- 실제 master 로그인 성공
- `/data-core/work/library`에서 캠퍼스 폴더 표시
- 파일 열기/업로드/삭제/복원 실사용 확인
- 계정 1개 생성 후 해당 캠퍼스만 보이는지 확인
- logout 후 protected API 401 확인
