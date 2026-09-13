# Content Automation ↔ DATA CORE Contract

기준일: 2026-09-07

2026-09-13 확장: [OpenAI 콘텐츠 워크플로](CONTENT_OPENAI_WORKFLOW.md). 기존 파일/초안/파생 계약을 유지하며 실제 provider adapter, 자료보관함 공통 picker, 캠퍼스 기본 문구를 추가한다. 실제 provider 운영 검증은 secret 연결 전 미완료다.

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
  "schemaVersion": 1,
  "derivedFromFileId": "original-file-id",
  "derivativeFileId": "new-file-id",
  "derivativeType": "instagram-4x5",
  "width": 2160,
  "height": 2700,
  "aspectRatio": "4:5",
  "createdBy": "instagram-editor"
}
```

### Deterministic Instagram derivative (2026-09-09)

- Canvas cover crop, centered by default; horizontal/vertical crop sliders. JPEG/PNG/WebP sources, PNG output only. No AI provider or external publishing.
- `POST /api/data-core/instagram/derivatives`: same-origin multipart `derivedFromFileId` and `file`. Output must decode as a valid, CRC-checked, non-interlaced 8-bit RGB/RGBA PNG at 2160 x 2700, at most 8 MiB. Bounded decompression and a restricted chunk set reject malformed/bomb payloads.
- Server inherits source campus, owner and visibility. A caller needs write access, source read access, and source campus access. Derivative chains are not accepted.
- New `file_objects` row: `sourceApp=instagram`, `category=instagram-derived`, new R2 key under existing FILES. Source row and bytes are never changed.
- Existing `data_records.metadata_json` stores the immutable provenance above as reserved `recordType=instagram-derived-file`; the output's `data_record_id` points to it. No schema or binding changes.
- Reserved provenance records cannot be created, changed, deleted or linked by generic record/upload APIs. File list responses include validated `metadata`; reads and draft linking recheck the original's current authorization. Missing/deleted/restricted sources fail closed.
- Private binaries remain behind `/api/data-core/files/:id`. No R2 URL is returned. Generic legacy `/api/files/:key` cannot read DATA CORE keys.
- `metadata.relatedFileIds` references originals; `metadata.derivedFileIds` references outputs, validated on create/update. Blog continues to use the same original without creating a derivative.
- Delete outputs through the existing soft-trash policy first, then the synthetic source; R2 objects are retained. Provenance remains for traceability. Source soft-trash makes outputs unreadable until the source is restored and authorized.
- A save completing after a user switches drafts remains in FILES but is not attached to the new draft. The output can be found through the `instagram-derived` file filter.

Local synthetic browser verification: `node scripts/test-instagram-browser.mjs` with Playwright installed (or `PLAYWRIGHT_MODULE` set to its absolute module path); optional `PLAYWRIGHT_CHANNEL=chrome`. This loopback-only fixture never connects to production. Screenshots go to ignored `outputs/instagram-derivative/`.

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
