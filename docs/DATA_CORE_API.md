# HI5·ANiHi DATA CORE API

## 목적

앞으로 HI5·ANiHi의 새 기능은 앱별 로컬 저장소를 만들지 않고 이 API를 통해 중앙 DATA CORE에 데이터를 저장하고 조회한다.

기존 입시컨설팅의 `/api/data`, `/api/upload`, `/api/files/...`는 호환을 위해 유지한다.
새 기능은 `/api/data-core/...`를 사용한다.

## 인증

OpenAI Hosting이 전달하는 로그인 헤더를 사용한다.

- `oai-authenticated-user-id`
- `oai-authenticated-user-email`
- `oai-authenticated-user-full-name`

로그인한 사용자는 DATA CORE `users`에 자동 동기화된다.

## 최초 마스터 설정

환경변수:

`DATA_CORE_SUPER_ADMIN_EMAILS`

값은 쉼표로 구분한 이메일 목록이다.

예:

```text
owner@example.com,admin@example.com
```

해당 이메일로 로그인하면 DATA CORE가 `SUPER_ADMIN` 멤버십을 자동 생성한다.

중요:
- 실제 운영 이메일은 코드에 하드코딩하지 않는다.
- 환경변수로만 관리한다.
- 마스터가 만들어진 뒤 다른 사용자의 캠퍼스 권한은 관리자 API에서 부여한다.

## 역할

### SUPER_ADMIN
- 전체 캠퍼스 조회
- 조직 전체 데이터 생성
- 모든 데이터/파일 수정·삭제
- 사용자 권한 부여/회수

### CAMPUS_DIRECTOR
- 소속 캠퍼스 데이터 사용
- 본인이 등록한 데이터/파일 수정·삭제

### TEACHER
- 소속 캠퍼스 데이터 사용
- 본인이 등록한 데이터/파일 수정·삭제

### STAFF
- 소속 캠퍼스 데이터 사용
- 본인이 등록한 데이터/파일 수정·삭제

현재 정책은 사용자가 요청한 원칙에 맞춰 `본인이 등록한 자료만 삭제`를 기본으로 한다.
SUPER_ADMIN만 전체 삭제가 가능하다.

---

# 상태 / 로그인 컨텍스트

## GET `/api/data-core/health`

D1/R2 연결 상태와 DATA CORE 버전을 확인한다.

## GET `/api/data-core/context`

현재 로그인 사용자, 캠퍼스 멤버십, 역할, 쓰기 가능 여부를 반환한다.

---

# 캠퍼스

## GET `/api/data-core/campuses`

현재 사용자가 접근 가능한 캠퍼스를 반환한다.

초기 캠퍼스 seed:

- 애니입시관
- 디자인입시관
- 원종
- 범박
- 중동
- 옥길
- 광진
- 파주
- 안산
- 울산

이 목록은 운영 구조 변경 시 seed 설정에서 수정한다.

---

# 공통 데이터 레코드

`data_records`는 블로그 소재, 공모전 정보, 대학요강, 수업 연구자료, 전공 정보 등 여러 앱에서 공유하는 공통 데이터 단위다.

## GET `/api/data-core/records`

검색 파라미터:

- `q`
- `recordType`
- `sourceApp`
- `campusId`
- `tag`
- `limit`

예시:

```text
/api/data-core/records?recordType=competition&tag=웹툰
```

## POST `/api/data-core/records`

예시 JSON:

```json
{
  "campusId": "campus-anihi-admission",
  "recordType": "competition",
  "sourceApp": "competition",
  "title": "2027 청강대 실기대전",
  "summary": "웹툰·만화 관련 실기대회 정보",
  "visibility": "campus",
  "metadata": {
    "year": 2027,
    "department": "웹툰"
  },
  "tags": ["청강대", "웹툰", "실기대회"]
}
```

## GET `/api/data-core/records/{id}`

레코드 상세 조회.

## PATCH `/api/data-core/records/{id}`

본인 등록 자료 또는 SUPER_ADMIN 수정.

## DELETE `/api/data-core/records/{id}`

soft delete.
본인 등록 자료 또는 SUPER_ADMIN만 가능.
삭제 이력은 `audit_logs`에 남는다.

---

# 콘텐츠 허브

블로그와 인스타그램 자동화는 별도 저장소를 만들지 않고 콘텐츠 초안을 `data_records`에 저장한다.

## GET `/api/data-core/content`

검색 파라미터:

- `sourceApp`: `blog` 또는 `instagram`
- `campusId`
- `status`: `draft`, `review`, `ready`, `published`, `archived`
- `q`
- `limit`

## POST `/api/data-core/content`

예시 JSON:

```json
{
  "sourceApp": "blog",
  "campusId": "campus-anihi-admission",
  "title": "고2 웹툰 수업 성장 기록",
  "summary": "수업 피드백과 변화 기록",
  "content": "본문 또는 캡션",
  "contentPurpose": "class-story",
  "publishStatus": "draft",
  "relatedFileIds": ["file-id-1"],
  "tags": ["웹툰", "고2"]
}
```

저장 규칙:

- 블로그: `recordType=blog-draft`, `sourceApp=blog`
- 인스타그램: `recordType=instagram-draft`, `sourceApp=instagram`
- 본문/캡션: `content_text`
- 연결 파일: `metadata.relatedFileIds`
- 인스타 규격: `metadata.imageSpec = 2160 x 2700, 4:5`

## GET `/api/data-core/content/{id}`

초안 상세와 본문/캡션을 조회한다.

## PATCH `/api/data-core/content/{id}`

본인 초안 또는 SUPER_ADMIN만 수정할 수 있다. 생성 후 `sourceApp`은 바꾸지 않는다.

