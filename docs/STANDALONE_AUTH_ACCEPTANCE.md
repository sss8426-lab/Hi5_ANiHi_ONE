# DATA CORE standalone auth acceptance criteria

완료는 코드 구현만으로 인정하지 않는다.

## 필수 기능
- 브라우저에서 `/login` 진입 가능
- master 로그인 가능
- 업무용 접근 시 로그인 세션 사용
- 캠퍼스 계정 생성 가능
- 캠퍼스 계정은 지정 캠퍼스만 접근
- 로그아웃 가능
- 비활성 계정 차단
- 비밀번호 변경 가능
- 기존 OpenAI 헤더 인증 호환

## 실제 운영 검증
1. production deploy success
2. master 실제 로그인
3. `/data-core/work/library` 실제 캠퍼스 폴더 표시
4. 파일 업로드
5. 파일 열기
6. 휴지통 이동
7. 복원
8. 캠퍼스 계정 생성
9. 해당 계정으로 로그인해 지정 캠퍼스만 노출
10. 로그아웃 후 protected API 401

## 보안 확인
- raw password DB 저장 없음
- raw session token DB 저장 없음
- cookie Secure/HttpOnly/SameSite
- repeated login lock
- unsafe method origin/CSRF 보호
- audit log
- private/student data unauthenticated 노출 없음
