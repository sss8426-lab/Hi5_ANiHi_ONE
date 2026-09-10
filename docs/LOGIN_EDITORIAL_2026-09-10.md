# Approved DATA CORE login redesign

## Scope and asset approval

- Base: main `ae35c13e5f26e14241c5e7217ccd7da1e54a6f96`.
- The user explicitly approved the final white-calligraphy image for the login screen.
- Original: built-in image generation `exec-3889e99b-4c76-49cd-a878-a710da50e6e5.png`.
- Fictional middle-school students in school uniforms; not actual student photography.
- Approved raster wording: `너와 나의 합격의 순간` / `하이파이브`.
- Served asset: `public/data-core/assets/login-highfive-v1.webp`, 1536 x 1024, 191144 bytes.
- WebP quality 90 conversion only; no new generation, crop, or typography changes after approval.
- The stable `v1` filename and versioned stylesheet avoid stale previous artwork. Future image replacement uses a new deliberate version, not random filenames.

## Presentation

- Full-bleed desktop image with a small bottom-right login panel.
- The approved white lettering stays in the image. A matching semantic H1 provides its text to assistive technology without duplicating visible copy.
- Under 1101px, portrait-like ratios, or short landscape viewports, the complete image appears above the form. Neither students nor lettering are cropped on mobile/tablet.
- First-login password change and long errors can expand the document rather than covering artwork or clipping controls.
- Brand home link and public counseling return remain available.
- Login-only CSS replaces the previous shared illustration layer. Internal DATA CORE pages, guardian PWA, and other entry routes keep their existing presentation.
- No third-party runtime images/fonts; the image is preloaded and high priority.

## Behavior and safety

- `public/data-core/login.js` and all server authentication/session code are unchanged.
- Form IDs, required fields, password autocomplete/minlength, alert messages, submit handling and next-route behavior are preserved.
- No Worker logic, schema, binding, account, DB, FILES, FAMILY_DB, FAMILY_FILES or admissions-data changes.
- No real credentials, production login attempts, or account/password creation is needed for this visual change.
- Browser checks intercept all auth calls with synthetic responses, including Preview checks. They never send synthetic passwords to a real API.

## Verification

- `npm ci --no-audit --no-fund`: clean install. Separate npm audit is not part of this task.
- `npm test`: includes production build and full behavior suite.
- `npx tsc --noEmit`.
- `node --check` for every public browser JS file.
- `npx wrangler deploy --dry-run`.
- `node --test tests/login-editorial.test.mjs`: 10 focused HTML/asset/auth behavior tests.
- `PLAYWRIGHT_MODULE=<installed playwright index.mjs> node scripts/check-login-editorial-browser.mjs`: responsive browser checks, login success/error, temporary-password flow, mismatch guard, back/refresh, asset/JS errors.
- Optional `LOGIN_BASE=<preview origin>` runs the same browser checks against deployed static assets while still mocking every auth API.
- Screenshots are local-only under ignored `outputs/login-editorial/`.

GitHub CI, Cloudflare Preview and production evidence are recorded on the PR after each actual result. Local tests alone do not establish deployment success.