## DELETE `/api/data-core/content/{id}`

초안을 soft delete 한다.

---

# 중앙 파일 저장소

새 파일은 반드시 DATA CORE 파일 API를 사용한다.

## POST `/api/data-core/files`

호환 별칭:

`POST /api/data-core/upload`

`multipart/form-data` 필드:

- `file`: 필수
- `campusId`: 캠퍼스 사용자 필수
- `area`
- `category`
- `sourceApp`
- `recordId`
- `ownerId`
- `year`

### area

- `student-private`
- `documents-private`
- `academy-public`
- `exports-temporary`

R2 key는 다음처럼 중앙 규칙으로 생성한다.

```text
data-core/{area}/{organization}/{campus}/{category}/{owner}/{year}/{uuid-file}
```

파일 최대 크기는 현재 100MB다.
실행 파일과 스크립트 파일은 차단한다.

## GET `/api/data-core/files`

검색 파라미터:

- `campusId`
- `category`
- `recordId`
- `sourceApp`
- `q`
- `limit`

`sourceApp`은 DATA CORE 파일 원본을 중복 저장하지 않고 앱별로 구분해 조회할 때 사용한다. 예를 들어
`sourceApp=blog`, `sourceApp=instagram`, `sourceApp=competition`을 전달할 수 있다. `recordId`와 함께 사용하면
특정 공모전 등 하나의 DATA CORE 레코드에 연결된 파일만 권한 범위 안에서 조회한다.

## GET `/api/data-core/files/{fileId}`

DB의 `file_objects` 권한을 검사한 뒤 R2 원본을 전달한다.

새 DATA CORE 파일은 기존 `/api/files/{r2-key}`에서 직접 열 수 없게 분리한다.

## DELETE `/api/data-core/files/{fileId}`

본인 업로드 또는 SUPER_ADMIN만 삭제 가능.

처리:
1. R2 원본 삭제
2. `file_objects.deleted_at` 기록
3. `audit_logs` 기록

---

# 사용자 / 권한 관리

SUPER_ADMIN 전용.

## GET `/api/data-core/admin/users`

DATA CORE에 로그인 기록이 있는 사용자 조회.

## GET `/api/data-core/admin/memberships`

현재 역할/캠퍼스 권한 조회.

## POST `/api/data-core/admin/memberships`

예시:

```json
{
  "email": "teacher@example.com",
  "campusId": "campus-paju",
  "role": "TEACHER"
}
```

사용자는 먼저 시스템에 한 번 로그인해서 `users`에 생성되어 있어야 한다.

마스터 권한:

```json
{
  "email": "admin@example.com",
  "role": "SUPER_ADMIN"
}
```

## DELETE `/api/data-core/admin/memberships/{membershipId}`

권한 회수.
현재 로그인한 마스터가 자신의 SUPER_ADMIN 권한을 실수로 제거하는 것은 차단한다.

---

# 앱별 recordType/sourceApp 권장값

## 블로그 자동화

- sourceApp: `blog`
- recordType: `blog-material`, `blog-draft`, `blog-published`

## 인스타 자동화

- sourceApp: `instagram`
- recordType: `instagram-material`, `instagram-draft`, `instagram-published`

## 공모전/실기대회

- sourceApp: `competition`
- recordType: `competition`, `competition-result`, `award-work`

## 입시 컨설팅

- sourceApp: `admissions`
- recordType: `university`, `admission-rule`, `acceptance-case`, `application-analysis`

## 꿈·전공 로드맵

- sourceApp: `dream-roadmap`
- recordType: `career`, `major`, `skill-roadmap`, `curriculum-roadmap`

## 수업/연구자료

- sourceApp: `education`
- recordType: `lesson`, `research-work`, `curriculum`, `teaching-guide`

---

# 개발 원칙

## Instagram derivative API (2026-09-09)

`POST /api/data-core/instagram/derivatives` requires an authenticated writer and an exact same-origin `Origin` header. Multipart fields: `derivedFromFileId`, `file` (PNG, 2160 x 2700, <= 8 MiB). JPEG/PNG/WebP original selection is supported by the browser Canvas editor. The server validates actual PNG bytes and inherits source authorization; client campus/owner/visibility/provenance are ignored.

Returns HTTP 201 `{ file: { id, campusId, sourceApp, category, fileName, mimeType, sizeBytes, visibility, metadata, downloadUrl, createdAt } }`. `metadata.derivedFromFileId` is the original file ID; output `id` is always new. Metadata lives in the existing linked `data_records` JSON with reserved type `instagram-derived-file`. Generic record mutations are denied for that type. List/read and content attachment recheck source access. Original bytes/row are unchanged. See `CONTENT_AUTOMATION_DATA_CORE_CONTRACT.md` for format limits and cleanup.

Content create/update accepts additive `derivedFileIds` alongside existing `relatedFileIds`. Both are canonicalized into draft metadata; derived IDs must be authorized registered outputs.

1. 새 앱은 별도 파일 저장소를 만들지 않는다.
2. 파일은 R2, 메타데이터/관계는 DATA CORE DB에 저장한다.
3. 캠퍼스와 업로더 정보를 가능한 모든 데이터에 남긴다.
4. 앱 사이에서 공유할 정보는 `data_records` 또는 전용 테이블로 저장한다.
5. 검색 가능한 태그를 함께 저장한다.
6. 삭제는 중앙 API에서만 수행한다.
7. 권한검사는 클라이언트가 아니라 Worker 서버에서 수행한다.
8. 개인정보와 학생 자료는 기본 private로 본다.
9. 기존 입시컨설팅은 점진적으로 DATA CORE로 이전한다.
10. 기능 구현 후 CI 빌드/타입검사를 통과해야 완료로 판단한다.
