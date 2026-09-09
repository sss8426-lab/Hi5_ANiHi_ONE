# 도메인 연결 준비

## 현재 상태와 범위

- 기존 운영 사이트: https://hi5-anihi-one.sss8426.workers.dev/data-core/
- 앱을 새로 만들거나 다른 저장소로 이전하지 않는다. 기존 Worker에 맞춤 주소를 연결한다.
- 도메인 구매, DNS/네임서버 변경, 인증서 발급, 실제 데이터 이전은 이번 준비 작업에 포함하지 않는다.
- Cloudflare 도메인 화면 확인 시점에 등록 영역과 Worker 맞춤 도메인이 없었다.
- PR171/172 및 기존 부모 Issue의 완료된 실제 운영 acceptance는 반복하지 않는다.

## 주소 추천

1. `hi5anihi.com`: 우선 추천. 짧고 하이픈 없이 두 브랜드를 함께 표현한다.
2. `hi5-anihi.com`: 브랜드 구분은 명확하지만 구두 전달 시 하이픈 설명이 필요하다.
3. `hi5anihi.net`: 첫 번째 주소를 구매할 수 없을 때의 대안.

2026-09-10 KST Verisign 공개 RDAP 조회에서 세 주소 모두 404(등록정보 없음)를
반환했다. 예약·구매한 상태가 아니며, 등록 가능성과 가격은 구매 직전에 확인해야 한다.
이름 선택, 소유자 정보 및 결제는 사용자 결정이다. 결제·자동갱신 동의를 대신하지 않는다.

## 구매 전 준비

- [x] 기존 standalone 로그인 사용: 새 마스터 생성/비밀번호 초기화 불필요.
- [x] 로그인 쿠키는 host-only Secure/HttpOnly/SameSite=Lax이며 특정 기존 도메인을 지정하지 않는다.
- [x] 서버 요청 출처 비교는 현재 request URL origin을 기준으로 한다. 새 도메인을 이유로 CORS/권한을 완화하지 않는다.
- [x] PWA start_url/scope/icon은 `/family/` 상대 경로를 사용한다.
- [x] 상대 API/fileId 경로와 기존 FILES/FAMILY_FILES 바인딩을 유지한다.
- [x] 읽기 전용 도메인 사전점검 도구 및 합성 테스트 추가.
- [x] 구매/연결/검증/복구 순서와 보류 사항 문서화.
- [ ] 이 변경의 CI/Preview/병합 결과: PR에 실제 결과를 기록한다.
- [ ] 기존 의존성 보안 경고 상세 검토: npm ci에서 23건(낮음 1, 중간 6, 높음 16)이 보고됐다. 상세 npm audit는 의존성 정보 외부 전송에 대한 자동 보호 규칙으로 차단되어 사용자 승인을 요청했다. 미검토 경고를 해결됐다고 표시하거나 무조건적인 출시 준비 완료로 간주하지 않는다.

## 연결 순서: 도메인 확정 후 실행

1. 구매 화면에서 등록 가능 여부, 최초 비용과 갱신 비용, 자동갱신 조건을 사용자에게 확인받는다.
2. 기존 Cloudflare 계정에 활성 zone이 있는지 확인한다. 다른 등록기관에서 구매했다면 기존 DNS 전체를 보존한 상태에서 필요한 네임서버 전환을 계획한다.
3. 충돌하는 A/AAAA/CNAME, 기존 웹사이트 및 이메일 MX/TXT가 있는지 먼저 확인한다. 기존 레코드를 임의 삭제하거나 덮어쓰지 않는다.
4. 전환 직전 기존 운영 백업 기능으로 새 백업을 만들고 manifest/완료 상태를 확인한다. 개인정보 payload는 출력/다운로드/커밋하지 않는다. 메타데이터 백업과 파일 원본 백업의 범위 차이를 명시한다.
5. 현재 main/Worker version/기존 도메인 설정을 기록한다. workers.dev 운영 주소는 복구 경로로 유지한다.
6. 같은 `hi5-anihi-one` Worker에 확정된 호스트만 Custom Domain으로 추가한다. 새 DB/R2/Worker나 Sites 배포를 만들지 않는다.
7. 재배포 시 설정이 유실되지 않도록 기존 Vite/Cloudflare 설정 경로에 실제 확정 호스트를 반영하고 dry-run에서 기존 바인딩·도메인이 보존되는지 확인한다. 가짜 도메인을 미리 넣지 않는다.
8. DNS와 HTTPS 인증서 활성화를 확인한다. apex와 www는 서로 다른 호스트이므로 대표 주소 결정 후 필요한 쪽만 추가하고 리디렉션한다.
9. 읽기 전용 preflight를 새 도메인에 실행하고 링크·새로고침·로그인 이동을 확인한다. 기존 `/` 입시컨설팅 경로는 임의 변경하지 않는다. 통합 시작 화면은 `/data-core/`다.
10. 사용자가 새 주소에서 기존 계정으로 로그인한다. 기존 주소의 쿠키를 복사하거나 출력하지 않는다. 로그인/권한/로그아웃 결과만 기록한다.
11. 실제 사용할 보호자 기기에서 새 주소의 PWA 설치와 알림 허용을 확인한다. 기존 origin의 설치·구독이 새 주소로 자동 이전된다고 가정하지 않는다. 실 보호자 일괄 재발송 금지.
12. 모든 결과를 확인한 뒤 새 주소를 안내한다. 기존 DB/FILES/FAMILY_DB/FAMILY_FILES 및 입시 데이터는 그대로 사용한다.

## 읽기 전용 점검

```powershell
node --use-system-ca scripts/domain-preflight.mjs --origin=https://hi5-anihi-one.sss8426.workers.dev
```

연결 후 `--origin`에 실제 주소를 넣는다. 도구는 GET만 사용하고 인증 정보 없이
페이지/이미지/PWA/보호 API의 상태를 확인한다. 리디렉션을 자동 추적하지 않으며
private 응답 본문은 읽거나 출력하지 않는다. DNS 소유권, 새 인증서 활성화,
새 도메인 로그인과 기기 알림까지 자동 통과했다고 보고하지 않는다.

## 복구와 금지

- 새 주소 문제면 먼저 기존 workers.dev 주소로 안내하고 같은 Worker의 이전 정상 버전 복구 여부를 판단한다.
- DNS 변경을 되돌릴 때는 이번에 추가한 정확한 호스트/레코드만 대상으로 한다. 이메일과 다른 사이트 설정은 유지한다.
- 도메인 문제를 해결하기 위해 DB 복원·초기화·학생 migration 재실행·secret rotation을 하지 않는다.
- 현재 준비 단계에서는 신규 운영 백업/복원, 실 파일 CRUD, 실제 사용자 계정·구독 작업을 실행하지 않는다.
- 실제 기기 알림 배너 확인과 새 도메인 로그인은 연결 이후 확인할 항목이며 아직 완료로 표시하지 않는다.

## 공식 근거

- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://www.cloudflare.com/application-services/products/registrar/buy-com-domains/
- https://developers.cloudflare.com/registrar/faq/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
