# Soft Premium / Work-Focused Visuals

## Scope

Started from main `8ba8f86557520df1f0eea6da36e103338b93cd9c` (PR #200).
The user's latest instruction approves direct application without another image review gate.
Presentation only: no Worker API, authorization, account, schema, D1 record, R2 object,
admissions value or student data changes. Existing routes and D001-D035 IDs remain intact.

## Shared Design

- Warm-white `#f8f8f5`, white surfaces, ink `#171917`, restrained green `#174f44`.
- Ink sidebar `#151715` for staff/counseling/admissions; small outline icons and existing drawer.
- Shared fonts and tokens, compact operational headers/forms, low-shadow cards, readable borders.
- Removed the separate dark accounts and curriculum surface overrides.
- FAMILY uses the same tokens through a presentation-only stylesheet, not staff navigation/CSS.
  PWA shell v4 includes that stylesheet and the public token file. Private APIs remain network-only.
- The approved login scene and home meadow/family photographs retain their brand-story role.
- Curriculum's six course artwork examples, university logos, real uploaded works, and all 105
  occupation detail scenes remain unchanged. These already show their specific educational subject.

## Images

Five new fictional, generated workstation photographs are in
`public/data-core/assets/work-visuals/{story,design,competition,admissions,operations}-v1.webp`.
They replace people-centric category/functional photos in mode selection, roadmap/category,
curriculum/category, competition/news and admissions masthead. No third-party downloads.
They depict generic work materials, not official documents or actual admissions evidence.
The original image files are retained. `visual-assets.json` retains historical page entries
and lists the new active work-focused slots separately.

All 35 occupation cards now use 640x480 WebP display copies of **their own** approved portfolio
photograph. No cross-occupation reuse. `occupation-image-concepts.js` records explicit stable slug,
new cover, original source, legacy portrait, dimensions and meaningful alt.
`scripts/prepare-work-covers.mjs` creates display copies and records source SHA256;
`prepare-career-visuals.mjs` uses the explicit slug, independent of the card's path.
Cards use 4:3 contain, stable dimensions, lazy loading outside the first visible group.
`scripts/review-work-covers.mjs` produces five visual review sheets.
Combined cover bytes: 2,987,860 before, 1,936,650 after (35% smaller); largest 78,384 bytes.
This measures asset payload, not an asserted page-load time improvement.

## 35-Image Review

All covers inspected at desktop review size. People are absent or small/background;
the tools and deliverables dominate. These are educational examples, not proof of employment.

| IDs | Visible distinction |
|---|---|
| D001 / D002 | Vertical webtoon pages / printed ink-and-panel comic manuscripts |
| D003 / D004 | Editorial/production boards / story-sequence and scene boards |
| D005 / D006 | 2D movement sheets / rendered 3D character animation |
| D007 / D008 | Directed final sequence / shot-by-shot storyboard and animatic planning |
| D009 / D010 / D011 / D012 | Game key art / character variations / environment art / HUD and inventory UI |
| D013 / D014 / D015 / D016 | Finished illustrations / character system / expression stickers / picture-book spreads |
| D017 / D018 / D019 / D020 / D021 | Graphic posters / coordinated identity / book layouts / packaging and dielines / cross-format campaign |
| D022 / D023 / D024 | App prototype flow / motion graphic frames / filmed video editing |
| D025 / D026 | Product prototype / vehicle clay model and sketches |
| D027 / D028 / D029 | Interior plans / exhibition display models / theater set model |
| D030 / D031 / D032 | Fashion patterns and garment / textile repeat prints / jewelry prototypes |
| D033 / D034 / D035 | Ceramic collection / furniture prototype / projected interactive-media study |

## Verification Boundary

All browser data is intercepted synthetic data, including Preview runs. No real student/guardian
record is read or mutated. This does not repeat previous account or FAMILY acceptance.
Checks include shared pages, curriculum routes, both occupation catalogs and all 35 details,
FAMILY tabs/login, responsive drawer, calendar and presentation controls.

## Local Verification (2026-09-13)

- `npm ci`, build, TypeScript, all 56 public browser JavaScript syntax checks, and Wrangler dry-run passed.
- Full suite: 349 passed, zero failed. Final changed visual/cache tests also passed.
- Shared browser matrix: 1,479 checks at 1920/1440/1280/1024/768/390/320; no page errors,
  console errors, broken assets or real mutations. Includes accounts, FAMILY, curricula and admissions.
- All 35 careers at six widths: 210 complete traversals; 105 detail sections, 4-per-page pagination,
  guideline dialogs, back/forward/refresh/deep links, aliases, unauthorized/empty/missing-image states.
- Brand-home regression: eight widths; calendar, navigation and presentation on/off remained intact.
- Visual review: all 35 covers; desktop/tablet work, accounts, competition, curriculum, Instagram,
  admissions and mobile FAMILY screenshots. Fixed the clipped analytics button, cramped admissions
  metric labels and narrow FAMILY artwork empty state found during this review.
- Changed-file ESLint: zero errors. Repository-wide lint remains non-green: 69 errors in unchanged
  tracked files, plus 21 in local/generated artifacts (90 total). One inherited regex-style error in
  a touched test was corrected. No unrelated functional lint refactor.
- Dependency audit: 12 existing findings (8 high, 4 moderate). Dependencies/lockfiles unchanged.

Release/Preview/production results are recorded on the PR after they actually finish.
Production smoke is read-only; protected-page synthetic rendering is distinguished from a
real authenticated session. No account login/password reset or production write is performed.
