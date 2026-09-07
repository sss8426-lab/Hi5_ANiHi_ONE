# HI5·ANiHi DATA CORE Foundation

## 목적

HI5미술학원·ANiHi만화학원의 모든 서비스가 하나의 중앙 데이터 허브를 공유하도록 만드는 1차 기반이다.

DATA CORE는 학생관리 앱 하나가 아니라 다음 서비스가 공통으로 사용하는 중심 계층이다.

- 블로그 글 자동화
- 인스타그램 이미지/글 자동화
- 공모전·실기대회 정보 공유
- 입시 데이터 분석
- 전공/꿈 기반 대학 및 교육 로드맵 설계
- 학생 작품·연구작·수업자료·홍보자료 축적
- 향후 추가되는 모든 HI5·ANiHi 서비스

## 기본 구조

```text
HI5·ANiHi CORE
      |
      v
DATA CORE
  |- D1: 메타데이터/관계/권한/검색 기준
  |- R2: 이미지/PDF/엑셀/문서 등 원본 파일
  |- API: 모든 앱의 공통 저장/조회 경로
```

## Foundation v1에서 추가된 테이블

### organizations
HI5·ANiHi 통합 조직 최상위 단위.

### campuses
캠퍼스 단위. 향후 모든 데이터는 필요 시 campus_id와 연결한다.

### users
사용자 기본 계정 메타데이터.

### memberships
사용자-조직-캠퍼스-역할 관계.

### data_records
모든 서비스에서 공통으로 사용할 수 있는 범용 정보 레코드.
예: 공모전 정보, 대학 요강, 수업 연구 자료, 블로그 소재, 전공 정보 등.

### file_objects
R2에 저장된 실제 파일의 메타데이터.
파일 원본은 R2에 저장하고 DB에는 검색 및 연결에 필요한 정보를 저장한다.

### tags / data_record_tags
전공, 학년, 실기유형, 대학, 공모전, 캠퍼스 등 다양한 분류를 유연하게 연결하기 위한 태그 구조.

### audit_logs
누가 어떤 데이터에 어떤 작업을 했는지 추적하기 위한 기반.

## 파일 논리 영역

- `student-private`: 학생 작품, 수업 관련 비공개 자료
- `documents-private`: 문서, 요강, 내부 자료 등 기본 비공개 자료
- `academy-public`: 홍보용 또는 조직 공유가 가능한 공개 자료
- `exports-temporary`: 향후 리포트/출력물의 임시 저장 영역

현재 기존 업로드 목적은 다음처럼 매핑된다.

- `student-artwork` -> `student-private`
- `admission-images` -> `academy-public`
- `award-images` -> `academy-public`
- 그 외 -> `documents-private`

## 기존 입시컨설팅과의 호환

기존 `state/admissions-data.json` 방식은 제거하지 않는다.
현재 입시컨설팅은 그대로 동작하게 유지하면서 새 DATA CORE 구조를 병행한다.

즉, 한 번에 전체 데이터를 마이그레이션하지 않고 기능별로 점진적으로 이동한다.

## 새 상태 확인 API

`GET /api/data-core/health`

D1과 R2 연결 여부와 DATA CORE 버전을 확인한다.

예시 응답:

```json
{
  "ok": true,
  "version": "foundation-v1",
  "bindings": {
    "database": true,
    "files": true
  },
  "mode": "central"
}
```

## 다음 구현 단계

1. 캠퍼스 초기 데이터 등록
2. 인증 사용자와 memberships 연결
3. 공통 업로드 API에 organization/campus/sourceApp/recordType 메타데이터 추가
4. data_records CRUD 및 검색 API
5. tags 검색/분류 API
6. 파일 조회 시 권한 검사
7. 파일 삭제 시 권한 검사 + soft delete + audit log
8. 기존 입시컨설팅 JSON의 일부 데이터를 data_records 및 전용 테이블로 점진적 분리
9. 블로그/인스타/공모전 서비스가 같은 DATA CORE API를 사용하도록 연결
10. AI 검색/분석 계층 추가

## 중요한 원칙

- 데이터의 원본은 중앙 서버에서 관리한다.
- 앱별로 별도 저장소를 만들지 않는다.
- 파일은 R2, 관계와 메타데이터는 DB에 저장한다.
- 모든 서비스는 공통 API를 통해 같은 데이터를 읽고 쓴다.
- 현재 입시컨설팅 기능을 파괴하지 않고 점진적으로 전환한다.
- 향후 private 파일은 반드시 인증/권한검사 후 제공한다.
