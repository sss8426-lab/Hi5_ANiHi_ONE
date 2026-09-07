# HI5·ANiHi 꿈·전공 로드맵 지식 그래프

기준일: 2026-09-07

## 목적

학생 또는 상담자가 목표 직업/전공을 입력하면 다음 흐름을 DATA CORE 안에서 연결한다.

```text
꿈·직업
  → 관련 전공
  → 대학/학과
  → 입시 전형/실기유형
  → 필요한 미술 역량
  → 배워야 할 수업 모듈
  → 순서가 있는 미술 진도
```

대학 요강은 매년 변경되므로 코드에 대학 목록을 고정하지 않는다.
모든 요소를 지식 노드로 분리하고 관계(edge)로 연결한다.

## 지식 노드 유형

- `career`: 직업/꿈
- `major`: 전공군
- `university`: 대학
- `university_program`: 대학 학과/프로그램
- `admission_method`: 실기전형/입시방식
- `skill`: 필요한 미술 능력
- `curriculum_module`: 학습 모듈

## 관계 유형

- `RELATED_MAJOR`: 꿈 → 관련 전공
- `LEADS_TO_PROGRAM`: 전공 → 대학 학과
- `OFFERED_BY`: 대학 학과 → 대학
- `USES_ADMISSION_METHOD`: 대학 학과 → 전형/실기유형
- `REQUIRES_SKILL`: 전공/전형 → 필요한 능력
- `LEARNED_THROUGH`: 능력 → 수업 모듈
- `PREREQUISITE_OF`: 선행 수업 → 다음 수업
- `RELATED_TO`: 일반 연관관계

## 기본 교육 노드

초기 공통 교육 그래프에는 다음 흐름을 제공한다.

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

초기 진로/전공:

- 웹툰 작가 → 웹툰·만화콘텐츠
- 애니메이터·애니메이션 감독 → 만화·애니메이션
- 게임 캐릭터 디자이너 → 게임그래픽·게임아트
- 시각디자이너 → 시각디자인·커뮤니케이션디자인

대학/학과/전형은 실제 검증 데이터가 들어오기 전에는 임의 seed하지 않는다.

## API

### 꿈/전공 목록

`GET /api/data-core/roadmap/goals`

### 목표 기반 로드맵

`GET /api/data-core/roadmap?goal=게임%20캐릭터%20디자이너`

또는

`GET /api/data-core/roadmap?goalId=knowledge:career:game-character`

응답에는:

- goalMatches
- careers
- majors
- universityPrograms
- universities
- admissionMethods
- requiredSkills
- curriculumSequence
- missingData
- graph

가 포함된다.

`missingData`가 true인 영역은 대학/전형 데이터가 아직 연결되지 않았다는 뜻이며, 허위 대학 정보를 채워 넣지 않는다.

### 지식 노드 CRUD

- `GET /api/data-core/knowledge/nodes`
- `POST /api/data-core/knowledge/nodes`
- `GET /api/data-core/knowledge/nodes/{id}`
- `PATCH /api/data-core/knowledge/nodes/{id}`
- `DELETE /api/data-core/knowledge/nodes/{id}`

검색 예:

`GET /api/data-core/knowledge/nodes?nodeType=university_program&q=웹툰`

### 지식 관계

- `GET /api/data-core/knowledge/edges`
- `POST /api/data-core/knowledge/edges`
- `DELETE /api/data-core/knowledge/edges/{id}`

## 앞으로 연결할 실제 데이터

1. 입시컨설팅 대학 데이터를 university/university_program으로 연결
2. 대학별 전형을 admission_method로 연결
3. 대학별 내신/실기 반영비와 실기유형을 metadata로 연결
4. 공모전 데이터가 특정 전공/skill과 연결되도록 확장
5. 합격/불합격 사례를 대학 프로그램과 연결
6. 데이터가 쌓이면 AI가 목표별 추천 경로와 부족 역량을 분석

## 핵심 원칙

- 대학·입시 정보는 검증된 최신 데이터만 추가한다.
- 꿈에서 역산해 필요한 교육을 보여준다.
- 모든 서비스가 같은 대학/전공/skill 노드를 공유한다.
- 대학 정보가 바뀌면 한 노드/관계만 갱신해 전체 로드맵에 반영한다.
