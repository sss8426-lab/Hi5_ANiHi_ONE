# HI5·ANiHi DATA CORE 현재 상태

기준일: 2026-09-07

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

관리자/운영관리/readiness/권한관리는 일반 메인 메뉴에서 숨기고, SUPER_ADMIN 보조 영역으로 분리한다.

## 7-0. 상담용 홈

경로:

`/data-core/counseling`

상담용 기본 메뉴는 다음 3개만 노출한다.

- 공모전·실기대회
- 꿈·전공 로드맵
- 대학합격 로드맵

대학합격 로드맵은 기존 입시컨설팅을 삭제하지 않고 상담용 명칭으로 연결한다.

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
