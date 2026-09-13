# CORE visual system

## Scope and approval

The user approved the bright natural-light photorealistic previews and requested
their application together with a shared professional UI system on 2026-09-10.
This changes presentation only. No Worker/API/auth contracts, schema, bindings,
DATA CORE or FAMILY records, admissions numbers, R2 objects or credentials change.
The already approved login and mode-selection photographs remain unchanged.
The guardian FAMILY PWA is intentionally not restyled.

## Shared presentation

2026-09-13 home-only extension: `.brand-home` uses the same shell/token system with
an ink sidebar and Soft Premium warm-white main. See
`COUNSELING_BRAND_HOME_2026-09-13.md` for two-pass screenshots, MASTER presentation
UI, unchanged routes and pending new-photo approval. Other screens keep their
existing themes; the campus account screen already has its own dark variant.

- `design-tokens.css`: common surfaces, ink, brand, status colors, spacing, radius,
  shadows and existing Korean/system font stack. No remote fonts or CDN dependency.
- `design-system.css`: scoped override of the existing app styles. Plain sidebar,
  compact identity/header, primary/secondary/ghost/danger controls, restrained cards,
  inputs, tables, calendar and gallery chrome. Sections remain unframed.
- `design-shell.js`: local licensed Lucide icons and a native mobile navigation dialog.
  It moves the original sidebar node, keeping navigation handlers and authorization
  visibility intact. Escape/backdrop/close controls, focus return and resize back to
  desktop are supported. It does not call any API or read persistent storage.
- At 1100px and below the sidebar becomes a labeled drawer, not icon-only navigation.
  Existing standalone operations/accounts/readiness header layouts remain intact.
- Login keeps its isolated editorial composition and authentication code.

## Images

41 approved optimized images are used: six page/category scenes and 35 occupation
scenes. The seventh page preview (decorative studio sidebar) is intentionally not
applied because the newer UI instruction explicitly requests a plain sidebar.
`public/data-core/visual-assets.json` is the asset inventory; the existing occupation
mapping is reused. Existing job/competition asset paths are retained with stable
version `20260910-photo-v2`; new page assets have explicit `photo-v1` filenames.
No user-uploaded artwork or production file storage is involved.
All generated people are fictional. Adult professionals are used for career scenes.
Each image remains under 300 KB. Original generation files stay in the local review
folder; no machine-specific source paths or unpublished previews enter the app.

## Verification and release gates

Run npm ci, build, TypeScript, all public browser JS syntax checks, full behavior
tests and Wrangler dry-run. `scripts/check-core-design-browser.mjs` covers the
requested route matrix at 1920/1440/1024/820/390/320 widths, both career families,
mode links/history, drawer close/focus/resize, modal width, visible images, button
clipping and anonymous presentation. All API responses are synthetic and mutations
are rejected. Protected shells come from the exact checkout; CSS/images are loaded
from the selected local or Preview origin. This is visual regression testing, not
a repeat of production acceptance with real accounts or data.

Merge requires GitHub CI and Cloudflare Preview success plus visual review. Record
the production build/version and anonymous read-only smoke separately after merge.

Local verification: npm ci/build/TypeScript passed; all 41 public JavaScript files
passed node syntax checks; all 251 behavior tests passed; Wrangler dry-run passed
with DB/FILES/FAMILY_DB/FAMILY_FILES bindings unchanged. The six-viewport synthetic
browser matrix passed 794 checks with zero runtime/console errors, broken assets,
page overflow, clipped buttons or API mutations. Release remains gated on CI/Preview.
