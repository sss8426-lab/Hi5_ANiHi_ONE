# 블로그 자동화 네이버 홈피드형 콘텐츠 전략 및 발행 패키지

기준일: 2026-09-14

## 목적

기존 "사진 선택 → 명령 입력 → AI 글 생성" 단일 단계 흐름에, 네이버 홈피드 노출과 SmartEditor로
옮겨 쓰기 좋은 콘텐츠 전략 단계를 추가한다. 네이버에 비공식 방식으로 자동 로그인/자동 발행하는
기능은 **이번 작업에서 만들지 않는다** — 목표는 "좋은 블로그 글 자동 생성" + "네이버에 바로 옮겨
게시하기 좋은 최종 패키지"까지다.

## 2단계 생성 구조

```text
사진 선택 → 글 목적/내용 입력 → 글 방향 선택(균형형 기본)
  → AI 콘텐츠 전략 분석 + 제목 후보 3개 생성 (1회 호출)
  → 사용자가 제목 선택
  → (필요 시) 제목에 맞춰 최소 재작성
  → 발행 패키지 완성
```

사용자가 원하면 **[바로 글 만들기]** 로 제목 선택 단계를 건너뛰고 기존처럼 한 번에 생성할 수도
있다(같은 API 호출, 클라이언트에서 제목 선택 화면만 생략).

## 콘텐츠 전략 모드

"글 방향" 선택 UI(기본값 **균형형**):

- **검색형**: 명확한 검색 의도(지역+분야+문제) 중심, 억지 키워드 반복 금지.
- **홈피드형**: "이 주제에 관심 있는 사람이 다음으로 궁금해할 질문" 중심, 자극적인 낚시 제목 금지.
- **균형형**: 검색 키워드 + 홈피드 관심형 제목을 함께 사용(HI5·ANiHi 블로그 기본값).

## 핵심 주제 하나 + 다음 질문 분석

AI가 글을 만들기 전에 내부적으로 `strategy.primaryTopic`(핵심 주제 하나) /
`strategy.searchIntent` / `strategy.nextQuestion` / `strategy.readerProblem`을 정한다. 입시/공모전/
학원소개/대학소개/이벤트 등 서로 다른 내용은 한 글에 섞지 않고, `nextTopics`(다음 글 아이디어
3개)로 분리하도록 지시한다. 이 데이터는 화면에 전부 노출하지 않고 품질 검증과 다음 글 추천에
사용한다.

## 제목 후보 3개 + 본문 일치

한 번의 structured generation 호출로 `strategy` + `titles`(search/homefeed/balanced) + 선택한
strategyMode에 맞춰 이미 작성된 `lead`(도입부) + `body`(본문) + `hashtags` + `cta` + `nextTopics`를
함께 만든다(비용 제어: 제목 3개를 만들기 위해 별도 호출을 여러 번 하지 않는다).

- 제목에서 질문하거나 약속한 내용은 본문 초반(`lead`, 3~5문장)에서 먼저 답하도록 지시한다.
- 정보/교육 내용 약 70~80%, 학원·브랜드 설명 15~20%, 상담 유도(CTA) 5~10% 배분을 프롬프트에
  명시한다.
- 문단 2~4문장, 자연스러운 문장형 소제목 2~4개, 키워드는 문맥에 필요한 만큼만 사용.
- 캠퍼스가 선택돼 있으면 그 캠퍼스 표시명만 지역 키워드로 사용하고(`campusDisplayName()`), 다른
  캠퍼스 지역명은 넣지 않는다.
- `hashtags`는 8~15개, `cta`는 상투적 문구 대신 자연스러운 한두 문장.

## 제목 선택 → 최소 재작성 (비용 제어)

- 사용자가 strategyMode가 추천한 제목(`selectedTitleKind`)을 그대로 선택하면 **추가 API 호출 없이**
  이미 생성된 `lead`+`body`를 그대로 적용한다.
- 다른 후보를 선택하면 `POST /api/data-core/content/refine`(`mode:'retitle'`)로 **사진을 다시
  전송하지 않고** lead/body만 새 제목에 맞게 최소 재작성한다.
- **[다른 제목 만들기]** 는 같은 엔드포인트를 `mode:'titles'`로 호출해 제목 후보 3개만 다시
  만든다(사진 재전송 없음). 두 모드 모두 `withAiRequest()`의 requestId 기반 비용 가드를 그대로
  재사용한다.

## 홈피드 품질검사(서버)

`content-openai-provider.ts`의 `blogQualityIssues()`가 생성 직후 다음을 점검한다: 핵심 주제 존재,
제목 길이, 제목·도입부 주제 일치(단어 겹침), 첫 문단 존재, 같은 단어 과다 반복, 학원 소개 비중
과다. 문제가 2개 이상이면 **정확히 한 번만** 교정 지시를 추가해 재작성하고(무한 재생성 금지),
재시도 결과가 또 파싱 실패하면 원래 결과를 `warnings`와 함께 그대로 반환한다(요청 자체는 실패하지
않음).

## 중복 제목 방지

클라이언트가 매 생성/제목 재작성 요청마다 현재 캠퍼스의 최근 블로그 초안 제목 최대 20개를 조회해
(`GET /api/data-core/content?sourceApp=blog`) `recentTitles`로 함께 보낸다. 서버는 이를 프롬프트에
"다음 제목들과 완전히 동일한 제목은 만들지 마세요"로 포함시키고, 클라이언트는 별도로 단어 겹침
비율(≥60%)로 근접 중복을 감지해 비차단 경고 배너를 보여준다. 완전히 차단하지 않는다.

## 사진 순서 활용 · 허위정보 방지

