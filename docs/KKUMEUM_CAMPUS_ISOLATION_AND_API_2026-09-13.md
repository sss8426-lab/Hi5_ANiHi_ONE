# 꿈이음 캠퍼스 격리 · 학생 이동 · API 진단

## 권한과 저장소

- 반 목록의 폴더는 기존 `family_classes`를 사용한다. 로그인 세션의 캠퍼스 membership으로 서버에서 제한한다. 자료보관함 폴더를 복제하지 않는다.
- CAMPUS_ADMIN/CAMPUS_DIRECTOR: 자기 캠퍼스 반·학생·작품·평가·보호자 연결 관리. 다른 캠퍼스 학생 조회/변경 불가.
- TEACHER: 기존 활성 담당 반과 학생 권한을 유지한다. STAFF에는 학생 개인정보 권한을 새로 부여하지 않는다.
- MASTER/호환 SUPER_ADMIN: 상단 캠퍼스 선택으로 전체 관리. 설정에서 기존 캠퍼스 계정/접속 현황 화면으로 연결한다.
- 저장소는 기존 FAMILY_DB/FAMILY_FILES. 일반 DB/FILES, 기존 10개 계정, 비밀번호, 캠퍼스 ID는 변경하지 않는다.
- 학생/반 권한 검사에서 요청 campusId뿐 아니라 실제 저장된 학생/반 소유 캠퍼스도 확인한다.
- 실제 발견된 누락: 보호자 관리 API가 CAMPUS_DIRECTOR만 허용하여 CAMPUS_ADMIN의 학생 상세 로딩까지 실패할 수 있었다. CAMPUS_ADMIN을 동일 캠퍼스 관리자 정책에 포함했다.
- 다른 캠퍼스 자녀에도 연결된 보호자 계정의 비밀번호/전체 세션/활성 상태 변경은 MASTER만 가능하다. 캠퍼스 관리자는 자기 학생과의 연결 권한만 관리하며 타 캠퍼스의 보호자 계정 전체에 영향을 주지 않는다.
- 모바일과 기존 관리 화면은 상단 캠퍼스 하나만 사용한다. 이전 캠퍼스의 늦은 응답은 버리고 학생 상세를 즉시 비운다.

## 마스터 학생 이동

꿈이음 → 아이소식 → 학생 → **캠퍼스 이동** → 도착 캠퍼스/활성 반 선택 → 대상 확인 → 이동 확정.

- `POST /api/kkumeum/students/:id/transfer`: MASTER만 허용. fromCampusId, toCampusId, classId(optional), expectedUpdatedAt 필수 확인.
- `GET /api/kkumeum/students/:id/transfer`: MASTER 전용 최근 20건 이동 이력.
- 동일/미등록 도착 캠퍼스, 다른 캠퍼스의 반, 비활성 반, 오래된 학생 정보, 교차 출처 요청 차단. 기존 pilot campus 제한 유지.
- FAMILY_DB atomic batch: 학생 소유 캠퍼스/현재 반과 학생에 연결된 family_files/student_artworks/monthly_reports 캠퍼스를 함께 변경한다.
- 이전 반 enrollment는 종료 시각을 기록하고 새 반 enrollment를 추가한다. 반 미지정 이동도 가능하다.
- student ID, 파일 ID, R2 key/bytes, 작품의 과거 수업 반, 평가 revision, 보호자 연결/동의, 과거 공지/전달/읽음 기록은 보존한다. 반 전체 또는 다른 학생은 이동하지 않는다.
- 보호자는 기존 own-child/consent/pilot 정책 아래 연결된 자녀를 계속 열람한다. 캠퍼스 간 공유 계정을 만들거나 동의를 자동 부여하지 않는다.
- 이전 캠퍼스는 이동한 학생·작품·평가 파일을 직접 ID로 요청해도 접근할 수 없다. 새 캠퍼스의 담당 교사는 새 현재 반 배정을 따른다.
- 이동 감사에는 출발/도착 캠퍼스, 이전/새 반, 학생 ID, 실행자, 시각만 기록한다. 학생 이름/비밀번호/토큰/원본 bytes는 넣지 않는다.
- 중복 제출/오래된 확인은 409로 중단한다. 결과가 불확실하면 재클릭 대신 학생 위치/이동 이력을 확인한다. 운영자만 반대 방향으로 다시 이동할 수 있다.
- 기존 반 수정은 캠퍼스 이동을 수행하지 않는다. 학생 편집 중 이동이 일어나면 이전 캠퍼스의 늦은 반 배정 변경도 차단한다.
- 동시 학생 편집에서는 성공한 UPDATE의 고유 audit marker가 있을 때만 반 배정 이력을 변경한다. 충돌한 요청은 audit/enrollment를 남기지 않으며, 같은 밀리초 안에서도 학생 수정/이동의 revision 시각은 증가한다.
- 별도 테이블 또는 migration 없음. 기존 schema의 record와 audit만 재사용한다. 운영 학생 자동 이동/일괄 이전 없음.

## “API 미연결” 원인별 해결

