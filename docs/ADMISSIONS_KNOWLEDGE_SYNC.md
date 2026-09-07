# 입시컨설팅 → 꿈·전공 로드맵 지식 동기화

기준일: 2026-09-07

## 목적

기존 입시컨설팅에 축적된 대학 데이터를 꿈·전공 로드맵의 대학/학과/전형 영역에서 재사용한다.

원본 입시컨설팅 데이터를 옮기거나 삭제하지 않는다.
DATA CORE의 `knowledge_nodes` / `knowledge_edges`에 로드맵용 참조 데이터를 생성·갱신한다.

## 동기화 원본

우선순위:

1. R2 `state/admissions-data.json`
2. R2가 없을 경우 D1 `app_state` JSON

입시컨설팅 운영 데이터의 `universities` 배열을 사용한다.

## 생성되는 지식

### university
대학 단위 노드.

### university_program
대학의 전공/학과/모집단위 단위 노드.

metadata 예:

- sourceUniversityId
- year
- universityName
- major
- admission
- practicalType
- gradeRatio
- skillRatio
- subjects
- rateCurrent
- requiredScores
- conversionRule
- notes

### admission_method
전형명과 실기유형을 묶은 입시 준비 노드.

## 관계

- 기본 전공 → `LEADS_TO_PROGRAM` → 대학 학과
- 대학 학과 → `OFFERED_BY` → 대학
- 대학 학과 → `USES_ADMISSION_METHOD` → 전형
- 전형 → `REQUIRES_SKILL` → 필요한 실기능력

실기유형 텍스트를 기반으로 상황표현/칸만화/웹툰/캐릭터/게임/기초디자인/이미지보드 등의 필요 역량을 기존 skill 노드와 연결한다.

## 안전한 동기화

- SUPER_ADMIN만 실행 가능
- 원본 입시 JSON은 수정하지 않음
- stable ID 기반 upsert
- 같은 대학/학과/전형은 다음 동기화에서 갱신
- 삭제된 원본을 자동 삭제 처리하지 않음: 자동 삭제는 별도 검증정책이 필요함
- 동기화 실행 이력을 audit_logs에 기록

## API

현재 상태:

`GET /api/data-core/admin/knowledge/admissions/status`

동기화:

`POST /api/data-core/admin/knowledge/admissions/sync`

## 운영 화면

`/data-core/operations`

마스터에게 다음 기능을 제공한다.

- 현재 로드맵 대학 수
- 학과/프로그램 수
- 입시전형 수
- 최근 동기화 시각
- 입시데이터 동기화 버튼

## 로드맵 반영

동기화 후 `/data-core/roadmap`에서 관련 전공을 선택하면 지식 그래프의 연결을 따라 대학/학과/전형이 자동으로 결과에 포함된다.

## 다음 단계

- 대학 데이터의 학년도/최신성 표시 강화
- 입시컨설팅 데이터 수정 완료 시 자동 동기화 이벤트 검토
- 대학별 공식요강 출처/검증일 메타데이터 추가
- 합격/불합격 사례를 program 노드에 연결
- 대학별 실기유형과 curriculum_module의 세부 연계
