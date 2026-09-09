# Shared bright DATA CORE layout

## Scope

- Reuses the approved main-mode sidebar artwork and the dream roadmap's light background, green accent, readable typography and restrained borders.
- Adds a versioned CSS layer to the main/counseling/work/library shell, blog/Instagram editor, accounts, operations, readiness, login and staff kkumeum shell.
- Keeps the approved homepage artwork, dream roadmap and admissions theme. Guardian PWA remains its independent mobile experience.
- Internal navigation becomes a horizontally scrollable labeled bar on tablets/phones. Forms, tables and operational panels retain their existing workflow and density.
- Hidden permission/state elements remain hidden. Reduced-motion and keyboard focus are supported.
- No route, API, authentication, schema, binding, migration, file ownership or data mutation logic changes.

## Verification

- npm ci, build, TypeScript, all browser JS syntax checks and Wrangler deploy dry-run passed.
- Full behavior suite: 194 passed, zero failed.
- Shared-layout browser suite: 280 checks across 1440, 820, 390 and 320px, including mode-card navigation, browser back/refresh, authenticated/unauthenticated states, hidden elements and kkumeum modal opening/canceling. Zero page errors, missing static assets or horizontal page overflow.
- Protected shells in the local layout test use actual checked-in HTML and synthetic API fixtures, not production credentials. This is UI verification, not production authentication proof.
- Existing award gallery: 65 checks; dream roadmap: 103; admissions: 113. Screenshots inspected for desktop, tablet and phone layouts.
- Dependency installation reports 23 pre-existing advisories. No automatic dependency changes were made.

## Operational acceptance

Parent issues #30, #18 and #43 are audited separately. A successful UI build is not acceptance evidence for production account lifecycle, file restoration, backup or guardian device delivery. Unverified items remain open. No real records are used by browser tests.
