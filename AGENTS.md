# HI5·ANiHi CORE — AGENTS.md

이 저장소에서 작업하는 모든 AI 코딩 에이전트와 개발자는 이 문서를 최상위 개발 원칙으로 사용한다.

## 1. 제품의 최종 목적

이 프로젝트는 단순 학생관리 앱이 아니다.

HI5미술학원·ANiHi만화학원에서 발생하는 파일, 입시정보, 공모전정보, 교육자료, 학생작품, 성과, 홍보콘텐츠, 전공/직업/대학/교육과정 지식을 하나의 중앙 데이터 허브에 축적하고 여러 웹앱이 같은 데이터를 공유·검색·분석하도록 만드는 통합 시스템이다.

최상위 개념은 `HI5·ANiHi DATA CORE`다.

학생관리, 입시컨설팅, 블로그 자동화, 인스타 자동화, 공모전, 꿈·전공 로드맵은 DATA CORE를 사용하는 서비스다.

## 2. 반드시 지켜야 할 아키텍처

```text
HI5·ANiHi CORE
       |
       v
HI5·ANiHi DATA CORE
       |
       +-- Cloudflare D1 : 구조화 데이터, 관계, 권한, 검색 메타데이터
       +-- Cloudflare R2 : 이미지, PDF, 엑셀, 문서 등 실제 파일 원본
       +-- Worker API    : 모든 서비스의 공통 저장/조회/권한검사 경로
       |
       +-- 입시컨설팅
       +-- 공모전·실기대회
       +-- 꿈·전공 로드맵
       +-- 블로그 자동화
       +-- 인스타 자동화
       +-- 향후 추가 서비스
```

### 금지

- 서비스별로 별도의 독립 파일 저장소를 새로 만들지 않는다.
- 블로그용 사진 DB, 인스타용 사진 DB처럼 같은 원본을 중복 저장하지 않는다.
- 브라우저가 보낸 `campusId`, `role`, `ownerUserId`를 신뢰해 권한을 결정하지 않는다.
- private R2 object를 공개 URL로 직접 노출하지 않는다.
- 기존 운영 데이터를 한 번에 파괴적으로 마이그레이션하지 않는다.
- 기존 입시컨설팅의 `admissions-data.json` 호환 계층을 명시적 전환 완료 전 제거하지 않는다.

## 3. DATA CORE 데이터 원칙

### 실제 파일

Cloudflare R2에 저장한다.

현재 논리 영역:

- `student-private`
- `documents-private`
- `academy-public`
- `exports-temporary`

새 DATA CORE 파일은 `file_objects`에 메타데이터를 남긴다.

필수로 고려할 메타데이터:

- organization
- campus
- sourceApp
- category
- owner
- 연결 dataRecord
- visibility
- mime type
- size
- createdAt

### 구조화 정보

D1에 저장한다.

범용 정보는 `data_records`를 우선 사용하고, 특정 도메인에서 검색/관계/무결성이 중요해지면 전용 테이블 또는 knowledge graph를 추가한다.

긴 텍스트는 `content_text`를 사용한다.

태그는 전공, 학년, 실기유형, 대학, 공모전, 콘텐츠용도 등 서비스 간 검색에 재사용한다.

## 4. 앱 식별 규칙

모든 신규 DATA CORE 연동 서비스는 `sourceApp`을 명시한다.

권장값:

- `admissions`
- `competition`
- `blog`
- `instagram`
- `education`
- `dream-roadmap`
- `data-core`

파일과 data_records 모두 가능한 한 sourceApp을 남긴다.

## 5. 권한 원칙

현재 역할:

- `MASTER` (기존 `SUPER_ADMIN`과 동일 권한, 기존 계정 유지)
- `CAMPUS_ADMIN` (단일 캠퍼스 운영 자료 관리)
- `SUPER_ADMIN`
- `CAMPUS_DIRECTOR`
- `TEACHER`
- `STAFF`

원칙:

- 권한검사는 Worker 서버에서 수행한다.
- 일반 캠퍼스 사용자는 접근 가능한 캠퍼스 범위 안에서만 작업한다.
- 일반 사용자는 기본적으로 본인이 만든 데이터/파일만 수정·삭제할 수 있다.
- `SUPER_ADMIN`은 조직 전체 관리가 가능하다.
- `MASTER`도 조직 전체 관리가 가능하며, `CAMPUS_ADMIN`은 자신의 캠퍼스 자료를 관리한다. 공용 정보 수정, 계정/권한/시스템 관리, 백업/복구와 영구삭제는 마스터 전용이다.
- 캠퍼스 코드와 기존 FK 호환, 접속 현황 및 입시 저장 정책은 `docs/CAMPUS_ACCOUNTS_AND_PRESENCE.md`를 따른다.
- 삭제는 가능하면 soft delete / 휴지통을 우선한다.
- 파일 영구삭제는 마스터 권한으로 제한한다.
- 개인정보와 학생자료는 기본 private로 취급한다.

## 6. 기존 입시컨설팅 호환 원칙

기존 입시컨설팅은 현재 운영 기능으로 취급한다.

