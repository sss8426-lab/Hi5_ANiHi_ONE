# Codex Next Work Package — Production Validation + Content Automation Foundation

기준일: 2026-09-07

상태: Issue #18에서 콘텐츠 허브 1차 기반이 구현되었다. 운영환경 검증은 아직 실제 운영 계정과 배포환경에서 확인해야 한다.

이 문서는 다음 Codex 작업 묶음의 실행 명세다.

Codex는 작업 시작 전에 반드시 다음을 읽는다.

1. `/AGENTS.md`
2. `/docs/DATA_CORE_CURRENT_STATUS_2026-09-07.md`
3. `/docs/ADMISSIONS_DATA_CORE_TRANSITION.md`
4. `/docs/DATA_CORE_API.md`
5. `/docs/DREAM_ROADMAP_KNOWLEDGE_GRAPH.md`

---

# 0. 작업의 큰 목적

HI5·ANiHi CORE의 다음 단계는 두 가지다.

1. 지금까지 만든 DATA CORE가 실제 배포 환경에서 정말 동작하는지 운영 수준으로 검증한다.
2. 검증된 중앙 DATA CORE 위에 블로그·인스타 자동화가 같은 파일과 콘텐츠 데이터를 재사용할 수 있는 공통 콘텐츠 계층을 만든다.

새 앱별 저장소를 만들지 않는다.

---

# 1. Phase A — 실제 운영환경 검증

## 목표

GitHub CI 통과가 아니라 실제 배포된 Worker + D1 + R2 + 인증이 정상인지 확인한다.

## 확인 경로

- `/data-core/readiness`
- `/data-core`
- `/data-core/operations`
- `/data-core/roadmap`

## 필수 검증

### 인증/권한

- 로그인 사용자 인식
- SUPER_ADMIN 인식
- `DATA_CORE_SUPER_ADMIN_EMAILS` 적용 확인
- 일반 사용자와 마스터 권한 차이 확인

### D1/R2

`/data-core/readiness` 전체 진단을 실행한다.

반드시 확인:

- D1 read
- D1 temporary write/read/delete
- R2 temporary write
- R2 read/content validation
- R2 delete

모두 성공해야 운영 가능 판정이다.

### 중앙 파일 라이프사이클

작은 테스트 이미지를 사용해 실제로 다음을 수행한다.

1. `/data-core`에서 업로드
2. `file_objects`에 메타데이터 기록 확인
3. 파일 열기 확인
4. 검색 확인
5. 휴지통 이동
6. `/data-core/operations`에서 복원
7. 다시 파일 열기 확인

SUPER_ADMIN일 때만 테스트용 파일 영구삭제까지 확인할 수 있다.

### 백업

- 운영 스냅샷 1회 생성
- completed 상태 확인
- manifest 확인
- 백업에 users/memberships/audit_logs가 포함되지 않는지 확인

### 입시 지식 동기화

- 입시 knowledge sync status 확인
- 실제 동기화 실행
- university / university_program / admission_method 수가 0보다 큰지 확인
- `/data-core/roadmap`에서 실제 대학/학과/전형이 연결되는지 확인

### 입시 신규 이미지 중앙화

입시컨설팅에서 학생작품 또는 입시 관련 테스트 이미지를 신규 업로드한다.

확인:

- DATA CORE 자료보관함에 생성
- `sourceApp=admissions`
- campusId 올바름
- 기존 입시 화면에서 이미지 정상 표시

## 운영환경 접근이 없을 때

실제 배포환경/D1/R2 접근이 불가능하면 성공했다고 가정하지 않는다.

대신:

1. 접근 불가 항목을 정확히 기록
2. 로컬/preview에서 가능한 범위의 검증 수행
3. 운영자가 해야 할 최소 수동 설정을 `docs/PRODUCTION_SETUP_REQUIRED.md`에 작성
4. 코드 문제와 계정/환경 문제를 분리해서 보고

---

# 2. Phase B — Content Automation 공통 계층

운영 검증에서 치명적 문제가 없을 때 착수한다.

## 목표

블로그 자동화와 인스타 자동화가 서로 다른 저장소를 만들지 않고 같은 DATA CORE 파일과 콘텐츠 레코드를 공유하도록 기반을 만든다.

아직 실제 네이버/인스타 게시 API 연동 자체가 핵심이 아니다.

이번 단계 핵심은:

> 콘텐츠 입력 → DATA CORE 파일 선택 → 생성 초안 저장 → 다른 서비스가 재사용

이다.

---

# 3. 공통 콘텐츠 데이터 모델

가능하면 기존 `data_records`를 우선 재사용한다.

새 전용 테이블이 필요하다면 이유를 문서화한다.

권장 recordType:

- `content-source`
- `blog-draft`
- `instagram-draft`
- `published-content`

권장 sourceApp:

- `blog`
- `instagram`

`content_text`:

- 블로그 본문
- 인스타 캡션
- 생성된 설명/카피

metadata 예시:

```json
{
  "contentPurpose": "class-story",
  "major": "webtoon",
  "grade": "high2",
  "practicalType": "situation-expression",
  "publishStatus": "draft",
  "publishedAt": null,
  "channelPostId": null,
  "relatedFileIds": []
}
```

실제 필드명은 기존 코드 스타일에 맞춰 조정 가능하나 의미를 보존한다.

---

# 4. 파일 재사용 규칙

