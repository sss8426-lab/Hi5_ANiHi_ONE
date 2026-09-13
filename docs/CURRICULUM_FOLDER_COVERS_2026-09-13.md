# 커리큘럼 폴더 전용 표지

## 범위

- content 기초 24 / 심화 21 / 입시 3, 총 48개 수업 폴더.
- 각 폴더의 반복 타이틀 페이지를 제외한 앞·중간·후반 3장, 총 144장을 검토했다. D: 파일 fingerprint와 중앙의 현재 curriculum-page fingerprint가 일치하는지 읽기 전용 확인 후 참고했다.
- 새 표지는 OpenAI imagegen으로 폴더별 독립 제작한 교육 주제 일러스트다. 실제 학생 작품이나 추가 교재 페이지로 주장하지 않는다. 원본 그림을 교체하거나 식별 가능한 기존 캐릭터를 복제하지 않는다.
- design에는 실제 수업 폴더가 없으므로 가짜 폴더/수업을 추가하지 않는다.

## 중앙 저장 및 보존

- 기존 FILES에 content-addressed WebP 파일을 추가한다. 새 bucket, table, migration 없음.
- file_objects: source_app=curriculum, category=curriculum-cover, area=documents-private, organization visibility, campus NULL, data_record_id=기존 폴더 ID.
- 폴더 metadata의 coverFileId와 cover(참고 page IDs/fingerprints, sourceFingerprint, 생성 방식, asset SHA256, 크기, alt, 이전 cover ID)를 추가한다.
- 기존 representativeFileId는 삭제하지 않고 fallback으로 유지한다. curriculum-page, 원본·preview·thumbnail·print 파일은 수정하지 않는다.
- 표지 파일은 출력 페이지에 포함하지 않는다. 기존 926장 및 페이지 순서/인쇄 URL을 보존한다.
- 인증된 조직 사용자만 같은-origin file API로 읽는다. 폴더와 상위 폴더가 유효해야 하며 campus 사용자는 공용 curriculum 수정/삭제가 불가하다.
- 기존 표지가 soft-trash되거나 이미지 로딩이 실패하면 기존 대표 미리보기로 대체한다. 교체 전 표지 객체는 삭제하지 않는다.
- importer는 표지 metadata를 유지하고 페이지의 4종 파일만 count/verify한다. 진행 callback 없이 verify 호출 시의 기존 집계 오류도 수정했다.

## 이미지 규격

- 640 x 480, 4:3, WebP quality 84 (복잡한 펜화는 80/76까지 용량 조정), EXIF 제거, 파일당 상한 120 KiB.
- 첫 4개 eager/high priority, 이후 lazy. 확대 갤러리의 preview 우선/인접 캐시 동작은 그대로 유지한다.
- 로고/문자 중심 교재 표지 대신 학습할 그림 자체를 크게 배치한다.
- 공통 제작 지시: 밝은 종이 배경, 전문적인 graphite/ink/watercolor 그림, 제목/로고/워터마크 없음, 인물 작업실 사진 아님, 참고자료는 주제 근거로만 사용.
- 실제 최적화 파일/production mapping은 배포 후 중앙 file_objects와 폴더 metadata가 source of truth다. Git에는 제작 주제와 도구만 기록하고 대용량 원본/표지 파일을 정적 배포하지 않는다.
- 제작 결과: 48개, 합계 3,484,110 bytes, 평균 72,586 bytes, 최대 121,064 bytes. quality 84는 45개, 80은 1개, 76은 2개이며 실제 카드 화면에서 선명도/내용을 검수했다.

## 관리 절차

```powershell
node scripts/prepare-curriculum-covers.mjs
# imagegen: plan.json의 referencePath를 참고하여 key별 PNG 제작
node scripts/publish-curriculum-covers.mjs --prepare
node scripts/publish-curriculum-covers.mjs --preview
# 코드 CI / Preview 검증 및 production 배포 후:
node scripts/publish-curriculum-covers.mjs --apply
node scripts/publish-curriculum-covers.mjs --verify
```

