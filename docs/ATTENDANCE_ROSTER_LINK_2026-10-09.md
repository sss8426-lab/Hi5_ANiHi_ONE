# 출석부 ↔ 출석체크 연동 (2026-10-09)

## 무엇이 바뀌었나

1. **출석부를 만들면 출석체크 명단이 자동으로 바뀝니다.**
   업무 › 출석부에서 종합 출석부를 올리고 "반별 출석부 Excel 생성"을 누르면, Excel을 만드는 것과 동시에
   그 달의 반 · 학생 · 수업요일 · 학생/학부모 전화번호를 꿈이음 출석체크에 저장합니다(`PUT /api/kkumeum/attendance/roster`).
   같은 달을 다시 만들면 그 달 명단을 새것으로 바꿉니다.
2. **출석체크 "오늘 수업"**: 오늘 날짜의 요일(한국 시간)이 수업요일에 들어 있는 학생만 출석부의 반별로 보여줍니다.
   타임(1·2·3타임)도 함께 표시합니다. "이 달 명단 전체"로 그 달 출석부 전체를 볼 수 있고, 출석부에 없는
   꿈이음 학생은 맨 아래 따로 묶입니다.
3. **미등원 표시와 전화 버튼**: 오늘 수업인데 아직 아무 출결도 기록되지 않은 학생은 "미등원"으로 표시하고
   "미등원만" 버튼으로 모아 볼 수 있습니다. 각 학생 오른쪽의 **학생 / 학부모** 버튼은 `tel:` 링크라서
   휴대폰에서 누르면 바로 전화가 걸립니다. 번호가 없으면 흐리게 표시됩니다.
4. **공휴일·휴무**: 출석부와 같은 업무 캘린더의 공휴일·휴무(공휴일 수업 예외 포함)를 확인해, 쉬는 날에는
   안내 문구를 보여주고 미등원 표시를 하지 않습니다. 그래도 출석체크는 할 수 있습니다.

## 어떤 달의 출석부를 쓰나

- 오늘이 속한 달의 출석부가 있으면 그것을 씁니다.
- 없으면 가장 최근 지난달 출석부, 그것도 없으면 가장 가까운 다음 달 출석부의 수업요일을 쓰고 화면에 그 사실을 알립니다.
  (예: 10월 말에 11월 출석부만 만든 경우)

## 학생 연결 규칙 (꿈이음 학생과 출석부 이름)

- 출석부 이름과 같은 이름(공백 무시)의 **재원 중(active)** 꿈이음 학생이 한 명이면 그 학생으로 연결합니다.
- 같은 이름이 여러 명이면 꿈이음의 현재 반 이름이 출석부 반 이름과 같은 학생으로 연결합니다. 그래도 정할 수 없으면
  "동명이인 확인 필요"로 남기고 체크할 수 없게 둡니다(전화 버튼은 동작).
- 같은 이름의 학생이 휴원·퇴원 상태로만 있으면 새로 만들지 않고 "꿈이음 휴원 상태"로 알립니다.
- 꿈이음에 없는 학생은 출석부 저장 때 **새로 등록**합니다(이름·학교·학년·반). 없는 반도 만듭니다.
  기존 학생의 이름·반·상태는 바꾸지 않습니다(추가만 함).
- 한 출석부 안에서 같은 이름이 두 반에 있으면, 학부모 번호가 같거나 비어 있을 때는 한 학생(두 반 수강)으로,
  학부모 번호가 다르면 서로 다른 학생으로 봅니다.

## 권한과 개인정보

- 명단 저장(학생 등록 포함): 슈퍼관리자 또는 해당 캠퍼스 원장·관리자(`CAMPUS_DIRECTOR`/`CAMPUS_ADMIN`)만.
  교사가 출석부를 만들면 Excel은 그대로 만들어지고, 연동만 안 된다는 안내가 나옵니다.
- 출석체크 조회: 원장·관리자는 그 달 명단 전체, 교사는 자신이 볼 수 있는 학생(배정 반)과 연결된 행만 받습니다.
  전화번호도 같은 범위에서만 응답에 들어갑니다.
- 전화번호는 숫자·`+`·`-`·공백만 저장하고, 명단은 FAMILY_DB `family_attendance_rosters`(캠퍼스·월 단위 1행)에 둡니다.
- 꿈이음 파일럿 캠퍼스 제한(`assertKkumeumPilotCampus`)은 기존 출석체크와 똑같이 적용됩니다.

## API

- `PUT /api/kkumeum/attendance/roster` — body `{campusId, month:'YYYY-MM', sourceName, classes:[{name, students:[{no,name,school,grade,studentPhone,parentPhone,slots:['월1','토2',…]}]}]}`
  → `{month, classes, students, created:{classes, students}, unmatched:[{name,className,reason}]}`. same-origin만 허용.
- `GET /api/kkumeum/attendance/roster?campusId=` — 저장된 달 목록 `{rosters:[{month,sourceName,students,updatedAt}], canSave}`.
- `GET /api/kkumeum/attendance?campusId=` — 기존 응답에 `schedule`이 추가됨(출석부가 없으면 `null`):
  `{month, exact, sourceName, updatedAt, weekday, todayCount, classes:[{name, students:[{key,name,studentId,unmatched,today,times,slots,studentPhone,parentPhone,events}]}]}`.

## 확인

- `tests/kkumeum-attendance-roster.test.mjs`: 저장 권한, 기존 학생 연결·누락 학생 등록·재저장 무변화, 오늘 요일 필터와 타임,
  전화번호, 출결 표시, 출석부 없음, 미배정 교사 범위, UI 계약.
