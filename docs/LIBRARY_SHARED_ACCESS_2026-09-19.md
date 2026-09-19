# 자료보관함 공유 열람과 관리 권한

기준 main: `eea660467e7e4683e6d3bdc6ca26ae9c83036a32`. 이전 문서의 10개 최근 파일/빈 폴더 전용 삭제 정책보다 이 문서가 우선한다.

## 권한표

| 기능 | MASTER / SUPER_ADMIN | 자기 캠퍼스 쓰기 사용자 | 다른 캠퍼스 |
| --- | --- | --- | --- |
| 일반 폴더 열기 | O | O | O |
| 일반 파일 보기 / 다운로드 | O | O | O |
| 사용자 폴더 생성 / 이름 변경 | O | O | X |
| 사용자 폴더 삭제 | O | O | X |
| 파일 업로드 / 이동 / 휴지통 | O | O | X |
| 기존 휴지통 복원 | 기존 전체 권한 | 기존 소유/관리 권한 | X |

쓰기 사용자는 실제 membership의 CAMPUS_ADMIN / CAMPUS_DIRECTOR / TEACHER / STAFF이며 context.canWrite가 필요하다. 클라이언트 campus/role/owner는 권한 근거가 아니다. 자기 캠퍼스 일반 자료는 다른 작성자의 파일/폴더도 관리하지만 보호파일 소유권은 확대하지 않는다.

## 보호 경계

- 공유 읽기는 library-folder 전체 ancestry, 동일 조직/캠퍼스/분류, data-core-library source, non-private visibility 및 허용 area를 검증한다. class-photo의 기존 campus shareMode를 재작성하지 않고 일반 non-private 파일의 자료보관함 읽기만 허용한다.
- student-private, explicit private, FAMILY/kkumeum, 학생/보호자/상담자료, 백업, 미확인 legacy linkage는 공유 범위에 추가하지 않는다. 학생그림 기본 업로드는 계속 student-private다. 일괄 홍보 허용 변환은 없다.
- 원장전용과 하위 폴더는 master-only다. 과거 organization visibility가 저장되었더라도 공개하지 않는다. 기존 row/ID/visibility는 수정하지 않는다.
- Generic files API와 AI 입력, FAMILY/입시의 캠퍼스 제한은 유지한다. 자료보관함 다운로드 권한으로 AI 입력 권한을 결정하지 않는다.
- Mutation은 exact same-origin과 실제 source/target 폴더/캠퍼스를 서버에서 검사한다. private R2 URL 공개 없음.

## 폴더와 이동

### 기본 분류 폴더 편집 후속

수업사진/학생그림 등 기본 분류와 기존 본원 기본 폴더도 이름 변경 및 삭제가 가능하다. MASTER/SUPER_ADMIN은 전체, 캠퍼스 쓰기 사용자는 자기 캠퍼스만 가능하다. 캠퍼스 자체/root/hq/organization 및 임의 system-managed 폴더는 편집 대상이 아니다. 원장전용은 이름을 바꿔도 MASTER 전용으로 유지한다.

기본 폴더는 파일 권한의 기준이므로 DELETE 시 기존 data_records.metadata_json의 libraryArchived=true로 목록에서 제거한다. ID/category/visibility/file_objects 연결/R2 바이트는 유지한다. 일반 사용자 폴더의 기존 soft-delete/relink와 구분한다. 별도 DB/migration 없음. 기본 폴더를 강제로 일반 미분류로 옮겨 개인정보 범위를 넓히지 않는다.

해당 캠퍼스 또는 본원에서 `삭제한 기본 폴더` → 자료 보기 → `폴더 복원`으로 되돌릴 수 있다. GET folders?parentId=...&archived=1은 해당 범위 관리자만, PATCH folders/:id {restore:true}도 같은 쓰기 권한을 검증한다. 삭제 상태에서는 업로드/이름 변경/하위 폴더 생성/이동/자료보관함 파일 삭제를 차단하고 읽기 권한은 유지한다. 하위 폴더 또는 진행 중인 multipart 업로드가 있으면 삭제를 차단한다. 복원할 이름이 다른 폴더와 중복되면 409다.