- 기본 출력: outputs/curriculum-covers (gitignored).
- preview는 원격 읽기 전용. apply는 사전 fingerprint/metadata 검사, 신규 객체 업로드, file identity 확인 후 폴더 metadata CAS로 연결한다.
- 동일 asset skip, 동시 수정 감지 시 중단, 재실행 전 preview 갱신. 이전 cover 원본의 영구삭제 기능은 없다.
- 검증은 cover 48개 R2 hash와 전체 curriculum-page/기존 file_objects digest 보존을 비교한다. 기존 926개 R2 원본을 다시 쓰거나 일괄 변환하지 않는다.
- tests/curriculum-covers.test.mjs: Miniflare 합성 데이터만 사용. 권한, 비로그인 차단, fallback, idempotence, 동시 수정, 재import, source PC 제거, 기존 원본 byte 보존.
- check-curriculum-library-browser.mjs: 슬라이드·원본 확대·인쇄 회귀, 표지 fallback.
- check-curriculum-covers-browser.mjs: 실제 생성 48개 파일 + 격리된 합성 API로 1920/1440/1280/1024/768/390/320 검사. 실제 운영 로그인 검증으로 혼동하지 않는다.
- production 반영/검증 결과는 PR evidence 및 publish-verification.json과 구분한다.
- 로컬 검증: npm ci/build/tsc, 60개 public JS 구문검사, 전체 369 tests, 신규 파일 lint, wrangler dry-run 통과. 48개 실제 표지를 7개 width에서 표시하고 48개 폴더 클릭 확인. 슬라이드/인쇄 회귀는 3과정 x 6개 width 통과. npm ci의 기존 dependency 경고 12개(4 moderate / 8 high)는 이번 범위에서 의존성 변경 없이 유지했다.

## 폴더별 제작 주제