- 기존 `/api/data`, `/api/upload`, `admissions-data.json` 흐름을 당장 제거하지 않는다.
- 신규 업로드는 `data-core-upload-bridge.js`를 통해 가능한 경우 DATA CORE로 전환한다.
- 전환 실패 시 기존 동작이 유지되도록 점진적 마이그레이션을 선호한다.
- 입시 대학/학과/전형 데이터는 knowledge graph 동기화 계층과의 호환을 보존한다.

관련 문서:

- `docs/ADMISSIONS_DATA_CORE_TRANSITION.md`
- `docs/ADMISSIONS_KNOWLEDGE_SYNC.md`

## 7. 꿈·전공 로드맵 원칙

최종적으로 다음 연결이 가능해야 한다.

```text
꿈/직업
  -> 전공
  -> 대학/학과
  -> 입시전형/실기유형
  -> 필요한 역량
  -> 교육과정/미술진도
```

지식은 단순 화면 하드코딩이 아니라 knowledge node/edge로 축적해 향후 분석과 AI 추천에 사용할 수 있어야 한다.

## 8. 블로그·인스타 자동화 원칙

향후 두 서비스는 반드시 같은 DATA CORE 자산을 재사용한다.

예:

한 번 올린 `부천 / 고2 / 웹툰 / 상황표현 / 학생작품` 이미지는 필요 시

- 블로그 글
- 인스타 게시물
- 학생 성장기록
- 입시 사례
- 학원 홍보

에서 다시 선택 가능해야 한다.

블로그/인스타 구현 시 별도 업로드 창고를 만들지 말고 `/api/data-core/files` 및 공통 검색 계층을 사용한다.

생성된 글 역시 `data_records`에 저장해 향후 검색/재작성/성과분석의 원본으로 남긴다.

## 9. 공모전·실기대회 원칙

공모전은 DATA CORE의 첫 공통 도메인 서비스다.

대회정보와 캠퍼스별 출품/수상 결과를 누적하여 장기적으로 다음 분석이 가능해야 한다.

- 대회별 수상률
- 실기유형별 성과
- 학년별 성과
- 캠퍼스별 성과
- 전공별 성과

관련 문서: `docs/COMPETITION_DATA_CORE.md`

## 10. 보안·삭제·백업

- 새 private 파일은 인증된 DATA CORE file API로만 제공한다.
- 일반 삭제는 휴지통으로 이동하며 R2 원본을 즉시 제거하지 않는다.
- 영구삭제는 SUPER_ADMIN만 가능하다.
- 운영 백업은 업무 데이터/파일 연결정보 중심으로 수행한다.
- 사용자 이메일, memberships, audit logs를 불필요하게 R2 스냅샷에 복제하지 않는다.
- 복원 기능은 기존 운영 데이터를 덮어쓸 수 있으므로 반드시 dry-run/충돌정책/검증을 먼저 설계한다.

## 11. 변경 작업 방식

### 작업 시작 전

1. `AGENTS.md`를 읽는다.
2. `docs/DATA_CORE_CURRENT_STATUS_2026-09-07.md`를 읽는다.
3. 관련 도메인 문서를 읽는다.
4. 기존 구현을 검색해 중복 기능을 만들지 않는다.
5. 현재 main 기준으로 새 브랜치를 만든다.

### 구현 중

- 기존 동작을 최대한 보존한다.
- 대규모 변경보다 점진적 호환 계층을 선호한다.
- 권한은 서버에서 검증한다.
- API 계약을 바꾸면 관련 docs도 갱신한다.
- 스키마 변경은 재실행 가능한 forward migration으로 만든다.
- 민감정보나 API key를 코드/문서/커밋에 넣지 않는다.

### 완료 조건

기능 구현만으로 완료 처리하지 않는다.

최소:

```text
git status
npm ci
npm run build
npx tsc --noEmit
관련 browser JS node --check
관련 테스트
```

을 실행하고 오류를 수정한다.

그 후:

1. 변경사항 자체검토
2. 문서 갱신
3. commit
4. push
5. PR 생성
6. CI 통과 확인

까지 되어야 완료로 본다.

## 12. 설계 판단 우선순위

새 기능 요청을 받으면 다음 순서로 판단한다.

1. 이 데이터의 원본은 무엇인가?
2. 이미 DATA CORE에 같은 데이터가 있는가?
3. 파일인가, 구조화 정보인가, 지식 관계인가?
4. 어느 캠퍼스/사용자의 것인가?
5. 누가 볼 수 있는가?
6. 누가 수정/삭제할 수 있는가?
7. 다른 어떤 서비스가 재사용할 것인가?
8. 검색/분석을 위해 어떤 metadata/tag/sourceApp이 필요한가?
9. 감사로그/휴지통/백업이 필요한가?
10. 기존 기능과의 호환을 어떻게 유지할 것인가?

## 13. 핵심 제품 원칙 한 줄

> 앱을 중심으로 데이터를 만들지 말고, DATA CORE에 데이터를 축적하고 앱들이 그 데이터를 사용하게 만든다.
