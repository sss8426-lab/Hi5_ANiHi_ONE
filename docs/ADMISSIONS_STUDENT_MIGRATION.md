# 기존 입시 학생 데이터 안전 병합

## 범위

`scripts/migrate-legacy-admissions-students.mjs`는 기존 입시컨설팅 JSON의
`students` 배열만 현재 `admissions-data.json`에 병합한다. 대학, 합격사례,
수상작 폴더 및 그 밖의 최상위 컬렉션은 대상 JSON을 그대로 유지한다.

## 안전 정책

- 기본 실행은 파일을 쓰지 않는 dry-run이다.
- `id`가 없는 학생, source 내 중복 `id`, target 내 중복 `id`는 모호한 항목으로
  분류해 자동 병합하지 않는다.
- 기존의 비어 있지 않은 필드는 유지한다. source의 값은 비어 있는 필드만 채운다.
- 보고서에는 개인 필드, 학생 이름, 식별자를 출력하지 않고 건수와 불투명 digest만
  출력한다.
- production 대상은 먼저 private R2 백업을 생성하고, 병합 결과를 별도 파일로
  검증한 뒤에만 업로드한다.

## 실행

실제 운영 JSON이나 백업 파일은 저장소에 넣거나 GitHub에 올리지 않는다.

```powershell
# 검토: 파일을 변경하지 않음
node scripts/migrate-legacy-admissions-students.mjs --source <legacy-export.json> --target <production-backup.json>

# 병합 결과를 새 private 파일에 작성
node scripts/migrate-legacy-admissions-students.mjs --source <legacy-export.json> --target <production-backup.json> --out <merged.json> --apply

# 백업을 복원 후보 파일로 복사하고 불투명 검증값만 출력
node scripts/migrate-legacy-admissions-students.mjs --restore --backup <production-backup.json> --out <restored.json>
```

병합 후에는 대상의 대학, 합격사례, 수상작 폴더 건수가 백업 전후 동일한지 확인한다.
