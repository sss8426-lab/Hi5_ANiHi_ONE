# 꿈이음 성장영역 표준 분류 v1

Canonical source: `docs/KKUMEUM_GROWTH_SKILL_TAXONOMY_V1.json`

Version: `kkumeum-growth-skill-v1`

## 목적

이 분류는 월간평가에서 교사가 **이번 달에 관찰하거나 지도한 성장 영역**을 일관된 코드로 선택하기 위한 계약이다. 학생의 능력을 점수화하거나 서열화하는 체계가 아니다.

기존 `monthly_reports.growth_points_json`은 자유형 object이므로 자동 변환하거나 analytics에 사용하지 않는다. 기존 보고서는 그대로 보존하고, 향후 구조화된 성장영역 저장은 별도 version/code 필드에 additive 방식으로만 적용한다.

## 사용 원칙

- 한 월간평가에서 최대 5개까지 선택한다.
- 자유입력 custom tag는 허용하지 않는다.
- 코드와 한국어 라벨은 taxonomy version 안에서 고정한다.
- 새 영역이 필요하면 기존 코드 의미를 바꾸지 말고 새 taxonomy version을 만든다.
- 동일 의미의 별칭을 analytics에서 별도 bucket으로 만들지 않는다.
- AI가 영역을 제안하더라도 canonical allowlist 안에서만 제안하고, 교사가 확인하기 전 자동 저장·전달하지 않는다.
- 이 분류를 학생/교사 순위, 등급, 경쟁지표로 사용하지 않는다.

## 대분류

### DRAWING_FOUNDATION — 드로잉 기초

- `form_observation` — 형태·관찰: 대상의 큰 형태, 구조, 실루엣을 관찰해 표현하는 영역.
- `proportion_accuracy` — 비례·정확도: 부분 간 크기·길이·위치 관계를 안정적으로 맞추는 영역.
- `line_control` — 선·필압 조절: 선의 방향, 속도, 굵기, 필압을 의도에 맞게 사용하는 영역.

### FIGURE_CHARACTER — 인체·캐릭터

- `figure_anatomy` — 인체 구조: 골격·덩어리·관절 관계를 이해해 인체를 구성하는 영역.
- `pose_motion` — 동세·포즈: 무게중심, 방향성, 움직임이 느껴지는 포즈를 설계하는 영역.
- `face_expression` — 얼굴·표정: 얼굴 구조와 감정 표현을 연결하는 영역.
- `hands_feet_clothing` — 손발·옷주름: 손발 구조와 몸의 움직임에 따른 옷주름을 표현하는 영역.

### SPACE_BACKGROUND — 공간·배경

- `perspective_space` — 투시·공간감: 1·2·3점 투시와 공간 축을 활용하는 영역.
- `background_environment` — 배경·환경: 장소·사물·환경 요소를 장면 목적에 맞게 구성하는 영역.
- `depth_staging` — 근경·중경·원경 구성: 화면 안 거리감과 레이어를 사용해 깊이를 만드는 영역.

### COMPOSITION_STORY — 구성·연출

- `composition_focus` — 구도·주제부 강조: 화면에서 중요한 정보와 시선을 명확히 배치하는 영역.
- `visual_flow` — 시선 흐름: 요소의 방향과 배치를 통해 보는 순서를 설계하는 영역.
- `panel_storytelling` — 컷 연출·스토리텔링: 컷의 크기·순서·연결을 사용해 내용을 전달하는 영역.
- `scene_staging` — 상황·장면 연출: 인물·소품·배경의 관계를 통해 상황을 읽히게 만드는 영역.

### COLOR_RENDERING — 색채·표현

- `value_light` — 명암·빛: 광원과 명도 관계를 이용해 입체감과 분위기를 만드는 영역.
- `color_harmony` — 색채·조화: 색상·채도·명도 관계를 의도에 맞게 조절하는 영역.
- `material_texture` — 질감·묘사: 재질 차이와 표면 특성을 표현하는 영역.
- `media_technique` — 재료·기법: 수채화, 디지털 브러시 등 사용 재료의 특성을 효과적으로 다루는 영역.

### IDEATION_CONTENT — 발상·콘텐츠

- `theme_interpretation` — 주제 해석: 제시된 주제의 핵심 의미와 조건을 파악하는 영역.
- `idea_development` — 발상·아이디어 전개: 초기 아이디어를 구체적 장면·설정으로 발전시키는 영역.
- `character_concept` — 캐릭터·콘셉트 설계: 목적과 설정에 맞는 캐릭터 시각언어를 만드는 영역.
- `content_understanding` — 전공·콘텐츠 이해: 웹툰·애니·게임·디자인 등 매체 특성과 표현 목적을 이해하는 영역.

### PROCESS_COMPLETION — 과정·완성

- `revision_feedback` — 수정·피드백 반영: 피드백을 이해하고 실제 결과물 수정으로 연결하는 영역.
- `planning_execution` — 계획·제작 진행: 제한 시간과 제작 단계를 나누고 작업을 진행하는 영역.
- `completion_consistency` — 완성도·일관성: 화면 전체의 밀도, 스타일, 마감 수준을 일관되게 유지하는 영역.

## analytics 연결 규칙

Phase 5A의 privacy boundary를 그대로 유지한다.

- `growth_points_json` 자유형 데이터는 계속 집계하지 않는다.
- 향후 tag analytics는 `taxonomyVersion === kkumeum-growth-skill-v1`인 canonical code만 집계한다.
- skill bucket도 최소 cohort 5명 규칙을 적용한다.
- 작은 bucket이 다른 total에서 역산되지 않도록 세부 breakdown 전체 suppression을 우선한다.
- 학생별 tag record를 DATA CORE에 생성하지 않는다.
- `KKUMEUM_ANALYTICS_SYNC_ENABLED`는 별도 운영 승인 전 계속 비활성 상태를 유지한다.

## versioning

v1 코드의 의미를 바꾸지 않는다. label의 단순 오탈자 수정 외에 의미 변경, 통합, 분할이 필요하면 v2를 만든다. 과거 report는 저장 당시 taxonomy version을 유지해 장기 분석에서 의미가 섞이지 않게 한다.
