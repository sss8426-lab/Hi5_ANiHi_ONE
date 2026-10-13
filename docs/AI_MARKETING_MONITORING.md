# AI 마케팅 모니터링 API

## 저장 및 권한

기존 DB(D1) `data_records`, FILES(R2), `file_objects`만 사용합니다. 신규 DB, bucket, migration은 없습니다. `marketing-report`, `marketing-channel-profile` 및 향후 `marketing-internal-config`는 범용 레코드 API 읽기/변경 대상이 아닙니다. 보고서는 immutable입니다. 원본 PNG는 `documents-private` / `marketing-report` / `marketing-monitoring` / `campus`로 등록하며 소유자는 서버가 찾은 실제 활성 조직 MASTER 내부 ID입니다.

웹 조회는 기존 `resolveDataCoreAccess` + `requireAuthenticatedAccess` 세션 인증을 사용합니다. MASTER/SUPER_ADMIN은 실제 활성 정규 10개 캠퍼스를 조회합니다. 캠퍼스 관리자·원장·선생님·직원 등 캠퍼스 소속 계정은 자기 캠퍼스 보고서와 PNG만 조회합니다(2026-10-13 사용자 요청). 채널 주소 변경(PUT /channels)은 MASTER와 자기 캠퍼스 CAMPUS_ADMIN만, 수동 수집은 MASTER만 가능합니다. 소속 캠퍼스가 없는 계정/공개 접근은 거부합니다. 토큰은 읽기 API의 인증이 되지 않습니다. 파일도 기존 인증 다운로드 경로에서 동일 관리자/캠퍼스 및 live report 링크를 검증합니다.

## 계약

- `GET /api/data-core/marketing/config`: `{campuses:[{id,code,name,status,displayOrder}],keywords:[13개],schedule:{days:['월','수','금'],time:'15:00',timezone:'Asia/Seoul'},capabilities:{ingestConfigured:boolean},channelProfiles:[]}`. 실제 DB 활성 캠퍼스만 반환. 검증된 계정이 없는 캠퍼스의 URL을 만들지 않습니다.
- `GET /api/data-core/marketing/reports?campusId=&date=&limit=30`: `{reports,coverage:{campuses,latestDaily:[{campus_id,kind,capturedAt}],latestSample:[...]}}`. campus/date SQL 필터가 LIMIT보다 먼저 적용됩니다. limit 1~100. coverage는 전체 접근 범위 최신 daily/sample를 각각 보존하며 선택 date 필터와 무관한 최종 수집 시각입니다.
- `GET /api/data-core/marketing/reports/{encodeURIComponent(id)}`: `{report}`.
- report: `{id,campusId,campusName,reportDate,capturedAt,runId,runKind,status,environment,platforms,channels,improvements,limitations,imageFiles:[{id,name,url}],createdAt,updatedAt}`. status `partial|complete`. 원본 PNG URL은 `/api/data-core/files/{id}`이며 R2 키/공개 URL은 응답하지 않습니다.
- `GET /api/data-core/marketing/channels?campusId=`: `{channelProfiles:[{id,campusId,channels,updatedAt}]}`.
- `PUT /api/data-core/marketing/channels`: 같은 출처 인증 요청, body `{campusId,channels:{blog:null|'https://...',instagram:null|'https://...',website:null|'https://...'}}`. MASTER/자기 캠퍼스 CAMPUS_ADMIN만 허용합니다. 저장되지 않은 채널은 비어 있습니다. 자격증명 및 내부 주소는 거부합니다. PUT은 채널 매핑을 교체합니다.
- `POST /api/data-core/marketing/ingest`: multipart `payload` JSON 문자열 정확히 하나, 반복 `images` PNG 0~4개. 최초 201 `{ok:true,existing:false,report}`. 같은 run/campus, 같은 정규화 payload/이미지 checksum 재시도 200 `{ok:true,existing:true,report}`. 다른 checksum 409. 이미지 이름/순서/바이트도 checksum에 포함됩니다. 누락 PNG나 플랫폼/채널은 partial이고 실제 표본은 sample로 저장합니다.

## payload v1

`{version:1,runId,runKind:'sample'|'daily',campusId,reportDate:'YYYY-MM-DD',capturedAt:ISO,environment:{device:'desktop',...},platforms:{naver:{status,keywords:[{keyword,adRank,adCount,adStatus,organicRank,officialDocuments,inspectedResults,sourceUrls,...}]},google?:동일},channels?:{blog,instagram,website},improvements?:[{priority,title,action,evidence}],limitations?:[]}`.

