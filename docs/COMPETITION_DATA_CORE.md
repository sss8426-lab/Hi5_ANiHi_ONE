# 공모전·실기대회 DATA CORE

## 목적

공모전·실기대회 정보를 캠퍼스별 파일이나 단톡방에 흩어두지 않고 HI5·ANiHi DATA CORE에 축적한다.

축적 대상은 단순 일정만이 아니다.

- 대회명
- 주최/주관
- 관련 대학
- 접수기간
- 대회일
- 발표일
- 대상 학년
- 관련 전공
- 실기유형
- 상금/시상
- 접수방법
- 원문/요강 링크
- 상세 분석/안내문
- 포스터/PDF/수상작 파일
- 캠퍼스별 출품 인원
- 캠퍼스별 수상 인원
- 상격별 수상 수
- 수상률

시간이 쌓이면 향후 다음 분석이 가능해진다.

- 전공별 수상률이 높은 대회
- 학년별 추천 대회
- 캠퍼스별 출품/수상 추이
- 실기유형별 성과
- 특정 대학 실기대전과 실제 입시 성과의 관계

## API

### GET `/api/data-core/competitions`

공모전/실기대회 목록 조회.

기존 DATA CORE 검색 파라미터를 사용할 수 있다.

- `q`
- `campusId`
- `tag`
- `limit`

응답에는 접수기간 기준 상태가 계산되어 포함된다.

- `upcoming`
- `open`
- `closed`
- `result-announced`
- `unknown`

### POST `/api/data-core/competitions`

예시:

```json
{
  "campusId": "campus-anihi-admission",
  "title": "2027 청강문화산업대학교 실기대전",
  "summary": "웹툰·만화·애니메이션 분야 실기대회",
  "content": "학원 내부에서 공유할 상세 분석과 안내 내용",
  "organizer": "청강문화산업대학교",
  "hostSchool": "청강문화산업대학교",
  "competitionKind": "practical-competition",
  "applicationStart": "2027-05-01",
  "applicationEnd": "2027-05-31",
  "eventDate": "2027-06-20",
  "resultDate": "2027-07-01",
  "targetGrades": ["고1", "고2", "고3"],
  "majors": ["웹툰", "만화", "애니메이션"],
  "practicalTypes": ["상황표현", "칸만화"],
  "prize": "세부 시상내역",
  "applicationMethod": "온라인 접수",
  "sourceUrl": "공식 원문 URL",
  "guideUrl": "입시/대회 요강 URL",
  "year": 2027,
  "tags": ["청강대", "실기대전"]
}
```

### GET `/api/data-core/competitions/{id}`

대회 상세 조회.

### PATCH `/api/data-core/competitions/{id}`

본인 등록 대회 또는 SUPER_ADMIN 수정.

### DELETE `/api/data-core/competitions/{id}`

DATA CORE soft delete 정책 사용.

### GET `/api/data-core/competitions/{id}/results`

접근 가능한 캠퍼스별 결과 데이터 조회.

### POST `/api/data-core/competitions/{id}/results`

예시:

```json
{
  "campusId": "campus-anihi-admission",
  "participants": 38,
  "winners": 15,
  "gold": 1,
  "silver": 2,
  "bronze": 3,
  "honorableMention": 9,
  "year": 2027,
  "practicalType": "상황표현",
  "grade": "고2"
}
```

`participants`와 `winners`가 있으면 수상률을 자동 계산한다.

## 파일 연결

포스터, PDF 요강, 수상작 이미지는 기존 DATA CORE 파일 API를 그대로 사용한다.

`POST /api/data-core/files`

권장 값:

```text
recordId = 공모전 data_record id
category = competition-poster | competition-guide | award-work
sourceApp = competition
area = academy-public 또는 documents-private
```

파일과 대회 정보가 `recordId`로 연결되므로 다른 앱에서도 동일한 원본을 다시 사용할 수 있다.

공모전 상세 화면은 `GET /api/data-core/files?recordId={competitionId}&sourceApp=competition`으로 연결 파일을
조회한다. `competition-poster` 이미지는 대표 포스터로, `competition-guide`는 실제 요강 링크로,
`award-work`는 수상작 썸네일 또는 파일 링크로 표시한다. 연결된 파일이 없으면 빈 상태만 보여 주며,
R2 공개 URL이나 별도 복사본을 만들지 않는다.

## 공유 정책

- 마스터가 등록한 조직 공통 공모전 정보는 전체 캠퍼스가 활용 가능
- 캠퍼스 사용자가 등록한 자료는 현재 DATA CORE 기본 정책에 따라 해당 캠퍼스 범위로 저장
- 캠퍼스 출품/수상 결과는 캠퍼스 데이터로 축적
- SUPER_ADMIN은 전체 캠퍼스 결과를 분석 가능

