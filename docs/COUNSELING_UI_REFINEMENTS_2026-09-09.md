# Counseling UI Refinements

## Scope

The counseling home now has three full-click image cards using the existing
routes. Dream/major reuses the approved mode-counseling asset. Competition and
admission counseling use original built-in image_gen illustrations, optimized
with the existing Sharp/WebP pipeline. No third-party art was downloaded.

Generated assets: `public/data-core/assets/counseling/competition-challenge.webp`
and `admission-roadmap.webp`. Prompts: bright Korean art studio, fictional student
making a large competition artwork; and fictional student/teacher jointly
reviewing university strategy at a desk. Both match the approved daylight
editorial style with no text, logos or actual university/statistical claims.

Competition retains the PR170 authenticated award gallery, folder ownership,
memory image cache, upload filenames, Lightbox, selective soft-trash and restore.
The manual competition creation entry, stored list and detail are removed from
this counseling UI only. Existing APIs and records remain intact. The news header
and page hero use the competition illustration. No invisible manual list fetch
is necessary. Public sources now accept exact `접수중`, `예정`, and `접수전`
(the last normalized to upcoming), retaining elapsed-deadline filtering, source
deduplication, partial failure fallback and calendar projection. This supersedes
the earlier PR170 Art&Design-only-open restriction at the user's explicit request.

Dream/major related university programs are paged by four with numbered controls,
previous/next and gaps. Career/filter changes reset the page. Source links index
the visible page, not the full result array. Existing hash navigation remains;
refresh/back revalidate private records and default to page one.

## Public Guideline Boundary

Read-only inspection on 2026-09-09: anonymous public source JSON contained 2643
susi and 1183 jungsi rows. The source page's `META` list, not all JSON columns,
defines the approved additional field allowlist. Added: admission division and
subtype, previous quota/applicants, practical schedule/venue, schedule notes,
document deadline, subject count, second language, admission contact and homepage.

The JSON includes extra student-record grading and accepted-applicant statistics
not exposed in that anonymous table. Those columns are NOT imported. Missing
student-record method/year breakdown, standalone practical duration/paper and
registration dates remain unverified. The verbatim public selection formula and
practical subject can contain relevant facts without guessing or parsing them
into unsupported numbers. No membership login, protected page or editorial article
is scraped. Sources:

- https://grinalda.net/univ-info-susi/
- https://grinalda.net/univ-info-jungsi/

The table displays source practical subject/selection formula instead of repeated
generic detail labels, plus application period and season-correct grade/CSAT ratio.
Clicking a row or pressing Enter/Space opens a grouped, escaped fact detail dialog.
The detail includes source link, timestamps and official-university disclaimer.

## Additive Metadata Enrichment

`scripts/enrich-public-guideline-details.mjs --remote-read-only` produces only
counts, plan hash and preservation hash. `--apply --expected-plan=<fresh plan>`
requires the exact reviewed plan. Run after CI/Preview/production deployment.

It adds `publicDetails` and `detailsCheckedAt` to existing guideline metadata only.
It never creates/deletes a row, remaps a university, changes identity/fingerprint,
overwrites existing detail values, or modifies original fields. Official/manual
priority rows and verified records are skipped. Each SQL statement has explicit
organization/campus/type/ID/tombstone guards and optimistic original metadata
comparison. Whole original-metadata hashes before/after must match. Temporary
SQL contains only public guideline facts, never student data or credentials, and
is removed in finally. Wrangler disk logs are disabled. No new bindings/schema.

Pre-change production audit: 3826 rows, matched 2663, review 1163, proposed mapping
changes zero. Student/university/case/award/settings preservation hashes recorded
in the execution evidence; no raw payload retained. Actual enrichment/deployment
results must be recorded on the PR, not inferred from this implementation note.

## Verification

Synthetic tests cover four-per-page, source-link correspondence, filters/career
reset, five viewport sizes, keyboard/close/escape, malicious text escaping,
source URL/timestamps, public-only fields, priority, null preservation and real
Miniflare D1 guarded updates. Existing gallery 77 browser checks are rerun.
No existing real student, guardian, university, award or file is used as a CRUD
fixture; production visual reads do not mutate those domains.
