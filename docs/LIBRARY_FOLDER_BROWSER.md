# Library Folder Browser

## Storage and Compatibility

`/data-core/work/library?folder=<id>` uses one browser for HQ, campus categories and nested folders. Breadcrumb links, parent navigation, browser history and refresh preserve the selected folder. Search is limited to that folder. Original filenames are retained.

- Existing `hq-library-folder` / `data-core-library` records are projected unchanged.
- Existing campus categories remain virtual roots. Reading does not create folders. The first upload materializes only its deterministic root ID.
- New `library-folder` records use existing `data_records.metadata_json`: `schemaVersion: 1`, `parentFolderId`, `campusId`, `libraryScope`, `category`, `libraryShareMode`. No new table, bucket, binding or migration.
- Children inherit server-resolved ancestry and scope. Up to 14 hierarchy levels; cyclic/deleted/malformed/cross-organization paths fail closed. No move/reparent API.
- Existing unlinked category files remain visible to their existing campus/owner scope. They are **not** silently converted into cross-campus shared files or rewritten.
- DB initialization caches are now scoped by D1 binding identity (the existing knowledge cache pattern). Initialization SQL itself is unchanged.

## API

All routes require an authenticated DATA CORE organization membership. Mutations require exact same-origin. Responses are private/no-store.

| Method | Route | Contract |
| --- | --- | --- |
| GET | `/api/data-core/library/folders?parentId=<id>` | Current folder, breadcrumb ancestors and authorized children; server-derived `canWrite`, `canDelete`, `readOnly` |
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
