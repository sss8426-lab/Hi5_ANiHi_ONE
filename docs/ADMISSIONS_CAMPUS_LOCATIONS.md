# Reviewed Admissions Campus Locations

Updated 2026-09-14; existing September 12 reviews retain their original dates. No university/student JSON, guideline mappings, DB schema or R2 object is changed.

## Contract

Reuse the existing per-program `campusLocation` contract. `campus-locations.js` is a reviewed read-only presentation registry, resolved by exact school identity, explicit program name, entry-specific reviewed academic year, and non-conflicting campus. It does not attach main-campus coordinates using only school names. Existing explicit metadata, including needs_review, is not overridden. Missing or conflicting identities stay needs_review/unknown; unreviewed years require review. Existing Haversine Seoul City Hall constant remains only in `counseling-ux.js`.

Each entry includes campus, WGS84 latitude/longitude, official location URL, program-location evidence URL, status, verifiedAt/updatedAt, supported program names and years. This is not an admissions eligibility or cutoff change. Guidelines and imported numeric fields are untouched.

## Verified Evidence

- [Kookmin official Bukak campus building directory](https://www.kookmin.ac.kr/user/unIntr/campusGuide/bukakCampusGuide/index.do): hidden `wid`/`hei` coordinates are paired with each building and its department list. N3 조형관 `37.612173,126.997656` explicitly lists 금속공예/도자공예/공간디자인/공업디자인/시각디자인/의상디자인. N5 형설관 `37.611484,126.998562` lists 영상디자인 and 자동차·운송디자인. N2 북악관 `37.612268,126.99688` lists AI디자인. This verifies teaching buildings, not an assumed main-campus centroid. Stored `자동차.운송디자인학과` is the explicitly reviewed punctuation variant; no general suffix/fuzzy matching is enabled.
- [SeoulTech official directions](https://www.seoultech.ac.kr/intro/campinfo/location/) embeds Kakao roughmap key `x8qa`, timestamp `1582693254251`, school marker `placeX=517108,placeY=1147856`. Its loaded map SDK `Coords.toLatLng()` gives `37.63186482205055,127.07752602092229`. Use the active school marker, not the commented airport/directions map or arbitrary map center. [Official college/program directory](https://www.seoultech.ac.kr/univ/univ/mol/intro) and [design department location](https://design.seoultech.ac.kr/introduction/department) establish the Gongneung address and programs. Stored 산업디자인학과/시각디자인학과 are deliberately NOT automatically equated with the official 전공 labels; those remain review.

## New Verified Evidence

### September 14 KUMA review

- [Official university directions](https://edu.pro.ac.kr/content/content05.do): the first map belongs to **한국영상대학교**, address **세종특별자치시 장군면 대학길 300**. Its initial `kakao.maps.LatLng(36.462172912634, 127.21061593393193)` is explicitly passed through `map.getCenter()` to `new kakao.maps.Marker({position: ...})` and `marker.setMap(map)`. This is the initial university marker, not merely a map viewport. The separate Ajou Automotive/Hyejeon maps on the same page are not used; neither are user-clicked marker positions.
- [2027 official admissions guide landing page](https://ipsi.pro.ac.kr/ipsi/rcrt/rcrtguidePage.do?mi=1197) links the [official 2027 PDF](https://ipsi.pro.ac.kr/upload/ad/rcrt/ipsi/775513_2027학년도%20신입생%20모집요강(입학홈페이지)%20(1).pdf). PDF pages 8/9 establish the same university address; PDF page 25 (printed page 47), visually inspected, lists the exact 2027 programs. `세종 장군면 캠퍼스` is a descriptive location label for this address, not a claim that the university advertises that exact campus brand name.
- Reviewed exact programs: 영상자율전공학과, 영상연출학과, 영상촬영조명학과, 영상편집제작학과, 음향제작학과, 영화영상학과, 영상디자인학과, 방송영상미디어학과, 미디어보이스학과, 애니메이션전공, 게임콘텐츠전공, VFX콘텐츠전공, 웹툰웹소설자율전공, 만화웹툰전공, 웹소설전공, 웹툰PD전공, 웹툰일러스트전공.
- Explicitly reviewed stored school aliases: `한국영상대학교`, `한국영상대`. **2027 only**; 2026/2028 and later years are not inferred. `_야간`, `웹툰애니자율전공`, `웹툰ㆍ웹소설 융복합계열` and older `학과` spellings are not silently equated to the listed `전공` names. Conflicting campus strings remain review. Existing Kookmin/SeoulTech entries and dates remain unchanged.

## Pending Evidence (Unchanged)

Chungkang official directions establishes an address but this pass did not establish a numeric campus marker. Kaywon's English directions contains a Google map viewport, not a separately verified marker; do not treat its center as an exact campus coordinate. Hansung and Hanyang ERICA program identities/markers need further exact reconciliation. No estimate was inserted. Remaining schools without reviewed source work are unknown.

## Coverage

Read-only `node scripts/audit-campus-locations.mjs --remote-read-only` reads legacy state only in memory and emits counts/fingerprints, never raw student or admissions payloads.

2026-09-12 snapshot:

| Scope | Program rows | Distinct stored school-name identities | verified rows | needs_review rows | unknown rows |
|---|---:|---:|---:|---:|---:|
| Whole existing catalog | 3915 | 291 | 20 | 162 | 3733 |
| Checked, not hidden candidates | 1616 | 269 | 8 | 56 | 1552 |

Two schools have verified program locations. School-name identities include existing aliases; they are not a claim of 291 distinct institutions. Counts are per-program, because one school can have both verified and unresolved programs. Coverage remains limited and must not be described as complete TOP30 geographic coverage. More official per-program reviews can extend this registry without rewriting operating data.

### September 14 follow-up

The before audit reproduced the September 12 counts above. After the KUMA review:

| Scope | Program rows | Stored school identities | verified rows | needs_review rows | unknown rows |
|---|---:|---:|---:|---:|---:|
| Whole catalog | 3915 | 291 | **67** | **183** | **3665** |
| Checked, not hidden candidates | 1616 | 269 | **44** | **77** | **1495** |

New coverage: **47 catalog rows / 36 checked candidate rows**, backed by **17 exact official program identities at one additional institution**. There are now **3 verified institutions**, represented by **4 stored school-name identities** (KUMA has two aliases). Schools with at least one needs_review program: **11 catalog / 10 checked identities**; schools with unknown programs: **280 / 259**. These school categories can overlap. More needs_review rows means previously unknown KUMA variants are now explicitly flagged, not falsely verified. Complete geographic coverage remains unfinished.

`node scripts/audit-campus-locations.mjs --remote-read-only --priorities` now adds aggregate candidate analysis using the existing dashboard recommendation declarations, with no app boot, private student profiles, probability changes or writes. It enumerates **75 existing track/practical-filter combinations** against the **1616-row recommendation pool**. This is reproducible filter-based frequency, **not observed user/individual-student TOP30 usage telemetry**, which is not available in this audit. TOP30 positions use the existing distance order and source-order ties.

Before-review priorities included 영산대 (279 candidate appearances), 경일대 (242), 동서대 (224), 한국영상대학교 (212), 동양대_동두천 (163), 대구대 (159), 국립공주대 (158); 상명대 had 95. KUMA was prioritized as a high-frequency webtoon/animation/game/design institution with exact official evidence. Its `한국영상대학교` alias appeared in TOP30 35 times before and 179 times after verification across those combinations; these are repeated row appearances, not unique students or institutions. Seoul/Gyeonggi sources including Chungkang, Kaywon and Sangmyung were also inspected, but unresolved marker/program proof was not replaced with guesses.

Read-only before/after fingerprints for students, universities, cases, awardFolders and settings were identical. Original admissions JSON, student files, R2 objects, account data and FAMILY were not modified. Six targeted location/audit tests cover exact programs/year/campus, alias counts, source-order ties, low-probability nearer campuses, unknowns last, existing explicit review metadata, filtered aggregate privacy and input immutability. Deployment and full-suite results are recorded in the corresponding PR evidence; local overlay counts alone are not production deployment proof.