| 제작 키 | 실제 폴더 | 시각 주제 |
|---|---|---|
| basic-01 | 1-1얼굴기초-눈의구조 | Eye structure: one large graphite eye with eyelid volume and iris, accompanied by two smaller expressive webtoon eye studies. Eyes only, not a whole portrait. |
| basic-02 | 1-2얼굴기초-코의구조 | Nose structure: three large nose studies, front, three-quarter and side view; faint geometric planes beneath beautifully shaded graphite volume. Nose bridge, tip and nostrils clearly readable. No eyes or full portrait. |
| basic-03 | 1-3얼굴기초-입의구조 | Mouth structure: large carefully rendered lips with clear upper and lower lip volume, plus small side-view and smiling-mouth studies. Graphite structure lines with subtle natural rose watercolor accents. No full faces. |
| basic-04 | 1-4얼굴기초-귀의구조 | Ear structure: three large isolated ears at different angles, clear helix, antihelix and inner folds; one simplified plane study and one shaded anatomical drawing. Graphite and muted cool-blue construction lines. |
| basic-05 | 1-5얼굴기초 | Face proportions and angles: a neutral drawn head in front, side and three-quarter views, faint alignment guides for brows, nose and chin, clean measured facial structure. Study sheet rather than a person portrait. |
| basic-06 | 1-6 얼굴,헤어 | Hair construction: three sketched head forms showing hair masses, parting, flow and varied short and long hairstyles. Main focus is sculptural hair strands and volume, subtle teal construction underdrawing. |
| basic-07 | 2-1인체기초8등신 | Eight-head figure proportion: anatomically plausible simplified adult art mannequins in front, side and back view with eight faint horizontal proportion guides. Smooth nonsexual mannequin, no anatomical nudity detail, structure and balance are the focus. |
| basic-08 | 2-2등신비율.및 데포르메 | Body proportion and stylization: three original clothed character studies progressing from two-head chibi through five-head to eight-head proportion, all fully visible feet to head. Clear silhouette comparison and light construction lines, no text or numeric labels. |
| basic-09 | 2-3상체근육의 구조와 형태 | Upper-body muscle structure: a large non-graphic artist anatomy study of shoulders, chest, upper arms and back, two angles with simplified muscle masses softly color-coded teal, blue and warm rose. No blood, no cut tissue, no medical labels. |
| basic-10 | 2-4하체근육의 구조와형태 | Lower-body muscle structure: front, side and back artist studies of legs showing thigh, calf, knee and ankle volumes, softly differentiated muscle groups with confident graphite contours. Cropped below the hip, no groin or nudity detail. |
| basic-11 | 2-5근육의 흐림과 움직임 | Muscle flow and movement: three simplified upper-body artist mannequins bending and twisting, shoulder and torso masses changing with motion, faint curved gesture lines and restrained blue/rose anatomical construction. Non-graphic educational drawing. |
| basic-12 | 3-1동세와 흐름 전신스탠딩 | Full-body standing gesture: three original fully clothed character sketches in natural standing poses, clear weight on one leg, shoulder and hip tilt, full silhouette including feet. Graphite linework and light translucent clothing washes. |
| basic-13 | 3-2동세와 흐름포즈와 균형 | Pose and balance: energetic figure drawing studies of fully clothed figures reaching, lunging and turning, clear line of action and center of gravity, expressive charcoal strokes, restrained red gesture arcs. Entire bodies visible. |
| basic-14 | 3-3동세와 흐름 크로키 | Croquis: lively economical charcoal gesture sketches of clothed dancers or moving figures, one dominant sweeping full-body pose and two smaller quick studies. Loose decisive line and a few muted watercolor strokes, not a photograph. |
| basic-15 | 4-1손발 기초 손의 구조와 형태 | Hand structure: one large open hand with five anatomically correct fingers, a side hand and a curled grasp study, clear palm blocks, knuckles and finger joints in graphite with faint geometric construction. Hands are the whole subject. |
| basic-16 | 4-2손발 기초 발의 구조와 형태 | Foot structure: two large anatomical artist foot studies, side and three-quarter view, plus a simplified geometric foot block. Correct heel, arch and five toes, graphite volume and subtle blue construction, feet only. |
| basic-17 | 5-1옷주름의 발생원리와 표현 | Clothing folds: a prominent draped shirt sleeve bending at the elbow and a hanging piece of cloth, clearly showing tension, compression and flowing folds; graphite shading with muted blue fabric wash. Focus on cloth, not faces. |
| basic-18 | 5-2 계절별 직군별 차이 | Season and occupation clothing: original fashion study sheet comparing light summer outfit, structured winter coat and martial-arts training uniform on simple faceless mannequins. Distinct silhouettes and fabric weight, clothes fill the image. |
| basic-19 | 5-3 캐릭터별 차이 | Character costume differences: two original fantasy and science-fiction costume designs on faceless mannequin forms, one layered traveling cloak and light armor, the other technical jacket with protective equipment. Costume shapes, materials and accessory details are the focus. |
| basic-20 | 5-4 전통복식 | Traditional costume: elegant Korean hanbok clothing studies with jeogori, flowing chima and a long men's robe, original faceless fashion mannequins, accurate layered garment silhouettes and delicate fabric folds. Muted red, sage and ink-blue watercolor with graphite. |
| basic-21 | 5-5모자의 종류와표현 | Types of hats: large clearly arranged drawn studies of a cap, beret, fedora and traditional Korean gat, different viewing angles reveal crowns, brims and perspective ellipses. No heads needed, graphite and subtle color accents. |
| basic-22 | 5-6 캐릭터 포즈및 턴어라운드 | Character turnaround: the SAME original clothed student-adventure character in consistent front, side and back views, faint alignment lines, matching height, clothing and accessories. Design model sheet, full bodies, no text. |
| basic-23 | 5-7캐릭터 포스터 | Character poster composition: one original dynamic fully clothed webtoon character in a strong diagonal pose, layered graphic shapes and expressive color, secondary small figure silhouette, blue and coral palette. Finished illustrated poster artwork without any lettering. |
| basic-24 | 6.수채화 기초 | Watercolor foundations: a luminous small landscape watercolor with layered sky, trees and water, nearby painted washes and wet-on-wet color transitions incorporated into the composition. The artwork and brush textures dominate, no art supplies or people needed. |
| advanced-01 | 7-1.투시의 이해 - 빛과 그림자의 이해 | Light and shadow: a drawn room corner with one window casting clear diagonal sunlight onto geometric forms and the floor. Distinguish lit planes, form shadow and cast shadow, bright high-key overall, graphite structure and restrained warm/cool watercolor. |
| advanced-02 | 7-2.투시의 이해 - 1점투시의 특징 | One-point perspective: straight-on view down a greenhouse corridor, all receding parallel lines converging to ONE central vanishing point, verticals stay vertical. Fine construction lines remain visible beneath green and blue environment concept painting. No dominant person. |
| advanced-03 | 7-3.투시의 이해 -2점 투시의 특징 | Two-point perspective: eye-level view of a city building CORNER with both facades receding toward two opposite horizontal vanishing points, vertical edges remain parallel and vertical. Clear urban architectural drawing with subtle watercolor and perspective guides. |
| advanced-04 | 7-4.투시의 이해 - 3점투시의 특징 | Three-point perspective: dramatic looking-up view between tall city buildings, vertical edges visibly converge upward toward the third vanishing point and the two facade directions recede left and right. Bright blue open sky, precise architectural sketch and lightly painted building planes, no person. |
| advanced-05 | 8-1펜터치연구 | Pen hatching research: impressive close-up ink drawing of a tree trunk, stone and foliage with cross-hatching, stippling and parallel-line textures visibly differentiated. A few small texture study patches, sophisticated black ink on white paper, no lettering. |
| advanced-06 | 8-2 펜터치 연구 실습 | Pen drawing application: a completed richly detailed monochrome ink illustration of a wooded path with an old stone arch, showing confident line-weight, cross-hatching and depth. This is a coherent finished scene rather than isolated texture samples. |
| advanced-07 | 8-3배경개체묘사도시.시골 | City and rural backgrounds: a single environment sketch composition transitioning from a detailed street corner with urban buildings into smaller rural houses and a quiet lane. Architecture and spatial depth dominate, pen linework with restrained daylight watercolor, no people. |
| advanced-08 | 8-4배경개체묘사 산.바다 | Mountains and sea backgrounds: luminous hand-painted coastal mountains, foreground waves with visible water reflections, layered distant hills and open sky. Environmental observation of rock, water and atmosphere, crisp drawing under watercolor, no people. |
| advanced-09 | 8-5배경개체묘사 정글.서부극.판타지 | Jungle, western and fantasy backgrounds: original fantasy frontier settlement beside lush jungle ruins, timber buildings and a stone gateway, abundant foliage and coherent environment design. Bright sunlit concept-art illustration, no recognizable existing franchise, no dominant figures. |
| advanced-10 | 8-5배경개체묘사 학교 | School backgrounds: a clean perspective drawing of a classroom with rows of desks and large windows, with a subtle secondary school exterior study. Well-defined doors, boards, furniture and daylight, no people, no writing on boards. |
| advanced-11 | 8-6배경개체묘사 SF.아포칼립스 | Science-fiction and post-apocalyptic environment: original futuristic city structures partly reclaimed by vines, exposed beams and damaged facades, a compact isometric building study in one corner. Bright daylight, clear environment-design drawing, no violence or people. |
| advanced-12 | 9-1동물의 구분.개그리기 | Dog drawing: one large graphite canine study in a standing pose with accurate limb and head proportions, accompanied by simple head-shape studies of two different dog breeds. Warm subtle fur washes, visible sketch structure, not a pet photograph. |
| advanced-13 | 9-2 고양이 그리기 | Cat drawing: a large graceful sketched cat stretching and two smaller sitting and turning gesture studies, readable feline spine, paws, shoulder and hip construction. Graphite with subtle warm fur color on white drawing paper. |
| advanced-14 | 9-3 말 그리기 | Horse drawing: a powerful original horse in side view and a smaller trotting study, clear leg joints, neck, shoulder and body proportions, faint skeletal construction beneath graphite and warm-brown wash. No rider. |
| advanced-15 | 9-4 조류 그리기 | Bird drawing: a large bird with spread wings, smaller folded-wing and feather-structure studies, accurate wing articulation, layered flight feathers and simple gesture construction. Graphite, restrained blue-gray watercolor, no text. |
| advanced-16 | 9-5 동물의 외피 | Animal surface studies: richly drawn close studies of scales, layered feathers and fur, with a small goldfish and feather demonstrating texture on form. Material and surface patterns are the focus, graphite plus selective gold and teal color. |
| advanced-17 | 9-6 합성과 활용 | Combining animal forms: an original gentle fantasy creature combining a feline body, deer-like horns and bird wings, with small construction studies showing how anatomical parts join coherently. Professional creature-design sheet, no violence, no existing franchise. |
| advanced-18 | 10-1.만화전공 | Comics specialization: an original polished color comic page with three clearly separated sequential panels, expressive clothed characters and coherent visual storytelling. A small visible graphite thumbnail-composition strip, no speech lettering, no logos, no copied characters. |
| advanced-19 | 10-2.애니전공 | Animation specialization: original animation model and acting sheet showing the same appealing clothed character in three sequential running poses and three small facial-expression sketches, a tiny storyboard strip below. Motion and consistency, not a static poster, no writing. |
| advanced-20 | 10-3.게임전공 | Game specialization one: original fantasy game character concept sheet with front and side costume studies plus distinct equipment and prop designs. Rendered material, silhouette and character identity stand out; no UI screenshot and no existing game character. |
| advanced-21 | 10-3.게임전공2 | Game specialization two: original isometric fantasy building/environment design with modular props and a neat small set of jewel-colored ability icons. Spatial game assets, interface icon language and environment layout, no dominant character or lettering. |
| admission-01 | 24상황표현-고1 | High-school first-year situation-expression preparation: an original colorful narrative drawing of clothed teenagers collaboratively carrying art materials through a lively school courtyard, simple clear action and balanced composition; a small faint preliminary compositional sketch integrated at the edge. Emphasize basic staging and color relationships, not a portrait. |
| admission-02 | 24상황표현-고2 | High-school second-year situation-expression preparation: original dynamic narrative illustration of several clothed characters responding to wind scattering drawings in a well-constructed interior, clear perspective, expressive body poses, foreground-middle-background separation and stronger dramatic lighting. No danger, no text, no existing franchise. |
| admission-03 | 24상황표현-고3 | High-school third-year situation-expression final practice: original richly finished watercolor-and-gouache narrative composition of a fantastical festival workshop, multiple clothed characters cooperating among imaginative oversized art objects, sophisticated perspective, controlled color and focal hierarchy. A cohesive complete entrance-exam artwork, no lettering, no reproduced reference character. |
