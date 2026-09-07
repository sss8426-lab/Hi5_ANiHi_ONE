# 꿈이음 API 계약

이 문서는 꿈이음의 교직원 API, 보호자 API, private file access, 월간평가 상태전이와 PWA 보안 원칙을 고정한다.

## 공통 원칙

- 기존 DATA CORE staff session은 교직원 꿈이음 API에서 재사용 가능하다.
- 보호자 세션은 별도 cookie namespace를 사용한다.
- FAMILY_DB/FAMILY_FILES가 학생·보호자 원본의 source of truth다.
- 브라우저가 campusId/studentId 권한을 결정하지 않는다. 서버가 session과 관계테이블로 검증한다.
- 보호자/학생 개인정보를 `/api/data-core/search` 같은 일반 검색 API에 넣지 않는다.

## 교직원 API

### 캠퍼스/반/학생

- `GET /api/kkumeum/classes?campusId=`
- `POST /api/kkumeum/classes`
- `PATCH /api/kkumeum/classes/:id`
- `GET /api/kkumeum/students?campusId=&classId=&status=&q=`
- `POST /api/kkumeum/students`
- `GET /api/kkumeum/students/:id`
- `PATCH /api/kkumeum/students/:id`
- `POST /api/kkumeum/students/:id/move-class`

권한:
- SUPER_ADMIN: all campuses
- CAMPUS_DIRECTOR: own campus
- TEACHER: assigned class/student scope
- STAFF: explicitly allowed read/notice functions only

### 작품/파일

- `POST /api/kkumeum/files` multipart
- `GET /api/kkumeum/files/:id`
- `DELETE /api/kkumeum/files/:id` soft delete
- `POST /api/kkumeum/files/:id/restore`

파일은 `FAMILY_FILES`에 저장한다.
직접 public URL을 응답하지 않는다.
`downloadUrl`은 Worker authorization route만 반환한다.

업로드 purpose allowlist:
- artwork
- class-photo
- report-attachment
- announcement

### 월간평가

- `GET /api/kkumeum/students/:studentId/reports?year=`
- `GET /api/kkumeum/reports/:id`
- `POST /api/kkumeum/reports`
- `PATCH /api/kkumeum/reports/:id`
- `POST /api/kkumeum/reports/:id/mark-ready`
- `POST /api/kkumeum/reports/:id/send`
- `POST /api/kkumeum/reports/:id/reopen` (권한 제한)

상태전이:

```text
draft -> ready -> sent
```

- `sent` 이후 본문 변경은 원본 덮어쓰기보다 revision을 남긴다.
- 교사 검토 없이 AI 결과를 sent로 만들지 않는다.
- send 시 대상 guardian 관계를 다시 확인한다.

### AI 평가 초안

- `POST /api/kkumeum/reports/:id/generate-draft`

입력은 최소화:
- 작품의 비식별 특징/교사 메모
- 학생의 현재 수업단계
- 전월 성장포인트(필요 시)

응답:
- strengths
- growth
- improvements
- nextMonthFocus
- evaluationDraft

provider가 연결되지 않았으면 503 또는 명시적인 `provider_not_configured`를 반환한다. 템플릿 결과를 AI 생성처럼 표시하지 않는다.

### 공지

- `GET /api/kkumeum/announcements`
- `POST /api/kkumeum/announcements`
- `PATCH /api/kkumeum/announcements/:id`
- `POST /api/kkumeum/announcements/:id/publish`

announcementType:
- individual-news
- class-news
- campus-notice
- organization-notice
- selected-delivery

대상은 `announcement_targets`로 관리한다.

## 보호자 인증/API

### 인증

- `POST /api/family/auth/login`
- `POST /api/family/auth/logout`
- `GET /api/family/auth/session`
- `POST /api/family/auth/change-password`

cookie 예시:
- `kkumeum_family_session`
- Secure
- HttpOnly
- SameSite=Lax
- Path=/

DB에는 raw session token을 저장하지 않고 hash만 저장한다.

### 보호자 자녀/피드

- `GET /api/family/children`
- `GET /api/family/children/:studentId/feed`
- `GET /api/family/children/:studentId/reports`
- `GET /api/family/reports/:id`
- `GET /api/family/files/:id`
- `GET /api/family/news`
- `POST /api/family/read-receipts`

모든 studentId 요청에서 `student_guardians` 관계를 서버가 재검증한다.
다른 학생 접근은 403.

## 개인정보 최소화

일반 응답에서 필요하지 않은 필드를 제거한다.
보호자 feed에 교직원 내부 ID, 다른 보호자 정보, 내부 메모, audit metadata를 노출하지 않는다.

교사용 `teacher_note`와 보호자에게 보이는 `evaluation_text`는 분리한다.

## PWA/service worker

- HTML/CSS/JS/app icon 같은 정적 shell만 캐시 가능.
- `/api/family/**`, `/api/kkumeum/**`는 cache-first 금지.
- 학생사진/월간평가/공지 응답을 Cache Storage에 저장하지 않는다.
- 민감 응답에는 `Cache-Control: private, no-store`.
- 브라우저 history/back 동작에서 이전 학생 데이터를 HTML에 inline embed하지 않는다.

## 감사로그

반드시 기록:
- student created/updated/moved
- guardian linked/unlinked
- report created/ready/sent/reopened
- family file upload/trash/restore/read-sensitive
- announcement publish
- guardian login lock/reset

로그에 raw password/session token/연락처 원문을 불필요하게 남기지 않는다.

## DATA CORE sync contract

명시적 비식별 sync만 허용:
- student_ref (random pseudonymous id)
- campus/type/yearMonth
- grade band
- major/track
- skill tags
- growth deltas
- competition/admission outcome reference

금지:
- 학생 이름
- 보호자 이름/전화/이메일
- 월간평가 전문
- private image URL/R2 key

## 테스트 최소 세트

- unauth staff 401
- cross-campus staff 403
- teacher unassigned student 403
- guardian own child 200
- guardian other child 403
- private file no session 401
- report draft->ready->sent
- sent revision audit
- announcement target scope
- family API no-store headers
- service worker private endpoint cache exclusion
- DATA CORE search cannot return family PII
# 교직원 운영 화면 추가 계약

- `GET /api/kkumeum/dashboard?campusId=&yearMonth=YYYY-MM`은 FAMILY_DB에서만 현재 캠퍼스의 학생·반·월간평가·작품·보호자 연결 집계를 반환한다.
- `GET /api/kkumeum/guardians?campusId=&studentId=`과 보호자 연결 변경 API는 `SUPER_ADMIN` 또는 해당 캠퍼스 `CAMPUS_DIRECTOR`만 사용할 수 있다.
- `POST /api/kkumeum/guardians`는 새 보호자 연결과 함께 임시 비밀번호를 응답 한 번에만 반환한다. 원문 비밀번호는 FAMILY_DB 또는 감사로그에 저장하지 않는다.
- `PATCH /api/kkumeum/guardians/:guardianId`, `POST /api/kkumeum/guardians/:guardianId/reset-password`, `POST /api/kkumeum/guardians/:guardianId/unlink`는 same-origin 요청만 허용한다.
- 꿈이음 API JSON 응답은 성공·실패 모두 `Cache-Control: private, no-store`다.