향후 승인 워크플로를 추가하면 캠퍼스가 제보한 공모전 정보를 마스터가 검토 후 조직 공통 정보로 승격할 수 있다.

## 화면 구조

상담용 모드의 `/data-core/counseling/competitions`에서 좌우 분할 화면으로 제공한다.

좌측:

- 대회 검색
- 상태 필터
- 학년/전공/실기유형 필터
- 대회 리스트

우측:

- 연결된 포스터/대표 이미지 또는 빈 상태
- 연결된 요강 PDF/파일 및 원문 링크
- 상세설명
- 접수방법
- 시상/상금
- 버튼으로 만드는 편집 가능한 학원용 안내문 초안 템플릿과 복사
- 캠퍼스별 출품/수상 현황
- 수상작 파일/이미지 연결 안내

실제 AI 안내문 생성처럼 보이게 하지 않고, 현재 단계에서는 등록된 대회 정보 기반 템플릿 초안만 제공한다.

## 구조적 의미

공모전 기능은 DATA CORE를 실제로 사용하는 첫 번째 도메인이다.

```text
공모전 화면
    ↓
competition API
    ↓
data_records + content_text + tags
    ↓
file_objects + R2
    ↓
audit_logs
```

이 구조를 이후 블로그, 인스타그램, 입시, 꿈·전공 로드맵에도 동일하게 적용한다.

## 수상작 폴더 갤러리 (2026-09-09)

> 아래 과거 삭제 정책은 2026-09-10 정책으로 대체되었다. 수상작 화면의 파일 삭제는 마스터 전용 영구삭제이며, 비어 있지 않은 폴더 삭제는 차단한다.

- 기존 `competition-award-folder` record와 `competition-material` 파일 연결을 그대로 사용한다. 스키마/바인딩 변경은 없다.
- `+ 새 폴더`는 맨 왼쪽에 두고 폴더명/캠퍼스는 모달에서 입력한다. 폴더는 생성순으로 표시한다.
- 선택 폴더만 표시하며, 이전 요청의 지연 응답/오류와 다른 recordId의 파일은 갤러리에 반영하지 않는다.
- 업로드 대상 폴더/캠퍼스/분류를 고정하고 취소하면 연결을 해제한다. 다중 파일 업로드는 시작 시점의 대상을 유지한다.
- PC 4~6열, 태블릿 3열, 모바일 2열. 이미지는 인증된 file API에서 가져오며 Lightbox는 닫기/배경/ESC로 닫는다.
- 폴더 삭제는 기존 record DELETE만 호출한다. 파일 메타데이터와 R2 원본은 유지하며 기존 서버 캠퍼스 권한을 그대로 적용한다.
- 우측 소식은 항상 표시하고 새로고침만 제공한다. 접수중/예정 소식의 달력 투영은 유지한다.
- 검증: `tests/award-gallery-behavior.test.mjs`, 기존 D1/R2 behavior suite의 합성 캠퍼스 테스트, `scripts/check-award-gallery-browser.mjs`의 localhost-only 합성 브라우저 검증.
- 기존 API의 최대 100개 조회 제한은 그대로이며, 대규모 페이지네이션 변경은 이 UI 작업에 포함하지 않는다.

## 수상작 세부 UX 및 실제 소식 파싱 (2026-09-09)

