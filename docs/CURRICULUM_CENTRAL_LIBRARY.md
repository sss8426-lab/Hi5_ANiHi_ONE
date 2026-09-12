# 중앙 커리큘럼 수업자료

기준: 2026-09-12, 작업 시작 main `1ddf3cdd858035e7541f973ff375615787999632`.
배포 및 운영 import 증거는 PR 최종 코멘트로 구분한다. 아래 inventory는 실제 D:를 읽은 결과이며 운영 업로드 완료를 뜻하지 않는다.

## 범위와 저장 구조

- `content/basic`, `content/advanced`만 변경한다. content/admission, design 전 과정은 유지한다.
- 기존 D1 `data_records`: `curriculum-folder`, `curriculum-page`, `source_app=curriculum`, organization visibility, campus NULL.
- 폴더 metadata: family/stage/order/relativePath/parentFolderId/representativeFileId/active.
- 페이지 metadata: 원본 파일명/상대경로/SHA256/크기/순서/폴더, original/preview/thumbnail/print file IDs 및 파생물 SHA256.
- 기존 `file_objects`와 `FILES`의 documents-private 영역을 사용한다. 새 DB, bucket, binding, migration 없음.
- 원본 byte는 그대로 저장한다. preview 최대 2200px WebP quality 88, 대표 thumbnail 최대 640px WebP quality 82, print 최대 3200px JPEG quality 93. 확대는 원본이다. 파생물은 EXIF 방향을 반영하며 원본은 변경하지 않는다.
- 운영 브라우저는 D:를 읽지 않는다. 모든 자료는 인증된 `/api/data-core/files/:id`에서 제공한다.

## API와 권한

`GET /api/data-core/curriculum?family=content&stage=basic|advanced`

`GET /api/data-core/curriculum/folders/:id`

`GET /api/data-core/curriculum/print?family=content&stage=basic|advanced&lesson=<optional>`

조직에 속한 로그인 사용자는 공통 교재를 열람/인쇄한다. MASTER/SUPER_ADMIN만 기존 records/files mutation을 수행할 수 있다. campus/owner 클라이언트 값을 권한 근거로 사용하지 않는다. 삭제/숨김된 상위 폴더 또는 원본은 파생 파일에서도 접근을 차단한다. private conditional cache는 인증 및 관계 검사 후 304를 반환한다. R2 공개 URL은 제공하지 않는다.

## 읽기 전용 원본 inventory

두 source 모두 접근/전체 JPEG decode 성공. 기초 24폴더/360장/972,374,873 bytes, 심화 21폴더/465장/1,973,019,775 bytes. 총 825 JPG. 손상/미지원/루트 파일/중첩 폴더/대표 이미지 없는 폴더는 모두 0. 아래 실제 이름의 띄어쓰기 및 오타를 수정하지 않았다.

### 기초과정

Source: `D:\애니하이 스스로 학습\기초과정`

| 실제 폴더명 (natural order) | 이미지 |
|---|---:|
| 1-1얼굴기초-눈의구조 | 8 |
| 1-2얼굴기초-코의구조 | 12 |
| 1-3얼굴기초-입의구조 | 14 |
| 1-4얼굴기초-귀의구조 | 6 |
| 1-5얼굴기초 | 14 |
| 1-6 얼굴,헤어 | 23 |
| 2-1인체기초8등신 | 14 |
| 2-2등신비율.및 데포르메 | 16 |
| 2-3상체근육의 구조와 형태 | 14 |
| 2-4하체근육의 구조와형태 | 10 |
| 2-5근육의 흐림과 움직임 | 20 |
| 3-1동세와 흐름 전신스탠딩 | 11 |
| 3-2동세와 흐름포즈와 균형 | 11 |
| 3-3동세와 흐름 크로키 | 23 |
| 4-1손발 기초 손의 구조와 형태 | 19 |
| 4-2손발 기초 발의 구조와 형태 | 16 |
| 5-1옷주름의 발생원리와 표현 | 24 |
| 5-2 계절별 직군별 차이 | 21 |
| 5-3 캐릭터별 차이 | 12 |
| 5-4 전통복식 | 18 |
| 5-5모자의 종류와표현 | 8 |
| 5-6 캐릭터 포즈및 턴어라운드 | 12 |
| 5-7캐릭터 포스터 | 13 |
| 6.수채화 기초 | 21 |

### 심화과정

Source: `D:\애니하이 스스로 학습\심화과정`