블로그와 인스타는 새 파일 저장소를 만들지 않는다.

반드시 DATA CORE 파일 API를 사용한다.

파일 검색 기준:

- campusId
- category
- sourceApp
- fileName
- 가능하면 tags/연결 record

주요 category:

- `student-artwork`
- `class-photo`
- `academy-photo`
- `research-work`
- `award-work`
- `competition-poster`
- `admission-guide`

한 파일을 여러 콘텐츠 초안이 참조할 수 있어야 한다.

원본 파일을 블로그용/인스타용으로 복제하지 않는다.

이미지 편집 결과처럼 실제 다른 바이너리가 생성된 경우에만 별도 derived file로 저장한다.

파생 파일은 원본 fileId를 metadata 또는 명시적 관계로 추적 가능해야 한다.

---

# 5. 블로그 자동화 1차 화면

새 경로 권장:

`/data-core/content/blog`

현재 1차 구현 경로:

- `/data-core/content`
- `/data-core/content/blog`

또는 기존 CORE 구조에 맞는 더 좋은 경로가 있으면 기존 네비게이션 패턴을 우선한다.

필수 기능:

1. 캠퍼스 선택
2. 콘텐츠 목적 선택
3. DATA CORE 사진 검색
4. 여러 사진 선택
5. 제목
6. 본문 편집 영역
7. 태그/키워드
8. 초안 저장
9. 기존 초안 불러오기
10. 선택한 fileId와 draft 관계 유지

이번 단계에서 AI 생성 API가 연결돼 있지 않다면:

- 생성 버튼 UI/서비스 인터페이스를 분리
- mock AI 결과를 운영 기능처럼 속이지 않는다.
- API key가 필요한 부분은 adapter/interface 수준으로 준비

## 블로그 콘텐츠 원칙

학원 콘텐츠는 단순 성과 자랑보다

`왜 좋아졌는지 / 어떤 수업과 피드백으로 성장했는지`

를 설명하는 교육정보 구조를 우선한다.

---

# 6. 인스타 자동화 1차 화면

새 경로 권장:

`/data-core/content/instagram`

현재 1차 구현 경로:

- `/data-core/content`
- `/data-core/content/instagram`

필수 기능:

1. DATA CORE 원본 이미지 선택
2. 캠퍼스/분류 검색
3. 캡션 편집
4. 해시태그 편집
5. 초안 저장
6. 블로그에서 사용한 같은 원본 파일 재사용 가능
7. 파생 이미지가 생기면 원본과 관계 추적

## 이미지 규격

HI5·ANiHi 인스타 관련 생성/편집 이미지 기본 캔버스는

`2160 × 2700px (4:5)`

로 유지한다.

이미지 편집 엔진 자체가 이번 Codex 작업 범위 밖이라면 규격 검증/메타데이터/파생파일 인터페이스까지 구현한다.

---

# 7. 공통 콘텐츠 검색

기존 DATA CORE 통합검색과 연결한다.

검색 가능:

- 블로그 초안
- 인스타 초안
- 공모전
- 입시정보
- 교육자료
- 로드맵 자료

블로그/인스타 화면에서 다른 서비스 데이터를 직접 수정하는 것은 피하되 읽어서 콘텐츠 소재로 사용할 수 있게 한다.

---

# 8. 권한

- 모든 쓰기 작업은 Worker 권한검사
- 캠퍼스 사용자는 자기 campus 범위
- 본인이 만든 draft만 수정/삭제가 기본
- SUPER_ADMIN은 전체
- 파일 원본 접근은 기존 file 권한을 그대로 존중

UI에서 버튼을 숨기는 것만으로 권한을 구현하지 않는다.

---

# 9. 기존 기능 보존

이번 작업에서 깨지면 안 되는 것:

- 기존 입시컨설팅
- `/data-core`
- `/data-core/operations`
- `/data-core/readiness`
- `/data-core/roadmap`
- 공모전 API
- knowledge graph
- admissions knowledge sync
- legacy admissions upload fallback

라우터를 추가할 경우 기존 위임 체인을 정확히 보존한다.

---

# 10. 테스트/완료 기준

최소:

```bash
npm ci
npm run build
npx tsc --noEmit
```

브라우저 JS를 추가/수정하면 모두 `node --check`에 포함한다.

추가 테스트:

- blog draft CRUD
- instagram draft CRUD
- campus 권한 차단
- 다른 사용자 draft 수정/삭제 차단
- 동일 fileId를 blog/instagram 양쪽에서 참조 가능
- sourceApp 필터
- 기존 DATA CORE 및 입시 경로 smoke test

완료 시:

1. 코드
2. 테스트
3. 관련 docs
4. `docs/DATA_CORE_CURRENT_STATUS_2026-09-07.md` 갱신
5. commit
6. push
7. PR
8. CI success

까지 수행한다.

---

# 11. 작업 종료 보고 형식

Codex는 최종 보고에서 다음을 구분한다.

## 실제 검증 완료

실제로 실행/확인한 항목만 작성.

## 코드 구현 완료

구현됐지만 운영계정에서 아직 검증하지 않은 항목은 별도 표시.

## 남은 외부 설정

Cloudflare/API key/게시채널 등 코드 외부에서 필요한 설정.

## 다음 권장 작업

다음 한 묶음만 추천.

성공하지 않은 운영검증을 성공했다고 추정하지 않는다.
