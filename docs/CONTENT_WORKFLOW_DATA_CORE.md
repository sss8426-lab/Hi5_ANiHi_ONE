# HI5·ANiHi 블로그/인스타 자동화

기준일: 2026-09-07

## 목적

블로그 자동화와 인스타 자동화가 별도 저장소를 만들지 않고 DATA CORE 파일과 `data_records`를 함께 사용하도록 한다.

사용자 화면에서는 `콘텐츠 허브`라는 단일 메뉴명 대신 업무용 모드 안에서 다음 두 메뉴로 분리한다.

- 블로그 자동화
- 인스타 자동화

## 경로

- `/data-core/content`
- `/data-core/content/blog`
- `/data-core/content/instagram`

`/data-core/content`는 기존 deep link 호환용으로 유지하며 기본 블로그 자동화 화면으로 진입한다.

## API

### GET `/api/data-core/content`

콘텐츠 초안 목록을 조회한다.

검색 파라미터:

- `sourceApp`: `blog` 또는 `instagram`
- `campusId`
- `status`: `draft`, `review`, `ready`, `published`, `archived`
- `q`
- `limit`

### POST `/api/data-core/content`

콘텐츠 초안을 생성한다.

예시:

```json
{
  "sourceApp": "blog",
  "campusId": "campus-anihi-admission",
  "title": "고2 웹툰 수업 성장 기록",
  "summary": "상황표현 수업 피드백 정리",
  "content": "본문 또는 캡션",
  "contentPurpose": "class-story",
  "publishStatus": "draft",
  "relatedFileIds": ["file-id-1", "file-id-2"],
  "tags": ["웹툰", "고2", "상황표현"]
}
```

### GET `/api/data-core/content/{id}`

초안 상세와 `content_text`를 조회한다.

### PATCH `/api/data-core/content/{id}`

초안을 수정한다. 콘텐츠 종류(`sourceApp`)는 생성 후 바꾸지 않는다.

### DELETE `/api/data-core/content/{id}`

초안을 soft delete 한다.

## 저장 규칙

- 블로그 초안은 `record_type=blog-draft`, `source_app=blog`로 저장한다.
- 인스타 초안은 `record_type=instagram-draft`, `source_app=instagram`으로 저장한다.
- 본문과 캡션은 `data_records.content_text`에 저장한다.
- 연결 파일은 `metadata_json.relatedFileIds`에 저장한다.
- 인스타 초안은 `metadata_json.imageSpec`에 `2160 x 2700`, `4:5` 규격을 남긴다.

## 권한

- 모든 생성/수정/삭제는 Worker 서버에서 권한을 검사한다.
- 캠퍼스 사용자는 자기 캠퍼스 초안만 만들 수 있다.
- 일반 사용자는 본인이 만든 초안만 수정/삭제한다.
- `SUPER_ADMIN`은 전체 초안을 관리할 수 있다.
- 연결 파일은 현재 사용자가 읽을 수 있는 DATA CORE 파일만 허용한다.
- 콘텐츠 캠퍼스와 다른 캠퍼스의 파일은 연결하지 않는다.

## 이번 단계의 한계

- 실제 네이버 블로그 또는 인스타그램 게시 API는 아직 연결하지 않았다.
- AI 생성 결과를 운영 기능으로 가장하지 않는다.
- 파생 이미지 생성 엔진은 후속 작업이다. 이번 단계에서는 인스타 출력 규격과 원본 fileId 추적 구조를 준비했다.