13개 키워드: 부천웹툰학원, 부천만화학원, 부천애니학원, 부평웹툰학원, 부평만화학원, 부평애니학원, 부천미술학원, 부천입시미술학원, 부천디자인학원, 부평미술학원, 부평입시미술학원, 부천예고입시, 부평예고입시.

runId는 1~160자의 영숫자 및 `._:-`. campusId는 CAMPUS_DIRECTORY 정규 내부 ID. 2020년 이후 실제 캡처 시각, 현재보다 최대 10분 미래 허용, reportDate는 캡처 KST 날짜와 일치해야 합니다. unknown metric은 null이며 결측은 null로 보존합니다. 숫자 0~10억 유한값, 알려진 계수/순위는 정수이며 순위는 1 이상입니다. rank는 관측된 광고에만 허용하고 adCount를 초과하지 못합니다. `adStatus=observed|not_exposed|not_observed|unavailable`. platform/channel status는 설명 문자열을 보존합니다. 중복/비허용 키워드는 거부합니다. 원 payload 및 저장 metadata 최대 200KB.

PNG는 MIME/확장자/8-byte signature/IHDR/IDAT/IEND/모든 chunk CRC 및 fast-png 실제 픽셀 디코딩/해상도 검증, 파일당 최대 10MB, 최대 4개, Worker 메모리 안전을 위해 최대 8백만 픽셀. 원본 바이트를 변환하지 않습니다. 모든 원본 R2 put 후 보고서+파일 metadata+감사로그를 D1 atomic batch에 기록합니다. 실패하면 DB를 다시 조회해 파일 row에 연결되지 않은 이 요청의 임의 UUID R2 키만 삭제하며 기존 재시도 원본 및 이미 커밋된 원본은 지우지 않습니다. DB 재조회 자체가 실패하면 원본을 보존하고 500 commit_state_unknown을 반환합니다. cleanup 실패는 500 `cleanup_failed`로 표시합니다. 다운로드 권한은 공통 파일 API에서 검증합니다.

## 수집 인증

선택 secret `MARKETING_INGEST_TOKEN`은 `/marketing/ingest` POST에서만 `Authorization: Bearer ...`를 받습니다. SHA-256 후 동일 길이 전체 비교. 미설정 503, 잘못된 값 401. 기존 조직의 활성 NULL-campus MASTER/SUPER_ADMIN 사용자를 서버에서 조회해 owner로 사용합니다. 토큰/헤더/payload owner를 DB/로그/오류에 저장하지 않습니다. 사용자 visitor/session headers는 머신 인증이 아닙니다.

Authorization 없이 수동 수집은 인증 MASTER만 가능하며 동일 Origin 또는 동일 Referer를 요구합니다. 일반 CAMPUS_ADMIN은 수집할 수 없습니다. 외부 라우터는 API 진입 전 generic 인증 미들웨어로 머신 요청을 차단하지 않도록 본 handler를 먼저 호출해야 합니다.

## 검증 및 운영 범위

`node --test tests/marketing-monitoring.test.mjs`는 esbuild 직접 모듈 번들 + Miniflare 일회성 D1/R2로 검증하며 운영 DB에 쓰지 않습니다. parent가 outer router/Env, CI, uploader, secret, 일정, 배포를 담당합니다. 보고서 모듈 자체는 일정을 실행하거나 외부 데이터를 수집하지 않습니다. 공개 페이지나 token 발급 UI는 없습니다.

## 화면 및 수집 클라이언트

업무용 `인스타 자동화` 바로 아래에 `AI 마케팅 모니터링`이 있으며 주소는 `/data-core/work/marketing`입니다. 메뉴·독립 페이지·업무홈 카드·모바일 메뉴를 연결합니다. config/reports/detail을 읽고 화면이 보일 때 60초마다 저장된 결과를 다시 조회합니다. 캠퍼스·KST 날짜·daily/sample 필터, 최근 30건, 출처 링크, SNS·개선사항·한계, 인증된 원본 PNG 미리보기/다운로드를 제공합니다. `observed`를 관찰 완료로 표시하며 날짜만 확인한 발행일에 임의 00:00 시각을 붙이지 않습니다. Instagram 일평균 프로필 방문은 UV 방문자와 구분합니다. 채널 편집/수동 수집 UI는 없습니다.

