# 꿈이음 교직원 반·학생 권한 보완 계약

## 발견한 구조 공백

꿈이음 기본 계약은 `TEACHER: 배정된 반/학생`만 접근하도록 정했지만, 최초 FAMILY_DB 스키마에는 **교직원↔반 배정 관계 테이블이 없었다.**

이 상태에서 단순히 기존 DATA CORE의 캠퍼스 membership만 사용하면 TEACHER가 같은 캠퍼스의 모든 학생을 볼 수 있게 될 수 있으므로, Phase 1 구현 전에 관계를 명시적으로 추가한다.

## FAMILY_DB 추가 테이블

```sql
CREATE TABLE IF NOT EXISTS class_staff_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  staff_user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'TEACHER',
  can_edit_reports INTEGER NOT NULL DEFAULT 1,
  can_manage_artworks INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (class_id) REFERENCES family_classes(id) ON DELETE CASCADE,
  UNIQUE(class_id, staff_user_id, started_at)
);

CREATE INDEX IF NOT EXISTS class_staff_assignments_staff_idx
  ON class_staff_assignments(staff_user_id, ended_at, class_id);
CREATE INDEX IF NOT EXISTS class_staff_assignments_class_idx
  ON class_staff_assignments(class_id, ended_at, staff_user_id);
```

`staff_user_id`는 기존 DATA CORE `users.id`의 stable external reference다. FAMILY_DB에서 기존 DB로 cross-database FK는 만들지 않는다.

## 서버 권한 계산

### SUPER_ADMIN
- 모든 캠퍼스/반/학생 읽기·쓰기 가능.
- 단, 학생·보호자 원본은 여전히 FAMILY_DB/FAMILY_FILES를 통해서만 접근한다.

### CAMPUS_DIRECTOR
- 기존 DATA CORE membership으로 본인 캠퍼스 확인.
- 해당 캠퍼스의 모든 반/학생 관리 가능.

### TEACHER
- 먼저 기존 DATA CORE membership에서 campus membership 확인.
- 이어서 FAMILY_DB `class_staff_assignments`에서 현재 활성 배정(`ended_at IS NULL`)을 확인.
- 학생 접근은 `family_students.current_class_id` 또는 활성 `class_enrollments`가 교사의 배정 class에 포함될 때만 허용.
- 같은 캠퍼스라는 이유만으로 모든 학생을 반환하지 않는다.

### STAFF
- 기본값은 학생 개인정보 읽기 불가 또는 명시적 최소 권한.
- 공지 업무가 필요하면 별도 permission/assignment를 확장한다.
- STAFF를 TEACHER와 동일하게 처리하지 않는다.

## 쿼리 원칙

목록 API가 전체 캠퍼스 학생을 먼저 조회한 뒤 JS에서 필터링하면 안 된다. SQL WHERE/JOIN 단계에서 접근 가능한 class/student 범위를 제한한다.

예시 개념:

```sql
SELECT s.*
FROM family_students s
JOIN class_staff_assignments a
  ON a.class_id = s.current_class_id
WHERE a.staff_user_id = ?
  AND a.ended_at IS NULL
  AND s.campus_id = ?
  AND s.status != 'deleted'
```

실제 구현에서는 반 이동 이력과 current_class_id 일관성을 함께 검증한다.

## 반 이동

학생 반 이동 시 한 transaction에서:
1. 기존 활성 `class_enrollments.ended_at` 설정
2. 새 enrollment 생성
3. `family_students.current_class_id` 갱신
4. audit 기록

교사가 새 반에 배정되어 있지 않으면 이동 직후 해당 학생 접근권한이 사라지는 것이 정상이다.

## 감사로그

추가 기록:
- class staff assigned
- class staff unassigned
- assignment permission changed
- student access denied (민감정보 원문 없이 resource id와 reason만)

## 테스트

필수 회귀 테스트:
1. TEACHER A가 본인 배정 반 학생 조회 200
2. TEACHER A가 같은 캠퍼스지만 미배정 반 학생 조회 403
3. TEACHER A가 다른 캠퍼스 학생 조회 403
4. CAMPUS_DIRECTOR는 본인 캠퍼스 전체 학생 가능, 타 캠퍼스 403
5. SUPER_ADMIN 전체 가능
6. STAFF는 명시적 권한 없으면 학생 개인정보 API 403
7. 교사 배정 종료 후 즉시 해당 반 학생 접근 403
8. 반 이동 후 이전 반 교사의 접근이 제거됨

이 계약은 `docs/KKUMEUM_FAMILY_DB_SCHEMA.sql`의 Phase 1 보완사항으로 취급한다.
