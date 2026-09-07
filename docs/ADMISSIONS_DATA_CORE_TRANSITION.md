# 입시컨설팅 → DATA CORE 이미지 업로드 전환

기준일: 2026-09-07

## 목적

기존 입시컨설팅의 학생작품, 입시요강 이미지, 공모전/수상작 이미지를 기능 중단 없이 HI5·ANiHi DATA CORE 중앙 저장소로 점진 전환한다.

## 현재 전환 방식

기존 `web-desktop-api.js`는 그대로 유지한다.

앞단의 `data-core-upload-bridge.js`가 `/api/upload` 요청만 선택적으로 가로채 다음 순서로 처리한다.

1. `/api/data-core/context`에서 로그인/권한 확인
2. DATA CORE 사용권한이 없으면 기존 `/api/upload` 사용
3. 일반 사용자가 접근 가능한 캠퍼스가 정확히 1개면 해당 campusId 사용
4. SUPER_ADMIN은 조직 공통 업로드 가능
5. 일반 사용자가 여러 캠퍼스 권한을 가져 자동 캠퍼스 선택이 모호하면 기존 업로드 유지
6. DATA CORE 업로드 실패 시 기존 `/api/upload`로 폴백
7. DATA CORE 성공 응답을 기존 입시컨설팅이 사용하는 `url/imageUrl/filePath/path` 구조로 변환

## DATA CORE 분류

- `student-artwork` → `student-private`
- `admission-images` → `academy-public`
- `award-images` → `academy-public`
- 그 외 → `documents-private`

모든 중앙 업로드는 `sourceApp=admissions`를 기록한다.

## 중요한 안전 원칙

- 기존 `admissions-data.json` 데이터 구조는 아직 변경하지 않는다.
- 기존 PC/legacy 이미지 경로도 현재 마이그레이션 기능을 유지한다.
- 신규 업로드부터 중앙 저장 비율을 높인다.
- 한 번에 기존 전체 데이터를 강제 이전하지 않는다.
- 여러 캠퍼스에 권한이 있는 사용자에게 캠퍼스를 추측해서 자동 저장하지 않는다.

## 다음 단계

1. 운영환경에서 `/data-core/operations` 진단 통과 확인
2. 실제 단일 캠퍼스 사용자로 신규 학생작품 업로드 확인
3. DATA CORE 자료보관함에서 `sourceApp=admissions` 파일 확인
4. 파일 열기/휴지통/복원 확인
5. 여러 캠퍼스 사용자의 업로드 시 캠퍼스 선택 UI 추가
6. 모든 사용자 권한 정비 후 legacy `/api/upload` 신규 사용 중단 검토
7. 이후 입시컨설팅의 대학/합격사례/상담정보도 범용 DATA CORE 또는 전용 구조화 테이블로 점진 이전