| 실제 폴더명 (natural order) | 이미지 |
|---|---:|
| 7-1.투시의 이해 - 빛과 그림자의 이해 | 10 |
| 7-2.투시의 이해 - 1점투시의 특징 | 24 |
| 7-3.투시의 이해 -2점 투시의 특징 | 9 |
| 7-4.투시의 이해 - 3점투시의 특징 | 16 |
| 8-1펜터치연구 | 20 |
| 8-2 펜터치 연구 실습 | 14 |
| 8-3배경개체묘사도시.시골 | 22 |
| 8-4배경개체묘사 산.바다 | 23 |
| 8-5배경개체묘사 정글.서부극.판타지 | 33 |
| 8-5배경개체묘사 학교 | 15 |
| 8-6배경개체묘사 SF.아포칼립스 | 28 |
| 9-1동물의 구분.개그리기 | 16 |
| 9-2 고양이 그리기 | 11 |
| 9-3 말 그리기 | 11 |
| 9-4 조류 그리기 | 15 |
| 9-5 동물의 외피 | 7 |
| 9-6 합성과 활용 | 14 |
| 10-1.만화전공 | 36 |
| 10-2.애니전공 | 60 |
| 10-3.게임전공 | 38 |
| 10-3.게임전공2 | 43 |

같은 숫자 접두사가 있는 심화 폴더도 전체 경로가 다르므로 별도 수업으로 유지한다. importer가 부여하는 정렬 순서는 중복되지 않는다.

## 안전한 import

OAuth credential은 Wrangler subprocess stdout에서 메모리로만 받아 Cloudflare API에 사용한다. 파일/argv/로그/문서에 기록하지 않는다. CLI는 Cloudflare 운영 권한을 필요로 하며 웹 클라이언트용 인증 우회 경로가 아니다.

긴 import 중 OAuth가 만료되어 401이 반환되면 Wrangler로 한 번 갱신해 같은 요청을 재시도한다. 지속적인 401, 403 또는 API token 오류는 권한을 우회하지 않고 중단한다. 중단 후에는 새 remote preview로 이미 등록된 페이지를 확인하고 이어간다.

```powershell
node scripts/import-curriculum-tree.mjs --family content --stage basic --source "D:\애니하이 스스로 학습\기초과정" --preview --remote
node scripts/import-curriculum-tree.mjs --family content --stage basic --source "D:\애니하이 스스로 학습\기초과정" --apply --remote
node scripts/import-curriculum-tree.mjs --family content --stage basic --source "D:\애니하이 스스로 학습\기초과정" --verify --remote
```

기초 verify 후에만 stage/source를 advanced/심화과정으로 바꿔 동일 순서로 실행한다. Preview report와 파생 파일은 gitignore 대상 `outputs/curriculum-import/<stage>`에만 쓴다. D: source 안으로 출력하는 경로와 symlink는 차단한다.

빈 source, 원본 변경, 기존 identity/순서 충돌, 삭제된 중앙 자료, 지원 불가 형식, source 누락은 apply를 차단한다. 중앙 자료를 삭제하거나 덮어쓰지 않는다. 중단된 draft는 새 preview 후 재개하며 모든 파일 등록 전에는 노출하지 않는다. 동일 원본/폴더 경로는 deterministic ID로 중복 생성을 막는다. 원본 변경은 새 자동 버전을 만들지 않고 검토 대상으로 남긴다.

원본 R2 객체는 SHA256 content-addressed key이며 기존 key의 내용이 다르면 중단한다. import 후 D: 원본 재해시, 중앙 count, 별도 verify로 R2 원본 전수 SHA256을 검증한다. 기존 비커리큘럼 자료와 FAMILY에는 쓰지 않는다.

## UI / 검증

폴더 표지+이름 카드, 단계별 breadcrumb, 슬라이드/키보드/Home/End/swipe/URL slide 유지, 원본 확대를 제공한다. 카드에서는 thumbnail만, 뷰어는 현재/이전/다음 preview만, 고해상도 print 파일은 인쇄 요청 때만 읽는다.

수업 및 과정 인쇄는 4개 이하 동시 decode로 전체 준비 후 브라우저 인쇄를 호출한다. 실패가 있으면 누락 인쇄를 차단하고 재시도한다. A4 세로 8mm margin, contain, UI 숨김. 실제 프린터를 자동으로 선택하거나 출력하지 않는다.

- 합성 unit: 자연 정렬/중첩/표지 우선/원본 SHA/중단 재개/중복 방지/권한/숨김 상위폴더/원본 삭제 후 derivative 차단.
- 합성 browser: 1920/1440/1024/820/390/320, 두 과정, 확대/스와이프/back/reload, 인쇄 실패 차단, API mutation 외부전송 0.
- 실제 운영 import 및 browser 확인 결과는 실행 후 PR evidence에 추가한다. 합성 결과를 실제 운영 검증으로 간주하지 않는다.
- Windows 병렬 Miniflare 테스트에서 기존 roadmap D1 검증의 EADDRINUSE가 재현되어 전체 테스트 실행 동시성을 1로 통일했다. 테스트를 생략하거나 assertion을 완화하지 않았으며 334개 전체가 단일 실행에서 통과했다.

## 제한

현재 source에는 PDF/Office가 없다. JPEG/PNG/WebP/GIF를 처리하며, PDF/Office 발견 시 변환 필요 blocker로 보고하고 import를 중단한다. multi-page PDF/Office를 이미 지원한다고 간주하지 않는다. 다른 물리 PC/실제 프린터 검증은 별도이며, 웹 런타임에 D: 의존성이 없다는 것과 구분한다.
