# DATA CORE Phase 2 — 본문·통합검색·감사로그

## 목적

DATA CORE에 단순 메타데이터만 저장하는 단계를 넘어,
블로그 글·인스타 글·공모전 설명·입시요강 요약·전공/꿈 로드맵처럼 긴 텍스트를 중앙에 축적하고 검색할 수 있게 한다.

## 본문 저장

기존 `data_records`의 상세 본문은 `content_text` 컬럼에 저장한다.

### GET `/api/data-core/records/{id}/content`

권한이 있는 레코드의 본문을 조회한다.

### PUT/PATCH `/api/data-core/records/{id}/content`

요청:

```json
{
  "content": "긴 본문 내용"
}
```

정책:
- SUPER_ADMIN은 전체 수정 가능
- 일반 캠퍼스 사용자는 본인이 등록한 레코드의 본문만 수정 가능
- 본문 변경은 audit_logs에 `update_content`로 기록
- 현재 최대 본문 길이는 1,000,000자

## 통합 텍스트 검색

### GET `/api/data-core/search?q=검색어`

검색 대상:
- title
- summary
- content_text
- metadata_json
- tags

필터:
- `recordType`
- `sourceApp`
- `campusId`
- `limit` (최대 50)

예시:

```text
/api/data-core/search?q=청강대&recordType=admission-rule
```

검색 결과는 기존 DATA CORE 권한 규칙을 그대로 적용한다.
권한이 없는 private/campus 레코드는 결과에서 제외된다.

## 감사로그 조회

### GET `/api/data-core/audit`

필터:
- `action`
- `resourceType`
- `campusId`
- `limit` (최대 200)

정책:
- SUPER_ADMIN: 조직 전체 감사로그 조회
- 일반 사용자: 본인이 수행한 작업 로그만 조회

감사 대상 예:
- data_record create/update/delete
- content update
- file upload/delete
- membership grant/revoke

## 앞으로의 활용

### 블로그 자동화

1. 수업사진/학생작품을 DATA CORE files에 저장
2. 수업정보/키워드를 data_records에 저장
3. 생성된 블로그 원문을 content_text에 저장
4. 향후 같은 주제 작성 시 통합검색으로 과거 콘텐츠를 재활용

### 인스타 자동화

- 같은 DATA CORE 파일을 다시 사용
- 캡션/해시태그/게시 이력을 data_records + content_text로 축적

### 공모전/실기대회

- 공모전 요약은 summary
- 상세 요강/분석은 content_text
- 포스터/PDF는 file_objects/R2
- 대학/전공/실기유형은 tags/metadata

### 입시 데이터

- 대학/학과/전형은 구조화 metadata 또는 전용 테이블
- 요강 원문·해석·변경사항은 content_text
- 통합검색으로 학교/학과/실기유형별 자료를 묶어 검색

### 꿈·전공 로드맵

- career / major / skill-roadmap / curriculum-roadmap를 레코드로 저장
- 각 로드맵 상세 설명은 content_text
- 향후 AI가 전공→대학→입시→필요역량→수업과정 순서로 검색·조합

## 다음 단계

1. 실제 OpenAI Hosting에서 D1/R2/마스터 계정 연결 검증
2. 공모전/실기대회 모듈을 첫 DATA CORE 실제 소비 앱으로 전환
3. 기존 입시컨설팅 파일 업로드를 새 파일 API로 점진 이전
4. 블로그/인스타 자동화에서 DATA CORE 검색/파일선택 사용
5. 검색 품질이 필요한 시점에 FTS/벡터 검색 계층 추가
