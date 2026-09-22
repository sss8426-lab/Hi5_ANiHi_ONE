# 자료보관함 파일 관리 개선 (2026-09-22)

## 범위와 보존

기존 DATA CORE D1/R2 및 캠퍼스별 권한을 재사용한다. 새 저장소, 공개 파일 URL, 외부 변환 서비스, AI 호출을 추가하지 않는다. 본원 작업물 진입 숨김, 관리자 R2 사용량/비용, FAMILY 분리, 기존 multipart 업로드와 블로그/인스타 파일 선택 API를 유지한다.

## 8개 기능

| 요청 | 구현 |
| --- | --- |
| 전체 경로 | 서버가 검증한 조상 ID와 표시명을 files/recent 응답에 포함. 동일 조상 일괄 조회. 경로 클릭 시 실제 페이지 탐색과 강조, 브라우저 뒤로가기로 검색/정렬/스크롤 복구 |
| 공통 미리보기 | 파일명/형식/크기/경로/다운로드/이전·다음, Esc 및 포커스 복귀. 문서 파서는 해당 파일을 열 때만 로딩 |
| 선택/이동 | ID 기준 체크박스, Ctrl/Cmd/Shift, 마우스 범위 선택, 내부 드래그/이동 대화상자, 불러온 항목 선택, 기존 비재귀 휴지통 |
| 보기/정렬 | 일반 파일 그리드/목록 전환, 로컬 보기 설정, SQL 정렬 후 권한 필터와 페이지 분할. 최신/오래된/이름 양방향/크기 양방향 |
| 개수 | 직접 하위 폴더와 파일 수를 카드에 분리 표시. 통계 실패는 null로 반환하며 0으로 꾸미지 않음 |
| 폴더 업로드 | 최상위 이름과 중첩 경로 보존. 폴더 합치기/이름 변경, 파일 이름 변경/건너뛰기. readEntries는 빈 결과까지 반복 |
| 진행창 | 우측 하단 비모달 다중 배치, 접기와 취소 분리, 성공 후 약 2초 자동 접힘. 포인터/포커스가 있으면 지연. 오류/썸네일 실패 보존 |
| 최근 카드 | 기존 최대 50개/12개씩 표시 유지. 썸네일 왼쪽/파일명 오른쪽, 전체 경로/시간/작업, 데스크톱 4~5열에서 모바일 1열 |

## API와 원본 보존

- `GET /api/data-core/library/files`에 선택적 `sort`, `focusId` 추가. 기존 호출은 기존 기본 정렬 유지.
- `POST /api/data-core/library/move`: `{requestId,targetId,items:[{kind,id,revision}]}`. 같은 캠퍼스/호환 보호 범위만 허용한다.
- 기본 분류 루트, 자기 자신/하위, 순환, 같은 위치, 이름 충돌, 보관 폴더, 깊이 14 초과, 업로드 충돌, 권한 변경을 차단한다.
- 하위 폴더/파일/조상 스냅샷을 D1 batch 안에서 검증한다. 조건부 UPDATE 건수도 검사한다. 하위 category 갱신과 감사 로그가 하나의 트랜잭션이다.
- 파일/폴더 ID, R2 key/원본 바이트, 소유자/공유 범위/생성일은 유지한다. 원본 다운로드/재업로드/삭제로 이동하지 않는다. AI 전송 보호 수준도 낮추지 않는다.
- 한 요청에 선택 100개, 하위 폴더 총 250개, 포함 파일 2,000개까지 원자적으로 처리한다. 초과 시 일부 이동 없이 전체 거부한다. 초과 규모용 비동기 이동 작업은 제공하지 않는다.
- 같은 requestId 재시도는 감사 로그 결과를 재사용한다. 다른 payload 재사용은 충돌이다.
- 간단 업로드의 uploadRequestId와 파일 해시를 서버에 저장해 응답 유실 후 같은 원본 중복 생성을 방지한다. multipart는 기존 세션/청크 계약을 유지한다.
- 업로드 동안 내부 `library-write-lease`로 폴더 정책 이동을 차단한다. 일반 records API는 lease/request/session 위조를 거부한다. 비정상적인 Worker 강제 종료로 남은 lease/request는 자동 만료시키지 않으며 운영자 확인이 필요하다. 늦은 업로드를 허용하는 무조건적인 타임아웃 해제는 하지 않는다.

