# Campus / Library Presentation

## Single Display Source

`worker/campus-directory.ts` owns display names/order separately from legacy names, IDs, account provisioning and the existing directory array index. Authorized `/api/data-core/campuses` results are presented after permission filtering. The library API resolves the same names for roots and breadcrumbs. Context, presence, accounts, record and file labels reuse the mapping. Presence retains its existing online/activity sorting.

| Order | Display name | Existing ID |
| --- | --- | --- |
| 1 | 부천 디자인 입시본원 | campus-design-admission |
| 2 | 부천 애니 입시본원 | campus-anihi-admission |
| 3 | 부천 범박 캠퍼스 | campus-beombak |
| 4 | 부천 원종 캠퍼스 | campus-wonjong |
| 5 | 부천 중동 캠퍼스 | campus-jungdong |
| 6 | 부천 옥길 캠퍼스 | campus-okgil |
| 7 | 서울 광진 입시본원 | campus-gwangjin |
| 8 | 울산 송정 입시본원 | campus-ulsan |
| 9 | 안산 입시본원 | campus-ansan |
| 10 | 파주 입시본원 | campus-paju |

Unknown real campuses remain after the known list in stable source order. No title-substring hiding: a legitimate name containing TEST must not disappear. No campus, role, membership, password or original file is modified by this projection. No migration.

## Shared Folder Browser

Library, Blog and Instagram all use existing `/api/data-core/library/folders` and `/files` through `library-client.js`. `folderGroups` retains API names/order and renders HQ work, campuses and actual user-created folders consistently. Nested folders use the same stored parent IDs and breadcrumb data. The first four HQ folders and nine campus categories are the existing projections, not recreated folders. Campus roots use a single ordered group so older admissions/preparatory grouping cannot reorder the requested sequence. Each UI retains its purpose-specific actions (library upload vs. image selection); image-only filtering, selection, scopes and defaults are unchanged.

## Read-only Production Inventory

September 14 KST: SELECT-only inspection found 10 real active campuses and the exact retired `campus-synthetic-acceptance-20260909` campus named `SYNTHETIC TEST 20260909`. Matching test records were already trashed: 3 blog drafts, 2 Instagram drafts, 1 competition folder and 1 library folder. No active records matched the reserved TEST_/VERIFY_/SYNTHETIC_ prefixes, the inspected synthetic title prefixes, explicit `metadata_json.testOnly`, or the retired campus. Its 3 file_objects were already trashed; their original synthetic provenance cannot be assumed from campus ownership alone.

One existing account is linked to this retired campus. Its account-list row is hidden by default with an explicit MASTER-only "보관된 검증 계정 보기" checkbox so administrators can still manage it. No account status, session or password is changed. Hide only this known retired campus from ordinary campus choices and root folder projections. Preserve its D1 row, memberships, trashed files, R2 objects and authorized deep links for recovery. No production DELETE/UPDATE, reset, seed or cleanup job was executed. Test fixtures and validation scripts remain in the repository and isolated Miniflare instances, not production UI seeds. Trash is an intentional administrator recovery surface and is not silently purged or title-filtered.

## Verification

Local checks passed: npm ci, build, typecheck, all 64 public JS syntax checks, 380 tests and Wrangler dry-run. Changed-file ESLint comparison is 16 inherited errors before / 15 after, zero new; full repository lint retains 89 errors. npm audit retains 12 findings (8 high, 4 moderate); dependencies were not changed. Windows loopback exhaustion during an overlapping verification attempt was resolved by stopping only the test processes, allowing connections to expire and rerunning the full suite alone.

Content AI synthetic workflow passed seven widths without live provider calls. Library browser regression passed six widths, upload/preview/download/soft-trash/restore/private-scope checks and 32 deployed asset comparisons. The campus/library comparison passed all seven widths with 44 public asset matches and the expected protected-account HTML login response. Browser screenshots are local artifacts under `outputs/campus-library-preview`; production login sessions were not available for authenticated live acceptance.

`tests/campus-presentation.test.mjs` exercises the built Worker with isolated D1/R2: exact 10-campus ordering/names, unknown real campus preservation, hidden legacy choice, permitted recovery deep links, server campus scope and cross-campus denial, unchanged campus/membership rows, real nested folders and common grouping/search.

`scripts/check-campus-library-browser.mjs` checks Library/Blog/Instagram/Attendance at 1920, 1440, 1280, 1024, 768, 390 and 320px, identical folder groups, all dropdown choices, nested navigation and campus-limited accounts. Optional `--preview <origin>` compares public static bytes with the checkout and separately verifies the expected login response for protected account HTML; APIs and fixture writes stay in isolated local D1/R2. The account screen's authenticated behavior uses local HTML and isolated APIs, not an authorization bypass for the deployed shell. This is not a claim of live production account acceptance. Deployment/CI and actual test results are recorded in PR evidence.
