# Approved mode-card photography

## User approval and scope

The user approved both generated photographic previews before application.

- Counseling: fictional middle-school student and adult art teacher exploring a portfolio together. Original generation `exec-68558ac9-697d-4543-a2b5-65dbfea05011.png`.
- Work: three fictional adult art teachers collaborating on materials. Original generation `exec-0a50f22d-c3c3-40d1-9b3a-e95048e7d4bf.png`.
- No real student/staff identities, records, uploaded works or private files were used.
- New static assets are resized proportionally to 1440 x 1080 and encoded as quality-88 WebP. No new visual changes after approval.
- `public/data-core/assets/mode-counseling-photo-v1.webp`: 191090 bytes.
- `public/data-core/assets/mode-work-photo-v1.webp`: 201666 bytes.

## Applied surfaces

- `/data-core`: counseling and work mode cards.
- `/data-core/counseling`: the dream/major roadmap entry card reuses the same approved counseling image.
- New stable `photo-v1` filenames and a versioned stylesheet avoid stale artwork.
- Main mode photos preserve their complete 4:3 composition so faces are not cut off by narrow/tall cards. Cards retain equal heights, existing captions, hover/focus treatment and native links.

Existing illustration assets are preserved. Roadmap/admissions hero banners, competition imagery, occupation illustrations, sidebar art and login imagery are not replaced by this change. Remaining imagery still needs user approval. No auth/Worker/schema/binding changes and no mutations to DB/FILES/FAMILY_DB/FAMILY_FILES or actual admissions/student/artwork data.

## Validation

- Clean install: `npm ci --no-audit --no-fund`.
- `npm test` (includes build), `npx tsc --noEmit`, every public JS `node --check`, `wrangler deploy --dry-run`.
- Updated HTML/asset contracts preserve route/visibility/permission assertions.
- `PLAYWRIGHT_MODULE=<installed module> MODE_PHOTO_BASE=<localhost or Preview origin> node scripts/check-mode-photos-browser.mjs` checks six widths (1920/1440/1024/820/390/320), both synthetic signed-in/signed-out presentation states, complete image ratio, equal cards, native counseling/work destinations, keyboard entry, back/refresh, runtime errors and asset loading.
- Browser APIs use synthetic fixtures, known read-only source previews are mocked, and unexpected mutations are blocked. The protected work destination is stubbed only to check the native link, not to claim new server-side authentication acceptance.
- Screenshots stay in ignored `outputs/mode-photos/`.
- Domain preflight now checks the two active photo URLs.

CI/Cloudflare Preview and actual production deployment evidence are recorded on the PR after verification.