| 증상 | 원인/현재 상태 | 안전한 해결 |
| --- | --- | --- |
| 로그인 화면 또는 401 | 직원 세션 없음/만료 | 동일 운영 도메인에서 다시 로그인. 계정 재생성/비밀번호 초기화가 필요한 상황으로 단정하지 않는다. |
| 403 캠퍼스/담당 반 | 정상 권한 차단 또는 계정 배정 불일치 | MASTER가 기존 계정의 캠퍼스와 담당 반 배정을 확인. URL campusId 변경으로 우회하지 않는다. |
| 403 파일럿 캠퍼스 | 기존 closed-beta 제한 | MASTER가 pilot 설정과 실제 운영 승인 범위를 확인. 진단 작업이 자동으로 pilot/동의를 해제하지 않는다. |
| `/api/kkumeum/health` 503 | FAMILY_DB/FAMILY_FILES binding 누락 | 빌드가 생성하는 `dist/server/wrangler.json`과 `vite.config.ts`의 기존 FAMILY binding/리소스 연결을 확인하고 정상 배포. 새 DB/R2 생성이나 일반 DB fallback 금지. |
| health 정상인데 목록 500 | schema/배포 불일치 등 별도 실패 | 비밀정보 없는 오류 코드와 배포 버전을 확인. 기존 forward schema만 검토. RESET/seed 덮어쓰기 금지. |
| 출석/답변/문의/수납/선생님 관리에 미구현 안내 | 해당 업무의 전용 API가 아직 없음 | 로그인/secret 추가로 해결되지 않는다. 기존 FAMILY 학생/반/담당자 관계에 해당 업무 adapter/API와 저장 구조를 별도 구현한 뒤 버튼 연결 필요. |
| 월간평가 AI 초안 `provider_not_configured` | `MonthlyReportDraftProvider`가 라우터에서 주입되지 않음 | 기존 server-side OpenAI provider를 월간평가 계약에 맞게 연결하고 구조화 응답/오류 처리를 검증해야 한다. 단순 API key 등록만으로는 해결되지 않는다. 수동 작성/저장은 계속 가능. |

### 후속 API 구현 순서

1. 출석: FAMILY의 실제 학생·반 관계를 재사용하고 학생/날짜 중복 방지, 교사 담당 반 권한, campus ownership을 적용한다.
2. 문의/답변: 보호자 own-child 관계로 조회/작성 범위를 제한하고 학생 문의 thread와 답변을 연결한다.
3. 선생님 관리: 기존 class_staff_assignments와 직원 계정 목록을 연결한다. 계정 생성/역할 변경은 기존 MASTER 기능 유지.
4. 신청서/수납: 기존 동의 정책과 일반 신청서를 구분한다. 금액/개인정보 접근, 정정 이력까지 별도 설계한 뒤 추가한다.
5. 월간평가 AI: 명시적으로 선택/입력한 교사 관찰 내용만 전달, 학생 실명/학교/연락처/내부 ID는 모델 context에서 제외. 실제 학생 자료 없이 synthetic provider smoke. 자동 보호자 발송 금지.

이 문서는 미구현 기능을 연결 완료로 표시하지 않는다. 이번 변경은 캠퍼스 격리·이동과 오류 안내 보완이며, 위 후속 모듈은 새로 구현하지 않는다.

### AI 연결 설정 확인 결과

2026-09-13 `hi5-anihi-one` production Worker에서 `wrangler secret list`로 이름만 확인했다. OpenAI secret은 없으며 인증/Push용 기존 secret만 존재한다. 값은 읽지 않았고 새 키 생성/교체/과금 설정 변경도 하지 않았다. 빌드 설정에는 기존 FAMILY_DB/FAMILY_FILES binding이 각각 존재한다. 이는 현재 로그인 후 API 응답 성공을 대신하는 증거는 아니다.

AI를 연결할 때는 기존에 발급한 OpenAI Platform 키를 소유자가 Cloudflare Worker의 **Variables and Secrets**에서 `OPENAI_API_KEY` secret으로 직접 입력하거나, 프로젝트 관리자 터미널의 `npx wrangler secret put OPENAI_API_KEY` 비공개 입력창에서 등록한다. 채팅/GitHub/일반 변수/설정 파일에 붙여넣지 않는다. 먼저 위의 월간평가 provider adapter 계약을 구현·검증해야 하며 키 등록만으로 월간평가 AI가 동작한다고 안내하지 않는다. 꿈이음의 수동 학생·반·작품·평가 관리는 OpenAI 키 없이 사용한다.

## 검증 범위

- 운영 브라우저 재진입은 로그인 화면으로 돌아왔다. 저장된 예전 MASTER 화면만으로 현재 인증 성공을 주장하지 않는다.
- 운영 데이터 이동/계정 변경/푸시 재발송은 수행하지 않는다.
- 격리된 Miniflare의 SYNTHETIC 데이터로 10개 캠퍼스 소유권, MASTER 이동, 타 캠퍼스 API 차단, 원본 bytes/관계/이력 보존을 검증한다.
- 로컬 `npm ci`, `npm run build`, `npx tsc --noEmit`, public JS 59개 `node --check`, `npm test` 361개, 변경 파일 ESLint, `wrangler deploy --dry-run` 통과. 후속 동시성 검사에는 고정 시계에서의 수정/이동 revision 증가와 실패한 수정의 audit/enrollment 무변경을 포함한다.
- 꿈이음 browser fixture 검사 807개: 1920/1440/1024/820/768/430/390/375/320px, 운영자 이동 확인/제출/일반 관리자 버튼 숨김, 캠퍼스 선택, 기존 관리 영역 숨김 회귀. 다른 주요 화면 검사 1,444개: 오류/깨진 자산/운영 mutation 0.
- 이동 중 DB 오류를 합성 trigger로 주입하여 학생/파일/audit가 함께 rollback되는 것도 확인했다. 이 trigger는 메모리 테스트 DB에만 생성하며 운영 DB에는 실행하지 않는다.
- CI/Preview/production 버전은 PR evidence와 최종 보고에 별도 기록한다. Preview UI의 fixture 검증을 실제 운영 계정 로그인/학생 이동 성공으로 표현하지 않는다.
