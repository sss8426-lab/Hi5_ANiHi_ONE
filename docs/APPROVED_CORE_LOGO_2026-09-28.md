# Approved DATA CORE Logo

The user approved the green lowercase-i Hi5 orbital logo for production.

- Reuse the exact approved PNG, without cropping, recoloring or regeneration.
- Replace the existing H5 mark in the shared home, content, roadmap, admissions and legacy Kkumeum headers.
- Keep navigation, adjacent brand labels, login destinations, campus logos, permissions and application data unchanged.
- Use a 48px non-shrinking image slot with `object-fit: contain` and accessible alternative text.
- Version the stylesheet reference on the affected pages to avoid stale presentation.

## Verification

- Approved asset SHA-256: `f46030cfc85b9624e7235c4ede5870020e2fc6f3aa0a2315e63b696c034eaa4a`.
- Logo and mode-home tests: 9 passed.
- Type check, build and changed-test lint passed.
- Isolated Chromium layout checks at 320, 390 and 1440px: all four visible headers loaded the full image without logo/label overlap. The existing hidden legacy Kkumeum header stayed hidden.
- The layout check used local HTML/CSS with application scripts disabled; it does not represent authenticated production verification.
- Production deployment and live verification are reported separately after CI and release.
