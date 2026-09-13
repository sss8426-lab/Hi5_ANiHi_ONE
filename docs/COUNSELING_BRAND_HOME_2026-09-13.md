# Brand home: Soft Premium

## Scope

Base: main `526df95332cf935e08633bd95173c4fbf1f7fed6` (PR #199).
Only the `/data-core/counseling` presentation is redesigned. Shared tokens and
components are extended with a `.brand-home` variant; operational pages keep their
own theme. Authentication, API authorization, calendar implementation, routes,
schemas, D1/R2 objects, accounts and existing original photographs are unchanged.

Visible labels: `홈`, `너와 나의 합격의 순간`, `하이파이브.애니하이`,
`HI5·ANiHi DATA CORE`, `모드 선택`, `처음으로`.
The introductory paragraph, three card descriptions and calendar introductory
sentence are removed. Card links remain competitions, `/data-core/roadmap`, `/`.
The curriculum menu and existing administrative menus remain functional.

## Two design passes

PASS 1: ink sidebar #111311, ivory #f5f3ee, deep-green #174f44, 50px/700 heading,
8px card corners, generous spacing. Screenshots were captured and inspected before
PASS 2. Existing sans-serif font stack retained, no serif/remote fonts added.

PASS 2: warm-white #f8f8f5, white cards, softer ink sidebar #151715,
text #171917, secondary #61675f, border #e1e3dc, green #174f44, hover #123f37,
soft green #e8f0ec. 46px/650 desktop heading, 42px compact desktop/wide tablet,
38px middle tablet, 34px narrow and 28px small phone. No viewport-scaled font or
nonzero letter-spacing. Card radius 12px; subtle 1.02 image hover, no floating shadow.
Reduced-motion disables transitions. Calendar heading is 19px and visually secondary.

Existing 1100px drawer breakpoint is retained. Cards use three columns from 1024px,
two from 761px to 1023px, one at 760px and below. At 1024/1180/1280/1440/1920 by
900, the heading and all three cards fit in the first viewport.

## Presentation mode

`brand-home.js` only handles UI state, never network/auth/data operations.
The trigger is available on this home after a confirmed authenticated MASTER or
compatible SUPER_ADMIN context (`isSuperAdmin`). Its local Lucide icon has a Korean
accessible name and hover/focus tooltip. Activation hides administrative navigation,
storage status, identity, logout and internal footer; all five consumer menu choices
remain. A small fixed exit control restores the original elements and focus.

Preference: sessionStorage `data-core.brand-presentation.v1`, boolean-like `on` only.
It survives refresh/back within the same tab. Other pages retain their normal UI;
returning to home restores the choice. New sessions default to normal, confirmed
non-MASTER context and successful logout clear it. Storage-disabled browsers use
memory state. Forging the preference does not expose MASTER controls. This is not
a security boundary and does not grant/revoke any permission.

## Approved home photographs

The competition photograph is preserved without modifying its bytes:
`public/data-core/assets/counseling/competition-challenge.webp`.

Two new fictional-person photos were generated with the built-in image generator.
The user approved application on 2026-09-13. They are applied to the two home cards
only, with accurate alt text and separate inventory entries. Existing roadmap and
admissions page images remain unchanged. No internet image download, reused card
duplication or recoloring.

| Slot | Asset under public/data-core/assets/counseling | Output | Alt |
|---|---|---|---|
| `data-brand-image="dream"` | `dream-roadmap-field-v1.webp` | 1440x960, 114490 bytes | 푸른 하늘을 바라보며 미래를 상상하는 학생 |
| `data-brand-image="admissions"` | `university-success-family-v1.webp` | 1440x960, 140894 bytes | 합격 소식을 가족과 함께 기뻐하는 학생 |

Review copies remain in `outputs/brand-image-review/`; the approved WebPs are now
shipped under the paths above. `visual-assets.json` has 43 distinct assets, including
the unchanged 35 occupation images and two new home-only entries.
Generated sources are 1536x1024 PNG. Deterministic Sharp conversion: auto-orient,
1440x960, WebP quality 84; no visual retouch. Card-specific `--card-focus` is declared
for both slots, currently 50% 50%; shared aspect-ratio 3:2 and object-fit cover.
Only the two home src/alt attributes are changed for this asset application.
No new UI/API feature is needed for the swap.

Generation brief, dream: photorealistic Korean teen student, fully clothed, resting
comfortably on a broad green meadow and looking up at a blue sky with generous
white cumulus clouds. Bright daylight, open space, relaxed smile, hopeful future,
no classroom/desk/teacher/computer, no logos or text. 3:2 landscape card composition.

Generation brief, admissions: photorealistic Korean teen student smiling with two
parents, sharing joyful admissions news in a bright naturally lit home. Genuine
warm family emotion, ordinary unmarked paper, no university names, official seals,
logos, fake credentials or decorative text. 3:2 landscape with all faces visible.

## Verification and release boundary

- Before, PASS 1 and PASS 2 screenshots: `outputs/brand-home/{before,pass1,final}/`.
- `scripts/check-brand-home-browser.mjs`: eight widths, headings, card count/ratio,
  first-viewport fit, overflow/header overlap, MASTER toggle/drawer/focus/refresh/back,
  campus/guest UI, original links, curriculum/mode/permissions navigation, calendar
  previous/next/today and one synthetic add; reduced motion.
- All `/api/**` requests in that browser test are intercepted. No production write,
  real account login/logout or real calendar event is performed. This is UI regression
  evidence, not a rerun of earlier production acceptance.
- The current home has a monthly calendar, previous/next/today/add and selected-day
  list. It does not have separate week/day/list view tabs. No extra calendar feature
  is invented by this visual change.
- Unit tests cover pending auth, forged preference, role loss, session reset,
  disabled storage, focus restoration, route preservation and theme scope.
- Image approval is complete. Keep the PR unmerged until the final image crop,
  three-emotion visual review and latest CI/Preview checks are complete.

CI/Preview and production release evidence are recorded separately on the PR.
Do not infer deployment from local screenshots or mock API tests.

Final approved-image local results (2026-09-13): npm ci, build, tsc and Wrangler dry-run passed;
56 public scripts passed node syntax checks; all 349 behavior tests passed.
Home browser test passed all eight widths with no runtime errors, overlap or
horizontal overflow; tested text contrast is at least 4.5:1. Shared six-width browser
regression passed 794 checks with zero page/console errors or broken assets.
All browser API responses were synthetic, including the single calendar add and
logout simulation. No real account, calendar, file or D1/R2 record was mutated.
Targeted new files/tests lint passed; app.js has 3 pre-existing errors on main and
3 after this change, with no added diagnostic. Existing tests were updated for the
new labels/cache version and the already-existing dark account theme/activity API.

Final image review: before/after 1440, final 1920/1440/1280, 1024 presentation and
390 mobile screenshots were directly inspected. The creative studio, open meadow
and joyful family scenes are distinct, bright and correctly framed. Both approved
images decode at 1440x960 in all eight tested widths. The three earlier photographs
also passed read-only production SHA256 comparison before release; no original
asset was overwritten. The former home-image filename assertion was updated to
the approved home asset while preserving the original asset existence check.
