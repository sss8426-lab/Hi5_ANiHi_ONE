# 확대 이미지 연속 보기

2026-09-13, `feat/shared-image-gallery`, base main `f2901015`.

## 적용 범위

| 화면 | 이동 범위 |
| --- | --- |
| 공모전·실기대회 수상작 | 현재 선택한 폴더의 조회된 이미지 |
| 대학합격 로드맵 학생관리 | 해당 학생의 그림 전체 (표 첫 그림/상세/수정 모두) |
| 합격·불합격 사례 | 해당 사례 학생의 그림 |
| 커리큘럼 | 현재 수업의 페이지 순서 |
| 자료보관함 | 현재 폴더·검색·목록 페이지의 이미지 파일만 |
| 블로그·인스타 사진 확대 | 현재 자료보관함 목록, AI 사진 선택 상태와 독립 |
| 꿈이음 교직원 작품 | 선택한 학생·월의 작품 |
| FAMILY 보호자 작품 | 현재 연결 자녀의 허용된 작품 |
| 기존 수상작/대학 입시요강 이미지 | 해당 대학·연도 또는 대학 요강 이미지 목록 |

자료보관함에서 다른 폴더나 다음 목록 페이지까지 자동 조회하지 않는다.
커리큘럼 과정이나 수업 경계, 학생/캠퍼스 경계를 넘어서 연결하지 않는다.
단일 홍보 이미지, PDF/문서 미리보기, 인스타 원본/AI 결과 비교는 기존 동작을 유지한다.

## 공통 구현

- `public/data-core/image-gallery.js`, `image-gallery.css`
- `window.DataCoreImageGallery.open({items,index,title,scope,anchor,onChange,onClose,actions})`
- item: `src`(원본), `previewSrc`(선택), `title`, `alt`, `load({signal})`(기존 비공개 캐시용 선택)
- 확대창 안의 이전/다음 버튼, 장수 표시, ArrowLeft/ArrowRight/Home/End, Escape, 터치/마우스 수평 스와이프.
- 첫/마지막 장에서 멈춤. 한 장이면 좌우 버튼 숨김. 이미지 비율 유지, 잘라내지 않는 contain.
- 원본 크기 확대 중 드래그, 세로 스크롤, 다중 포인터는 페이지 전환하지 않음.
- native dialog, 44px 터치 영역, Tab 포커스 제한, 종료 시 호출 버튼 포커스 복원.
- 오류 재시도, 늦은 응답 무시, 종료/로그아웃/경로 변경/호출 요소 제거 시 정리.
- 현재 그림과 이웃 미리보기만 준비. 기존 공모전/자료보관함 메모리 캐시를 재사용.
- 커리큘럼 확대 이동은 기존 `slide` query와 축소 화면도 동기화. 인쇄 파일과 인쇄 준비는 변경하지 않음.
- Lucide 0.468.0의 ZoomIn/ZoomOut/ChevronLeft/ChevronRight/Trash2를 기존 sprite에 추가. 원본: https://github.com/lucide-icons/lucide/tree/0.468.0/icons (ISC).

## 보존 및 보안

서버/API/권한/DB/R2 변경 없음. migration 없음. 기존 원본, ID, 업로드·삭제·다운로드 계약 유지.
same-origin 인증 파일 URL과 기존 메모리 blob URL만 사용하고 외부 URL을 새로 만들지 않는다.
슬라이드 자체는 읽기 기능이며 쓰기 API를 호출하지 않는다.
기존 legacy 뷰어의 명시적 삭제 버튼은 확인창 및 기존 API를 그대로 재사용한다.
FAMILY의 자녀 전환/로그아웃 후 늦게 온 이전 요청을 무시하도록 요청 순번 검사를 추가했다.
Service worker는 UI 정적 파일만 캐시하며 `/api/` 이미지는 계속 network-only다.

## 검증

- `node scripts/check-image-gallery-browser.mjs`: 320~1920px, 키보드/포커스/원본 확대/실제 touch/핀치/오류/늦은 응답/닫기.
- 기존 공모전, 커리큘럼, 학생 썸네일, 자료보관함, 콘텐츠 AI, 꿈이음 browser suite에 갤러리 회귀 추가.
- `node --test tests/image-gallery.test.mjs`: 소비자 HTML 로딩, 자녀 변경/로그아웃 race, private 파일 SW 보호.
- API 테스트는 합성 데이터와 임시 D1/R2 또는 intercepted fixtures만 사용. 실 운영 학생·사진 수정 없음.
- 배포 검증 시 `GALLERY_PREVIEW_ORIGIN`은 배포된 정적 자산 바이트를 비교한다. 합성 UI 검증을 실 계정 운영 승인 테스트로 표현하지 않는다.