## 미리보기 지원과 제한

| 형식 | 지원 범위 |
| --- | --- |
| JPG/JPEG, PNG, WebP, GIF, AVIF, BMP | 브라우저 원본 래스터 표시. 원본 비율/브라우저 EXIF 방향 및 GIF 애니메이션 유지. 2,400만 픽셀 이하 |
| PDF | 로컬 PDF.js 6.3.289. 페이지 이동, 확대/축소/맞춤, 현재 페이지만 렌더링. 암호 파일은 다운로드 안내 |
| AI | 실제 PDF 호환 데이터가 있는 파일만 PDF 뷰어 사용. 비호환 AI/외부 링크/설치되지 않은 폰트를 재구성하지 않음 |
| XLSX/XLS/XLSM/CSV | SheetJS 0.20.3 읽기 전용. 최대 100개 보이는 시트, 시트별 첫 500행/50열, 50행씩 표시. 저장된 값/표시 형식/일부 병합. 매크로·수식·외부 링크 실행 없음 |
| PSD | ag-psd 31.0.2, 8비트 RGB, 1,600만 픽셀 이하의 저장된 합성 이미지 또는 내장 썸네일. 레이어 재합성 없음 |
| PSB/CMYK·16비트 PSD/SVG/TIFF/HEIC | 이번 버전 미지원. 원인을 표시하고 원본 다운로드 유지 |

- 입력 파일 한도: Excel 16MiB, 기타 32MiB. XLSX ZIP 중앙 디렉터리의 총 해제 크기 64MiB/4,000항목 제한, Excel/PSD worker 15초, PDF 초기 로딩 15초. 원본 업로드 한도와는 별개다.
- 복잡한 엑셀 차트/그림/서식, 손상 ZIP 내부의 실제 팽창량, 모든 PDF 압축 스트림의 메모리를 완전히 예측하는 기능은 없다. 파서는 별도 Worker로 실행하고 종료 가능하게 한다. 원본과 완전히 같은 편집기 렌더링을 보장하지 않는다.
- 시트 셀은 textContent로 표시한다. PDF 스크립트/첨부 실행/annotation 링크/XFA는 렌더링하지 않는다. SVG HTML 삽입이나 외부 온라인 뷰어 전송은 없다.
- 파서/글꼴/WASM은 build 시 정적 자산에 복사한다. PDF.js Apache-2.0, SheetJS Apache-2.0, ag-psd MIT 라이선스를 함께 배포한다.
- 세션 메모리 캐시는 원본 ID/ETag/렌더러 버전 기준 최대 3항목/입력 기준 48MiB. 새로 열 때 HEAD로 서버 권한을 재검사한다. 닫을 때 요청/렌더/파싱 worker/Blob URL을 정리하며, 로그아웃·페이지 종료·권한 거부 시 캐시를 비운다. 캐시 크기는 디코딩 후 전체 브라우저 heap의 상한을 뜻하지 않는다.

## 업로드 지원 조건

한 배치 최대 파일 5,000개/폴더 500개. 파일마다 목적지와 요청 ID를 고정한다. 다른 폴더로 이동해 추가한 배치가 이전 목적지를 바꾸지 않는다. 일반 파일 3개 병렬, 대용량은 기존 16MiB multipart/제한 동시성 경로를 사용한다.

파일 선택창의 webkitdirectory는 빈 폴더를 제공하지 않을 수 있다. DirectoryEntry를 지원하는 폴더 드롭은 빈 폴더도 생성한다. 지원 조건을 충돌 확인창에 표시한다. 폴더 준비 중 실패하면 이미 만든 빈 폴더는 유지되며 합치기로 다시 사용할 수 있다. 브라우저 탭을 닫은 뒤 계속 업로드하는 백그라운드 서비스는 아니다.

