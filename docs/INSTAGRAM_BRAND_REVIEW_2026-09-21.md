# 인스타 로고·제작·승인 계약 (2026-09-21)

## 재사용과 원본 보호

기존 자료보관함 folder API, content draft/defaults, authenticated file API,
`persistImageDerivative`, `file_objects`, `data_records`, `audit_logs`, FILES를 재사용한다.
DB migration, bucket 신설, 계정/캠퍼스 이름 변경, 기존 파일 교체/삭제는 없다.
기존 `OPENAI_API_KEY` binding을 재사용한다. 키 생성/교체/값 출력이나 모델 변경은 없다.
블로그 작성 흐름은 유지한다.

## 공식 로고 자산

사용자 제공 JPG 2장은 `public/data-core/assets/brand/reference-{1,2}-20260921.jpg`에 보존한다.

- 참조 1 SHA256: `9FB2ECCFDBD68608C6DCEF70D36FD806EEB266DD8F8A0BD8D81B4B59CC48F008`
- 참조 2 SHA256: `5D6991BD104E5774E7AABAD20469F9F77456650980BCE7DD056DC694F7769634`

`scripts/prepare-instagram-brand-assets.mjs`는 참조 1에서 ANiHi/Hi5/통합 마크만 crop한다.
색/형태/비율을 바꾸거나 AI로 다시 그리지 않는다. 안산 문구는 crop에 포함하지 않는다.
참조 2는 조합/배치 참고 원본이다. 외부 이미지 다운로드는 없다. 벡터 원본이 제공되면
동일 registry에 새 version으로 추가할 수 있다.

## 표시명과 템플릿

Worker와 브라우저는 `instagram-brand-policy.js` 하나를 공유한다.

| 원본 캠퍼스명 | 로고 표시명 |
|---|---|
| 부천 디자인 입시본원 | 부천 입시본원 |
| 부천 애니 입시본원 | 부천 입시본원 |
| 부천 범박 캠퍼스 | 범박 캠퍼스 |
| 부천 원종 캠퍼스 | 원종 캠퍼스 |
| 부천 중동 캠퍼스 | 중동 캠퍼스 |
| 부천 옥길 캠퍼스 | 옥길 캠퍼스 |
| 서울 광진 입시본원 | 광진 입시본원 |
| 울산 송정 입시본원 | 송정 입시본원 |
| 안산 입시본원 | 안산 입시본원 |
| 파주 입시본원 | 파주 입시본원 |

미등록 명칭은 일괄적으로 앞 단어를 제거하지 않는다. 서버가 campus directory의 공식
표시명을 조회해 계산한다. 클라이언트의 campusLogoLabel은 출력/권한 근거가 아니다.
작품/애니 템플릿은 ANiHi, 디자인은 Hi5, 종합은 통합 로고를 추천하고 수동 변경 가능하다.
권장 로고와 다르면 사람 확인 필요로 표시한다.

## 제작과 승인

1. 기존 picker에서 원본 1장 선택.
2. 자료 유형, 홍보 사용 권한, 템플릿, 로고, 제목, 검증된 문의 문구 입력.
3. 로고 합성·미리보기: 초안을 저장하고 2160x2700 PNG를 새로운 FILES 객체에 저장.
4. 자동 검수 및 7개 담당자 확인 후 현재 버전 승인.
5. 승인된 버전만 1080x1350 PNG로 내보내고 게시용 사본도 FILES에 보존.

작품 영역은 (120,550)-(2040,2330)이며 원본 전체를 contain 배치한다. 로고/제목은 위,
문의는 아래로 분리한다. 제목/문의는 측정 후 2줄 초과 시 차단한다. 편집 가능한 문구와
로고 선택은 초안 metadata에 보존한다. 지난 작업은 최신 렌더/승인 상태를 복원한다.
과거 렌더 record는 보존하지만 전체 버전 비교 UI는 아직 없다.

학생 작품은 AI 전송/재생성을 금지한다. 실제 사진은 별도 외부 AI 동의 확인 시 캡션 분석만
가능하고, 이미지 편집은 AI 보조 이미지로 제한한다. student-private 및 학생/작품/수상작/
입시문서/로고 category는 서버에서 추가 차단한다. 자료 유형/동의 체크는 담당자 진술이며
이미지 의미나 법적 동의서를 자동 검증하는 기능이 아니다. AI 보조 prompt는 가짜 학생/
수업/성과, 로고/글자/말풍선 추가를 금지한다. 기존 선택 파일·비용·타임아웃 보호를 유지한다.

## API와 보안

- GET `/api/data-core/content/instagram-policy?campusId=...`
- GET `/api/data-core/content/instagram/:draftId/review?renderId=...`
- POST `/api/data-core/content/instagram/:draftId/render` (bounded PNG multipart)
- POST `/api/data-core/content/instagram/:draftId/approve`
- POST `/api/data-core/content/instagram/:draftId/export`

기존 writer/campus/owner/MASTER 및 same-origin 검사에 따른다. reserved record type
`instagram-reviewed-render`는 일반 record API로 승인 위조/수정 불가다. fingerprint는
초안 내용/제목/태그/전체 metadata/캠퍼스 정책을 포함한다. 캡션·문의·이미지·로고·캠퍼스
변경 후 이전 승인으로 export할 수 없고, 변환 후에도 재검사한다.
`instagram-layout` / `instagram-publish`는 원본의 derivative provenance와 권한을 상속한다.
작업 이미지의 authenticated 열람과 최종 승인 export는 구분한다. 기존 작업파일 다운로드를
승인된 게시로 간주하지 않으며 외부 Instagram 게시 API는 추가하지 않는다.

approve는 승인자/시각/버전/체크를 저장하며 render/approve/export 감사 이력을 남긴다.
provider 오류의 원문/출력 문구/임의 error.message 로그를 제거하고 알려진 오류 코드만 남긴다.

## 검증 경계와 제한

자동 검사: 캠퍼스 규칙, 로고 선택값, 권한/동의 진술, PNG 실제 형식/규격, 텍스트 줄 수,
일부 과장 문구, 버전 일치. 로고 픽셀 OCR, 인체/얼굴 오류, 원작 대조, 전화번호 진위,
이미지-캡션 날짜·숫자의 의미 비교는 자동 판정하지 않는다. 담당자 확인이 필수다.
전화번호 DB가 확인되지 않아 임의 번호를 생성하지 않으며 확인된 전화/DM 문구를 직접 입력한다.
신규 모자이크 편집기와 다장 carousel은 없다. 마스터 PNG는 기존 정책상 최대 8MB다.

`tests/instagram-brand-production.test.mjs`는 격리 D1/R2와 합성 자료만 사용한다.
`scripts/check-content-ai-browser.mjs`는 실제 UI/캔버스/API를 실행하되 OpenAI 응답만
합성 adapter로 대체한다. `--preview`는 배포 정적 자산 byte hash까지 비교하지만
인증 mutation은 로컬에만 실행한다. 이를 실제 OpenAI/운영 DB 검증이라고 부르지 않는다.
운영 key는 이름 존재만 확인했다. 실제 학생 사진 전송/실계정 게시/운영 원본 수정은 없다.
최종 검증 결과는 PR과 완료 보고에 별도 기록한다.
