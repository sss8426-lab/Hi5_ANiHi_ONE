# HI5·ANiHi Sync

버전 1.0.0. MASTER 원본 관리 PC에서 사용하는 Windows DATA CORE 동기화 프로그램이다.
일반 캠퍼스에는 설치하지 않는다. 캠퍼스는 기존 웹앱에서 공통 커리큘럼을 열람·인쇄한다.

## 설치와 실행

- 배포 폴더: `dist-sync/1.0.0/`.
- 설치 파일: `HI5-ANiHi-Sync-Setup-1.0.0.exe`.
- 설치 없이 실행: `win-unpacked/HI5-ANiHi-Sync.exe`. 이 경우 폴더 전체를 함께 보관한다.
- 일반 Windows 사용자 권한으로 실행한다. 관리자 권한, PowerShell bypass, 백그라운드 서비스가 필요하지 않다.
- 설치 시 바탕화면 바로가기를 만들 수 있다. 앱 설정에서도 `HI5·ANiHi Sync` 바로가기를 만들 수 있다.
- 현재 배포는 **코드서명 인증서가 없는 unsigned 개발 배포**다. 신뢰된 게시자로 표시하거나 자체 서명을 신뢰된 인증서로 가장하지 않는다.
- 자동 시작·자동 업로드·자동 업데이트·트레이 실행은 등록하지 않는다.

## 처음 사용할 때

바탕화면 아이콘을 열고 기본 폴더를 확인한다. 경로가 다르면 `폴더 변경`으로 해당 과정 폴더를 선택한다.

| 과정 | 기본 원본 폴더 | 중앙 범위 |
|---|---|---|
| 기초과정 | `D:\애니하이 스스로 학습\기초과정` | content/basic |
| 심화과정 | `D:\애니하이 스스로 학습\심화과정` | content/advanced |
| 입시과정 | `D:\애니하이 스스로 학습\입시과정` | content/admission |

경로 안에는 수업별 하위 폴더가 있어야 한다. 드라이브 전체, 앱·설정·캐시를 포함하는 경로, 다른 과정과 겹치는 경로는 선택하지 않는다.
빈 폴더나 지원 이미지가 없는 폴더는 중앙 반영을 차단한다. 원본 PDF/Office는 현재 변환기를 지원하지 않으므로 확인 필요로 표시한다.

중앙 인증이 없다면 `Cloudflare 로그인`을 누르고 열린 브라우저에서 관리자 Cloudflare OAuth 승인을 완료한다.
이 앱은 Cloudflare 비밀번호나 API token 입력창을 제공하지 않는다. 기존 Wrangler가 관리하는 OAuth 세션을 재사용한다.
다른 캠퍼스 직원에게 Cloudflare 관리자 권한을 제공하지 않는다.

## 매번 사용하는 순서

1. 원본 과정 폴더에 새 이미지나 새 수업 폴더를 추가한다.
2. `HI5·ANiHi Sync`를 연다. 변경 검사는 자동으로 시작하지만 중앙에는 쓰지 않는다.
3. 신규·수정·동일·삭제 확인·충돌·미지원 수를 확인한다. `상세 보기`에는 상대 경로로 표시한다.
4. 반영할 과정을 선택하고 `중앙서버에 동기화`를 누른다.
5. 확인 창의 새 폴더·새 파일·수정 파일·자동 삭제 0을 확인한 후 `동기화 시작`을 누른다.
6. 중앙 반영과 원본 검증이 모두 완료되면 `웹앱에서 확인`으로 확인한다.

과정 count는 매 실행 fresh scan 및 중앙 조회 결과다. 24/21/3 등의 과거 수를 하드코딩하지 않는다.
폴더 자동 감지를 켜면 새 변경이 생겼음을 표시하고 재검사를 요청한다. 감지만 자동이며 반영은 여전히 수동이다.

## 수정·삭제·재개

- 동일한 SHA256의 현재 자료는 다시 업로드하거나 파생 파일을 만들지 않는다.
- 같은 경로의 수정 파일은 `수정파일 반영`을 체크해야 진행된다. 새 immutable 버전으로 저장하며 구버전 원본을 보존한다.
- 로컬에서 사라진 자료는 `삭제 확인`으로 표시한다. 중앙의 기존 자료는 계속 열람 가능하며 R2 삭제는 없다.
- 폴더 이름 변경을 추측해 병합하지 않는다. 새 폴더와 기존 경로 누락으로 확인한다.
- `작업 중지`는 안전한 파일 경계에서 멈춘다. 진행 중인 한 업로드/페이지 공개가 마무리될 수 있다. 이미 반영된 자료를 억지 삭제하거나 되돌리지 않는다.
- 통신 실패, 앱 종료, 재부팅 후에는 새 변경 검사를 실행한다. 중앙 fingerprint를 비교해 이미 완료된 자료를 건너뛴다.
- 검증 실패를 동기화 성공으로 표시하지 않는다. 다시 검사한 뒤 오류를 확인한다.
- 확인 후 로컬 또는 중앙 자료가 바뀌면 첫 반영 전 중단하고 재검사를 요구한다. 선택한 모든 과정의 상태를 먼저 확인한다.

## 진행 표시와 기록

검사 파일 수, 파생 준비 완료 수, 반영 페이지 수, 처리 bytes/실제 업로드 bytes, 원본 검증 수를 실제 이벤트로 표시한다.
전체 파일 수가 아직 정해지지 않은 검사 중에는 완료 퍼센트를 추측하지 않는다.
각 과정의 마지막 성공 시간과 최근 20회 결과는 이 PC의 편의용 기록이며 서버 전체 이력으로 표현하지 않는다.
중앙 `curriculum.import` audit는 기존 importer 경로로 남으며 GUI operator는 `hi5-anihi-sync`다.

