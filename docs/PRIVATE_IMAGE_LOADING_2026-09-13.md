# 이미지 표시 지연 개선

기준 main: `4d5064b` (공통 갤러리 PR #206). 기존 운영 원본/계정/권한/스키마는 변경하지 않는다. 미리보기 파생 파일만 기존 중앙 저장 구조에 추가 가능하다.

## 확인한 원인

- 커리큘럼에는 2200px WebP 미리보기가 이미 있지만 확대창에서 즉시 대용량 원본으로 바꾸고 원본 decode까지 전체 화면을 가렸다.
- 확대 이동 시 이미 본 이미지를 다시 만들고 인증 파일 경로를 재요청했다. 다음 장 준비도 대부분 작은 미리보기뿐이었다.
- 공모전 타일은 서버 썸네일이 있어도 원본을 받아 Canvas로 축소했다. 새 공모전 업로드는 기존 썸네일 후처리에 연결되지 않았다.
- 자료보관함 확대 원본이 타일 다운로드 대기열 뒤에 밀릴 수 있었다.
- FAMILY 작품 파일은 매번 `no-store`였으므로 다시 볼 때 변경 없는 원본도 전송했다.

## 적용

| 영역 | 변경 |
| --- | --- |
| 공통 확대창 | 미리보기를 가리지 않는 작은 로딩 상태, 현재/인접 두 장만 준비, 현재 선택 우선, 요청 병합/재사용, 늦은 응답 차단 |
| 커리큘럼 | 기존 thumbnail → 2200px preview, 수업 화면/확대창 메모리 공유, 실제 원본은 돋보기 시 요청, print URL 유지 |
| 학생관리/합격사례/기존 수상작/입시요강 | 같은 학생/목록 범위의 공통 캐시와 앞뒤 준비, 기존 영구 thumbnail/원본 구분 유지 |
| 공모전 | 중앙 썸네일 일괄 조회/사용, 없으면 기존 원본 fallback. 권한자가 이미 열어본 타일 bytes로 폴더당 최대 5개, 한 번에 하나씩 기존 thumbnail POST 사용. 신규 업로드도 같은 후처리. 원본 성공/표시는 썸네일 실패로 되돌리지 않음 |
| 자료보관함/콘텐츠 사진 | 원래 썸네일/동일 폴더 유지, 클릭한 원본 전용 요청 슬롯, 확대 캐시 재사용 |
| 꿈이음/FAMILY | 권한/학생/보호자 동의 확인 이후 `private, no-cache` + ETag/304. UI 메모리 외 영구 캐시는 추가하지 않음 |

공통 캐시는 현재 뷰 범위, 6개 항목, 약 96MiB decoded pixel 기준 LRU(큰 단일 원본은 별도), 5분 재사용 수명이다. 원본 요청은 최대 45초, encoded 수신 상한은 기존 업로드 상한과 같은 100MiB다. 인접 요청은 낮은 우선순위이며 데이터 절약/2G/숨겨진 문서에서는 시작하지 않는다. 폴더/학생/수업 전환, 로그아웃, pagehide에 취소 및 URL 해제한다. 커리큘럼은 소유한 수업 cache를 dispose한다.

공모전 lazy thumbnail은 이미 받은 원본의 Canvas 결과를 재사용하며 원본 재다운로드 없이 별도 파일만 저장한다. 기존 480px/256KiB 제한 및 source 권한/lineage/idempotency 검사를 재사용한다. 폴더 전환 시 취소하며 POST는 30초 제한, 실패는 다음 열람에서 재시도 가능하다. 조회만 가능한 사용자에게는 POST하지 않는다.

R2 public URL, 공유 CDN 이미지 캐시, localStorage/IndexedDB, API Service Worker 캐시는 사용하지 않는다. 서버 권한은 매번 다시 검사하며 비인가/삭제된 데이터는 304로 우회할 수 없다. 보호자 JSON/API 목록은 여전히 `private, no-store`다.

참고: [MDN private/no-cache revalidation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching). 추가 유료 이미지 변환 서비스/새 binding은 사용하지 않는다. [Cloudflare Images binding](https://developers.cloudflare.com/images/optimization/binding/)은 이후 필요 시 별도 검토 대상이다.

## 측정과 검증

2026-09-13 production D1을 집계 SELECT로만 확인했다. 변경 건수/쓰기 행 수는 0이다. 파일명/학생 정보는 조회하지 않았다.

| 운영 분류 | 파일 수 | 평균 크기 |
| --- | ---: | ---: |
| curriculum-original | 926 | 3757KiB |
| curriculum-preview | 926 | 238KiB |
| curriculum-print | 926 | 803KiB |
| curriculum-thumbnail | 926 | 29KiB |
| competition-material | 67 | 4952KiB |

운영 `image-thumbnail`은 이 시점에 0건이다. 커리큘럼은 기존 웹 파일 사용만으로 표시용 전송량이 평균 약 94% 줄어든다. 공모전 기존 자료는 최초 열람 이후 제한된 lazy 생성으로 점진적으로 개선된다. 이 수치는 네트워크 시간 측정이 아닌 저장된 크기 집계다.

`scripts/check-image-loading-performance.mjs`는 PR #206 코드를 baseline으로 같은 합성 이미지/네트워크 지연과 비교한다. 파일 내용은 운영 학생 자료가 아니다.

1280px, 미리보기 응답 80ms / 원본 응답 1800ms 조건의 첫 실행:

| 측정 | 이전 | 개선 후 |
| --- | ---: | ---: |
| 커리큘럼 첫 표시 | 1861ms | 129ms |
| 다음 장 표시 | 1864ms | 25ms |
| 확대 전 원본 요청 | 1 | 0 |

이는 합성 응답 지연에서의 결과이며 운영 전송속도 보장 또는 모든 파일의 동일 배속 개선을 뜻하지 않는다.

추가 검사: 실제 zoom 시 원본 1회 요청, 뒤로 넘김 재다운로드 0, 요청 중복 병합, 미리보기 비차단 표시, 320~1920px 공통 뷰어, 수업별 print/뒤로가기, 업로드 후처리, 중앙 썸네일 LRU 보존, FAMILY 권한 확인 전 304 금지. 최종 build/test/Preview/production 결과는 PR evidence에 기록한다.

로컬 검증: `npm ci`, build, typecheck, 60개 public JS syntax, `wrangler deploy --dry-run` 통과. 전체 테스트 366개 통과 후 lazy persistence 2개를 추가해 cache 관련 17개를 재검증했다. 공통 갤러리 219 checks/10폭, 공모전 77 checks/5폭, 커리큘럼 3과정/6폭, 자료보관함/학생관리/콘텐츠 7폭/FAMILY 807 checks 회귀 통과. 최신 합성 재측정은 1852→124ms, 다음 장 1863→23ms다.

새 공통 갤러리/성능 측정 스크립트 ESLint 통과. 기존 전역 스크립트 `AwardImageCache`의 unused-vars 경고 1건은 남아 있으며, lockfile/의존성은 변경하지 않았다. `npm ci`의 기존 audit 경고는 12건(중간 4, 높음 8)이다. 최초 병렬 fixture 실행에서 Windows 포트 충돌이 있었고, Miniflare fixture를 직렬로 재실행해 통과했다.

## 남는 제한

썸네일이 없는 기존 작품의 **최초** 다운로드는 여전히 원본 bytes가 필요하다. 이번 작업은 운영 전체 원본을 일괄 변환하거나 재업로드하지 않는다. 학생관리의 기존 MASTER 5장 썸네일 생성 기능 및 신규 업로드 후처리는 유지한다. 공모전의 신규/lazy 썸네일은 접근 권한이 있는 캠퍼스에서 동일 중앙 파일을 재사용한다. 조회만 가능한 사용자의 열람에는 lazy 쓰기를 하지 않는다. 전체 backfill은 이번 작업에 포함하지 않는다.

인터넷/파일 원본이 매우 크거나 서버에 웹 미리보기가 없는 경우를 '즉시 표시 완료'로 보고하지 않는다. 원본/인쇄 품질을 낮추거나 기존 R2 객체를 덮어쓰지 않는다.
