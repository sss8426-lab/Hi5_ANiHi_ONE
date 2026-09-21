# 인스타·블로그 사용성 및 공통일정 통합

## 작업 기준과 보존

- `E:/codex/instagram-carousel`, `feat/instagram-carousel`, 기존 PR #242를 이어받음.
- 확인한 main `e5f1eefecb68326acaac2a927aae844e78eb9eeb`, 기존 인스타 head `af4a61d`.
- `E:/codex/attendance-repair`의 `feat/calendar-details` / `c355409`를 검토 후 `0827947`로 통합. 무충돌이며 작업 삭제/재작성 없음.
- 기존 DB/R2 바인딩, 원본 파일/ID, OpenAI 생성 키/모델 유지. 새 DB/bucket/migration 없음.
- 모든 쓰기 검증은 격리 Miniflare D1/R2의 synthetic 데이터. 운영 사용자 자료 변경 없음.
- main 병합과 production 배포는 별도 승인 전 수행하지 않음.

## 탐색 성능

- 인증 context를 먼저 확인하며 health/AI 사용량/defaults/로고는 탐색을 막지 않음.
- `DataCoreLibraryClient.browse`에 선택적 `onView`, `skipFolders`, `counts` 추가. 기존 반환 계약 유지.
- 폴더 응답 즉시 표시, 파일 실패 시 폴더 사용 가능. 새 탐색은 이전 요청 취소 및 세대 검사.
- 동일 API 함수/URL의 진행 요청만 공유. 한 구독자의 취소로 다른 구독자는 중단하지 않음. 완료 metadata는 권한 검증 없이 재사용하지 않음.
- 사진 페이징은 폴더 재요청 생략, 캠퍼스 목록/로고는 폴더마다 재생성하지 않음.
- `counts=0`은 picker가 표시하지 않는 파일 개수 집계 생략. 자료보관함 기본 개수 계약은 유지.
- 캠퍼스 기본분류의 누락 projection 조회를 단일 IN 쿼리로 묶음. malformed/private/deleted 검사는 유지.
- 썸네일은 IntersectionObserver, 동시3개, 8MiB/50개/5분 bounded cache. 이동 시 pending 취소, 승인된 새 목록 이후만 settled cache 사용.
- 썸네일 없는 legacy 자료는 빈 미리보기 아이콘을 사용하고 확대에서 인증 원본을 조회. 원본 일괄 다운로드/자동 축소 저장은 하지 않음.
- 로그아웃(pagehide), 재진입 context 변경, API 401/403, 폴더404 시 선택/목록/cache/임시 preview를 제거. 영구 브라우저 이미지 저장 없음.

### 동일 합성 조건 비교

`scripts/check-content-navigation.mjs`로 baseline `af4a61d`와 수정본의 실제 브라우저/Worker를 비교.
50개 이미지 및 중앙 썸네일, 폴더 왕복30회. 양쪽 asset 준비 후 측정.
health 900ms, 파일350ms, 폴더30ms의 동일한 추가 지연. 실제 운영 인터넷 속도나 유료 AI 생성시간 측정이 아님.

| 항목 | 전 | 후 |
|---|---:|---:|
| 첫 폴더 사용 가능 | 1,452ms | 346ms |
| 폴더 재방문 중앙값 | 869ms | 317ms |
| 폴더 재방문 p95 | 1,518ms | 352ms |
| 첫 파일 목록 | 840ms | 879ms |
| 첫 썸네일 | 1,096ms | 1,025ms |
| 측정 중 API 요청 | 326 | 243 |
| API 응답 bytes (정적 asset 제외) | 961,853 | 946,668 |
| 원본 이미지 요청 | 0 | 0 |

폴더 대기는 크게 감소했으나 첫 사진 목록 속도 자체는 개선으로 주장하지 않음.
30회 이동 후 cache 18개/3,600 bytes, pending active0. 표본은 작고 운영 부하는 별도.
GC 후 DOM listener 수는 수정 전 244→292, 수정 후 201→201. 수정 후 DOM node는 2,536→2,263,
JS heap은 2,432,088→2,573,356 bytes. 30회 표본에서 listener 누적은 없었지만 장시간 메모리 누수 부재까지 단정하지 않음.
측정 전후 GC와 안정화 대기를 추가한 최종 실행 값이며, 네트워크/기기/캐시 준비 상태에 따라 달라질 수 있음.
원시 결과: `outputs/content-navigation/metrics.json` (로컬 검증 산출물).

## 로고·저장·문구

- 여섯 번째 명시적 `logoType=none`. 브랜드 header/로고/캠퍼스/태그라인/구분선 합성 생략.
- none 이미지 영역은 (56,56,2048,2588). 작품 contain, 공간 사진 cover. 원본 속 글씨/서명은 별도 제거하지 않음.
- 기존 3종 legacy, 기존 5종 carousel fingerprint registry를 유지하여 새 옵션 때문에 과거 출력이 무효화되지 않음.
- 같은 화면에서 로고만 변경하면 캠퍼스/원본/방향/모드가 같은 AI 중간 결과를 재사용. 최종 렌더 API는 현재 source 권한/출처 재검사.
- 새로고침/선택 변경/방향 변경 시 AI 중간 결과 메모리 재사용은 끝남. 서버에 전역 생성 cache나 자동 재과금 기능 없음.
- 저장 전/중/완료/실패/변경사항 미저장. 저장 버튼과 상태를 flex gap으로 분리, 실제 세트 POST 성공 때만 완료.
- 기존 requestId 세트 idempotency 유지, 부분 제작은 완료 저장 금지. 캡션 실패 시 이미지 다운로드는 유지.
- `N번 이미지 다운로드` + Lucide Download 아이콘, 완료에는 Check 아이콘. 2160×2700 master/1080×1350 download 유지.
- 고정 두 입력칸은 방향 아래/로고 위, 320px에서도 2열. 기존 sourceApp/campus defaults 저장 재사용.
- footer의 줄바꿈/공백/빈 값 보존. AI에 전달하지 않고 결과에 한 번 결합. 고정 태그를 먼저 배치하고 중복 제거.
- 기본값 지연 응답은 새 입력을 덮어쓰지 않음. 저장 실패는 입력 보존. 기존 저장 세트 캡션은 기본값 변경으로 수정하지 않음.

