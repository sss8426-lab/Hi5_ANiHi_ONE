# HI5·ANiHi DATA CORE 현재 상태

기준일: 2026-09-07

## 1. 프로젝트 목적

HI5미술학원·ANiHi만화학원의 모든 정보와 파일을 하나의 중앙 데이터 허브에 축적하고, 여러 웹앱이 동일한 데이터를 공유·검색·분석하도록 만드는 것이 최종 목적이다.

학생관리 앱 하나가 중심이 아니다. 중심은 `DATA CORE`다.

향후 연결 대상:

- 블로그 글 자동화
- 인스타그램 이미지/글 자동화
- 공모전·실기대회 정보 공유 및 성과 데이터
- 입시 데이터 분석과 지원 가능 대학 추천
- 합격/불합격 사례 축적
- 전공·직업·대학·입시·교육과정 로드맵
- 학생작품/연구작/수업자료/학원사진
- 향후 추가되는 HI5·ANiHi 서비스

## 2. 현재 구조

```text
HI5·ANiHi CORE
       |
       v
HI5·ANiHi DATA CORE
       |
       +-- Cloudflare D1 : 관계/메타데이터/권한/검색 기준
       +-- Cloudflare R2 : 이미지/PDF/엑셀/문서 원본
       +-- Worker API    : 모든 앱의 공통 저장/조회 경로
       |
       +-- 입시컨설팅 (기존 앱 유지)
       +-- 공모전·실기대회 (DATA CORE 연결 완료)
       +-- 중앙 자료보관함 UI
       +-- 통합검색
       +-- 운영관리/휴지통/백업
```

## 3. main에 반영된 주요 작업

### DATA CORE Foundation

- organizations
- campuses
- users
- memberships
- data_records
- file_objects
- tags / data_record_tags
- audit_logs
- 공통 D1/R2 API
- OpenAI Hosting 로그인 정보 동기화
- 캠퍼스/역할 기반 권한
- 파일 메타데이터 중앙 기록

역할:

- SUPER_ADMIN
- CAMPUS_DIRECTOR
- TEACHER
- STAFF

기본 정책:

- 캠퍼스 사용자는 소속 캠퍼스 범위 사용
- 일반 사용자는 본인이 만든 자료만 수정/삭제
- SUPER_ADMIN은 전체 관리
- 실제 권한검사는 브라우저가 아니라 Worker 서버에서 수행

### 통합 텍스트 데이터

`data_records.content_text`를 통해 다음과 같은 긴 본문을 중앙 저장 가능:

- 블로그 원문
- 인스타 캡션
- 공모전 상세 설명
- 입시요강 해석
- 전공/꿈 로드맵
- 교육자료

통합검색 대상:

- title
- summary
- content_text
- metadata_json
- tags

### 중앙 파일 저장

새 DATA CORE 업로드 경로 예:

```text
data-core/{area}/{organization}/{campus}/{category}/{owner}/{year}/{uuid-file}
```

논리 영역:

- student-private
- documents-private
- academy-public
- exports-temporary

기본 보호:

- 100MB 업로드 제한
- 실행파일/스크립트 확장자 차단
- private 자료 서버 권한검사
- 새 DATA CORE 파일은 기존 공개형 `/api/files/{r2-key}` 경로로 직접 열 수 없음

### 캠퍼스 초기값

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

### 공모전·실기대회

DATA CORE의 첫 실제 도메인 서비스로 연결 완료.

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
- 캠퍼스별 출품 인원
- 수상 인원
- 상격별 수상 수
- 자동 수상률

### 중앙 자료보관함 UI

경로:

`/data-core`

기능:

- 파일 업로드
- 파일 목록
- 캠퍼스 필터
- 분류 필터
- 파일 검색
- 권한 기반 열기/삭제
- DATA CORE 통합검색
- 공모전 조회/등록
- SUPER_ADMIN 권한관리
- D1/R2 연결 상태 확인

### 휴지통

일반 파일 삭제는 이제 R2 원본을 즉시 지우지 않는다.

- DELETE → `deleted_at` 기록 → 휴지통 이동
- 원본 R2 object 유지
- 본인 파일 복원 가능
- SUPER_ADMIN만 영구삭제 가능
- 영구삭제 시에만 R2 원본 제거

운영관리 경로:

`/data-core/operations`

기능:

- 휴지통 목록
- 캠퍼스/검색 필터
- 복원
- SUPER_ADMIN 영구삭제

### 운영 데이터 백업

SUPER_ADMIN 전용 안전한 운영데이터 스냅샷.

백업 대상:

- organizations
- campuses
- data_records
- file_objects
- tags
- data_record_tags

제외:

- users
- memberships
- audit_logs
- 원본 R2 파일 바이트

데이터가 많아져도 500행 페이지 단위로 R2에 분산 저장한다.

운영관리 화면에서:

- 백업 생성
- 백업 목록
- 최근 상태
- manifest 다운로드

가능.

복원 기능은 아직 만들지 않았다. 기존 운영 데이터를 덮어쓸 수 있어 미리보기/충돌정책/검증 절차를 먼저 설계한 뒤 추가한다.

## 4. CI 기준

GitHub Actions `DATA CORE CI` 적용.

PR마다:

1. npm ci
2. npm run build
3. npx tsc --noEmit
4. DATA CORE 브라우저 JS 문법검사

를 통과해야 main에 반영한다.

2026-09-07 기준 DATA CORE 관련 PR #1~#7은 검증 후 main에 반영됐다.

## 5. 현재 아직 운영환경에서 확인해야 하는 부분

GitHub 코드 구현과 CI 검증은 완료됐지만, 이 대화에서 실제 운영 배포 환경 자체를 직접 확인한 것은 아니다.

운영 전 반드시 확인:

1. 실제 배포 환경 D1이 `DB`로 연결되는가
2. 실제 R2 bucket이 `FILES`로 연결되는가
3. `DATA_CORE_SUPER_ADMIN_EMAILS` 환경변수가 설정됐는가
4. 마스터 계정으로 로그인했을 때 SUPER_ADMIN membership이 생성되는가
5. `/api/data-core/health`가 D1/R2 모두 true를 반환하는가
6. `/data-core`에서 테스트 파일 업로드/열기/휴지통/복원까지 실제 동작하는가
7. 백업을 한 번 실행하고 R2 manifest가 생성되는가

실제 Cloudflare resource ID나 마스터 이메일은 코드에 임의로 하드코딩하지 않는다.

## 6. 다음 개발 우선순위

### 1순위: 실제 운영 연결 검증

D1/R2/인증/마스터 bootstrap을 실제 배포 환경에서 확인한다.

### 2순위: 기존 입시컨설팅 → DATA CORE 점진 전환

현재 legacy `admissions-data.json`을 한 번에 없애지 않는다.

우선순위:

- 대학요강
- 합격/불합격 사례
- 학생 작품 파일
- 공모전 데이터
- 대학 변경이력

순으로 DATA CORE 또는 전용 구조화 테이블에 이동한다.

### 3순위: 블로그 자동화 연결

블로그가 별도 사진 저장소를 만들지 않고:

- DATA CORE 파일 검색
- 수업사진/학생작품 선택
- 생성 원문 content_text 저장
- 게시 완료 이력 data_records 저장

을 사용하게 한다.

### 4순위: 인스타그램 자동화 연결

블로그와 같은 DATA CORE 원본 파일을 재사용한다.

- 이미지 선택
- 편집 결과
- 캡션
- 해시태그
- 게시 이력

을 축적한다.

### 5순위: 꿈·전공 로드맵 데이터 모델

```text
꿈/직업
  ↓
전공
  ↓
관련 대학
  ↓
입시요강/실기유형
  ↓
필요 역량
  ↓
교육과정/미술 진도
```

관계를 DATA CORE에서 조회 가능하도록 구조화한다.

### 6순위: AI Knowledge Layer

데이터가 충분히 축적된 뒤 단순 LIKE 검색에서 다음 단계로 확장한다.

- 전문 검색(FTS)
- 의미 검색/벡터 검색
- 여러 데이터 연결 분석
- 합격/수상/수업성과 패턴 분석
- 미래 방향성 및 추천

## 7. 앞으로 지켜야 할 원칙

1. 새 앱마다 별도 데이터 저장소를 만들지 않는다.
2. 원본 파일은 R2, 관계/메타데이터는 DB에 저장한다.
3. 모든 앱은 DATA CORE API를 통해 읽고 쓴다.
4. 가능한 데이터에는 campus/sourceApp/type/tags를 남긴다.
5. 삭제는 중앙 API에서만 수행한다.
6. private 데이터는 서버 권한검사를 거친다.
7. 잘 작동하는 기존 기능은 한 번에 갈아엎지 않고 점진적으로 이동한다.
8. 기능은 CI 통과 후 main에 반영한다.
9. 학생관리 자체가 최종 목적이 아니라 장기 데이터 축적과 정보 공유가 목적이다.
10. 최종 목표는 축적된 데이터로 HI5·ANiHi의 교육·입시·마케팅·운영의 미래 방향을 분석하는 것이다.
