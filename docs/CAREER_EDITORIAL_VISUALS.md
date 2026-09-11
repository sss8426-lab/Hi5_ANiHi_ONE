# Career Detail Editorial Visuals

## Scope and provenance

The 35 existing D001-D035 occupations receive three dedicated public educational
visuals: learning process, competency comparison, and completed portfolio. Existing
names, aliases, selection portraits, deep links, curriculum, admissions mappings,
filters and API contracts stay unchanged. No DB/R2 read/write, migration, sync,
student work, private image cache or real record is used to make these examples.

Images are fictional generated examples, not photographs of actual students,
verified professional work, admissions requirements or promised outcomes. The UI
states this once after the visual sections. Text-heavy artifacts deliberately use
silent visual layouts instead of invented Korean/English lettering. Titles, item
descriptions and meaningful alternatives remain ordinary accessible HTML.

## Sources and regeneration

- `scripts/career-visual-editorial.mjs`: reviewed ID-keyed copy and all 105 scenes.
- `scripts/prepare-career-visuals.mjs`: deterministic compiler and WebP optimizer.
- `public/data-core/career-visual-content.js`: additive `career.visualContent`.
- `public/data-core/career-visual-prompts.json`: per-ID scene, props, subjects,
  negative constraints, provenance and reusable generation specification.
- `public/data-core/assets/roadmap/detail/<existing-job-slug>/`: `learning.webp`,
  `competency.webp`, `portfolio.webp`. Never copy the selection portrait here.

Use the approved built-in image generation tool once per distinct scene. Keep
generated originals outside the repository. Optimize each selected result with:

```text
node scripts/prepare-career-visuals.mjs --image D001 learning ABSOLUTE_GENERATED_PNG
node scripts/prepare-career-visuals.mjs
node scripts/prepare-career-visuals.mjs --check
```

The optimizer refuses to overwrite an existing image by default. A reviewed
replacement requires the current full SHA-256 as the final argument, protecting
against replacing a different revision. Generated originals remain outside Git.
Learning/competency images
are 1600x1000; portfolio images are 1600x1200. Contain resizing preserves the whole
scene, WebP quality 82 down to 70 targets at most 350 KiB without extreme loss.
Versions are SHA-256 prefixes, not random filenames. No private API caching policy
is changed. The public static asset cache remains in use.

## Rendering

Learning is image-left/copy-right, competency reverses that order on desktop,
and portfolio uses the full content width with result names below. At 860px and
below all sections become image-first stacks. Explicit width/height and aspect
ratios reserve space; `object-fit: contain` avoids cropping work or faces. Only the
current detail's three images enter the DOM, all lazy and asynchronously decoded.
The current career portrait is eager. There is no cross-career prefetch, image
lightbox, storage write or new tracking. Failures retain educational text and a
plain error state instead of borrowing another occupation's image.

## Verification boundary

`tests/career-visual-content.test.mjs` checks all 35 mappings, original field
preservation, 105 paths/hashes/dimensions, nonempty copy/alt, generated-file parity,
escaping, and per-career lazy rendering. Missing manifest assets fail CI;
unreferenced files emit warnings. Full behavior tests retain admissions and other
product regression coverage. Browser testing uses synthetic intercepted APIs only,
including on immutable Preview, and must inspect required widths and representative
careers before merge. Production acceptance is read-only and recorded separately
on the PR; local tests alone are not deployment evidence.

## Local verification

- 35 stable careers, 105 dedicated images, zero missing or duplicate paths/hashes.
- Mean WebP size: 158.8 KiB; total: 16.29 MiB.
- All 35 careers traversed at 1920, 1440, 1024, 820, 390 and 320px: 210 passes.
- Three own-career lazy image requests only on a fresh detail deep link.
- Reserved image height unchanged across delayed loading; deliberate 404 retains
  the educational copy with an accessible error message.
- Eleven representative careers captured with all three sections at all widths.
- Existing ratio/filter/logo/guideline browser suite: six widths, 141 synthetic
  GET requests, zero page errors, missing assets or mutations.
- Build, TypeScript, all 50 public browser JavaScript checks, 314 behavior tests
  and Wrangler dry-run passed. Tests use synthetic fixtures, never real records.

Image review preserves distinctive media: vertical webtoon versus inked print
pages, animation poses/rigs versus shot boards, game key art versus character or
environment studies, and graphic, physical-material and spatial portfolios.
Selected images received cleanup edits for incidental lettering/logos, background
distractions and framing. These are educational examples, not software tutorials.
