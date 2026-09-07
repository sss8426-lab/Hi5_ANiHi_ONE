# DATA CORE 상담/업무 모드 병합 후 UI 점검

기준일: 2026-09-07

PR #24 병합 후 사용자 요구사항 기준으로 실제 구현을 검수했다.

## 충족된 항목

- `/data-core`에서 상담용/업무용 이미지 카드 2개 제공
- `/data-core/counseling` 상담용 메뉴 분리
- `/data-core/work` 업무용 메뉴 분리
- 상담용: 공모전·실기대회 / 꿈·전공 로드맵 / 대학합격 로드맵
- 업무용: 자료보관함 / 블로그 자동화 / 인스타 자동화
- 기존 입시컨설팅 기능은 대학합격 로드맵 명칭으로 연결
- 콘텐츠 허브 사용자 노출 명칭 제거, blog/instagram 경로 분리
- 등록 캠퍼스를 동적으로 읽어 자료보관함 최상위 폴더처럼 렌더링
- 공모전 화면 좌측 목록/필터 + 우측 상세 구조 구현
- 일반 사용자에게 관리자 메뉴 기본 숨김

## 즉시 보완 필요

### 1. 자료보관함 sourceApp 폴더 필터

`CAMPUS_FOLDERS`의 `블로그소스`, `인스타소스`에는 `sourceApp`이 정의되어 있으나 폴더 클릭 시 현재 구현은 `campusId/category`만 파일 필터에 반영한다.

보완:
- folder button의 `data-folder-source`도 읽는다.
- `/api/data-core/files` 요청에 `sourceApp=blog|instagram`을 실제 전달한다.
- 폴더 선택 상태를 UI에 명확히 표시한다.
- 같은 category라도 blog/instagram source가 정확히 분리되는 행동 테스트 추가.

### 2. 공모전 실제 포스터/수상작 연결

현재 우측 상세의 포스터와 수상작은 자리표시자/설명 문구 수준이다.

보완:
- competition record 관련 DATA CORE file_objects를 조회하는 방식으로 실제 미디어 연결.
- 포스터/요강 대표 이미지를 우측 상단에 표시.
- 수상작 이미지/파일 썸네일 목록 표시.
- 연결된 파일이 없으면 깔끔한 empty state만 표시하고 허위 미디어를 만들지 않는다.
- 기존 파일 권한을 그대로 사용한다.

### 3. 학원용 안내문 사용 흐름

현재 안내문 텍스트는 자동으로 조합되지만 사용자가 실제로 가져가기 어렵다.

보완:
- `안내문 초안 만들기` 버튼
- 대회 정보 기반 deterministic template 생성(외부 AI API가 없으면 AI처럼 표현하지 않음)
- 편집 가능한 textarea/preview
- `복사` 버튼
- 필요하면 DATA CORE `data_records`에 초안 저장하는 후속 확장 가능한 구조

## 검증

- npm test
- npx tsc --noEmit
- browser JS node --check
- folder sourceApp filtering behavior test
- competition media empty/linked states test
- 안내문 template/copy UI smoke
- 기존 admissions/roadmap/content/readiness smoke 유지

## 원칙

DATA CORE 단일 저장소 유지. 기존 R2 파일 중복 저장 금지. 권한 우회 금지.
