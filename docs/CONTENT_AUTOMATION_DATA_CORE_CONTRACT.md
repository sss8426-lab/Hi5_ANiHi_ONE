# Content Automation ↔ DATA CORE Contract

기준일: 2026-09-07

이 문서는 블로그 자동화와 인스타 자동화가 DATA CORE를 사용하는 공통 계약이다.

## 1. 핵심 원칙

한 번 업로드한 원본 사진은 중앙 DATA CORE에 하나만 저장한다.

블로그와 인스타는 같은 `fileId`를 참조한다.

원본을 서비스별로 복제하지 않는다.

## 2. 파일

원본/기존 자산 조회:

- `GET /api/data-core/files`

신규 업로드:

- `POST /api/data-core/upload`

필수/권장 메타데이터:

- campusId
- sourceApp
- category
- area
- recordId (연결 콘텐츠가 이미 있는 경우)

블로그 업로드 sourceApp:

`blog`

인스타 업로드 sourceApp:

`instagram`

### 원본과 파생파일

단순히 같은 원본을 사용하는 경우 새 바이너리를 만들지 않는다.

크롭/리사이즈/합성/텍스트 레이아웃 등 실제 이미지가 달라졌을 때만 derived file을 생성한다.

파생파일은 원본 fileId를 추적할 수 있어야 한다.

권장 metadata:

```json
{
  "derivedFromFileId": "...",
  "transformType": "instagram-4x5",
  "width": 2160,
  "height": 2700
}
```

## 3. 콘텐츠 레코드

기존 `data_records`를 공통 콘텐츠 저장소로 우선 사용한다.

권장 타입:

- content-source
- blog-draft
- instagram-draft
- published-content

블로그:

- sourceApp = `blog`
- title = 제목
- summary = 목록용 요약
- content_text = 실제 본문

인스타:

- sourceApp = `instagram`
- title = 내부 관리용 제목
- summary = 짧은 설명
- content_text = 캡션 본문

## 4. 콘텐츠 metadata

권장 구조:

```json
{
  "contentPurpose": "class-story",
  "major": "webtoon",
  "grade": "high2",
  "practicalType": "situation-expression",
  "publishStatus": "draft",
  "publishedAt": null,
  "channelPostId": null,
  "relatedFileIds": ["file-id-1", "file-id-2"]
}
```

초기 단계에서는 `relatedFileIds`로 연결 가능하다.

관계 조회/무결성 요구가 커지면 별도 relation table을 추가하되 기존 metadata를 마이그레이션한다.

## 5. 권한

- 서버 권한검사를 그대로 사용한다.
- 캠퍼스 사용자는 소속 캠퍼스 범위.
- 본인 초안 수정/삭제가 기본.
- SUPER_ADMIN 전체 관리.
- private 원본 파일은 기존 DATA CORE file 권한에 따름.

## 6. 인스타 이미지 규격

HI5·ANiHi의 인스타 관련 이미지 생성/편집 기본 규격:

`2160 × 2700px (4:5)`

원본이 이 비율이 아니더라도 원본 자체를 덮어쓰지 않는다.

인스타용 파생 결과물을 별도 파일로 생성하고 원본 관계를 남긴다.

## 7. 블로그 글 데이터 원칙

블로그는 단순 홍보문만 축적하지 않는다.

가능한 경우 다음 구조를 데이터에 남긴다.

- 어떤 수업인가
- 어떤 문제가 있었는가
- 어떤 지도/피드백이 있었는가
- 무엇이 개선됐는가
- 어떤 교육적 의미가 있는가

향후 DATA CORE가 교육성과와 콘텐츠성과를 함께 분석할 수 있도록 한다.

## 8. 콘텐츠 퍼널 정보

향후 필요 시 metadata에 다음을 추가할 수 있다.

- awareness
- expertise
- evidence
- trust
- consultation

앱 로직에 퍼널을 하드코딩하기보다 데이터 속성으로 남겨 분석 가능하게 한다.

## 9. 게시 이력

실제 외부 채널 게시가 연결되면 다음을 기록한다.

- publishStatus
- publishedAt
- channel
- channelPostId
- 실패/성공 상태

게시가 성공하지 않았는데 성공으로 저장하면 안 된다.

## 10. 금지

- 블로그 전용 R2 버킷 신규 생성
- 인스타 전용 원본 사진 저장소 신규 생성
- 브라우저에서 권한 결정
- 원본 파일을 가공 결과로 덮어쓰기
- AI 생성 결과를 저장하지 않고 화면에서만 소비
- 같은 콘텐츠를 앱마다 서로 다른 데이터 구조로 중복 관리