`node scripts/marketing-collector.mjs configure --token-file <보안파일> --config dist/server/wrangler.json`은 Windows CurrentUser DPAPI로 난수 자격증명을 먼저 암호화 저장하고 Cloudflare secret `MARKETING_INGEST_TOKEN`으로 등록합니다. 재시도는 기존 보안파일을 복호화해 동일 자격증명을 재사용하며 임의로 교체하지 않습니다. 비밀정보는 argv·Git·로그·브라우저 저장소·JSON 보고서에 저장/출력하지 않습니다. 암호화 파일은 같은 Windows 사용자/장치에서만 사용할 수 있으므로 장치 이전 시 별도 재구성이 필요합니다. 클라이언트는 환경변수 `MARKETING_INGEST_TOKEN`도 지원하나 운영 예약은 DPAPI 파일을 사용합니다.

```powershell
# 프로젝트 core 폴더에서 실행, 입력 JSON과 PNG는 동일 runId의 원본을 보존
node scripts/marketing-collector.mjs ingest --payload "report.json" --image "report.png" --token-file "..\.monitoring\secrets\marketing-ingest.dpapi" --result "..\.monitoring\sync\saved.json"
```

전송 대상은 검증된 운영 호스트로 고정하고 redirect를 거부합니다. 네트워크·429·5xx만 최대 3회 재시도합니다. 응답의 report ID/캠퍼스/날짜/runId/runKind/PNG 개수 및 인증된 파일 연결을 확인해 저장 확인 JSON을 남깁니다. 401/403/409는 자동 재수집·덮어쓰기로 숨기지 않습니다. 409는 같은 runId 내용 충돌이며 실제 신규 관측은 다른 runId를 사용합니다. 실패 원본은 보존하고 [blocked]로 알립니다.

`node scripts/render-marketing-report.mjs report.json temporary-report.html`은 13키워드×2플랫폼을 포함한 자체 인쇄 HTML을 생성합니다. 브라우저에 넣고 snapshot → PDF 스킬 `page.pdf({preferCSSPageSize:true,printBackground:true})` → `aside.pdf.renderPages`로 PNG를 만들며 각 페이지 픽셀 수가 8백만 이하인지, 최대 4장인지, 한글·행·날짜가 잘리지 않았는지 육안 검증합니다. HTML/PDF는 tmp, 사용자 PNG는 해당 실행 artifacts에 보존합니다. 전체 요약 이미지에는 다른 캠퍼스 데이터가 포함될 수 있으므로 개별 캠퍼스 ingest에 첨부하지 않습니다.

Windows npm .cmd 실행 경로 오류를 피하기 위해 build/deploy 스크립트는 잠긴 로컬 vinext/Wrangler CLI를 Node로 직접 호출합니다. 배포는 `--keep-vars`로 기존 운영 변수와 별도 FAMILY 바인딩을 보존합니다. 전용 수집 secret은 UI/API 조회 권한을 부여하지 않습니다. 예약 자체가 데이터를 만드는 단계이며 수집 토큰 설정만으로 매일 수집이 실행되는 것은 아닙니다.

## Google 차단 표시

2026-10-13 확인: 자동화 브라우저로 Google 검색을 열면 첫 검색부터 "비정상적인 트래픽" 로봇 확인 화면이 나와 결과를 읽을 수 없습니다. 로봇 확인은 우회하지 않습니다. 수집기는 이때 `platforms.google={status:'blocked',keywords:[]}`로 보내면 화면·PNG에 "자동 검색 차단 (Google 로봇 확인 화면)"으로 표시됩니다(확인 불가와 구분). 사용자 결정(2026-10-13): Google 광고·자연검색·지도는 유료 검색결과 API **SerpApi**로 받습니다.

1. 원장님이 serpapi.com에 직접 가입하고 Private API Key를 확인합니다(가입·결제는 사용자가 직접).
2. 수집용 PC에서 한 번 실행: `node scripts/marketing-google-serp.mjs configure --key-file "..\.monitoring\secrets\serpapi.dpapi"` → SerpApi 대시보드에서 키를 **복사만** 해 두고 실행하면 클립보드에서 읽어 Windows DPAPI 파일로 저장한 뒤 클립보드를 비웁니다(터미널에 붙여 넣지 않음). 복사된 키가 없을 때만 숨김 입력으로 받습니다.
3. 매일 수집 순서(Aside 예약): 네이버·채널 관찰 → 보고서 JSON 저장 → **`node scripts/marketing-google-serp.mjs merge --payload "report.json" --key-file "..\.monitoring\secrets\serpapi.dpapi"`** → PNG 렌더 → ingest. merge는 PNG 전에 실행해야 PNG에도 Google이 들어갑니다.

