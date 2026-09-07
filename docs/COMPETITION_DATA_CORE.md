# 공모전·실기대회 DATA CORE

## 목적

공모전·실기대회 정보를 캠퍼스별 파일이나 단톡방에 흩어두지 않고 HI5·ANiHi DATA CORE에 축적한다.

축적 대상은 단순 일정만이 아니다.

- 대회명
- 주최/주관
- 관련 대학
- 접수기간
- 대회일
- 발표일
- 대상 학년
- 관련 전공
- 실기유형
- 상금/시상
- 접수방법
- 원문/요강 링크
- 상세 분석/안내문
- 포스터/PDF/수상작 파일
- 캠퍼스별 출품 인원
- 캠퍼스별 수상 인원
- 상격별 수상 수
- 수상률

시간이 쌓이면 향후 다음 분석이 가능해진다.

- 전공별 수상률이 높은 대회
- 학년별 추천 대회
- 캠퍼스별 출품/수상 추이
- 실기유형별 성과
- 특정 대학 실기대전과 실제 입시 성과의 관계

## API

### GET `/api/data-core/competitions`

공모전/실기대회 목록 조회.

기존 DATA CORE 검색 파라미터를 사용할 수 있다.

- `q`
- `campusId`
- `tag`
- `limit`

응답에는 접수기간 기준 상태가 계산되어 포함된다.

- `upcoming`
- `open`
- `closed`
- `result-announced`
- `unknown`

### POST `/api/data-core/competitions`

예시:

```json
{
  "campusId": "campus-anihi-admission",
  "title": "2027 청강문화산업대학교 실기대전",
  "summary": "웹툰·만화·애니메이션 분야 실기대회",
  "content": "학원 내부에서 공유할 상세 분석과 안내 내용",
  "organizer": "청강문화산업대학교",
  "hostSchool": "청강문화산업대학교",
  "competitionKind": "practical-competition",
  "applicationStart": "2027-05-01",
  "applicationEnd": "2027-05-31",
  "eventDate": "2027-06-20",
  "resultDate": "2027-07-01",
  "targetGrades": ["고1", "고2", "고3"],
  "majors": ["웹툰", "만화", "애니메이션"],
  "practicalTypes": ["상황표현", "칸만화"],
  "prize": "세부 시상내역",
  "applicationMethod": "온라인 접수",
  "sourceUrl": "공식 원문 URL",
  "guideUrl": "입시/대회 요강 URL",
  "year": 2027,
  "tags": ["청강대", "실기대전"]
}
```

### GET `/api/data-core/competitions/{id}`

대회 상세 조회.

### PATCH `/api/data-core/competitions/{id}`

본인 등록 대회 또는 SUPER_ADMIN 수정.

### DELETE `/api/data-core/competitions/{id}`

DATA CORE soft delete 정책 사용.

### GET `/api/data-core/competitions/{id}/results`

접근 가능한 캠퍼스별 결과 데이터 조회.

### POST `/api/data-core/competitions/{id}/results`

예시:

```json
{
  "campusId": "campus-anihi-admission",
  "participants": 38,
  "winners": 15,
  "gold": 1,
  "silver": 2,
  "bronze": 3,
  "honorableMention": 9,
  "year": 2027,
  "practicalType": "상황표현",
  "grade": "고2"
}
```

`participants`와 `winners`가 있으면 수상률을 자동 계산한다.

## 파일 연결

포스터, PDF 요강, 수상작 이미지는 기존 DATA CORE 파일 API를 그대로 사용한다.

`POST /api/data-core/files`

권장 값:

```text
recordId = 공모전 data_record id
category = competition-poster | competition-guide | award-work
sourceApp = competition
area = academy-public 또는 documents-private
```

파일과 대회 정보가 `recordId`로 연결되므로 다른 앱에서도 동일한 원본을 다시 사용할 수 있다.

## 공유 정책

- 마스터가 등록한 조직 공통 공모전 정보는 전체 캠퍼스가 활용 가능
- 캠퍼스 사용자가 등록한 자료는 현재 DATA CORE 기본 정책에 따라 해당 캠퍼스 범위로 저장
- 캠퍼스 출품/수상 결과는 캠퍼스 데이터로 축적
- SUPER_ADMIN은 전체 캠퍼스 결과를 분석 가능

향후 승인 워크플로를 추가하면 캠퍼스가 제보한 공모전 정보를 마스터가 검토 후 조직 공통 정보로 승격할 수 있다.

## 화면 구조

상담용 모드의 `/data-core/counseling/competitions`에서 좌우 분할 화면으로 제공한다.

좌측:

- 대회 검색
- 상태 필터
- 학년/전공/실기유형 필터
- 대회 리스트

우측:

- 포스터/대표 영역
- 요강 PDF/원문 링크
- 상세설명
- 접수방법
- 시상/상금
- 학원용 안내문 초안 템플릿
- 캠퍼스별 출품/수상 현황
- 수상작 파일/이미지 연결 안내

실제 AI 안내문 생성처럼 보이게 하지 않고, 현재 단계에서는 등록된 대회 정보 기반 초안 템플릿만 표시한다.

## 구조적 의미

공모전 기능은 DATA CORE를 실제로 사용하는 첫 번째 도메인이다.

```text
공모전 화면
    ↓
competition API
    ↓
data_records + content_text + tags
    ↓
file_objects + R2
    ↓
audit_logs
```

이 구조를 이후 블로그, 인스타그램, 입시, 꿈·전공 로드맵에도 동일하게 적용한다.
