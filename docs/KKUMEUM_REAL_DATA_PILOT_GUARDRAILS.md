# 꿈이음 실제 데이터 파일럿 가드레일

## 목적
꿈이음은 학생 작품, 월간평가, 보호자 계정과 공지를 다루므로 `FAMILY_DB`/`FAMILY_FILES` production 연결 직후 곧바로 전체 캠퍼스 실제 데이터를 넣지 않는다.

이 문서는 코드 구현 완료와 실제 학생/보호자 데이터 운영 사이의 필수 검증 단계를 정의한다.

## 1. 파일럿 원칙
- 첫 파일럿은 1개 캠퍼스, 최소 학생/보호자 수로 제한한다.
- 실제 데이터 투입 전 학원 내부에서 수집항목, 이용목적, 열람대상, 보유기간, 삭제요청 대응방식을 확정한다.
- 불필요한 개인정보를 수집하지 않는다.
- 학생 작품/사진은 FAMILY_FILES에만 저장하고 public URL을 만들지 않는다.
- 보호자에게는 연결된 자녀의 `sent` 정보만 보여준다.
- AI 초안은 교직원 검토 전 보호자에게 자동 전송하지 않는다.

## 2. 보호자 동의/고지 상태 모델
FAMILY_DB에 동의 기록을 별도 저장한다.
권장 최소 필드:
- id
- student_id
- guardian_id
- consent_type
- version
- granted_at
- revoked_at
- source

동의 상태가 필요한 기능은 서버에서 검증한다. UI 체크박스만으로 권한을 결정하지 않는다.

## 3. 수집 최소화
초기 파일럿 필수 후보:
- 학생 표시명/이름
- 캠퍼스/반/학년
- 작품 이미지
- 월간평가
- 보호자 로그인 ID/표시명

선택 정보는 실제 운영 필요가 확인되기 전 수집하지 않는다.
학교명, 생년, 전화번호, 이메일은 각각 별도 목적이 있을 때만 사용한다.

## 4. 보유기간/삭제
데이터 종류별 정책을 설정 가능한 값으로 관리한다.
- 보호자 세션: 짧은 만료 + revoke
- 탈퇴/졸업/퇴원 학생: 운영정책에 따른 보존 후 삭제/비식별화
- soft delete 상태와 실제 purge를 구분
- FAMILY_FILES purge 시 DB metadata와 R2 object를 함께 감사로그에 기록

사용자 UI에서 임의 purge를 허용하지 않고 초기에는 SUPER_ADMIN 전용으로 제한한다.

## 5. 백업/복구
실제 파일럿 전 아래를 검증한다.
- FAMILY_DB schema/metadata backup 절차
- FAMILY_FILES 객체 목록/무결성 검증 절차
- 복구는 운영 DB에 바로 덮어쓰기 전에 별도 검증단계
- 백업에 raw password/session token을 포함하지 않음
- restore drill은 synthetic data로 먼저 수행

## 6. 보호자 계정 발급
공개 signup은 만들지 않는다.
- SUPER_ADMIN 또는 own-campus CAMPUS_DIRECTOR만 발급
- 임시비밀번호는 생성/재설정 응답에서 1회만 표시
- DB에는 PBKDF2 hash/salt만 저장
- 첫 로그인 비밀번호 변경 강제
- 계정 비활성화 시 기존 guardian session revoke
- 학생 연결/해제는 audit

## 7. 파일럿 체크리스트
### 기술
- `/api/kkumeum/health` 200
- FAMILY_DB/FAMILY_FILES 둘 다 ready
- generic DATA CORE DB/R2에 family table/object 없음
- cross-campus staff 접근 403
- guardian cross-child 403
- private image no-store
- PWA API network-only
- backup/restore synthetic drill 완료

### 운영
- 파일럿 캠퍼스 지정
- 담당 관리자/교사 지정
- 보호자 안내/동의 문안 승인
- 수집항목 확정
- 삭제/정정 문의 담당자 확정
- 장애 시 수동 연락 대체 절차 준비

## 8. 파일럿 단계
1. synthetic staff/class/student/guardian end-to-end
2. 내부 직원이 보호자 역할을 한 closed beta
3. 승인된 소수 실제 보호자
4. 2~4주 운영 후 오류/문의/권한 로그 검토
5. 문제 없을 때만 추가 캠퍼스 확대

## 9. 금지
- 파일럿 검증 없이 전 캠퍼스 일괄 실제 데이터 업로드
- 학생/보호자 정보를 일반 DATA CORE 검색에 원문 노출
- 공개 R2 URL
- 보호자 간 다른 학생 존재 여부를 유추할 수 있는 오류 메시지
- AI가 생성한 평가를 교사 검토 없이 자동 발행
- 비밀번호/token/연락처를 GitHub 로그·Issue·감사 metadata에 기록

## 10. 완료 기준
실제 데이터 파일럿 시작 전 별도 운영 승인 체크를 남긴다. 코드가 배포되었다는 이유만으로 개인정보 운영 준비가 완료된 것으로 간주하지 않는다.
