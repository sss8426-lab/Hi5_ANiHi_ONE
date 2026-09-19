# HI5·ANiHi DATA CORE 현재 상태

## 자료보관함 기본 분류 편집 (2026-09-19)

기본 분류 폴더 이름 변경·목록 삭제·복원을 기존 library API에 추가한다. MASTER 전체/캠퍼스 자기 범위 쓰기를 적용하고, 기본 폴더 삭제는 metadata archive로 파일 연결·원본·분류별 보호 권한을 보존한다. `삭제한 기본 폴더`에서 조회/복원이 가능하다. 캠퍼스 자체는 삭제하지 않는다. DB migration/R2 변경 없음. 검증/배포 증거는 해당 PR을 따르며 [공유 정책](LIBRARY_SHARED_ACCESS_2026-09-19.md)에 상세를 기록한다.

## 자료보관함 공유 열람과 최근 파일 (2026-09-19)

기존 폴더 API에 사용자 폴더 이름 변경, 원본 보존 삭제, 같은 캠퍼스 파일 이동을 추가한다. 자기 캠퍼스의 일반 자료를 관리하고 타 캠퍼스의 검증된 일반 파일은 읽기/다운로드만 한다. 원장전용·private·학생·FAMILY 보호와 AI 입력 캠퍼스 경계는 유지한다. 최근 업로드는 전체 캠퍼스 최대 50개, 12개씩 순차 표시한다. 새 DB/migration/R2 bucket 및 운영 데이터 재작성 없음. [자료보관함 공유 정책](LIBRARY_SHARED_ACCESS_2026-09-19.md)과 해당 PR에서 실제 검증/배포 증거를 구분한다.

## 휴무요일 생략 출석부 인식 보강 (2026-09-19)

주간 구분용 빈 열과 휴무요일 생략 때문에 0개로 표시되던 양식에 별도 안전 adapter를 추가했다. 운영 요일·다중 수업칸, 날짜 머리글/집계/공유 수식, 필터와 인쇄 범위를 함께 처리한다. 원본 날짜 오기와 기존 `#REF!`는 경고하며 원본 파일을 변경하지 않는다. 기존 연속 날짜 양식은 유지한다. 실제 검증 범위와 제한은 [주간 양식 복구](ATTENDANCE_SPARSE_IMPORT_2026-09-19.md), 최종 배포 증거는 해당 PR을 따른다.

## 출석부 셀 서식 보존 보강 (2026-09-15)

학생별·요일별·수업칸별 주황/회색/흰색을 분리 보존하고, 보강 문자 때문에 정규 색상 근거를 놓치던 오류를 수정했다. 휴원 병합행 문구, 새 달의 마지막 날짜 외곽선, 원본 열 폭·제목 run font·세로쓰기·병합 테두리의 미리보기를 보강했다. 지난달 날짜별 연휴/메모는 새 달에 복사하지 않으며 원본과 수동 횟수는 보존한다. 로컬 원본의 비교 가능한 반복 셀 1,113개 일치, 근거가 부족한 12칸은 미확인으로 구분한다. 상세와 제한은 [셀 서식 보존](ATTENDANCE_CELL_FIDELITY_2026-09-15.md), 배포는 해당 PR evidence 참조.

## 출석부 자동생성 복구 (2026-09-15)

시트별 선택/원본 월 확인, 복잡한 수식 양식의 명시적 원본 날짜칸 유지, 그림 anchor 검사와 조건부서식 호환을 추가했다. 실제 표 뒤의 1,000행 서식만 있는 영역을 생성 범위로 처리하던 지연을 수정했다. 로컬 실제 파일 5개에서 선택된 시트 생성과 원본 불변을 확인했으며, 한 파일은 원본 날짜칸 유지가 필요하다. 나란한 여러 표/불일치 근거가 있는 미지원 시트는 명확히 표시하고 원본 보존한다. 코드·브라우저 검증 및 제한은 [출석부 복구 기록](ATTENDANCE_RECOVERY_2026-09-15.md) 참조. 배포/운영 인증 검증은 PR evidence와 구분한다.

현재 구현 확인일: **2026-09-14** (아래 후속 항목 우선). 파일명은 기존 문서 링크 호환을 위해 유지한다.

## 운영 마무리 재점검 (2026-09-14)