- 상담 모드에서만 사용자 이름/역할을 로그아웃 바로 왼쪽에 둔다. 모바일에서도 역할을 숨기지 않는다.
- 새 수상작 파일은 업로드한 원래 파일명을 그대로 유지한다. 폴더명으로 바꾸지 않으며 이미 저장된 파일명도 변경하지 않는다. R2 key에만 안전한 이름 치환과 UUID를 적용하여 같은 이름의 파일도 별도로 보존한다.
- 갤러리 선택 삭제: `DELETE /api/data-core/files/:id?awardFolderId=:folderId`. 동일 Origin, 파일 소유자, 실제 폴더 연결, 폴더 종류, 캠퍼스 권한을 서버에서 검사한 뒤 기존 soft-trash를 호출한다. R2 원본은 보존하고 운영관리의 기존 복원 API를 사용한다.
- 페이지 전용 이미지 캐시는 인증된 file API의 blob만 메모리에 보관한다. 썸네일/Lightbox 요청을 합치며 24개/128MiB/5분 상한, 다운로드 동시 3개 제한을 둔다. 폴더 전환, 화면 이탈, 로그아웃, 페이지 숨김 시 요청 취소와 object URL 해제를 수행한다. Service Worker/영구 브라우저 저장소/R2 공개 URL을 사용하지 않는다.
- 기존 실측 desktop 구성은 수상작 유동폭 + 소식 340px이다. 이 구성을 유지하며 760px 이하에서는 수상작 다음 소식을 배치한다.
- `htmlparser2`로 개별 Art&Design `li.list-item`, Mgood `tr`의 실제 상태 필드만 추출한다. 주석 속 배너/옆 행 상태/수험표 발급을 접수중으로 오인하지 않는다. HTML 원문은 저장하지 않는다.
- 아트앤디자인 `/shop/list.php?ca_id=20`: 정확히 접수중만. 엠굿 `state=main`, `state=other`: 정확히 접수중/예정만. 지난 마감일은 한국 날짜 기준 제외한다. 상세 링크의 HTML entities를 정상 해석한다.
- Preview 응답에 `pages` 진단을 추가한다: 페이지 URL, 성공 여부, HTTP 상태, 추출/접수중/예정/제외 수. 저장된 수동 대회 레코드 및 import 권한/보수적 병합 규칙은 유지한다.
- UI는 출처별 external ID로 중복 제거 후 마감일, 접수중 우선, 제목순으로 정렬한다. 성공한 빈 목록은 오래된 항목을 제거하고 실패한 페이지의 마지막 정상 자료는 오류 표시와 함께 유지한다. 달력은 동일 필터 결과를 투영할 뿐 DB 일정을 생성하지 않는다.
- 실제 공개 목록/상세 링크 검증: `node --use-system-ca scripts/check-competition-live-sources.mjs`. DATA CORE D1/R2는 일회성 로컬 fixture만 사용한다. TLS 검증을 비활성화하지 않는다.
- 2026-09-09 소스 실측: Art&Design 24개 중 접수중 2/제외 22, Mgood main 20개 중 접수중 0/예정 0, other 20개 중 접수중 2/예정 1. 세 목록과 노출되는 다섯 상세 링크 HTTP 200. 이 수치는 조회 시점 기준이다.

## Upload progress and award deletion (2026-09-10)

- Existing multipart upload API, original uploaded filename, campus/owner rules and FILES binding are retained. The server uses the multipart File name, not a client filename override or folder title. `upload-queue.js` uses at most three XHRs and real multipart upload-byte events. Selection bytes exclude multipart overhead; transfer totals include it. 100% requires every server success response, not merely finishing the request body.
- Selection shows a count/size summary with an optional collapsed list. Failed requests can be retried without repeating successful requests. Cancelling aborts active XHRs and stops waiting items; confirmed successes are never rolled back. An already accepted server request may finish despite a client abort. Gallery refresh remains authoritative; transport errors advise checking the gallery before retrying.
- Upload destination is a frozen folder/campus/category snapshot. D1 inserts require the linked record still to be active. New-upload metadata failures compensate only the new row/object, never an existing file.
- `DELETE /api/data-core/files/:id?awardFolderId=:folderId` now invokes the existing purge function directly for valid competition-material files in competition-award-folder records. Same-origin and server SUPER_ADMIN checks are mandatory. Generic file DELETE without this parameter still uses soft-trash. No permission expansion.
- Permanent deletion checks live and trashed DATA CORE content/derivative metadata, knowledge metadata, legacy app_state and the active legacy admissions state object's references. Legacy JSON is scanned as a bounded stream without logging records. A referenced file returns 409; no cascading detach or delete occurs.
- Purge writes a start audit, claims a per-file tombstone, rechecks references, deletes R2, then batches completion audit and row removal. R2/DB failures restore the retained R2 body by streaming and restore the previous row status. A concurrent purge/restore is rejected. If compensation itself fails or execution is interrupted, the tombstone and start audit remain for operator reconciliation; D1/R2 are not a distributed transaction. Audit records intentionally remain.
- Folder DELETE checks all attached files, including trash, and uses an atomic conditional update. Only empty folders can be soft-deleted; no folder operation deletes R2 contents.
- Folder track never wraps, supports touch scroll, truncates long labels without changing data, and moves to the next offscreen item's actual bounds. Selected/new folders are exposed automatically. Arrows are 32px with endpoint disabled states.
- Synthetic verification: `tests/upload-queue.test.mjs`, updated D1/R2 behavior tests including failure compensation, and `scripts/check-award-transfer-browser.mjs` (1/10/30 uploads and six viewport widths). Preview mode intercepts every API and uses Preview static assets only; it is not production-write evidence. Production synthetic evidence is recorded on the release PR separately.