## AI 사용률 계약과 설정

공통 상단 `GET /api/data-core/content/ai-usage`는 무료 관리 API GET만 사용. 생성 시험 요청 없음.
MASTER 전용 `PUT /api/data-core/content/ai-budget`는 앱 내부 USD 월 예산만 저장하며 OpenAI 결제/차단 정책을 바꾸지 않음.

- 공식 비용: OpenAI `GET /v1/organization/costs`, 지정 `project_ids[]` 및 `group_by[]=project_id`, UTC 당월 시작부터 현재까지, cursor 전 페이지 합산.
- 공식 분모: `GET /v1/organization/projects/{project_id}/spend_limit`, USD/month의 양수 cents를 USD로 변환. 집행 상태를 구분.
- 공식 분모가 없으면 MASTER 앱 예산 사용. 비용/예산 미확인은 null/대시, 실제 성공한 0원 집계만 0%.
- 캐시5분, 실패 시 같은 프로젝트/월의 마지막 공식값과 갱신 실패 표시. 키 제거 시 공식 비용은 확인 필요로 전환.
- 공식값만 비용으로 사용. 불완전한 과거 호출 기록을 비용0이나 추정 월합계로 만들지 않음. 100% 초과 숫자 표시 가능.
- `content-ai-call`은 실제 outbound 호출마다 UUID 1개, 미확정→응답확인 갱신. retry는 별도 호출, 중복 UI 요청은 기존 request guard로 차단.
- ledger는 기능(blog/instagram), projectScope, 검증된 token 수만 저장. 프롬프트/사진/응답 본문/비밀키는 저장하지 않음.
- ledger 시작시각과 미확정 횟수를 표시. 공식 프로젝트 전체 비용에는 이 앱 밖의 프로젝트 사용도 포함되므로 앱 요청 횟수와 별개라고 명시.
- usage/ledger는 기존 data_records의 protected type. generic read/mutation을 차단하고 요약만 업무용 사용자에게 제공.

필요한 외부 설정:

1. 생성 키는 기존 `OPENAI_API_KEY` 재사용, 변경하지 않음.
2. 별도 최소 권한의 OpenAI 관리 키를 Worker secret `OPENAI_ADMIN_KEY`로 설정해야 공식 비용 조회 가능. 생성 키를 관리 키로 복제하지 않음.
3. 생성 키가 실제 사용하는 프로젝트를 `OPENAI_PROJECT_ID`로 지정해야 함. 임의 프로젝트 추정/키 자동 발급 없음.
4. 공식 월간 한도가 없는 경우 MASTER가 앱 관리 예산을 설정해야 비율 계산 가능.

읽기 전용 `wrangler secret list --name hi5-anihi-one` 확인 시 기존 생성 키는 있으나 관리 키/프로젝트 secret은 없었음. 평문 키를 읽거나 출력하지 않음. 일반 var의 프로젝트 값은 별도 확인 필요.
참고: [Admin API](https://developers.openai.com/api/docs/guides/admin-apis), [Costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs), [Project spend limit](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/subresources/spend_limit/methods/retrieve).

## 공통일정

상세/신규/수정/soft 삭제/복사, 제목·메모 검색, 범위·유형 필터, 월간·목록, 연월 이동, 시간·장소·여러 날, 오늘/7일 요약을 통합.
SQL ACL/date overlap 후 keyset pagination으로 100건 이후도 조회. 기존 조직/캠퍼스/작성자 권한, 공모전 읽기 전용 projection 유지.
상세는 키보드 초점/Esc/모바일 대응, 중복 제출 차단, 실패 입력 보존. 기존 테스트의 calendar origin 누락을 실제 브라우저 same-origin 계약에 맞춤.
세부 API와 검증은 `docs/CALENDAR_DETAILS_2026-09-21.md`.

## 검증 경계

- 합성 Worker/API와 실제 브라우저 테스트를 분리해서 실행. 실제 유료 AI 호출은 이번 작업에서 0회.
- Instagram 320/390/768/1024/1440/1920px, 원본 형식7종, 로고없음1/5/10장, 저장 실패/재시도/idempotency, 캡션 실패 및 이미지 다운로드, fixed defaults 재조회/실패 입력 유지.
- Calendar 1920/1440/1280/1024/820/768/430/390/320px, 120건 이상 UI 및 260건 API, 50회 열기/닫기 후 observer2/listener10 유지, 입력5~17ms.
- Preview asset hash 대조는 배포된 프런트 일치 검증이며 Preview의 실제 사용자 권한/DB 변경 검증으로 표현하지 않음.
- dependency audit 기존 12건(중간4/높음8), `data-core-library.ts` 기존 lint7건은 범위 밖. 새 any 오류는 제거.
- 전체 테스트/CI/Preview 최종 결과는 PR #242 및 최종 보고에 기록.