- 설정/최근 결과: `%APPDATA%\HI5-ANiHi-Sync\config.json`.
- 파생 캐시: `%LOCALAPPDATA%\HI5-ANiHi-Sync\cache`.
- 진단 로그: `%LOCALAPPDATA%\HI5-ANiHi-Sync\logs`, 최근 10개 제한.
- 설정에는 원본 경로, 웹 주소, 변경 감지, 마지막 성공 시간과 count만 저장한다.
- token, 비밀번호, session, raw SQL/응답, R2 key는 설정·UI·로그에 남기지 않는다. 로그는 시각과 고정된 작업 결과 코드만 저장한다.
- OAuth credential은 Wrangler의 기존 보안 저장 정책으로만 관리한다. 이 앱은 별도 credential 파일을 만들지 않고 subprocess 응답을 메모리에서만 사용한다.

## 웹 주소와 제거

기본 웹 주소는 `https://hi5-anihi-one.sss8426.workers.dev`다. 정식 도메인이 생기면 설정에서 HTTPS origin 한 곳만 바꾼다.
파일과 curriculum 목록은 기존 인증된 Worker API로 열람한다. R2 public URL은 사용하지 않는다.
웹앱은 관리자 PC의 D:를 읽지 않는다. 새 자료가 중앙에 반영되면 웹앱 재배포 없이 다음 조회에 나타난다.

Windows 앱 제거는 프로그램만 제거한다. D:와 중앙 D1/R2는 제거하지 않는다. 로컬 설정·기록은 기본 보존한다.
설치하지 않은 portable 폴더를 지워도 D:와 중앙 자료는 그대로다.

## 개발·보안 구조

- `tools/hi5-anihi-sync/`: 별도 npm package. 웹 root lockfile/배포 의존성과 분리한다.
- `scripts/curriculum-sync-core.mjs`: GUI 상태/설정/확인 토큰, 기존 inventory/plan/diff/apply/verify 조합. 두 번째 업로드 알고리즘은 없다.
- `scripts/import-curriculum-tree.mjs`: 기존 CLI 유지. apply 진행/취소 옵션 및 공유 verify 함수를 추가했다.
- `scripts/curriculum-tree.mjs`: 기존 SHA256/자연정렬/immutable ID, 선택적 진행·취소 이벤트. source mtime도 전후 확인한다.
- `scripts/curriculum-cloudflare.mjs`: 기존 bounded retry와 OAuth 401 시 1회 갱신 재사용. packaged Wrangler 실행 경로를 주입할 수 있다.
- `app/wrangler-node.cjs`: Electron의 Node subprocess에서만 Wrangler CLI 인자 해석을 보정한다. 기존 OAuth 저장·갱신 정책은 바꾸지 않는다.
- 앱 창은 local allowlist protocol, CSP, sandbox, context isolation, Node integration OFF. IPC는 main frame/sender와 고정된 명령을 검사한다.
- 원본 처리와 Cloudflare credential은 renderer가 아닌 별도 Node subprocess에 격리한다. subprocess 콘솔은 UI나 로그에 전달하지 않는다.
- Desktop runtime은 patched Sharp 0.35.4/Wrangler 4.131.1을 사용한다. root web/CLI 의존성은 변경하지 않는다. 동일 원본 skip은 유지하며 파생 생성 결과가 달라질 수 있는 불완전 구버전 import는 기존 identity 충돌 안전장치로 중단한다.
- 신규 bucket/DB/binding/migration 없음. Cloudflare 설정 패키징 시 기존 DB/FILES의 공개 식별자만 복사하며 vars/secret는 포함하지 않는다.
- 자동 startup/tray/auto-update/다른 자료 종류 동기화는 이번 범위에 없다.

개발 명령:

```text
npm ci
npm run build
npm ci --prefix tools/hi5-anihi-sync
npm run build --prefix tools/hi5-anihi-sync
npm test --prefix tools/hi5-anihi-sync
npm run package --prefix tools/hi5-anihi-sync
```

`test/gui-check.mjs`는 별도 임시 source/합성 D1/R2로 실제 Electron 창을 확인한다. 개발용 fixture 연결은 packaged 앱에서 차단하고 fixture 코드를 배포하지 않는다.
`test/read-only-smoke.mjs`는 실제 세 source를 두 번 읽어 SHA/mtime과 중앙 row digest 보존을 확인한다. 쓰기 transport를 제공하지 않는다.

## 검증 범위

실행 결과와 CI/Preview/production 버전은 PR 최종 evidence로 구분한다. 로컬 합성 성공을 운영 write 성공으로 표현하지 않는다.
2026-09-12 실제 read-only 검사: 기초 24/360, 심화 21/465, 입시 3/101, 신규·변경·누락·미지원 0. D: hash/mtime 및 중앙 레코드 무변경.
Windows 배포용 실행 파일에서도 기존 OAuth로 세 과정의 동일 count를 확인하고 바탕화면 바로가기를 생성했다. 운영 apply는 실행하지 않았다.
합성 Electron GUI 검증은 1920/1440/1280/1024와 100/125/150% 배율 12개 조합을 확인했다. Electron 배율 및 브라우저 viewport 테스트이며 실제 Windows 디스플레이 설정을 변경하지 않았다.
NSIS 설치 파일 생성과 unsigned 상태는 확인했다. 설치/제거 마법사 전체 실행은 미확인이고 portable 배포용 실행 파일의 직접 실행을 검증했다.
이 작업에서 실제 자료 재apply, 학생/대학/계정/FAMILY 데이터 수정은 하지 않는다.
기존 입시 고3 첫 장이 원본 자체 백지인 사항은 Sync 오류가 아니며 임의 교체하지 않는다.
