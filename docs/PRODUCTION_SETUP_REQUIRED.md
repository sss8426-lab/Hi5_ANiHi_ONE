# 운영환경 확인 필요 항목

기준일: 2026-09-07

## 코드 문제

- 현재 코드에는 `/data-core/content` 콘텐츠 허브와 `/api/data-core/content` 초안 API가 추가되어 있다.
- 로컬 코드 검증과 GitHub Actions CI는 통과했지만, 실제 Cloudflare 운영 배포 성공과는 별개다.
- PR #19의 Cloudflare Workers bot 댓글 기준 production deployment는 `e00aa470` 커밋에서 실패했다.
- 로컬 `wrangler deploy --dry-run`은 generated config인 `dist/server/wrangler.json`을 사용했고, `DB`, `FILES`, `ASSETS` 바인딩을 읽는 단계까지 성공했다.

## 계정/환경 문제

다음 항목은 GitHub 코드만으로 확인할 수 없다.

- Cloudflare Dashboard build log의 실제 실패 원인
- Cloudflare Workers Git 연동의 Build command / Deploy command / Preview deploy command / Root directory 설정
- 실제 배포 URL에서 ChatGPT 로그인 헤더가 Worker에 전달되는지
- `DATA_CORE_SUPER_ADMIN_EMAILS`가 운영환경에 설정되어 있는지
- 로그인한 운영자 계정이 `SUPER_ADMIN`으로 인식되는지
- Cloudflare D1 `DB` 바인딩이 실제 운영 DB에 연결되어 있는지
- Cloudflare R2 `FILES` 바인딩이 실제 운영 파일 저장소에 연결되어 있는지

## 운영자가 해야 할 최소 수동 설정

1. 배포환경 변수에 `DATA_CORE_SUPER_ADMIN_EMAILS`를 설정한다.
2. Cloudflare Dashboard > Workers & Pages > `hi5-anihi-one` > Settings > Build에서 root directory가 repo root인지 확인한다.
3. Build command가 `npm run build`인지 확인한다.
4. Deploy command가 `npx wrangler deploy` 또는 프로젝트 정책에 맞는 Wrangler 배포 명령인지 확인한다.
5. Preview deploy command가 production과 충돌하지 않는지 확인한다.
6. 실패한 build log에서 `npm ci`, `npm run build`, `wrangler deploy` 중 어느 단계에서 멈췄는지 확인한다.
7. 운영 배포 URL에서 마스터 이메일로 로그인한다.
8. `/data-core/readiness`에서 전체 진단을 실행한다.
9. D1/R2 진단이 모두 성공하는지 확인한다.
10. `/data-core`에서 작은 테스트 파일을 업로드한다.
11. 파일 열기, 검색, 휴지통 이동, 복원을 확인한다.
12. `/data-core/operations`에서 백업을 생성하고 manifest를 확인한다.
13. 입시데이터 동기화를 실행하고 `/data-core/roadmap` 연결을 확인한다.
14. `/data-core/content`에서 블로그/인스타 초안을 각각 생성하고 같은 DATA CORE fileId를 연결해 본다.

## 아직 실제 검증이 안 된 항목

- Cloudflare production deployment 성공
- Cloudflare Dashboard build log의 정확한 실패 원인
- 운영 readiness diagnostics 전체 성공
- 운영 파일 업로드와 R2 원본 열기
- 운영 휴지통 복원
- 운영 백업 생성과 manifest 읽기
- 운영 admissions knowledge sync
- 운영 roadmap의 실제 대학/학과/전형 연결
- 입시컨설팅 신규 이미지 업로드가 `sourceApp=admissions`로 중앙 파일을 만드는지
- 운영 콘텐츠 허브에서 blog/instagram draft CRUD가 정상인지