프롬프트에 "사진은 선택한 순서대로 제공되며, 설명→과정→피드백→결과 같은 구성의 힌트로만 참고하고
사진에서 실제로 확인할 수 없는 사실은 만들지 말라"는 지시를 포함한다. 기존 개인정보/합격·수상 수치
금지 규칙은 인스타그램과 동일하게 유지한다.

## 발행 패키지

- **다음 콘텐츠 아이디어**: `nextTopics` 3개를 클릭하면 명령창에 채워 다음 글 소재로 바로 쓸 수
  있다.
- **발행 전 확인**: 핵심 주제 1개 / 제목과 본문 일치 / 첫 문단 핵심 답 포함 / 선택 사진 수 /
  해시태그 개수(8~15개 권장) / CTA 포함 여부를 클라이언트에서 계산해 보여주고, "합격·수상 수치는
  직접 확인해주세요" 경고를 항상 표시한다.
- **네이버 발행용 복사**: 제목/본문/해시태그/CTA를 이어 붙이고, 이미지 순서(파일명 목록)를 별도
  섹션으로 붙여 복사한다. SmartEditor DOM이나 비공개 API를 흉내 내는 HTML은 만들지 않는다 —
  plain text + 구조 정보만 사용한다.

## Generation과 Publishing 분리

이번 작업은 `BlogGenerationService`(콘텐츠 생성)만 구현했고, `PublishingAdapter`(실제 게시)는
구현하지 않았다. 발행은 여전히 사람이 "네이버 발행용 복사"로 복사해 SmartEditor에 직접 붙여넣는
방식이다. 향후 공식적으로 허용된 발행 연결이 생기면 생성 로직을 그대로 재사용할 수 있도록 두
개념을 분리해 두었다.

## 금지 사항 (지키지 않음)

`NID_AUT`/`NID_SES` 쿠키 저장, 네이버 로그인 세션 탈취/재사용, CDP를 통한 네이버 로그인 자동제어,
CAPTCHA 우회, RabbitWrite 비공식 API 직접 호출, 네이버 내부 tokenId 강제 수집, 사용자 확인 없는
자동 게시 — 이번 구현에 전혀 포함되지 않는다.

## 기존 draft 호환

`title`/`content`/`hashtags`/`cta` 필드는 계속 지원한다. `strategy`/`titles`/`selectedTitleKind`/
`nextTopics`/`strategyMode`는 `metadata`에 additive로만 저장되며(DB migration 없음), 이 기능 이전에
저장된 초안은 이 필드들이 없어도 그대로 열리고 다시 저장된다.

## API

- `POST /api/data-core/content/generate` (블로그, `multipart/form-data`): 기존 필드에
  `strategyMode`(`search`|`homefeed`|`balanced`, 기본 `balanced`)와 `recentTitles`(문자열 배열,
  선택)를 추가로 받는다. 응답의 `generated`에 `strategy`/`titles`/`selectedTitleKind`/`lead`/
  `nextTopics`/`strategyMode`/`warnings`(선택)가 additive로 추가된다. 인스타그램 응답 모양은
  전혀 바뀌지 않았다.
- `POST /api/data-core/content/refine` (신규, 블로그 전용, JSON only — 사진 없음):
  `mode:'titles'`(전략 기반 제목 후보만 재생성) 또는 `mode:'retitle'`(새 제목에 맞춰 lead/body만
  최소 재작성)을 지원한다. 권한/캠퍼스 검사와 `withAiRequest()` 비용 가드는 `/generate`와 동일하게
  적용한다.

## 회귀 보존

자료보관함 사진 선택/폴더 탐색/사진 확대/선택 해제, 사진 AI 자동 최적화(10장, 2MiB/16MiB 한도),
초안 저장/불러오기, 기본 해시태그/하단 고정 문구, 전체 복사, 다시 작성, AI 취소는 모두 기존 그대로
동작한다. **인스타 자동화는 이번 작업에서 코드 한 줄도 바뀌지 않았다.**

## 테스트

- `tests/content-blog-strategy.test.mjs` (Miniflare, 신규): strategyMode 3종이 실제 OpenAI
  instructions에 반영되는지, 기본값이 balanced로 정규화되는지, 긴 명령이 그대로 전달되는지, 사진
  없는 블로그 생성이 기존처럼 거부되는지(`/refine`은 사진 없이 동작), 레거시 draft 호환, recentTitles
  중복회피 지시문 포함, `/refine`의 titles/retitle 두 모드와 권한 검사, 품질검사 1회 재시도와
  재시도 실패 시 경고와 함께 원래 결과 반환을 검증한다.
- `tests/content-blog-homefeed-ui.test.mjs` (정적 소스 검사, 신규): 글 방향 선택/바로 글 만들기가
  블로그에서만 보이는지, `runAi`의 quick/단계별 분기, 제목 재선택이 `/refine`만 호출하고 사진을
  다시 보내지 않는지, 발행 전 확인/네이버 발행용 복사/다음 콘텐츠 아이디어, additive draft metadata
  호환을 검증한다.
- 기존 `tests/content-openai.test.mjs`의 블로그 관련 mock을 새 schema에 맞게 갱신했다(인스타그램
  경로는 변경하지 않음). `tests/content-blog-photo-optimization.test.mjs`, `tests/content-generation-*.test.mjs`도
  변경 없이 그대로 통과한다.

## 검증

- `npm test`(전체 저장소) — 통과(정확한 수치는 PR/완료 보고에서 최종 확인).
- `npx tsc --noEmit`, `npx eslint`(변경 파일), `node --check`(변경 public JS) — 오류 없음.
- `npm run build`, `npx wrangler deploy --dry-run` — 통과.
- Preview/Production 배포 및 실제 브라우저 확인은 이 문서 작성 시점에서 별도로 진행한다.
