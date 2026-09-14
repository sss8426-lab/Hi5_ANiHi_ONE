# 자료보관함 최근 업로드

기준일: 2026-09-14

## 목적

자료보관함 최상위와 캠퍼스 자료보관함 홈에서, 폴더를 직접 찾아 들어가지 않아도 최근 업로드된 파일 최대 10개를
바로 보고 해당 폴더로 이동할 수 있게 한다. 새 저장소, 새 테이블, 새 R2 구조를 만들지 않고 기존
`file_objects` / 기존 자료보관함 폴더 해석·권한 로직만 재사용한다.

## API

`GET /api/data-core/library/recent?folderId=root|campus:<id>`

응답:

```json
{
  "files": [
    {
      "id": "...",
      "fileName": "2608청강대시상식.ai",
      "folderId": "category:campus-anihi-admission:instagram-source",
      "folderTitle": "인스타소스",
      "campusId": "campus-anihi-admission",
      "campusName": "애니입시관",
      "mimeType": "application/octet-stream",
      "sizeBytes": 123456789,
      "createdAt": "2026-09-14T09:00:00.000Z"
    }
  ]
}
```

R2 key 등 내부 저장 경로는 반환하지 않는다.

## 범위/정렬

- `folderId=root`: 요청자가 읽을 수 있는 전체 범위에서 최신 10개.
- `folderId=campus:<id>`: 해당 캠퍼스로 SQL 단계에서 먼저 제한한 뒤, 같은 캠퍼스 안에서 최신 10개.
- 정렬은 `created_at DESC`이며 서버가 항상 10개로 자른다(클라이언트가 더 많이 받아 자르지 않음).
- 개별 카테고리 폴더 화면에서는 프런트엔드가 이 영역을 다시 표시하지 않는다.

## 제외 대상

- 휴지통으로 이동한 파일(`deleted_at`)
- 이미지 썸네일 파생 파일(`category = image-thumbnail`)
- 자료보관함 폴더로 해석되지 않는 다른 서비스의 `file_objects` 행(SQL 단계에서 자료보관함이 실제로 만들 수 있는
  카테고리만 조회 대상으로 제한: 9개 캠퍼스 카테고리 + `hq-workspace` + `library-material`)
- 완료되지 않은 R2 multipart 업로드 세션(대용량 업로드는 완료돼야 `file_objects` 행이 생기므로 자동으로 제외됨)

## 권한

기존 `fileFolder()` / `libraryFileReadable()`를 그대로 재사용한다. 새 권한 규칙을 추가하지 않았다.

- MASTER: 전체 범위.
- 캠퍼스 관리자/일반 교직원: 자기 캠퍼스로 제한된 카테고리(`student-artwork`, `class-photo`,
  `counseling-material`)는 자기 캠퍼스 것만 보이고, 조직 전체 공개 카테고리는 기존 자료보관함과 동일하게
  캠퍼스 구분 없이 보인다. 이는 새로 만든 제한이 아니라 기존 자료보관함 읽기 권한을 그대로 재사용한 결과다.
- 클라이언트가 보낸 `folderId`(예: `campus:B`)를 그대로 신뢰하지 않는다. 요청한 폴더를 볼 수 있어도, 그 안의
  개별 파일은 각 파일마다 다시 권한을 검사한다.

## 프런트엔드

`public/data-core/work/hq-library.js`의 기존 `load()`/`navigate()`를 재사용한다. 새 페이지나 새 라우팅을
만들지 않았고, 최근 업로드 행 클릭은 기존 `data-lb-folder` 클릭 위임을 그대로 탄다. 업로드 완료와 파일 삭제
후에는 같은 `load()`가 다시 실행되며 최근 업로드 목록도 함께 새로고침된다. `.ai`/`.psd`/`.psb` 등은 썸네일을
새로 만들지 않고 파일 아이콘만 사용한다.

## 테스트

`tests/data-core-library-recent-uploads.test.mjs`:

- 12개 업로드 중 최신 10개만, 최신순으로 반환하는지
- 행 클릭 대상 폴더(`folderId`)가 실제 그 파일이 있는 폴더와 일치하는지
- 휴지통 이동 시 즉시 제외되는지
- 생성된 썸네일과 미완료 multipart 세션이 절대 나타나지 않는지
- 캠퍼스 한정 카테고리는 다른 캠퍼스로 새지 않고, 조직 공개 카테고리는 기존처럼 캠퍼스 간에도 보이는지
- `campus:<다른 캠퍼스>` 범위를 직접 요청해도 폴더별 읽기 권한이 각 파일마다 다시 적용되는지

배포 여부와 실제 운영 확인은 해당 PR evidence에서 별도로 기록한다.
