# 학원 공통 일정 상세·검색 개선

## 범위와 보존

- 기준 main: `e5f1eefecb68326acaac2a927aae844e78eb9eeb`.
- 업무홈/상담홈은 `public/data-core/calendar.js`와 기존 calendar API를 공유한다.
- 기존 `data_records`의 `academy-calendar-event`/`academy-calendar`를 재사용한다. migration, 운영 일정 수정, R2 접근/변경 없음.
- 이 작업은 PR까지 진행한다. main 병합과 production 배포는 별도 승인 전 수행하지 않는다.

## 화면

- 날짜 버튼/빈 칸은 날짜 선택, 일정 버튼은 읽기 전용 상세창, 더보기는 해당 날짜 전체 목록을 연다. 중첩 button 없음.
- 일반 일정은 실제 ID, 공모전 projection은 별도 source 복합 ID로 식별한다. 같은 제목도 혼동하지 않는다.
- 상세창: 제목, 범위/유형, 시작~종료일, 시간/장소/메모, 확인 가능한 작성자/등록·수정일. 메모는 HTML 실행 없이 줄바꿈 유지.
- PC 최대 760px, 휴대폰 전체화면, 본문 내부 스크롤, Tab 순환/Esc/배경 클릭/포커스 복귀. 편집창의 미저장 변경은 닫기 확인, 저장 중 닫기/중복 제출 차단.
- 선택 월 제목·메모 검색(한글 IME 고려), 허용 캠퍼스/조직 공통 범위, 유형, 월간/목록, 연월 이동. 검색·권한 상태는 로컬 영구 저장하지 않는다.
- 종일/시간 미지정/시간 지정 및 장소는 기존 metadata에 선택적으로 추가한다. legacy 데이터의 없는 시간·장소는 지어내지 않는다.
- 날짜는 한국 기준, 종료일 포함. 종료일 삭제로 단일 날짜 복귀. 같은 날짜의 종료시간 역전 금지.
- 복사는 제목/메모/유형/장소만 편집창에 채우고 날짜·시간·ID를 비운다. 범위는 현재 사용자 기본값이며 명시적으로 저장하기 전 POST 없음.
- 오늘/앞으로 7일(내일~7일 후) 요약은 선택 월과 독립이며 겹치는 기간 일정도 포함한다.
- 공모전 원본 링크는 http/https만 허용한다. 자동 projection은 읽기 전용이며 마감 D-day는 일반 일정에 붙이지 않는다.

## API와 권한

`GET /api/data-core/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`

선택 query: `q`, `scope=all|organization|campus`, `campusId`, `eventType`, `limit`(최대100), `cursor`.
응답은 기존 `events`와 additive `hasMore`, `nextCursor`다. 한 요청 기간은 최대63일이다.

- SQL에서 organization, deleted_at, 기존 ACL, 날짜 overlap, 검색/필터를 적용하고 `(startDate,id)` keyset으로 페이징한다.
- 프런트는 모든 페이지가 성공해야 전체 조회 완료를 표시한다. 오류/로딩과 실제 0건을 구분한다.
- 오래된 미래 일정이 최근 생성순 상위100에서 밀려 누락되던 기존 제한을 대체한다.
- malformed legacy JSON/날짜는 조회에서 안전하게 제외하되 원본은 수정하지 않는다. 잘못된 원본의 정정은 별도 검토 대상이다.
- `GET /api/data-core/calendar/:id`는 기존 record read ACL을 적용하고 server `canManage`를 반환한다.
- MASTER 전체, CAMPUS_ADMIN 관리 캠퍼스, 그 외 업무용 계정은 기존 작성자 mutation 계약을 유지한다. 조직 공통 생성/수정은 MASTER만 가능하다.
- 자동 연결 `sourceRecordId` 일정은 이 calendar API에서 직접 수정/삭제하지 않는다. 원본 기능에서 관리한다.
- 변경 요청은 same-origin을 검사한다. 다른 캠퍼스 ID 조작으로 읽기/쓰기를 확대하지 않는다.
- 로그아웃/접근 context 변경 시 상세 본문·목록·편집 상태를 지우고 진행 조회를 취소한다.

## 성능과 경합

- 목록과 상세 모두 AbortController/세대 번호로 오래된 응답을 무시한다.
- 동일 월 정상 저장은 확정 응답을 즉시 반영하며 불필요한 재조회 없음. 조회가 미완료/오류였거나 월이 바뀐 경우만 재조회한다.
- 달력 event delegation을 한 번만 등록한다. 공모전 observer는 홈별1개, 총2개를 유지한다.
- 입력마다 달력 전체를 다시 그리지 않는다. 검색은 IME 완료 후 debounce한다. modal backdrop blur 없음.

## 검증

`tests/calendar-details.test.mjs`: 격리 D1/R2, 260건 pagination, 오래된 미래 일정, 검색/범위, detail ACL, 윤년/시간/기간/장소, 복사 원본 보존, soft delete, same-origin.

`scripts/check-calendar-browser.mjs`: 실제 Worker + 격리 D1/R2. 공개 공모전 feed만 빈 응답으로 격리하며 calendar 저장/조회/권한은 실제 API를 호출한다. 합성 오류/지연으로 실패 입력 보존, 중복 제출, stale response를 검사한다.
1920/1440/1280/1024/820/768/430/390/320에서 입력창, 필수7개 폭에서 긴 제목·메모 상세창, 120건 초과 월 조회, 검색 IME, 목록, 복사, 필터, focus, 50회 상세 열기/닫기, observer/listener 수를 검사한다.

실행 결과/CI/Preview 증거는 PR에 기록한다. `--preview URL` 검사는 원격 정적 asset hash 일치 + 로컬 실제 Worker 동작 검증이며, Preview의 인증/DB 운영 검증으로 간주하지 않는다. 실제 production 사용자 일정 등록·삭제 검증은 수행하지 않는다.

## 제한과 후속

- 기존 calendar metadata에 첨부파일 계약이 없으므로 임의 링크/새 업로드를 만들지 않았다.
- 검색은 선택 월 전체(모든 페이지)이며 전 기간 검색은 아니다. 많은 월별 결과는 전부 메모리에 보관하므로 대규모 실운영 부하 측정은 별도 필요하다.
- SQL JSON 날짜 조건의 운영 규모 쿼리 비용/지연은 아직 실측하지 않았다. 필요 시 별도 additive index 검토.
- 다음 순서: 반복 일정(개별/전체 회차), 자료보관함 첨부(별도 파일 권한), 실제 알림(수신 설정·중복·재시도·결과).
