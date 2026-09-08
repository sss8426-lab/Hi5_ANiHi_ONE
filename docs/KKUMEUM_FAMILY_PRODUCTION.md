# Dream Family Production Resources

Issue #81 provisions isolated Cloudflare resources for the Dream Family service.

- D1 binding: `FAMILY_DB`
- D1 name: `hi5-anihi-family`
- D1 ID: `72137d46-50d1-4dd7-8caa-0e31bab003c3`
- R2 binding: `FAMILY_FILES`
- R2 bucket: `hi5-anihi-family-files`
- Worker: `hi5-anihi-one`

The existing `DB` (`site-creator-d1`) and `FILES` (`anihi-admissions-images`) bindings remain unchanged. The migration in `drizzle/0003_kkumeum_family_schema.sql` is schema-only and must be executed only against `FAMILY_DB`.

No student, guardian, class, report, artwork, or announcement records are seeded by this setup. Before any real-data pilot, complete the separate consent, retention, backup/restore, and closed-beta checks.
