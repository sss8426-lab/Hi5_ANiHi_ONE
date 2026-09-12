# Reviewed Admissions Campus Locations

Checked 2026-09-12. No university/student JSON, guideline mappings, DB schema or R2 object is changed.

## Contract

Reuse the existing per-program `campusLocation` contract. `campus-locations.js` is a reviewed read-only presentation registry, resolved by exact school identity, explicit program name, reviewed academic year (2026/2027), and non-conflicting campus. It does not attach main-campus coordinates using only school names. Existing explicit metadata, including needs_review, is not overridden. Missing or conflicting identities stay needs_review/unknown; future years require review. Existing Haversine Seoul City Hall constant remains only in `counseling-ux.js`.

Each entry includes campus, WGS84 latitude/longitude, official location URL, program-location evidence URL, status, verifiedAt/updatedAt, supported program names and years. This is not an admissions eligibility or cutoff change. Guidelines and imported numeric fields are untouched.

## Verified Evidence

- [Kookmin official Bukak campus building directory](https://www.kookmin.ac.kr/user/unIntr/campusGuide/bukakCampusGuide/index.do): hidden `wid`/`hei` coordinates are paired with each building and its department list. N3 조형관 `37.612173,126.997656` explicitly lists 금속공예/도자공예/공간디자인/공업디자인/시각디자인/의상디자인. N5 형설관 `37.611484,126.998562` lists 영상디자인 and 자동차·운송디자인. N2 북악관 `37.612268,126.99688` lists AI디자인. This verifies teaching buildings, not an assumed main-campus centroid. Stored `자동차.운송디자인학과` is the explicitly reviewed punctuation variant; no general suffix/fuzzy matching is enabled.
- [SeoulTech official directions](https://www.seoultech.ac.kr/intro/campinfo/location/) embeds Kakao roughmap key `x8qa`, timestamp `1582693254251`, school marker `placeX=517108,placeY=1147856`. Its loaded map SDK `Coords.toLatLng()` gives `37.63186482205055,127.07752602092229`. Use the active school marker, not the commented airport/directions map or arbitrary map center. [Official college/program directory](https://www.seoultech.ac.kr/univ/univ/mol/intro) and [design department location](https://design.seoultech.ac.kr/introduction/department) establish the Gongneung address and programs. Stored 산업디자인학과/시각디자인학과 are deliberately NOT automatically equated with the official 전공 labels; those remain review.

## Pending Evidence

Chungkang official directions establishes an address but this pass did not establish a numeric campus marker. Kaywon's English directions contains a Google map viewport, not a separately verified marker; do not treat its center as an exact campus coordinate. Hansung and Hanyang ERICA program identities/markers need further exact reconciliation. No estimate was inserted. Remaining schools without reviewed source work are unknown.

## Coverage

Read-only `node scripts/audit-campus-locations.mjs --remote-read-only` reads legacy state only in memory and emits counts/fingerprints, never raw student or admissions payloads.

2026-09-12 snapshot:

| Scope | Program rows | Distinct stored school-name identities | verified rows | needs_review rows | unknown rows |
|---|---:|---:|---:|---:|---:|
| Whole existing catalog | 3915 | 291 | 20 | 162 | 3733 |
| Checked, not hidden candidates | 1616 | 269 | 8 | 56 | 1552 |

Two schools have verified program locations. School-name identities include existing aliases; they are not a claim of 291 distinct institutions. Counts are per-program, because one school can have both verified and unresolved programs. Coverage remains limited and must not be described as complete TOP30 geographic coverage. More official per-program reviews can extend this registry without rewriting operating data.
