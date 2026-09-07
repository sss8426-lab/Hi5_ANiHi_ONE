# HI5·ANiHi 블로그·인스타 공통 콘텐츠 DATA CORE

기준일: 2026-09-07

## 목적

블로그와 인스타그램 자동화가 서로 다른 저장소를 만들지 않고 같은 DATA CORE의 파일과 콘텐츠 기록을 사용한다.

```text
DATA CORE 원본 사진
       ↓
콘텐츠 레코드
       ↓
원본(source) / 편집본(output) / 대표(cover) / 갤러리(gallery)
       ↓
블로그 또는 인스타 게시물
       ↓
게시상태·게시이력 축적
```

## 저장 구조

콘텐츠 본체는 기존 `data_records`를 사용한다.

- `record_type = content_post`
- `source_app = blog | instagram`
- `title`
- `summary`
- `content_text` : 블로그 본문 또는 인스타 캡션
- `metadata_json`
- `campus_id`
- `visibility`
- tags

파일 연결은 `content_media_links`를 사용한다.

### media role

- `source` : 편집 전 원본
- `output` : 편집/가공 결과
- `cover` : 대표 이미지
- `gallery` : 게시물 추가 이미지

한 파일을 여러 콘텐츠에서 재사용할 수 있다.

## 콘텐츠 상태

- `draft`
- `review`
- `ready`
- `published`
- `archived`

향후 자동 게시 기능이 붙으면 `ready → published` 변경 시 게시 URL, 외부 게시물 ID, 게시일시 등을 metadata에 기록한다.

## 인스타그램 이미지 규격

인스타그램 콘텐츠의 `metadata.imageSpec`은 공통 규격으로 고정한다.

```json
{
  "width": 2160,
  "height": 2700,
  "aspectRatio": "4:5"
}
```

인스타 이미지 편집/생성 기능은 이 규격을 기준으로 결과물을 만들어야 한다.

## API

### 콘텐츠 목록

`GET /api/data-core/content`

필터:

- `platform=blog|instagram`
- `status=draft|review|ready|published|archived`
- `campusId`
- `q`

### 콘텐츠 생성

`POST /api/data-core/content`

예:

```json
{
  "platform": "blog",
  "campusId": "campus-example",
  "title": "고2 웹툰반 상황표현 수업",
  "content": "본문...",
  "status": "draft",
  "contentType": "class",
  "tags": ["웹툰", "고2", "상황표현"]
}
```

### 콘텐츠 상세/수정/삭제

- `GET /api/data-core/content/{id}`
- `PATCH /api/data-core/content/{id}`
- `DELETE /api/data-core/content/{id}`

### 파일 연결

`POST /api/data-core/content/{id}/media`

```json
{
  "fileId": "DATA_CORE_FILE_ID",
  "role": "source",
  "position": 0
}
```

파일 연결 해제:

`DELETE /api/data-core/content/{id}/media/{linkId}`

## 권한

- 실제 권한은 Worker 서버에서 검사한다.
- 일반 사용자는 본인이 만든 콘텐츠만 수정/삭제한다.
- 캠퍼스 사용자가 만드는 콘텐츠는 기본적으로 캠퍼스 범위로 제한한다.
- 연결하는 파일 역시 해당 사용자가 읽을 수 있는 DATA CORE 파일이어야 한다.
- SUPER_ADMIN은 전체 관리 가능.

## 백업

다음이 운영 백업에 포함된다.

- `data_records`의 `content_post`
- `content_media_links`
- 연결 대상 `file_objects`
- tags / data_record_tags

원본 파일 바이트는 기존 R2 object에 그대로 유지된다.

## 이후 블로그 자동화 연결

1. DATA CORE에서 수업사진/학생작품 검색
2. 선택 파일을 content record에 `source`로 연결
3. AI가 제목/본문 생성
4. 생성 본문을 `content_text`에 저장
5. 검수 후 status=`ready`
6. 네이버 게시 자동화가 완료되면 status=`published`
7. 게시 URL/게시일시 저장

## 이후 인스타 자동화 연결

1. 같은 DATA CORE 원본 사진 검색/재사용
2. source 파일 연결
3. 2160×2700px 편집 결과 생성
4. 편집 결과를 DATA CORE R2에 `sourceApp=instagram`으로 업로드
5. output/cover로 콘텐츠에 연결
6. 캡션·해시태그를 `content_text`/metadata에 저장
7. 게시 완료 후 published 상태/게시정보 기록

## 핵심 가치

한 번 올린 사진을 블로그, 인스타, 입시, 평가서, 홍보에서 반복 활용하고,
어떤 원본이 어떤 콘텐츠와 성과로 이어졌는지 장기적으로 추적할 수 있게 한다.
