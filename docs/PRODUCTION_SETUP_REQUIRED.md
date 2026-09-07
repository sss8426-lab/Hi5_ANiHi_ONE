# 운영환경 연결 상태와 남은 확인

기준일: 2026-09-07

## Issue #21에서 확인 완료

- Cloudflare CLI OAuth 로그인 확인: `sss8426@gmail.com`
- Cloudflare Account ID 확인: `44d44ea5985018a83d093a28f5fb7511`
- 기존 D1 확인: `site-creator-d1` / `7a25ebae-c784-40a3-bd71-496f3623bf29`
- 기존 R2 확인: `anihi-admissions-images`
- generated Wrangler config 확인: `DB`, `FILES`, `ASSETS`가 실제 D1/R2 리소스를 가리킨다.
- `wrangler deploy --dry-run` 성공
- `wrangler deploy` 성공
- 운영 URL: `https://hi5-anihi-one.sss8426.workers.dev`
- 운영 Worker version ID: `a44f59ef-4d60-487b-870f-ceba80ea0ec9`
- 운영 health API 확인: `/api/data-core/health`
- 운영 readiness 화면 확인: `/data-core/readiness`
- 운영 secret 확인: `DATA_CORE_SUPER_ADMIN_EMAILS`
- R2 쓰기/읽기/삭제 probe 확인
- D1 실제 테이블 확인: DATA CORE 기본 테이블이 운영 D1에 생성되어 있다.
- PR preview 계열 명령 확인: `wrangler versions upload --dry-run` 성공

## 남은 운영 확인

다음 항목은 코드와 CLI만으로 실제 사용 성공을 단정하지 않는다.

- Cloudflare Workers Git 연동의 Build command / Deploy command / Preview deploy command / Root directory 설정
- PR #22 Cloudflare Workers bot 댓글에 연결된 최신 Dashboard 상세 로그
- 실제 배포 URL에서 ChatGPT 로그인 헤더가 Worker에 전달되는지
- 로그인한 운영자 계정이 `SUPER_ADMIN`으로 인식되는지
- 실제 로그인 상태에서 운영 readiness diagnostics 전체 성공
- 운영 파일 업로드와 R2 원본 열기
- 운영 휴지통 복원
- 운영 백업 생성과 manifest 읽기
- 운영 admissions knowledge sync
- 운영 roadmap의 실제 대학/학과/전형 연결
- 입시컨설팅 신규 이미지 업로드가 `sourceApp=admissions`로 중앙 파일을 만드는지
- 운영 콘텐츠 허브에서 blog/instagram draft CRUD가 정상인지

## 운영자가 Dashboard에서 확인할 항목

1. Cloudflare Dashboard > Workers & Pages > `hi5-anihi-one` > Settings > Build에서 root directory가 repo root인지 확인한다.
2. Build command가 `npm run build`인지 확인한다.
3. Deploy command가 `npx wrangler deploy` 또는 프로젝트 정책에 맞는 Wrangler 배포 명령인지 확인한다.
4. Preview deploy command가 production과 충돌하지 않는지 확인한다.
5. PR #22의 Cloudflare Workers bot 로그에서 실제 실패 단계가 install/build/deploy 중 어디인지 확인한다.
6. 실제 배포 URL에서 마스터 이메일로 로그인한다.
7. `/data-core/readiness`에서 전체 진단을 실행한다.
8. `/data-core`에서 작은 테스트 파일을 업로드한다.
9. 파일 열기, 검색, 휴지통 이동, 복원을 확인한다.
10. `/data-core/operations`에서 백업을 생성하고 manifest를 확인한다.
11. 입시데이터 동기화를 실행하고 `/data-core/roadmap` 연결을 확인한다.
12. `/data-core/content`에서 블로그/인스타 초안을 각각 생성하고 같은 DATA CORE fileId를 연결해 본다.

## 주의

운영 DB에 잘못된 사용자 ID가 남을 수 있으므로 CLI에서 임의의 ChatGPT 인증 헤더를 만들어 readiness diagnostics를 실행하지 않았다. 실제 마스터 로그인 세션에서 최종 진단을 실행해야 한다.

로컬 CLI 기준으로는 production deploy와 preview upload dry-run이 모두 성공한다. PR #22 Cloudflare Workers bot 실패는 Dashboard Workers Builds 설정 또는 Dashboard에만 보이는 build log 확인이 필요한 외부 설정 차단으로 기록한다.
