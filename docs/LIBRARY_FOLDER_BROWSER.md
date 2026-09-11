# Library Folder Browser

## Storage and Compatibility

`/data-core/work/library?folder=<id>` uses one browser for HQ, campus categories and nested folders. Breadcrumb links, parent navigation, browser history and refresh preserve the selected folder. Search is limited to that folder. Original filenames are retained.

- Existing `hq-library-folder` / `data-core-library` records are projected unchanged.
- Existing campus categories remain virtual roots. Reading does not create folders. The first upload materializes only its deterministic root ID.
- New `library-folder` records use existing `data_records.metadata_json`: `schemaVersion: 1`, `parentFolderId`, `campusId`, `libraryScope`, `category`, `libraryShareMode`. No new table, bucket, binding or migration.
- Admin-created top-level folders use `parentFolderId: null`, `libraryScope: organization`, `systemManaged: false`, `createdFrom: library-root`; their descendants inherit organization scope. Root POST accepts null/omitted/`root` parent and stamps canonical metadata server-side. Client metadata, campus and owner flags are ignored.
- The common/organization card is no longer projected on the root screen. Existing organization category deep links remain compatible and do not create or delete organization data.
- The exact historical acceptance campus projection `campus-synthetic-acceptance-20260909` is omitted only from the library root list. The campus object, direct links, permissions and original files are preserved. This is not a name-based filter or a data cleanup initializer.
- Children inherit server-resolved ancestry and scope. Up to 14 hierarchy levels; cyclic/deleted/malformed/cross-organization paths fail closed. No move/reparent API.
- Existing unlinked category files remain visible to their existing campus/owner scope. They are **not** silently converted into cross-campus shared files or rewritten.
- DB initialization caches are now scoped by D1 binding identity (the existing knowledge cache pattern). Initialization SQL itself is unchanged.

## API

All routes require an authenticated DATA CORE organization membership. Mutations require exact same-origin. Responses are private/no-store.

| Method | Route | Contract |
| --- | --- | --- |
| GET | `/api/data-core/library/folders?parentId=<id>` | Current folder, breadcrumb ancestors and authorized children; server-derived `canWrite`, `canDelete`, `systemManaged`, `readOnly` |
| POST | `/api/data-core/library/folders` | `{parentFolderId,title}`; trimmed 1-80 characters, duplicate sibling name 409, created folder 201 |
| DELETE | `/api/data-core/library/folders/:id` | Soft-delete empty physical folder only; any child or registered file (including trash) blocks with 409 |
| GET | `/api/data-core/library/files?folderId=<id>&q=<text>&page=1` | Current-folder files only, 50/page, `hasMore`; authenticated preview/download URLs |
| POST | `/api/data-core/library/files` | Multipart `file`, `recordId`; server overwrites campus/category/owner/source based on verified folder; existing upload implementation |
| GET/HEAD | `/api/data-core/library/files/:id` | Authorized image/PDF/plain-text inline; other MIME types attachment, sandbox/nosniff |
| GET/HEAD | `/api/data-core/library/files/:id/download` | Same authorization, attachment with original UTF-8 filename |
| DELETE | `/api/data-core/library/files/:id` | Existing recoverable soft-trash; never R2 deletion |

`/api/data-core/trash/files/:id/restore` remains the existing restore workflow and checks library ancestry/write permission. A trashed registered file intentionally prevents deleting its folder, so restoration retains its location.

## Permission Boundary

- SUPER_ADMIN: existing organization-wide access and mutations.
- Root create/delete is SUPER_ADMIN-only. The UI exposes a root new-folder button and small custom-folder menu only when the server grants permission. Anonymous API access is 401; director/teacher/staff root mutations are 403.
- Virtual/system roots, campus roots, existing HQ default folder keys and metadata `system`/`systemManaged` roots cannot be deleted even by SUPER_ADMIN. This does not block permitted file management inside them. Only empty custom folders can be soft-deleted; active children or any linked registered file, including trash, yield 409 with no R2 cascade.
- CAMPUS_DIRECTOR: own-campus folder/file mutations; other campus shared read/download only.
- TEACHER/STAFF: own-campus create/upload; delete only own files/folders, preserving ownership rules. Foreign shared read/download only.
- HQ writes remain admin-only. Existing HQ visibility is preserved, including existing organization-visible `director-only`. A missing director-only root defaults to restricted and is not newly exposed to staff.
- Cross-campus sharing requires actual `file_objects.data_record_id` -> reserved folder -> complete valid ancestry, same organization/campus/category, `libraryShareMode=organization`, server-stamped `source_app=data-core-library`, non-private visibility and allowed DATA CORE area.
- Student artwork, class photos and counseling categories do not receive new cross-campus sharing. Owner-private, admissions student and FAMILY data do not receive any expanded access.
- Generic file list foreign-campus 403 (#166) is unchanged. Generic record APIs cannot create/retype/reparent reserved library folders. Generic file reads and Instagram derivative provenance cannot bypass restricted/deleted library ancestry.

## Verification

`tests/data-core-library-browser.test.mjs` runs the real built Worker against ephemeral Miniflare D1/R2 fixtures. It covers all four staff roles, anonymous/outsider, eight nested levels, Unicode, search/isolation, lineage forgery/cycles, foreign read versus mutation, private/FAMILY exclusion, HQ compatibility, soft-trash/restore and original bytes.

`scripts/library-browser-smoke.mjs` drives real browser clicks against the same isolated Worker APIs. `PLAYWRIGHT_MODULE` may point to an installed Playwright module; `PLAYWRIGHT_CHANNEL` defaults to Chrome. `--preview <url>` also verifies fetched Preview static bytes match this checkout. All mutation requests still go only to ephemeral local D1/R2, never Preview production bindings. Runs at 1920/1440/1024/820/390/320 and writes ignored synthetic screenshots/results to `outputs/`.

Local verification: npm ci, build, TypeScript noEmit, all 46 public JS syntax checks, 289/289 full tests, Wrangler dry-run and six-width browser traversal passed. CI/Preview/production evidence is recorded on the PR after deployment; these local results alone are not a production acceptance claim. No real account, student or file fixture was used.

## Root Controls Follow-up to #185

`tests/data-core-library-root.test.mjs` adds root role matrices, canonical metadata/forgery checks, custom child sharing, system-default protection, empty soft-delete, active/trash-file blocking, and projection removal without persistence changes. The browser harness also checks admin menu create/delete, director/teacher/staff hidden controls, refresh/history/role-change non-reappearance and mobile menu overflow.

Follow-up local checks passed: npm ci, build, TypeScript, all 46 public browser scripts, 296/296 full behavior tests, Wrangler dry-run and six-width browser smoke. Preview and production verification are recorded separately on the follow-up PR.

New synthetic folder fixtures use `__synthetic_*`. The server stamps `testOnly: true` for this reserved fixture prefix and descendants; this flag never grants access or authorizes deletion. Automated fixtures exist only in ephemeral Miniflare D1/R2, disposed in `finally`. A production smoke may create one empty prefixed custom root and must soft-delete that exact ID after validation.

Read-only production inspection on 2026-09-11 found **zero active library folder records** with the requested legacy test title. The visible item is instead a campus projection, with **zero active library child folders and three linked, already-trashed file objects**. Those files belong to a previously trashed competition folder, have no test-only metadata or tags, and `sourceApp` alone does not establish synthetic provenance. **No file metadata, R2 object, competition folder or campus is deleted.** Permanent cleanup remains blocked pending positive provenance; hiding the requested projection is separate from physical data deletion. The 10 actual campus projections remain present.
