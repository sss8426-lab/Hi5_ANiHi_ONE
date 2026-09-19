# 수상작 공용 라이브러리 (2026-09-20)

## 적용 범위

`/data-core/counseling/competitions`의 수상작 폴더/파일만 확장한다. 대회정보, 외부 소식, 마감일 캘린더 투영, 자료보관함/AI/FAMILY 정책은 변경하지 않는다.
기존 `data_records` (`record_type=competition-award-folder`, `source_app=competition`), `file_objects`, `FILES`, `audit_logs`를 재사용한다. 신규 migration/DB/bucket 없음.

## 폴더와 권한

| 작업 | MASTER/SUPER_ADMIN | CAMPUS_ADMIN/DIRECTOR/TEACHER/STAFF | 익명/FAMILY/조직 비회원 |
|---|---|---|---|
| 공용 폴더/파일 조회 | 허용 | 허용 | 차단 |
| 폴더/하위폴더 생성 | 허용 | 허용 | 차단 |
| 폴더 soft-delete | 허용 | 허용 | 차단 |
| 이미지 업로드/다운로드/soft-trash | 허용 | 허용 | 차단 |
| 폴더 복원/기존 분류 지정 | 허용 | 차단 | 차단 |
| 감사 이력 편집/삭제 | 제공 안 함 | 제공 안 함 | 차단 |

기존 private 폴더는 작성자/마스터만, private/student-private 파일은 원 소유자/마스터만 접근한다. 이들의 새 감사 이벤트는 공용 이력에서 제외하고 마스터에게만 표시한다. 로그인했더라도 학원 조직 membership이 없거나 비밀번호 변경이 필요한 세션은 차단한다.

- 첫 그룹: 재원생 수상작 모음 (`enrolled`), 두 번째 그룹: 공개 수상작 모음 (`public`).
- metadata에 `schemaVersion:1`, `collectionType`, nullable `parentFolderId` 추가. 실제 폴더 ID 관계를 사용하며 최대 8단계(최상위 포함).
- 새 폴더는 캠퍼스 NULL, organization 공유. 자식은 최상위 분류를 상속한다. 클라이언트 campus/owner/role은 권한 근거가 아니다.
- 기존 미분류 폴더는 원본 그대로 첫 그룹에 `분류 확인 필요`로 노출한다. 자동 DB 분류/재생성하지 않는다. 마스터가 최상위 분류를 명시적으로 지정할 수 있다.
- 부모 이동은 제공하지 않는다. 서버에서 부모 변경/자기참조/순환·깊이 초과를 거절한다.
- 삭제는 선택한 폴더 record만 soft-delete. 자손과 연결 파일은 수정하지 않고, 조회 시 삭제된 조상을 검사하여 숨긴다. 마스터가 운영관리에서 부모부터 복원하면 원래 ID/연결로 다시 표시된다.
- 파일 soft-trash는 기존 R2 원본 보존. 기존 운영관리 파일 복원 사용. 기존 마스터 전용 영구삭제 API 자체는 유지하되 수상작 선택삭제에서는 호출하지 않는다.
- URL `?awardFolder=ID`, breadcrumb/back/forward/reload. 그룹별 `ko-KR`, numeric 이름 오름/내림차순을 localStorage로 기억한다.

## API

- GET/POST `/api/data-core/awards/folders` (`collectionType`, `parentId`, `offset`; 100개 단위)
- GET/PATCH/DELETE `/api/data-core/awards/folders/:id` (PATCH는 마스터 최상위 collectionType만)
- POST `/api/data-core/awards/folders/:id/restore`, GET `folders?trash=1` (마스터)
- 기존 POST `/api/data-core/files` + recordId/category로 이미지 업로드. JPG/PNG/WebP/GIF만 허용.
- 기존 GET `/api/data-core/files?recordId=...&category=competition-material&limit=100` 및 인증된 파일/썸네일 API 유지.
- 기존 DELETE `/api/data-core/files/:id?awardFolderId=...`는 이제 soft-trash. 잘못된 폴더 ID는 403.
- POST `/api/data-core/awards/files/:id/download`: 명시적 다운로드. Origin/조직/원본·조상 권한 검사 후 R2 object가 존재할 때 감사기록+attachment 응답.
- GET `/api/data-core/awards/activity?filter=all|folder|upload|download&cursor=...`: 최근 25개, `(created_at,id)` keyset. 일반 사용자 restricted 이벤트 제외.
- Mutation은 같은 Origin 필수. Generic records/files 경로에서도 동일 정책을 적용해 우회 방지.

## 원본과 이력

- multipart File.name → `original_file_name` → UI/다운로드 filename*. 한글·공백·괄호 및 중복 이름 유지. R2 key의 UUID만 별도 충돌 방지. 과거 이름 추측/재작성 없음.
- 기존 코드도 원본 파일명을 사용하고 있었으므로 불필요한 이름 마이그레이션은 하지 않았다. folderName 기반 변환을 새로 도입하지 않는다.
- `audit_logs.resource_type=competition_award`: folder.create/delete/classify/restore, file.upload/download/trash/restore. 사용자/캠퍼스 표시명 snapshot과 타깃·부모·분류/시각 저장. UI에는 내부 ID/키/이메일을 노출하지 않는다.
- 폴더 변경/파일 trash·restore와 감사 insert는 D1 batch로 묶고 변경 행이 있을 때만 기록한다. UI 요청 중복 클릭 차단.
- preview/thumbnail/lightbox GET은 다운로드 로그를 쓰지 않는다. 다운로드 로그는 **인증된 전송 응답이 준비됨**을 뜻하며 브라우저 디스크 저장 완료를 보장하는 것은 아니다.
- D1 metadata만 조회, R2 listing 없음. 기존 썸네일 lazy loading/인증 이미지 캐시 재사용. 폴더당 파일 조회는 기존 100개 상한 유지.

## 검증과 배포 경계

- `tests/award-shared-workspace.test.mjs`: 6역할, 익명/조직비회원/FAMILY 차단, 깊이8/순환, 미분류, 중복 한글 이름, 명시 다운로드, 감사 keyset, private/원본/FAMILY 보존.
- 기존 gallery/content/rendered-html 테스트의 이전 purge/empty-only 기대치를 새 soft-trash 정책으로 갱신. 마스터 명시적 purge의 참조보호·실패복구 테스트는 별도 경로로 유지한다.
- `scripts/check-award-shared-browser.mjs`: 실제 빌드 Worker + **일회성 합성 D1/R2**에서 클릭/업로드/다운로드/복원, 8폭 검사. 외부 뉴스 제공자는 빈 합성 응답 사용.
- `AWARD_ASSET_ORIGIN` 검증은 배포된 asset hash를 확인하고 동일 자산을 합성 backend로 테스트한다. 이것을 운영 DB 인증 mutation 성공으로 표현하지 않는다.
- 작업 시작 운영 read-only 집계: 폴더 9, 연결 파일 70, competition records 10. SELECT `rows_written=0`. 운영 사용자/학생/원본 파일 내용은 테스트 fixture에 사용하지 않았다.
- 최종 실행 및 배포 결과는 PR/완료 보고에 별도 기록한다. 확인하지 않은 운영 동작은 완료로 표시하지 않는다.