merge는 13개 키워드를 부천시 위치·google.co.kr·데스크톱으로 한 번씩 검색합니다(같은 KST 날짜 결과는 `..\.monitoring\cache\serpapi`에 저장해 다른 캠퍼스 보고서가 재사용). 2026-10-13 SerpApi **무료 플랜(월 250회)** 가입·인증 완료, 사용자 요청으로 Google은 정기 수집일 **월·수·금 15:00 KST**에만 검색합니다(13 × 월 12~14회 ≈ 156~182회, 2026-10-13 사용자 결정). 다른 요일 보고서는 검색 없이 `platforms.google={status:'not_scheduled',keywords:[]}`와 한계 문장을 남기고 화면·PNG에 "이번 회차 미수집 (Google은 월·수·금 수집)"으로 표시합니다. 요일은 `--days 1,3,5`(0=일~6=토)로 바꿀 수 있습니다. 공식 채널은 보고서 `channels`의 블로그·인스타·웹사이트 주소로 판정하고, 더 필요하면 `--official URL`, 지도 이름 매칭은 `--place 이름`을 더합니다. 이미 `platforms.google.status='observed'`인 보고서는 다시 검색하지 않아 같은 runId 재전송 409를 막습니다. 키 오류(401/403)와 사용량 초과(429)는 즉시 멈추고, 일시 오류는 최대 3회 재시도 후 해당 키워드만 unavailable(platform status partial)로 남깁니다. 키는 출력·로그·Git에 남기지 않으며 `SERPAPI_API_KEY` 환경변수도 지원합니다.

## 자연검색 안내

네이버 표 바로 아래(화면과 PNG 모두)에 `ORGANIC_GUIDE`(public/data-core/marketing.js)로 자연검색 순위의 뜻과 올리는 방법 5가지를 보여 줍니다. 자연검색 순위가 없는 키워드는 `organicFocusKeywords`로 골라 "먼저 할 일"로 표시합니다.

## 시간·지도·전회 비교

`capturedAt`은 한국 reportDate와 실제 시각 검증 후 같은 순간의 UTC ISO로 정규화해 저장합니다. KST/UTC가 혼용되어 최신 보고서 정렬이 뒤바뀌지 않도록 하며, 화면과 PNG에는 KST로 표시합니다. 날짜만 확인한 채널 발행일은 날짜만 보존합니다. 평균은 유한한 숫자 또는 null이고 계수·순위는 정수입니다. 자격증명·세션 헤더·사용자 소유권 필드는 payload에서 거부하고 출처 URL은 공개 http(s)로 검증합니다.

선택 `platforms.google.maps={status,summary,items:[{keyword,status,rank,sourceUrls}]}`를 별도 지도/로컬팩 영역에 표시합니다. rank는 실제 관찰한 1부터 시작하는 위치, 미노출/블록미관찰/확인 불가는 별도 상태로 제공하며 광고·자연문서 수에 합산하지 않습니다.

선택 `comparison={status:'observed'|'not_available'|'not_comparable',baselineRunKind?:'daily',baselineDate?,baselineReportId?,scopeComparable?,summary?,limitations?:string[]}`. observed는 현재 daily·이전 날짜·baseline daily·scopeComparable=true·실제 nonempty 요약·동일한 nonempty `environment.comparisonScope`가 필요합니다. ingest는 DB의 기준 보고서가 같은 조직/캠퍼스/type/sourceApp/live daily 및 실제 이전 시각·일치하는 날짜/관찰범위인지 검증합니다. 기준선이 없거나 샘플이면 변화를 0으로 계산하지 않습니다. 단위·분모·관찰환경이 다르면 not_comparable로 저장합니다. summary는 실제 기준선과 현 관찰값에서 근거가 확보된 변화 문장으로 제공하며 숫자 음수 delta를 임의로 저장하지 않습니다.

정기 수집은 서버 Worker cron이 아니라 연결된 수집용 PC의 Aside 예약에서 매주 월·수·금 15:00 KST 조사를 시작합니다(2026-10-13 변경, 이전 매일 13:30). PC/Aside가 실행 중이어야 하며 조사 완료 후 DATA CORE로 저장합니다. 화면의 ingestConfigured는 인증 연결 여부이지 항상 실행을 보장하는 표시가 아닙니다.
