# Codex next UI polish package

기준일: 2026-09-07

`docs/POST_MERGE_UI_AUDIT_2026-09-07.md`를 기준으로 다음 3개를 구현한다.

1. 자료보관함의 블로그소스/인스타소스 폴더가 실제 `sourceApp` 필터를 적용하도록 수정.
2. 공모전 우측 상세에 실제 DATA CORE 포스터/수상작 파일을 연결하여 썸네일/링크 표시.
3. 공모전 학원용 안내문을 버튼 → 편집 가능한 초안 → 복사 흐름으로 제공.

기존 DATA CORE, admissions, roadmap, content, readiness 기능과 권한 구조는 보존한다.

완료 시 `npm test`, `npx tsc --noEmit`, browser JS `node --check`, 관련 behavior test를 실행하고 PR을 생성한다.
