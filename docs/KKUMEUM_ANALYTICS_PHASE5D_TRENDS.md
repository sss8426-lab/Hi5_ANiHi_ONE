# 꿈이음 Phase 5D — 개인정보 보호형 월별 성장 흐름

Issue #135는 기존 단일 월 성장 통계를 최대 12개월의 **읽기 전용 집계 흐름**으로 확장한다.

## 원본과 권한

- 원본은 `FAMILY_DB`다.
- `SUPER_ADMIN` 또는 해당 캠퍼스 `CAMPUS_DIRECTOR`만 조회한다.
- 학생/보호자/교사 식별자, 평가 본문, 작품 파일 정보, R2 key는 반환하지 않는다.
- 학생·교사 순위, 백분위, 개인별 변화량은 만들지 않는다.

## API

`GET /api/kkumeum/analytics/trend?campusId=...&fromYearMonth=YYYY-MM&toYearMonth=YYYY-MM`

범위는 시작·종료월 포함 최대 12개월이다. 시작월이 종료월보다 늦거나 12개월을 넘으면 400을 반환한다.

각 월에는 다음 집계만 포함한다.

- 재원 학생 수
- 평가 진행률
- 학생당 작품 평균
- 현재 canonical taxonomy의 성장영역 집계

`delta`, 증감 인원, top/best skill 등 작은 집단을 역산할 수 있는 비교 필드는 제공하지 않는다.

## 성장영역 suppression

각 월은 기존 Phase 5C와 동일한 보수적 규칙을 독립적으로 적용한다.

- 현재 taxonomy version의 평가만 집계한다.
- 한 평가 안의 같은 code는 1회만 센다.
- legacy `growth_points_json`, stale taxonomy, unknown code는 제외한다.
- eligible report cohort가 5건 미만이면 해당 월 성장영역 전체를 숨긴다.
- 하나라도 1~4건인 non-zero skill bucket이 있으면 해당 월 성장영역 전체를 숨긴다.
- 숨겨진 월은 1~4라는 실제 수치를 반환하지 않는다.

다른 달의 안전한 집계값을 이용해 숨겨진 월의 작은 수치를 역산하지 못하도록 서버와 UI 모두 월간 delta를 계산하지 않는다.

## UI

교직원 `성장 통계` 화면의 기준 월을 종료월로 사용하며, 최근 3/6/12개월을 선택할 수 있다. 기본은 6개월이다.

월별로 평가 진행률, 작품 평균, 안전한 성장영역만 표시한다. 성장영역이 suppression된 달은 `표본 부족`으로만 표시한다. 학생·교사 drill-down 링크는 없다.

## DATA CORE

이 기능은 FAMILY 읽기 전용이다.

- trend 결과를 generic DATA CORE에 기록하지 않는다.
- `/api/kkumeum/analytics/sync` 계약은 변경하지 않는다.
- `KKUMEUM_ANALYTICS_SYNC_ENABLED`는 계속 기본 비활성 상태다.
- DB/FILES/FAMILY_DB/FAMILY_FILES binding을 변경하지 않는다.