이 후속 정책이 아래의 기존 기본 폴더 편집 제한보다 우선한다. 블로그/인스타도 동일 API의 변경된 제목/목록을 사용한다. 합성 API/브라우저 검증과 실제 운영 로그인/쓰기 검증은 구분한다.

기존 data_records와 file_objects만 사용한다. 새 DB/bucket/migration 없음.

- PATCH library/folders/:id: title만 변경, trim/80자/중복 검사. 시스템/virtual 캠퍼스·기본 폴더의 ID/구조/이름은 유지한다. 사용자 생성 일반 폴더가 관리 대상이다.
- DELETE: 폴더 soft-delete와 내부 파일(휴지통 포함) relink는 D1 atomic batch다. 보호 범위가 같은 상위 폴더 또는 분류 root에 연결한다. 일반 campus-root 폴더는 미분류(category:campus:library-material)에 연결한다. 파일 row/ID/원본/R2 경로/owner/visibility를 삭제·교체하지 않는다.
- 하위 폴더가 있으면 409로 먼저 정리를 안내한다. 재귀 삭제하지 않는다. 동일 보호 범위의 복구 위치가 없으면 먼저 안전한 위치로 이동하도록 안내한다.
- PATCH library/files/:id의 folderId: 같은 캠퍼스 이동. 일반 자료 분류 간에는 category만 함께 갱신한다. 원본/visibility/owner 유지. 보호 범위 변경, 다른 캠퍼스 이동, 파생 파일 단독 이동 금지.
- 파일 개수는 D1 metadata 집계 후 같은 읽기 정책으로 검사한다. 직접 포함된 파일 수이며 trash/보호자료는 권한에 따라 제외한다. R2 list/read로 계산하지 않는다.
- MASTER는 root의 본원 작업물 바로가기에서 기존 HQ 폴더를 관리한다. 일반 사용자 root는 기존 캠퍼스 중심이다.

## 최근 업로드

기존 GET /api/data-core/library/recent 재사용. root는 전체 캠퍼스, folderId=campus:id는 해당 캠퍼스 필터다. created_at DESC, id DESC keyset scan으로 허용 파일 최대 50개를 반환한다. private/학생/상담/원장전용/파생/trash/미완료 multipart 제외. 보호 파일이 앞에 많아도 뒤의 허용 파일을 계속 검사한다.

인증된 library preview/download/thumbnail endpoint 사용. 첫 12개 이후 IntersectionObserver로 12개씩 추가, 최대 50개. bytes는 보이는 thumbnail/사용자 클릭 시 기존 private cache로 요청한다. 파일명/캠퍼스/폴더/시간과 권한별 관리만 표시한다.

블로그/인스타는 기존 DataCoreLibraryClient와 동일 폴더 API를 사용한다. 별도 폴더 registry/cache 없음.

## 검증과 제한

library-shared-management.test.mjs는 실제 Worker와 격리된 Miniflare D1/R2에 합성 MASTER/SUPER_ADMIN/CAMPUS_ADMIN/DIRECTOR/TEACHER/STAFF/A/B를 사용한다. 읽기/쓰기 분리, 403, CSRF, rename/move/delete/restore, 원본 보존, private/FAMILY/원장전용 및 AI 권한 비확대를 검사한다.

최근 파일 테스트는 60개 중 최신 50개, cross-campus, 파생/trash 제외를 검사한다. library-browser-smoke.mjs는 실제 브라우저 흐름/responsive/12→50 및 권한별 버튼을 확인한다. Preview/production 옵션은 배포 asset bytes를 비교하지만 쓰기 API는 격리된 합성 D1/R2에서 실행한다. 운영 계정 로그인/운영 쓰기 검증과 혼동하지 않는다. 최종 검사/PR/CI/Worker version은 PR evidence에 기록한다.
