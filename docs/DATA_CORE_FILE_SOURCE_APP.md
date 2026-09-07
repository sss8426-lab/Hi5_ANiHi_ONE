# DATA CORE 파일 sourceApp 규칙

기준일: 2026-09-07

## 목적

중앙 저장소의 각 파일이 어느 서비스에서 생성되거나 업로드되었는지 장기적으로 추적한다.

`file_objects.source_app`을 사용한다.

예시 값:

- `admissions` : 입시컨설팅
- `blog` : 블로그 자동화
- `instagram` : 인스타그램 자동화
- `competition` : 공모전·실기대회
- `education` : 교육/수업 자료
- `dream-roadmap` : 꿈·전공 로드맵
- `data-core` : 중앙 자료보관함 직접 업로드
- `legacy` : sourceApp 도입 이전 또는 기존 업로드 경로

## API

`GET /api/data-core/files?sourceApp=admissions`

특정 서비스에서 업로드한 파일만 조회할 수 있다.

일반 파일 목록 응답에도 `sourceApp` 필드를 포함한다.

## 기존 데이터 호환

기존 `file_objects` 테이블에는 source_app 컬럼이 없을 수 있으므로 초기화/마이그레이션 과정에서 자동 추가한다.

기존 파일은 기본값 `legacy`로 분류한다.

신규 `/api/data-core/upload` 요청은 전달된 `sourceApp`을 저장한다.

## 의미

이 구조를 통해 나중에 다음 분석/검색이 가능해진다.

- 입시컨설팅에서 올라온 학생작품만 조회
- 블로그에서 사용된 학원사진만 조회
- 인스타 제작에 사용된 이미지와 원본 연결
- 같은 원본 파일이 여러 서비스에서 재사용되는 흐름 분석
- 서비스별 저장량/활용량 통계