이번 위치 보강의 기준 main은 `7eae58d117dee490a7add806e935391eb0bb8fe4` (PR #214 OpenAI 검증 기록, #215 캠퍼스 운영 검증 기록 포함)이다. 실제 AI/캠퍼스 확인은 Worker `58a9cc6c-783c-4091-b3e8-57b7fbe3c7e8`에서 수행했고, 이후 PR #214 production Worker `486ad903-0e3b-4a96-b8d7-dba493fbf067`의 100% 배포도 확인했다. 이 값은 검증 시점의 기준이며 후속 위치 PR의 최종 main/Worker는 해당 PR 배포 증거에서 확인한다.

- **OpenAI:** 기존 adapter 배포됨, 사용자가 등록한 `OPENAI_API_KEY` 이름 존재 확인. 값은 읽거나 기록하지 않았다. 설정 모델은 text `gpt-5.6-luna`, image `gpt-image-2.5-flare`. 합성 사진만 사용해 text/image 각각 한 번 실행했으나 모두 안전한 provider 오류 안내로 종료했다. 실제 생성·모델 접근 권한·2160×2700 운영 결과 저장은 **미승인/미확인**이다. 재시도하지 않았고 원인도 키/과금/모델 문제로 단정하지 않는다. 상세 HTTP 관측 한계와 다음 진단 단계는 [OpenAI 운영 검증](CONTENT_OPENAI_WORKFLOW.md) 참조.
- **캠퍼스:** 기존 10개 계정 모두 활성, 최초 변경 완료 **0**, 대기 **10**, 유효 캠퍼스 세션 **0**. 10개 합성 권한/격리/이동 테스트는 통과했다. 실제 2~3개 캠퍼스 CRUD는 담당자의 직접 최초 변경 전까지 **pending**이다. 실제 MASTER 접속 현황 10개·접속 0·오늘 로그인 0과 7개 화면폭을 읽기 전용으로 확인했다. 계정·비밀번호·역할은 바꾸지 않았다. [운영 acceptance](CAMPUS_OPERATION_ACCEPTANCE_2026-09-12.md) 참조.
- **대학 위치:** 한국영상대 2027학년도 공식 전공 17개와 세종 장군면 실제 지도 표식 연결. 전체 3915행에서 verified **67** / needs_review **183** / unknown **3665**. 추천 후보 1616행은 **44 / 77 / 1495**이며 신규 verified는 전체 **47행**, 후보 **36행**이다. 검증 기관은 **3개**(저장 이름 alias 4개). 야간·다른 연도·불명확 전공은 검토 필요로 남긴다. 기존 후보 계산/확률/Haversine/동률 source order는 변경하지 않는다. [공식 위치 근거와 집계](ADMISSIONS_CAMPUS_LOCATIONS.md) 참조.
- **회귀 확인:** Soft Premium/프레젠테이션, 꿈이음 모바일 앱, 중앙 커리큘럼·인쇄의 합성 브라우저 검증 통과. 학생 480px 썸네일·EXIF·원본 확대·신규 업로드 테스트에서 원본 바이트 무변경 확인. Windows Sync 기존 안전 동기화 테스트 **7개 통과**. 설치 프로그램 재설치, 운영 커리큘럼 재import, 물리 프린터 검수는 하지 않았다.
- **보존:** DB migration 없음. 입시 원본의 students/universities/cases/awardFolders/settings 전후 fingerprint 동일. AI용 합성 파일 한 개만 별도 업로드 후 복구 가능한 휴지통으로 정리했고 R2 원본 hash 동일. 실제 학생/작품/MASTER/캠퍼스 계정/FAMILY는 수정하지 않았다.
- **기술부채:** baseline 전체 테스트 **382개 통과**, 기존 lint **89개 오류**, npm audit **12개(높음 8/중간 4)**. 의존성 강제 업데이트나 unrelated lint 수정 없음. 위치 보강의 최종 검사와 신규 오류 비교는 PR evidence에 기록한다.

사람이 해야 할 작업은 각 캠퍼스 담당자의 최소 12자 최초 비밀번호 변경이다. AI는 같은 버튼을 반복해서 누르기보다 비밀값 없는 서버 오류 단계/상태 분류를 먼저 확보하고, 별도로 허용된 제한 호출로 다시 확인해야 한다. 키 재발급·회전이나 과금 변경이 필요하다는 근거는 아직 없다.

## 캠퍼스 표시·자료보관함 통일 (2026-09-14)

캠퍼스 선택창은 서버의 단일 표시 사전을 사용한다. 디자인/애니/범박/원종/중동/옥길/광진/울산/안산/파주 순서이며 정확한 표시명과 보존 정책은 [캠퍼스 표시 정책](CAMPUS_LIBRARY_PRESENTATION_2026-09-14.md)에 기록했다. 자료보관함·블로그·인스타는 실제 폴더 API와 공통 그룹 함수를 사용하여 이름/순서/하위 폴더를 일치시킨다. 출석부 등 공통 캠퍼스 선택창에도 적용된다. 알려진 과거 테스트 캠퍼스는 선택 목록에서 제외하되 복구 가능한 자료와 ID/계정/권한/DB/R2는 변경하지 않는다.

업무 자료보관함·블로그·인스타의 최상위 탐색에서 `본원 작업물`과 그 아래 수업그림/원장전용/자료/제작물 항목을 제거했다. 기존 본원 폴더와 파일은 삭제하지 않으며 권한이 있는 기존 직접 링크는 유지한다. 캠퍼스 내부 폴더 및 본원에 속하지 않는 사용자 생성 폴더는 이름이 같더라도 숨기지 않는다.

## 원본 Excel 출석부 복사 생성 (2026-09-14)

현재 흐름은 **지난달 Excel 업로드 → 다음 달 선택 → 만들기 → 결과 시트 탭 → 다운로드/인쇄**다. 수동 셀 위치·색상 샘플·원본 미리보기 UI는 제거하고, 기존 ZIP/XML 엔진을 재사용하는 자동 분석 adapter로 대체했다. 불확실한 학생만 이름/요일 확인을 받는다. 실제 파일의 입시 3행 블록, 심화 반복 날짜 열, 별도 연도/월을 읽기 전용으로 분석했으며 두 시트를 동시에 생성한다. 이전 실제 출결은 생성본의 날짜 영역에서만 지우고 예정일 스타일을 적용한다.

**업무홈의 꿈이음 바로 아래 출석부**(`/data-core/work/attendance`) 위치와 기존 인증/캠퍼스 정책은 유지한다. 원본 31일 구조/반복 날짜 열/학생 순서/병합/인쇄 설정을 보존한다. 실제 원본 hash 무변경, 등록 학생 39명 입시/20명 심화의 메모리 생성, 8개 화면폭, 다운로드 재열기와 Chromium PDF를 검증했다. 한 장 양식은 한 장, 원래 큰 입시 양식은 학생 블록만 세로 분할한다. 반복 슬롯은 날짜별 기존 개수를 유지하며 요일별 새 열 재배치는 하지 않는다. 실제 교사의 요일 확인/Excel 앱/물리 프린터 검수와 배포 상태는 [출석부 양식 보존](ATTENDANCE_TEMPLATE_PRESERVATION_2026-09-14.md) 및 PR evidence에서 구분한다. 서버 업로드/외부 AI/새 API/DB migration/R2 변경은 없다.

## 커리큘럼 폴더 전용 표지 (2026-09-13)

기초 24·심화 21·입시 3개 폴더의 수업자료를 참고해 별도 표지 48개를 제작한다. 기존 FILES의 curriculum-cover와 폴더 coverFileId를 사용하며 교재/인쇄 926장과 representativeFileId fallback을 보존한다. 640×480 WebP와 첫 화면 우선 로딩, 인증 파일 API를 사용한다. 설계/검증/운영 적용 증거는 [폴더 표지 문서](CURRICULUM_FOLDER_COVERS_2026-09-13.md)와 해당 PR에서 구분한다.

## 이미지 로딩 후속 (2026-09-13)

공통 갤러리의 비차단 미리보기/인접 이미지 캐시, 커리큘럼 웹 미리보기 우선/원본 지연 요청, 중앙 공모전 썸네일 재사용과 신규 업로드 후처리, 자료보관함 클릭 우선순위, FAMILY 인증 후 ETag 재검증을 추가한다. 원본 및 운영 데이터 bulk 변환은 하지 않는다. 합성 측정과 cold 원본 한계는 [PRIVATE_IMAGE_LOADING_2026-09-13.md](PRIVATE_IMAGE_LOADING_2026-09-13.md)를 따른다. 운영 반영은 해당 PR 배포 증거와 구분한다.

## 확대 이미지 연속 보기 (2026-09-13)

공모전, 학생관리/사례, 커리큘럼, 자료보관함, 블로그·인스타 사진 미리보기, 꿈이음/FAMILY 작품과 기존 입시요강 이미지에 공통 확대 갤러리를 연결했다. 좌우 버튼·키보드·터치 스와이프를 지원하며 같은 학생/폴더/수업의 허용된 목록만 연결한다. 원본 확대·인쇄·다운로드·인증 파일 API는 유지하며 DB/R2 변경은 없다. 범위와 검증 절차는 [SHARED_IMAGE_GALLERY.md](SHARED_IMAGE_GALLERY.md)를 따른다. 배포 여부는 해당 PR/Worker 검증 결과와 구분한다.

## 꿈이음 단일 모바일 UI (2026-09-13)

캠퍼스 격리 후속: CAMPUS_ADMIN 보호자 관리 역할 누락을 수정하고 학생/반의 실제 소유 캠퍼스 검사를 보강했다. MASTER 전용 학생 캠퍼스 이동은 기존 FAMILY_DB atomic batch와 audit를 재사용하며 R2 원본/학생 ID/보호자 관계/이력을 보존한다. 여러 캠퍼스에 연결된 보호자의 계정 전체 변경은 MASTER만 가능하다. 상단 캠퍼스 선택과 기존 관리 화면을 통일했다. API 미구현·인증·권한·binding·월간평가 AI adapter 미연결을 구분한 해결 절차는 [캠퍼스 격리 및 API 진단](KKUMEUM_CAMPUS_ISOLATION_AND_API_2026-09-13.md)에 기록했다. 운영 학생 이동은 수행하지 않는다.

교직원/보호자 화면을 480px 모바일 앱 프레임, 네 개 소식 탭, 고정 하단 메뉴와 더보기로 정리한다. 기존 FAMILY 작품/평가/학생/보호자 기능과 인증은 유지한다. 공지 상세 및 draft soft archive를 기존 테이블에 추가하며 새 DB/migration은 없다. 출석 기록 저장/수납/문의 등 미연결 기능, 일정 안내와 실제 예약발송의 차이는 `KKUMEUM_MOBILE_APP_2026-09-13.md`에 명시한다. 출석부 Excel 생성은 위 2026-09-14 후속 항목을 따른다. 운영 데이터 기반 쓰기 검증이나 Push 재발송은 하지 않으며 배포/실제 로그인 smoke는 PR evidence와 구분한다.

## 블로그·인스타 AI 작업실 후속 (2026-09-13)

자료보관함 공통 폴더 API, 사진 중심 입력, 캠퍼스 기본 문구, Responses/Image Edit provider adapter를 기존 콘텐츠·파생 구조에 추가했다. 인스타 최종 출력은 2160×2700/4:5이며 원본 관계와 private 권한을 유지한다. 수동 작성·크롭과 지난 초안도 보존한다.

9월 13일 확인 때는 OpenAI secret이 없었다. **9월 14일 사용자 등록 후 이름 존재를 확인했지만 실제 text/image 각 1회 검증은 실패했다.** 현재 상태는 위 운영 재점검과 [CONTENT_OPENAI_WORKFLOW.md](CONTENT_OPENAI_WORKFLOW.md)를 따른다. 값 조회·새 키 발급·키 변경은 하지 않았으며 기존 D1/R2/FAMILY/계정 데이터는 변경 대상이 아니다.

## 전체 화면 비주얼 후속 (2026-09-13)

PR #200 다음 작업은 홈의 Soft Premium 공통 토큰을 상담/업무/입시/관리 화면 및
FAMILY 표시 스타일에 확장한다. 직업 카드 35개는 각 직업의 기존 전용 포트폴리오
사진에서 만든 경량 작업물 중심 이미지로 교체하고, 계열/업무/공모전/입시에는
새 작업대 사진 5장을 적용한다. 기존 이미지 원본과 모든 운영 데이터는 보존한다.
구현 범위와 실제 검증/배포의 구분은 `CORE_SOFT_PREMIUM_WORK_VISUALS_2026-09-13.md`
및 해당 PR evidence를 따른다. 아래 홈 전용 기록은 이전 작업의 이력이다.

## 홈 비주얼 후속 (2026-09-13, 이전 작업)

main `526df95332cf935e08633bd95173c4fbf1f7fed6`에서 홈 전용 Soft Premium 토큰,
`너와 나의 합격의 순간` / `하이파이브.애니하이`, 카드 설명 정리와 MASTER 전용
프레젠테이션 표시 모드를 작업했다. 기존 메뉴/일정/API/권한/데이터는 유지한다.
신규 초원/가족 사진은 사용자 승인 후 홈 카드에만 적용했다. 다른 페이지의 기존 사진은 보존한다.
최종 로컬 테스트 349개, 홈 8개 화면폭 및 공통 화면 794개 회귀 검사가 통과했다.
로컬/Preview/production 상태를 혼동하지 않도록 상세 검증과 미완료 사항은
`COUNSELING_BRAND_HOME_2026-09-13.md` 및 PR evidence로 구분한다.

## 현재 상태 (2026-09-12)

Windows 관리 PC용 `HI5·ANiHi Sync` 1.0.0: 기존 중앙 curriculum importer를 재사용하는 별도 desktop package. 실행 시 읽기 전용 검사, 명시적 확인 후 동기화, 수정파일 새 버전, source 누락 보존, 진행/취소/재개/verify. 실제 세 과정 검사 결과는 48수업/926장 모두 중앙과 동일하며 이번 작업에서 재apply하지 않는다. 설치물·검증·CI·배포 증거는 PR 최종 코멘트와 `HI5_ANIHI_SYNC.md`에서 구분한다.

커리큘럼 후속: content/admission도 기초/심화와 같은 중앙 API·수업폴더·슬라이드·인쇄 구조에 연결했다. source 읽기 전용 검사에서 3폴더/101 JPG를 확인했다. 과정 선택의 수업 수는 D1에서 조회한다. 기존 기초 24폴더/360장, 심화 21폴더/465장은 재import하지 않는다. 입시과정 운영 import와 배포 완료 여부는 PR evidence로 별도 확인한다.

아래 현재 상태가 이전 날짜의 기록보다 우선한다. 구현, 로컬 검증, production 검증은 구분한다.

- 확인한 main: `0b572d0999b422da1cc60a66c6807aa916b8ca48` (PR #193). production Worker `8ea007b5-3a93-48fd-a54e-d2f03c8a5cf7` 100% 배포 확인 (2026-09-12 02:03 UTC).
- 상담용 메뉴는 **공모전·실기대회 / 꿈·전공 로드맵 / 대학 합격 로드맵 / 꿈을 향한 커리큘럼** 4개다.
- 커리큘럼은 content/design 계열별 기초·심화·입시 경로와 이미지 카드가 있다. content 세 과정은 기존 D1/FILES 기반 중앙 수업폴더, 슬라이드, 개별/전체 인쇄를 사용한다. PR #195/#196에서 실제 기초/심화 45폴더/825 JPG와 3,300파일의 운영 등록 및 원본 SHA256 검증을 완료했다. Git static manifest나 D:를 웹 런타임에서 읽지 않는다. 후속 importer는 기존 원본을 보존하는 새 버전, source 누락 검토 표시, 동일 fingerprint skip을 지원한다. 후속 배포 증거와 물리 cross-PC/프린터 QA 제한은 `CURRICULUM_CENTRAL_LIBRARY.md` 및 PR evidence에서 구분한다. design은 기존 빈 상태를 유지한다.
- 꿈·전공은 D001~D035 stable ID, alias, 4개 대학/학과 페이지, 실기향상 로드맵을 사용한다. 애매한 guideline mapping은 review로 유지한다.
- 대학 TOP30은 기존 후보 선별 후 검증된 캠퍼스 직선거리, 동률은 원래 순서다. 확률로 거리 동률을 재정렬하지 않는다. 미검증은 뒤에 둔다.
- 합격/불합격 사례는 각각 3개 독립 페이지이고, 불합격은 기존 예비번호 내림차순이다. 학생 이미지 첫 5장 우선 로딩과 현재 화면의 decoded image 재사용이 구현되어 있다.
- 자료보관함은 캠퍼스 중심 폴더 브라우저, 원본 파일명 유지, private 읽기, soft-trash 및 별도 WebP 썸네일을 지원한다. 기존 본원 자료는 일반 진입 목록에서만 제외하고 보존한다. 공모전 수상작은 폴더별 표시, 선택/전체선택, 원본 lightbox를 유지한다.
- 블로그/인스타는 공통 FILES와 content draft를 재사용한다. 인스타 2160×2700 deterministic 파생 이미지 및 `derivedFromFileId`가 있으며 AI 이미지 생성으로 표현하지 않는다. 외부 자동 게시의 완료를 뜻하지 않는다.
- FAMILY는 별도 FAMILY_DB/FAMILY_FILES, 학생/보호자 관계 검사, 월간평가/공지/read receipt/Web Push/PWA를 사용한다. 전체 캠퍼스 자동 활성화 및 실제 개인정보 bulk import는 하지 않는다. analytics sync는 계속 비활성이다.

### 역할과 캠퍼스

`MASTER`는 기존 `SUPER_ADMIN`과 같은 서버 관리 권한이다. 기존 MASTER 계정을 바꾸지 않는다. `CAMPUS_ADMIN`은 자기 캠퍼스 운영 데이터만 관리하며, 공용 입시정보는 조회만 가능하다. 계정·권한·시스템·백업/복구·영구삭제는 MASTER 전용이다. `SUPER_ADMIN`, `CAMPUS_DIRECTOR`, `TEACHER`, `STAFF`는 호환을 위해 유지한다.

| 캠퍼스 | 공개 코드 | 로그인 ID |
|---|---|---|
| 부천 애니입시관 | BUCHEON_ANI | ba |
| 부천 디자인입시관 | BUCHEON_DESIGN | bd |
| 부천원종 | WONJONG | wj |
| 부천범박 | BEOMBAK | bb |
| 부천중동 | JUNGDONG | jd |
| 부천옥길 | OKGIL | og |
| 광진 | GWANGJIN | gj |
| 파주 | PAJU | pj |
| 안산 | ANSAN | as |
| 울산 | ULSAN | us |

공개 코드는 기존 campus FK에 연결되며 FK를 재발급하지 않는다. 자세한 정책은 `CAMPUS_ACCOUNTS_AND_PRESENCE.md` 참조. 비밀번호는 문서에 저장하지 않는다. 최초 변경 후 12자 이상 정책, 약 5분 활동 heartbeat, 약 15분 온라인 판정, MASTER 60초 갱신과 서울시간 표시를 유지한다. 기존 입시 원본은 유지하고 캠퍼스 운영 변경은 `campus_admissions_state` overlay에 저장한다. campus 없는 기존 자료를 임의 배정하지 않는다.

### 이번 PHASE 1 / 제한

- `ADMISSIONS_CAMPUS_LOCATIONS.md`: 공식 프로그램/지도 근거가 확인된 위치만 읽기 전용 overlay로 연결한다. 전체 대학 좌표 검증이 완료된 것은 아니다.
- `ADMISSIONS_STUDENT_THUMBNAILS.md`: 새 학생 그림의 480px WebP와 선택 학생 최대 5장 MASTER backfill. 기존 학생 JSON/R2 원본을 변경하지 않는다. 생성 전에는 원본 fallback이다.
- 상담 결과 저장/이력/비교는 후속 PHASE 3 범위이며 이 문서 시점에는 완료로 간주하지 않는다.
- PHASE 2 실제 계정 CRUD는 최초 비밀번호 변경이 필요한 계정의 사용자 직접 단계와 synthetic acceptance를 분리한다. 이번 작업에서 기존 계정 재생성/reset을 하지 않는다.
- 2026-09-12 전체 lint 91개 기존 오류. PR #193 변경 파일 비교는 기존 31/현재 31/신규 0. 의존성 경고 12개(중간 4, 높음 8). 강제 업데이트 없음. 상세 분류와 수정은 PHASE 4 미진행이다.
- PHASE 1은 PR #193 CI/Preview/production 배포 및 읽기 전용 smoke가 확인되었다. 운영 썸네일 bulk/backfill은 실행하지 않았다.
- `CAMPUS_OPERATION_ACCEPTANCE_2026-09-12.md`: 운영 10개 계정 유지 확인, 최초 비밀번호 변경 대기 10개. 현재 합성 권한 검증은 통과했지만 실제 운영 CRUD 완료가 아니다. 사용자가 최초 변경을 완료하기 전 PHASE 2를 완료 처리하거나 PHASE 3/4로 건너뛰지 않는다.

## 과거 기록 (각 기록 작성 시점의 상태)

아래 내용은 역사 기록이며 현재 역할/캠퍼스/검증 상태의 근거로 단독 사용하지 않는다.

## 2026-09-11 직업 상담 내용 감사

D001~D035를 보존하며 직업별 설명·결과물·차이와 다섯 단계의 `실기향상 로드맵`을 정리했다.
네 직업의 쉬운 표시명은 이전 이름을 alias로 유지한다. 대학·입시 데이터는 읽기 전용으로 점검하며
review mapping을 강제 연결하지 않는다. 상세 결과와 남은 한계는 `ROADMAP_CAREER_AUDIT_2026-09-11.md` 참조.
배포 성공 여부와 production 버전은 해당 PR의 최종 증거로 별도 확인한다.

## 2026-09-09 Issue #18 derivative implementation

Instagram now has a deterministic Canvas 4:5 editor, 2160 x 2700 PNG save to the existing FILES, immutable original-file provenance in existing DATA CORE JSON metadata, and draft `derivedFileIds`. Source permissions are inherited and rechecked on output reads. No AI generation, external posting, new DB, schema/binding changes, or real-data migration is included. Existing Phase A/other Phase B production acceptance is not rerun. Production acceptance for these two new items must be recorded separately in Issue #18 after CI, Preview, production deploy and synthetic-only smoke; implementation alone is not production proof.

## 1. 프로젝트의 최종 목적

HI5미술학원·ANiHi만화학원의 모든 정보와 파일을 하나의 중앙 데이터 허브에 축적하고, 여러 웹앱이 동일한 데이터를 공유·검색·분석하도록 만든다.

학생관리 앱 자체가 중심이 아니다. 중심은 `HI5·ANiHi DATA CORE`다.

최종 연결 대상:

- 블로그 글 자동화
- 인스타그램 이미지 편집/글 자동화
- 공모전·실기대회 정보 공유 및 성과 분석
- 입시 데이터 분석과 지원 가능 대학 추천
- 합격/불합격 사례 축적
- 꿈·직업 → 전공 → 대학/학과 → 전형 → 실기능력 → 미술 진도 설계
- 학생작품/연구작/수업사진/학원사진/홍보자료
- 향후 추가되는 모든 HI5·ANiHi 서비스

## 2. 현재 전체 구조

```text
HI5·ANiHi CORE
       |
       v
HI5·ANiHi DATA CORE
       |
       +-- Cloudflare D1
       |     관계 / 메타데이터 / 권한 / 검색 / 지식 그래프
       |
       +-- Cloudflare R2
       |     이미지 / PDF / 엑셀 / 문서 / 백업 스냅샷
       |
       +-- Worker API
       |     모든 앱의 공통 저장·조회·권한검사 경로
       |
       +-- 중앙 자료보관함
       +-- 통합검색
       +-- 공모전·실기대회
       +-- 입시컨설팅
       +-- 꿈·전공 로드맵
       +-- 운영관리 / 휴지통 / 백업 / 진단
```

## 3. 주요 사용 경로

- `/` : 기존 입시컨설팅
- `/data-core` : 상담용/업무용 모드 선택
- `/data-core/counseling` : 상담용 홈
- `/data-core/counseling/competitions` : 상담용 공모전·실기대회 화면
- `/data-core/work` : 업무용 홈
- `/data-core/work/library` : 중앙 자료보관함
- `/data-core/content` : 기존 콘텐츠 deep link, 블로그 자동화로 호환 진입
- `/data-core/content/blog` : 블로그 자동화
- `/data-core/content/instagram` : 인스타 자동화
- `/data-core/roadmap` : 꿈·전공 로드맵
- `/data-core/operations` : 운영관리
- `/data-core/readiness` : 운영환경 진단 화면

## 4. DATA CORE 공통 DB

현재 핵심 구조:

- `organizations`
- `campuses`
- `users`
- `memberships`
- `data_records`
- `file_objects`
- `tags`
- `data_record_tags`
- `audit_logs`
- `data_backups`
- `knowledge_nodes`
- `knowledge_edges`

역할:

- `SUPER_ADMIN`
- `CAMPUS_DIRECTOR`
- `TEACHER`
- `STAFF`

기본 권한 원칙:

- 실제 권한검사는 브라우저가 아니라 Worker 서버에서 수행한다.
- 캠퍼스 사용자는 허용된 캠퍼스 범위만 사용한다.
- 일반 사용자는 기본적으로 본인이 만든 자료만 수정/삭제한다.
- `SUPER_ADMIN`은 전체 관리가 가능하다.
- private 학생/내부 자료는 서버 권한검사를 거쳐서만 제공한다.

## 5. 초기 캠퍼스

- 애니입시관
- 디자인입시관
- 원종
- 범박
- 중동
- 옥길
- 광진
- 파주
- 안산
- 울산

## 6. 중앙 파일 저장소

원본 파일은 R2, 검색/관계 정보는 D1 `file_objects`에 저장한다.

새 DATA CORE R2 경로 예:

```text
data-core/{area}/{organization}/{campus}/{category}/{owner}/{year}/{uuid-file}
```

논리 영역:

- `student-private`
- `documents-private`
- `academy-public`
- `exports-temporary`

보호:

- 파일당 100MB 제한
- 실행파일/스크립트 확장자 차단
- private 파일 권한검사
- 새 DATA CORE 파일은 R2 key를 공개 URL로 직접 노출하지 않음
- fileId 기반 API를 통해 조회

`file_objects.source_app`도 도입되어 파일 출처를 구분한다.

예:

- `admissions`
- `blog`
- `instagram`
- `competition`
- `education`
- `dream-roadmap`
- `data-core`
- `legacy`

서비스별 파일 조회 예:

`GET /api/data-core/files?sourceApp=admissions`

## 7. 중앙 자료보관함

경로:

`/data-core/work/library`

현재 기능:

- `/data-core` 첫 화면에서 상담용/업무용을 이미지 카드로 선택
- 업무용 홈에서 자료보관함, 블로그 자동화, 인스타 자동화만 기본 노출
- 중앙 파일 업로드
- 파일 목록
- 등록 캠퍼스를 DATA CORE campus API에서 읽어 최상위 가상 폴더로 표시
- 조직 공통 가상 폴더
- 캠퍼스별 기본 가상 하위 폴더
- 폴더 선택 시 캠퍼스/분류 필터와 파일 목록 연동
- 파일명 검색
- 권한 기반 파일 열기
- 휴지통 이동
- D1/R2 연결상태 표시

업무용 일반 업로드 분류는 수업사진, 학생그림, 학원사진, 공모전·실기대회,
입시자료, 상담자료, 블로그소스, 인스타소스, 홍보자료의 9개다. 브라우저는
분류만 전달하며, Worker가 분류에 따라 저장 영역·공개 범위·블로그/인스타 출처를
결정한다.

관리자/운영관리/readiness/권한관리는 일반 메인 메뉴에서 숨기고, SUPER_ADMIN 보조 영역으로 분리한다.

## 7-0. 상담용 홈

경로:

`/data-core/counseling`

상담용 기본 메뉴는 다음 3개만 노출한다.

- 공모전·실기대회
- 꿈·전공 로드맵
- 대학합격 로드맵

대학합격 로드맵은 기존 입시컨설팅을 삭제하지 않고 상담용 명칭으로 연결한다.

## 7-0-1. 상담용 공모전·실기대회

경로: `/data-core/counseling/competitions`

- 좌측 수상작 자료실은 `data_records`의 `competition-award-folder` 레코드를 폴더로 표시한다.
- 수상작은 기존 DATA CORE `file_objects`와 R2 원본에 폴더 레코드로만 연결한다. 별도 저장소나 복사본은 만들지 않는다.
- 폴더 삭제는 soft delete이며, 연결된 원본 파일은 보존한다.
- 여러 파일을 한 번에 업로드할 수 있고 이미지 파일은 카드 썸네일로 표시한다.
- 우측 대회 소식은 기존 competition 구조화 데이터의 검색, 상태, 접수 기간, D-day, 원문/요강 링크를 사용한다. 확인되지 않은 일정 수치는 새로 만들지 않는다.
- 기존 입시컨설팅의 운영 데이터와 `admissions-data.json` 호환 계층은 유지하며, 상담용 표기는 `대학 합격 로드맵`으로 통일한다.

## 7-1. 블로그/인스타 자동화

경로:

- `/data-core/content`
- `/data-core/content/blog`
- `/data-core/content/instagram`

현재 기능:

- 사용자 화면에서는 `콘텐츠 허브` 단일 메뉴 대신 `블로그 자동화`, `인스타 자동화`로 분리
- 블로그 초안 작성
- 인스타그램 캡션 초안 작성
- 캠퍼스 선택
- DATA CORE 파일 검색/선택
- 같은 원본 fileId를 블로그와 인스타 양쪽에서 재사용
- 제목/요약/본문 또는 캡션/태그 저장
- 초안 상태 관리: draft, review, ready, published, archived
- 초안 불러오기/수정/삭제
- 인스타그램 기본 출력 규격 `2160 x 2700px (4:5)` metadata 기록

저장 구조:

- 블로그: `data_records.record_type=blog-draft`, `source_app=blog`
- 인스타그램: `data_records.record_type=instagram-draft`, `source_app=instagram`
- 본문/캡션: `content_text`
- 연결 파일: `metadata_json.relatedFileIds`

주의:

- 실제 네이버/인스타 게시 API는 아직 연결하지 않았다.
- AI 생성 결과를 운영 기능처럼 가장하지 않고, 편집 가능한 초안 저장 흐름까지만 제공한다.
- 운영 배포환경에서 실제 CRUD는 별도 검증해야 한다.

## 8. DATA CORE 범용 텍스트

`data_records`에는 다음을 저장 가능하다.

- title
- summary
- `content_text`
- metadata
- tags
- source_app
- campus
- visibility

따라서 다음 긴 본문을 중앙에서 축적할 수 있다.

- 블로그 원문
- 인스타 캡션
- 공모전 상세설명
- 입시요강 해석
- 교육자료
- 전공/꿈 로드맵 설명

통합검색 대상:

- title
- summary
- content_text
- metadata_json
- tags

## 9. 공모전·실기대회

DATA CORE의 첫 실제 업무 도메인으로 연결 완료.

저장 가능:

- 대회명
- 주최/주관
- 관련 대학
- 접수기간
- 대회일
- 발표일
- 대상학년
- 전공
- 실기유형
- 시상/상금
- 접수방법
- 원문/요강 링크
- 상세 분석
- 포스터/PDF/수상작 파일
- 캠퍼스별 출품인원
- 수상인원
- 상격별 수상 수
- 자동 수상률

## 10. 입시컨설팅 → DATA CORE 전환

기존 입시컨설팅은 한 번에 제거하지 않는다.

### 신규 이미지 업로드

`data-core-upload-bridge.js`가 기존 `/api/upload` 요청을 점진적으로 중앙화한다.

- DATA CORE 로그인/권한 확인
- 일반 사용자이며 접근 캠퍼스가 정확히 하나면 중앙 업로드 우선
- SUPER_ADMIN은 조직 공통 업로드 가능
- 여러 캠퍼스로 자동선택이 위험하면 기존 방식 유지
- DATA CORE 업로드 실패 시 기존 업로드로 폴백

분류:

- 학생작품 → `student-private`
- 입시 이미지/수상작 이미지 → `academy-public`
- 기타 → `documents-private`
- `sourceApp=admissions`

기존 `admissions-data.json` 자체는 아직 유지한다.

## 11. 휴지통

중앙 파일의 일반 삭제는 R2 원본을 즉시 삭제하지 않는다.

```text
일반 삭제
  → file_objects.deleted_at 기록
  → 휴지통
  → 복원 가능
  → SUPER_ADMIN 영구삭제 시에만 R2 원본 제거
```

경로:

`/data-core/operations`

## 12. 운영환경 진단

운영관리에서 마스터가 실제 배포환경을 진단할 수 있다.

진단 항목:

- 마스터 인증
- D1 읽기
- D1 임시 probe 쓰기/읽기/삭제
- R2 임시 probe 업로드
- R2 읽기/내용 검증
- R2 삭제 확인

API:

`POST /api/data-core/admin/diagnostics/run`

중요:

GitHub CI 통과와 실제 Cloudflare 운영환경 진단은 별개다. 실제 배포된 환경에서는 마스터가 `/data-core/operations`에서 진단을 한 번 실행해야 한다.

## 13. 운영 데이터 백업

SUPER_ADMIN 전용 R2 스냅샷 백업.

현재 백업 대상:

- organizations
- campuses
- data_records
- file_objects (`source_app` 포함)
- tags
- data_record_tags
- knowledge_nodes
- knowledge_edges

제외:

- users
- memberships
- audit_logs
- 원본 R2 파일 바이트

500행 단위 페이지 파일로 저장하며 manifest를 남긴다.

복원 API는 아직 제공하지 않는다. 운영 데이터를 덮어쓰는 작업이므로 미리보기·충돌정책·검증 절차를 먼저 설계한 뒤 추가한다.

## 14. 꿈·전공 로드맵 지식 그래프

핵심 철학:

`꿈에서 역산해 필요한 교육을 설계한다.`

구조:

```text
꿈·직업
  → 관련 전공
  → 대학·학과
  → 입시전형/실기유형
  → 필요한 실기능력
  → 수업 모듈
  → 미술 진도
```

지식 노드:

- career
- major
- university
- university_program
- admission_method
- skill
- curriculum_module

관계:

- RELATED_MAJOR
- LEADS_TO_PROGRAM
- OFFERED_BY
- USES_ADMISSION_METHOD
- REQUIRES_SKILL
- LEARNED_THROUGH
- PREREQUISITE_OF
- RELATED_TO

초기 진로/전공:

- 웹툰 작가 → 웹툰·만화콘텐츠
- 애니메이터·애니메이션 감독 → 만화·애니메이션
- 게임 캐릭터 디자이너 → 게임그래픽·게임아트
- 시각디자이너 → 시각디자인·커뮤니케이션디자인

기본 수업 흐름:

1. 기초 선·형태·관찰
2. 얼굴 드로잉
3. 인체 드로잉
4. 손·발 드로잉
5. 옷주름·의상
6. 1·2·3점 투시
7. 배경·공간
8. 색채·채색
9. 전공 기초
10. 전공별 실기유형
11. 포트폴리오·입시 완성

경로:

`/data-core/roadmap`

## 15. 실제 입시 대학 데이터 → 로드맵 동기화

기존 입시컨설팅 `universities` 데이터를 로드맵 지식 그래프와 연결하는 동기화 기능이 구현되어 있다.

원본은 수정하지 않고 다음 지식을 stable ID 기반으로 upsert한다.

- university
- university_program
- admission_method

연결:

- 전공 → 대학 학과
- 대학 학과 → 대학
- 대학 학과 → 전형
- 전형/실기유형 → 필요한 skill

사용하는 입시정보:

- 대학명
- 전공/학과
- 전형
- 학년도
- 학생부/실기 비율
- 반영과목
- 경쟁률
- 실기유형
- requiredScores
- conversionRule
- notes

운영관리 마스터 기능:

- 동기화된 대학 수 확인
- 학과/프로그램 수 확인
- 전형 수 확인
- 최근 동기화 시각 확인
- `입시데이터 동기화` 실행

API:

- `GET /api/data-core/admin/knowledge/admissions/status`
- `POST /api/data-core/admin/knowledge/admissions/sync`

중요:

코드는 배포 가능한 상태이지만 실제 운영 데이터 동기화는 운영환경에서 마스터가 실행해야 한다. 이 대화에서 실제 운영 R2/D1 데이터에 동기화를 실행했다고 간주하지 않는다.

### 15-1. 꿈·전공 로드맵 상담 화면

`/data-core/roadmap`은 상담 전용 화면으로 아이콘 카탈로그에서 꿈을 선택하면 DATA CORE 지식 그래프의 관련 전공·대학/학과·필요 역량을 조회한다.

- 대학 표는 대학명, 학과명, 지역, 실기/성적 반영비, 경쟁률, 합격평균성적, 최저성적을 표시한다.
- 원본 입시 동기화 메타데이터에 학년도·전형·실기유형·공식 출처·검수 상태가 있을 때만 함께 표시한다.
- 값이 없는 수치, 출처 또는 검수 상태는 `확인 필요`로 남긴다. 화면이나 코드에 입시 수치를 임의로 추가하지 않는다.
- 공개 준비 흐름은 미술 기초 → 전공 탐색/기초 → 전공 심화 → 대학입시 → 대학 전공교육 → 취업·창작·데뷔로 제한한다. 학원 내부 36개월 세부안은 노출하지 않는다.

## 16. CI 기준

GitHub Actions `DATA CORE CI` 적용.

모든 PR은 최소 다음을 통과해야 main에 반영한다.

1. `npm ci`
2. `npm run build`
3. `npx tsc --noEmit`
4. DATA CORE 브라우저 JavaScript 문법검사

2026-09-07 기준 DATA CORE 관련 PR #1~#13까지 기능별 CI 검증 후 main에 반영됐다.

Issue #18 콘텐츠 자동화 기반 작업은 PR #19에서 다음을 확인했다.

- GitHub Actions `DATA CORE CI`: success
- `npm ci`: success
- `npm run build`: success
- `npx tsc --noEmit`: success
- DATA CORE 브라우저 JavaScript 문법검사: success
- 로컬 `wrangler deploy --dry-run`: success

단, PR #19의 Cloudflare Workers production deployment bot은 실패를 보고했다. Cloudflare Dashboard build log 접근 권한이 필요하므로 실제 운영 배포 성공으로 간주하지 않는다.

Issue #21에서는 PR #20 병합 이후 운영 리소스를 실제로 확인하고 production binding을 교체했다.

- Cloudflare account: `44d44ea5985018a83d093a28f5fb7511`
- D1 `DB`: `site-creator-d1` / `7a25ebae-c784-40a3-bd71-496f3623bf29`
- R2 `FILES`: `anihi-admissions-images`
- Worker: `hi5-anihi-one`
- 운영 URL: `https://hi5-anihi-one.sss8426.workers.dev`
- 운영 Worker version ID: `a44f59ef-4d60-487b-870f-ceba80ea0ec9`
- `DATA_CORE_SUPER_ADMIN_EMAILS` secret 설정 확인
- `wrangler deploy --dry-run`: success
- `wrangler deploy`: success
- `/api/data-core/health`: `ok=true`, `database=true`, `files=true`, `mode=central`
- `/data-core/readiness`: HTTP 200
- R2 쓰기/읽기/삭제 probe: success
- D1 테이블 확인: DATA CORE 기본 테이블 생성 확인
- `wrangler versions upload --dry-run`: success
- PR #22 GitHub Actions `DATA CORE CI`: success
- PR #22 Cloudflare Workers bot: failed, 상세 로그는 PR 댓글의 Dashboard 링크에서 확인 필요

## 17. 아직 실제 운영환경에서 확인해야 할 부분

코드/CI와 실제 배포환경은 구분한다.

운영에서 이미 확인:

1. D1 `DB` 바인딩
2. R2 `FILES` 바인딩
3. `DATA_CORE_SUPER_ADMIN_EMAILS`
4. CLI production deploy
5. 운영 health API
6. 운영 readiness 화면 접근
7. R2 직접 쓰기/읽기/삭제

운영에서 아직 확인 필요:

1. 실제 ChatGPT 로그인 세션에서 마스터/SUPER_ADMIN 확인
2. `/data-core/operations` 운영환경 진단 전체 통과
3. 테스트 파일 업로드 → 열기 → 휴지통 → 복원
4. 백업 생성 및 manifest 확인
5. 입시데이터 동기화 실행
6. `/data-core/roadmap`에서 실제 대학/학과/전형이 연결되는지 확인
7. 단일 캠퍼스 사용자로 입시컨설팅 신규 이미지 업로드 후 `sourceApp=admissions` 파일 생성 확인
8. PR #22 Cloudflare GitHub 연동 build/deploy bot 실패 로그를 Dashboard에서 확인

확인된 Cloudflare D1/R2 resource ID는 Wrangler 생성 설정에만 사용한다. 마스터 이메일 같은 secret 값은 코드에 하드코딩하지 않는다.

## 18. 다음 개발 우선순위

### 1순위: 실제 운영 연결 검증

운영관리 진단과 테스트 업로드/복원/백업/입시동기화를 실제 배포환경에서 확인한다.

### 2순위: 블로그 자동화 → DATA CORE

블로그가 별도 사진 저장소를 만들지 않는다.

- DATA CORE 파일 검색: 1차 구현
- 수업사진/학생작품 선택: 1차 구현
- 생성 원문을 data_records/content_text 저장: 1차 구현
- sourceApp=blog: 1차 구현
- 게시 이력 축적: 외부 게시 API 연결 후 후속 구현

### 3순위: 인스타 자동화 → DATA CORE

같은 원본 사진을 재사용한다.

- sourceApp=instagram: 1차 구현
- 이미지 편집 결과: 파생 파일 metadata 계약 준비, 실제 편집 엔진은 후속 구현
- 캡션: 1차 구현
- 해시태그: 1차 구현
- 게시 이력: 외부 게시 API 연결 후 후속 구현

### 4순위: 입시 지식 고도화

- 대학 공식요강 출처
- 검증일
- 학년도 최신성
- 합격/불합격 사례 → 대학 학과 연결
- 대학별 실기유형 → 수업 모듈 세부 연결

### 5순위: AI Knowledge Layer

데이터가 충분히 축적된 뒤:

- FTS 전문검색
- 의미/벡터 검색
- 합격/수상/수업성과 패턴 분석
- 대학 지원 추천
- 부족 역량 분석
- 교육과정 추천
- 콘텐츠 추천
- 학원 미래 방향성 분석

으로 확장한다.

## 19. 앞으로 지켜야 할 개발 원칙

1. 새 앱마다 별도 데이터 저장소를 만들지 않는다.
2. 모든 원본 파일은 중앙 R2를 사용한다.
3. 관계/메타데이터/권한은 중앙 DB를 사용한다.
4. 모든 앱은 DATA CORE API를 통해 읽고 쓴다.
5. 가능한 데이터에는 campus/sourceApp/type/tags를 남긴다.
6. private 데이터는 Worker 서버 권한검사를 거친다.
7. 삭제는 중앙 휴지통 구조를 사용한다.
8. 잘 작동하는 기존 기능은 점진적으로 전환한다.
9. 검증되지 않은 대학/입시정보를 임의 생성하지 않는다.
10. 기능은 branch → CI → PR → main 순서로 반영한다.
11. 학생관리 자체가 최종 목적이 아니다.
12. 최종 목표는 축적된 데이터로 교육·입시·마케팅·운영의 미래 방향을 분석하는 것이다.

## 20. Issue #43 PWA cache acceptance fix (2026-09-09)

Production acceptance found an installed guardian PWA serving an obsolete shell
without the report-confirmation script, while the network HTML was current.
The narrowly scoped fix uses a versioned FAMILY-only shell cache, online
revalidation, current-cache offline fallback, and precaches the confirmation
script. Private APIs remain network-only; no DB/R2 or subscription changes.
See `docs/KKUMEUM_FAMILY_SHELL_CACHE.md` for the contract and synthetic tests.
Deployment and remaining guardian/device acceptance must be verified separately
in Issue #43; this source note does not claim production completion.

## 21. Issue #43 delivery resilience follow-up

Synthetic concurrent publication reproduced two successful responses for one draft. The publish path now checks the conditional update result so only its winner can dispatch Push; no schema, binding, credentials, or production records change with this fix.

Additional isolated behavior coverage: concurrent/repeated publish, expired subscription 404/410, provider rejection/network failure, no-device subscription, and artwork object/metadata failure followed by retry. Production acceptance remains separately tracked in Issue #43; local tests do not establish OS notification receipt or the outstanding authenticated negative-access check. Existing successful production upload, report read receipt, and provider delivery are not repeated.

Local validation: npm ci, build (through npm test), TypeScript noEmit, all 37 public JavaScript syntax checks, 218/218 tests without skips, and Wrangler deploy dry-run passed. The full suite includes the isolated synthetic restore drill and production-target rejection guard. CI, Preview and production evidence are recorded separately on the PR/Issue after verification.

## 22. Library folder browser (2026-09-11)

Folder navigation, breadcrumb/history, nested-folder creation, shared upload queue, authenticated download and recoverable file trash now use one library browser. Existing HQ records and virtual campus categories are retained. Only verified shared library lineage grants cross-campus reads; generic #166 campus restrictions and private/FAMILY boundaries remain. No storage/schema/binding replacement or real data migration. See `docs/LIBRARY_FOLDER_BROWSER.md` for behavior/security tests and deployment evidence scope.

## 23. Library recent uploads (2026-09-14)

자료보관함 최상위와 캠퍼스 홈에 최근 업로드 10개 바로가기를 추가했다(`GET /api/data-core/library/recent`).
기존 `file_objects`와 기존 자료보관함 폴더 해석·권한 함수(`fileFolder`/`libraryFileReadable`)만 재사용했고
새 테이블·새 R2 구조·새 권한 규칙은 만들지 않았다. 썸네일·파생 이미지·휴지통 파일·완료되지 않은 multipart
세션은 자동으로 제외된다. 프런트엔드는 기존 `navigate()`/`load()` 흐름을 그대로 재사용한다. 자료보관함 외
다른 서비스는 변경하지 않았다. 계약과 테스트 목록은 `docs/LIBRARY_RECENT_UPLOADS_2026-09-14.md`를 따른다.

## 25. 블로그 자동화 네이버 홈피드형 콘텐츠 전략 및 발행 패키지 (2026-09-14)

블로그 "AI로 글 작성"을 사진 선택 → 글 방향(검색형/홈피드형/균형형, 기본 균형형) →
AI 전략 분석(핵심 주제 1개 + 제목 후보 3개 + 본문 초안 1회 생성) → 제목 선택 → 발행 패키지 완성
흐름으로 확장했다. [바로 글 만들기]로 제목 선택을 건너뛰고 기존처럼 한 번에 생성할 수도 있다.
제목을 strategyMode 추천과 다른 후보로 바꾸면 사진을 다시 보내지 않고 `POST /api/data-core/content/refine`
(`mode:'retitle'`)로 lead/body만 최소 재작성하고, [다른 제목 만들기]도 같은 엔드포인트의
`mode:'titles'`로 제목만 다시 만든다(비용 제어). 서버는 생성 직후 홈피드 품질검사(핵심주제·제목-도입부
일치·키워드 반복·광고 비중)를 거쳐 문제가 있으면 정확히 한 번만 교정 재작성하고, 그래도 남는 문제는
`warnings`로만 알린다(무한 재생성 없음). 최근 블로그 초안 제목을 함께 보내 중복 제목을 피하도록
지시하고, 클라이언트도 근접 중복을 비차단 경고로 보여준다. 다음 콘텐츠 아이디어 3개, 발행 전 확인
체크리스트, 네이버 발행용 복사(제목/본문/해시태그/CTA + 이미지 순서, plain text)를 추가했다.
네이버 비공식 자동 로그인/자동 발행(쿠키 저장, 세션 탈취, CDP 제어, CAPTCHA 우회, RabbitWrite 직접
호출 등)은 만들지 않았다 — Generation과 Publishing을 논리적으로 분리해 두었을 뿐이다. 기존
draft(`title`/`content`/`hashtags`/`cta`)는 그대로 열리고, 새 필드는 metadata에 additive로만
저장된다(DB migration 없음). 인스타 자동화는 코드 한 줄도 바뀌지 않았다. 세부 내용과 테스트는
`docs/BLOG_HOMEFEED_CONTENT_STRATEGY_2026-09-14.md`를 따른다.

## 직업 이미지 리뉴얼 2단계 (2026-09-19)

직업 카드와 상세 상단 이미지를 현장/결과물 중심으로 갱신했다. D002/D012/D020 승인 샘플은 유지하고,
나머지 32개는 새 생성 이미지의 versioned WebP로 연결한다. 카드 640x480, 신규 상세 1440x1080,
4:3 contain으로 원본 장면이 잘리지 않도록 한다. 기존 cover/portrait/105개 상세 교육 이미지는 보존한다.
D001~D035와 직업명/전공/대학/입시/실기 로드맵 및 운영 데이터는 변경하지 않는다.
MASTER/SUPER_ADMIN 전용 `/data-core/roadmap/image-review`에서 35개와 이름 가리기를 제공한다.
직업별 검수 및 실제 배포/검증 경계는 `docs/ROADMAP_IMAGE_REVIEW_FINAL_2026-09-19.md` 참조.

## 수상작 공용 라이브러리 (2026-09-20)

재원생/공개 수상작을 위아래 두 그룹으로 구분하고 그룹별 한글 숫자 이름 정렬을 제공한다.
업무용 학원 계정 6개 역할이 공용 폴더/하위폴더(최대 8단계), 업로드, 다운로드, soft-trash를 사용한다.
기존 미분류 폴더/ID/원본 이름/파일/R2는 유지하며 마스터가 분류와 폴더 복원을 관리한다.
공모전 소식 아래 append-only 관리 이력은 생성/삭제/업로드/명시 다운로드와 작업자·캠퍼스를 표시한다.
썸네일/확대 GET은 다운로드 이력이 아니며 private/student-private/FAMILY 보호는 유지한다.
새 DB/migration 없이 기존 records/files/audit 구조를 확장했다. 상세 계약과 검증 경계는
`docs/AWARD_SHARED_WORKSPACE_2026-09-20.md` 참조. 운영 mutation smoke는 별도 확인 전 완료로 간주하지 않는다.
