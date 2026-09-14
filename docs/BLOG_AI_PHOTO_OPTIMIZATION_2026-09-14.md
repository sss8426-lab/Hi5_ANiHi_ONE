# 블로그 AI 사진 선택/용량 자동 최적화

기준일: 2026-09-14

## 목적

「블로그 자동화 > AI로 블로그 글 작성」에서 사진을 6장 넘게 선택하거나 원본 용량이 크면
사용자가 직접 사진을 줄이거나 압축해야 했다. 브라우저가 선택한 사진을 AI 분석용으로
자동 리사이즈/압축해서 보내도록 바꿔, 사용자가 장수/용량을 계산할 필요를 없앴다.
자료보관함 원본 R2 파일은 전혀 건드리지 않는다.

## 경계

- 블로그 사진 선택: 최대 10장 (`BLOG_AI_PHOTO_LIMIT`)
- 인스타그램 대표 사진 1장 흐름과 기존 `AI_PHOTO_LIMIT`(6)는 완전히 그대로 유지
- AI 분석용 이미지 1장 서버 hard cap: 2 MiB (`BLOG_ANALYSIS_IMAGE_MAX_BYTES`)
- AI 분석용 이미지 전체 서버 hard cap: 16 MiB (`BLOG_ANALYSIS_TOTAL_MAX_BYTES`)
- 원본 R2 파일 크기 제한 없음(브라우저가 보내기 전에 이미 최적화하므로 서버는 원본을
  다시 읽지 않는다)

## 브라우저 최적화

`public/data-core/content.js`의 `optimizeImageForAi()`가 사진마다:

1. 자료보관함 private preview URL을 `fetch`
2. `createImageBitmap` → `OffscreenCanvas`에 그려 리사이즈 → `convertToBlob('image/jpeg', quality)`
3. 아래 순서로 시도하고, 목표(1.5 MiB) 이하가 되면 즉시 중단. 끝까지 못 줄이면 마지막
   단계(1280px/0.70) 결과를 그대로 사용하되 hard cap(2 MiB) 초과 시 실패로 처리한다.

   | 단계 | 긴 변 | quality |
   |---|---|---|
   | 1 | 2048px | 0.82 |
   | 2 | 1800px | 0.78 |
   | 3 | 1600px | 0.74 |
   | 4 | 1280px | 0.70 |

   작은 원본은 확대하지 않는다(`scale = Math.min(1, edge / max(width,height))`).

`prepareBlogPhotos()`가 이 과정을 **한 장씩 순차적으로** 실행하고(`ImageBitmap.close()`로
즉시 해제), `#aiStatus`에 "사진을 AI 분석에 맞게 준비하고 있습니다… N/M"을 표시한다. 한 장이라도
디코드/리사이즈에 실패하면 그 사진 이름을 명시한 에러로 전체 요청을 중단한다(다른 사진으로
조용히 계속 진행하지 않음). Canvas로 다시 인코딩하기 때문에 원본 EXIF/GPS는 결과물에 전혀
남지 않는다.

## 요청 형식

`POST /api/data-core/content/generate`가 두 가지 요청 본문을 모두 받는다.

- 기존 `application/json`(인스타그램은 계속 이 경로만 사용: 캡션 생성 호출과 이미지 편집
  호출 모두 무변경)
- 신규 `multipart/form-data`(블로그 전용): `input` 필드에 기존 JSON 본문과 동일한 내용,
  `photo:<selectedFileId>` 필드에 최적화된 JPEG Blob 하나씩

블로그가 아닌 `sourceApp`으로 멀티파트를 보내면 400으로 거절한다(`worker/router.ts`).

## 서버 재검증

브라우저가 이미 최적화했어도 서버가 다시 검증한다(`worker/content-openai-provider.ts`의
`blogAiImages()`):

1. `selectedFileIds` 개수 ≤ 10
2. 파일마다 DB row 조회 → 기존과 동일한 권한/캠퍼스/삭제 여부/mime 검사
   (`requireCampusAccess`, `canReadRegisteredFile`, mime 허용목록) — **R2 원본은 읽지 않는다**
3. 업로드된 사진 바이트: 장당 ≤ 2 MiB, 전체 ≤ 16 MiB (이 두 캡을 모두 통과한 뒤에만
   `sanitizeAiImage()`로 형식 검증 + 방어적 EXIF 재제거를 수행 — 예산 초과 배치에 형식
   파싱 비용을 쓰지 않는다)

인스타그램 경로(`selectedAiImages()`, `AI_IMAGE_BYTES`=8MiB/`AI_TOTAL_BYTES`=16MiB,
`AI_PHOTO_LIMIT`=6, `normalizeAiPng`의 2160×2700 크롭/리사이즈, `editInstagramImage()`)는
이번 작업에서 코드 한 줄도 바뀌지 않았다.

## 임시 파일

최적화된 이미지는 R2에 저장하지 않는다. `file_objects`/`data_records`/R2 파생 파일을 만들지
않고, OpenAI 요청이 끝나면 메모리에서 자연히 사라진다. DB migration 없음.

## 테스트

- `tests/content-openai.test.mjs`: 사진 10장 멀티파트 성공(OpenAI에 전달된 이미지가 40×30
  JPEG임을 디코드해서 확인, R2 PNG 원본이 아님을 증명), 11번째 400, 장당 2 MiB 초과 413,
  총합 16 MiB 초과 413(예산 초과 시 sanitize 전에 차단됨을 검증), 인스타그램으로 멀티파트를
  보내면 400, 전체 과정에서 R2 원본/`file_objects` row 불변
- `tests/content-blog-photo-optimization.test.mjs`: `content.js` 소스 텍스트 기준으로
  10장 제한 상수, 인스타 1장 교체 분기가 블로그 제한보다 먼저 오는지, 최적화 파이프라인이
  순차 처리(`Promise.all` 아님)로 `bitmap.close()`를 호출하는지, 블로그만 멀티파트를
  쓰고 인스타는 기존 JSON `post()` 그대로인지 확인
- 기존 `six-photo budget...`, `sanitized JPEG/WebP...`, `Responses adapter...`,
  `Image Edit adapter...` 테스트 회귀 없음

**미확인**: 실제 브라우저(태블릿 포함)에서 `createImageBitmap`/`OffscreenCanvas` 동작,
사진 준비 중 진행률 UI, 문서/입시요강처럼 글자가 많은 이미지의 최적화 후 판독성, `detail`
파라미터 조정 여부(이번 작업에서 `detail: 'low'`는 변경하지 않았다 — 실제 품질 확인 없이
바꾸지 말라는 지시에 따름). 실제 OpenAI 응답 품질과 Preview/Production 반영은 별도 확인이
필요하다.