## 검증 방법

- `tests/library-file-management.test.mjs`: 실제 Worker와 격리 D1/R2. 이동/충돌/권한/업로드 잠금/ID와 원본 보존/재시도/서버 정렬/3페이지 파일 찾기/통계 실패.
- 기존 `tests/library-*.test.mjs`, 썸네일/캐시/업로드 및 전체 `tests/*.test.mjs` 회귀 테스트.
- `scripts/library-management-smoke.mjs`: 합성 문서와 사진, 실제 Worker API, Playwright Chrome. 320/390/768/1024/1440/1920px, 시트/페이지/형식, 선택, 폴더 이동, 계층 업로드, 추가 배치, 137개 DirectoryEntry, 30회 왕복 탐색.
- `scripts/library-management-benchmark.mjs <built-baseline-checkout>`: 동일 깊이 4/사진 12개/1440x1000/새 context 3회 중앙값. 로컬 Node-workerd 브리지 수치이며 운영 인터넷 응답시간이나 대규모 데이터 SLA가 아니다.
- 브라우저 결과/스크린샷/성능 JSON은 로컬 `outputs/library-management/`에 저장한다. 운영 학생 데이터의 쓰기 테스트나 외부 AI 호출은 하지 않는다.

## 주요 변경 파일

`public/data-core/work/hq-library.js`, `library-manager.js/css`, `library-preview.js`, `library-preview-worker.js`, `library-upload-panel.js`, `public/data-core/library-client.js`, `upload-queue.js`, `worker/data-core-library.ts`, `data-core-library-policy.ts`, `data-core-files.ts`, `data-core-records.ts`, `data-core-derivative-policy.ts`, `private-image-response.ts`, `library-move.ts`, `library-write-lease.ts`, `library-upload-request.ts`, `scripts/build-library-preview.mjs`, 검증 스크립트/테스트, 패키지 lockfiles, CI 문법 검사.

## 로컬 검증 결과

- 최신 빌드의 자료보관함/기본폴더/커리큘럼/비공개 이미지 캐시/업로드 큐 관련 테스트 33/33 통과. 타입 검사, 관련 JS 7개 문법 검사, 신규 모듈 ESLint, Wrangler 배포 dry-run 통과. 운영 의존성 audit 0건.
- 실제 브라우저 테스트: 위 6개 화면 폭, 6종 래스터, PDF/AI 2페이지, Excel 2개 보이는 시트와 숨김 시트, PSD 합성/미지원 색상 모드/PSB/크기 제한, 권한 취소 후 캐시 표시 차단 통과.
- 체크박스 실제 checked 상태, Shift, 정렬/목록 전환, 사각형 마우스 선택, 내부 폴더 drag/drop 확인, 파일별 저장 목적지 유지, 자동 접힘 통과.
- 30회 왕복: 메타데이터 요청 120회(화면당 2회), GC 후 JS 이벤트 리스너 198 -> 198, heap 약 3.11 -> 3.24MB. 짧은 반복 검증이며 장기 무누수를 보장하지 않는다.
- 작은 합성 폴더 이동 API 114/106ms, 작은 합성 파일 업로드 360/372ms. 1초 의도적 지연 배치도 독립 목적지 저장 확인. 기존에는 폴더 업로드/전체 폴더 이동 기능이 없어 같은 동작의 이전 수치는 해당 없음.
- 전체 로컬 회귀 545개 실행 중 기존 커리큘럼 2건은 로컬 연결 오류, 새 이동 충돌 1건은 빌드 갱신 전 실행으로 실패(부모 suite 포함 4건). 최신 빌드에서 실패한 범위를 재실행하여 모두 통과했다. 최종 전체 회귀의 권위 있는 결과는 해당 PR의 DATA CORE CI이다.
- 암호화 PDF 실파일, 운영 규모 수백 MB PSD/실제 2GiB OS 업로드, 브라우저별 HEIC/PSB는 성공 검증 대상이 아니다. 암호화 안내/자원 제한과 기존 multipart API 회귀로 범위를 나누었다.
