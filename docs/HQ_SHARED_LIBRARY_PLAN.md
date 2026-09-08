# 본원 작업물 공용 자료영역

사용자 요청 기준으로 업무용 `자료보관함`의 `자료 폴더` 아래, `입시관` 위에 본원에서 전 캠퍼스에 배포하는 공용 작업물 영역을 추가한다.

## 화면 순서
1. 자료 폴더
2. 본원 작업물
3. 입시관
4. 예비관

## 기본 본원 폴더
- 수업그림
- 원장전용
- 자료
- 제작물

## 권한
- 폴더 생성/이름변경/삭제: SUPER_ADMIN(마스터)만
- 본원 작업물 업로드: SUPER_ADMIN만
- 일반 캠퍼스 업무계정: 허용된 본원 작업물 조회/다운로드
- 실제 `원장전용` 폴더의 추가 읽기 제한은 별도 정책 승인 전 폴더명 의미만 유지하고, 이번 요청에서는 임의 권한모델을 추가하지 않는다.

## 저장 구조
새 R2/D1을 만들지 않는다.
- 폴더 메타데이터: 기존 DATA CORE `data_records`
  - `recordType=hq-library-folder`
  - `sourceApp=data-core-library`
  - `campusId=null`
  - `visibility=organization`
- 파일: 기존 `FILES` R2 + `file_objects`
  - `category=hq-workspace`
  - `recordId=<hq folder record id>`
  - `campusId=null`
  - `visibility=organization`

본원 폴더는 논리 폴더이며 R2 bucket/prefix를 별도 저장소처럼 중복 생성하지 않는다.

## 기본 폴더 seed
기본 4개는 idempotent seed로 생성해 중복되지 않게 한다.
사용자 추가 폴더는 `system=false`, 기본 4개는 `system=true`로 구분한다.

## 서버 규칙
- `hq-workspace` 업로드는 SUPER_ADMIN + 유효한 hq-library-folder recordId가 필수.
- 캠퍼스 사용자가 client를 조작해 업로드하려 해도 403.
- 일반 DATA CORE 파일/캠퍼스 자료의 권한·분류는 변경하지 않는다.
- 폴더 CRUD와 본원 파일 업로드는 audit log에 남긴다.

## UI
`본원 작업물` 섹션에 기본 4개 폴더 카드를 표시한다.
마스터에게만 `+ 폴더 추가` 버튼을 표시한다.
폴더 클릭 시 파일 목록은 `recordId`로 필터한다.
본원 폴더가 선택된 상태에서 업로드를 열면 캠퍼스=조직 공통, 분류=본원 작업물, recordId=선택 폴더로 고정한다.

## 테스트
- 본원 작업물 섹션이 입시관보다 앞에 렌더
- 기본 4개 이름/순서 정확
- seed 재실행 중복 없음
- SUPER_ADMIN 폴더 생성 가능
- 일반 계정 폴더 생성 403
- 일반 계정 hq-workspace 업로드 403
- SUPER_ADMIN 유효 folder recordId 업로드 성공
- folder recordId filter 동작
- 기존 캠퍼스 9개 분류/입시관·예비관/자료보관함 회귀 green
