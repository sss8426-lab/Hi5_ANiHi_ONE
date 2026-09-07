# 꿈이음 아키텍처

## 목적

`꿈이음`은 HI5·ANiHi CORE의 업무용 모듈이며, 학생 작품·월간 성장평가·보호자 소식·학원 공지를 전 캠퍼스가 함께 사용하는 시스템이다.

핵심 원칙은 **CORE와 통합하되 학생·보호자 개인정보는 별도 보호영역으로 격리**하는 것이다.

## 제품 위치

업무용 홈:
- 자료보관함
- 블로그 자동화
- 인스타 자동화
- 꿈이음

상담용에는 노출하지 않는다.

권장 경로:
- `/data-core/kkumeum` 교직원 업무용
- `/kkumeum-family` 보호자 모바일/PWA

## 인프라

```text
Cloudflare account
├─ hi5-anihi-one Worker
├─ DB               기존 DATA CORE D1
├─ FILES            기존 일반 R2
├─ FAMILY_DB        꿈이음 전용 D1
└─ FAMILY_FILES     학생/보호자 전용 private R2
```

기존 DB/R2를 교체하거나 삭제하지 않는다. 꿈이음에서 학생 이름, 보호자 연락처, 월간평가 원문, 학생 작품 파일은 FAMILY_DB/FAMILY_FILES를 source of truth로 한다.

## 인증과 권한

내부 역할은 기존 CORE 역할을 재사용한다.
- SUPER_ADMIN: 모든 캠퍼스
- CAMPUS_DIRECTOR: 본인 캠퍼스 전체
- TEACHER: 배정된 반/학생
- STAFF: 허용된 공지/운영 기능

보호자 전용 역할:
- GUARDIAN: 연결된 자녀만 읽기

보호자 인증은 내부 직원 인증과 scope를 분리한다. 가족관계는 `student_guardians` 테이블에서 서버가 검증한다.

## 교직원 UX

`업무용 > 꿈이음` 진입 후:
1. 캠퍼스 선택(SUPER_ADMIN)
2. 반/상태 폴더
3. 학생 선택
4. 이번 달 작품 업로드
5. 교사 메모
6. 월간평가 작성 또는 AI 초안
7. 교사 검토/수정
8. 보호자 전달

AI 초안은 자동 전송하지 않는다.

## 보호자 UX

모바일/PWA 우선:
- 홈
- 우리아이
- 성장기록
- 소식
- 더보기

보호자 홈에는:
- 이번 달 작품
- 월간 평가
- 지난 성장기록
- 반소식
- 캠퍼스공지
- 전체공지
- 읽지 않은 알림

## 공지 유형

- 개별소식
- 반소식
- 캠퍼스공지
- 전체공지
- 선택전달

각 공지는 audience target을 별도 테이블로 관리해 특정 학생/반/보호자/캠퍼스/조직 단위로 전달한다.

## DATA CORE 연결

개인정보 원본은 일반 DATA CORE 검색에 넣지 않는다.

DATA CORE로 내보낼 수 있는 것은 필요 시 비식별/집계 데이터만 허용한다.
예:
- random student_ref
- 학년
- 전공/수업단계
- skill tag
- 성장지표 변화
- 수상/합격 결과 연결용 pseudonymous ref

이를 통해 장기적으로 수업단계와 성장, 공모전, 합격 데이터를 분석할 수 있다.

## 파일 정책

FAMILY_FILES는 기본 private.
- 영구 public URL 금지
- Worker read API에서 매 요청 권한 검증
- guardian→student 관계 검증
- staff→campus/class/student 권한 검증
- cross-campus 403
- guardian cross-child 403
- soft delete + audit
- 민감 파일을 service worker offline cache에 저장하지 않음

## PWA

1차는 responsive Web App + PWA.
- iPhone Safari
- Android Chrome
- 태블릿/PC
- 홈화면 설치

추후 App Store/Google Play가 필요하면 같은 API/UI를 Capacitor/native shell로 패키징할 수 있게 프런트와 API를 분리한다.

## 구현 단계

### Phase 1
- FAMILY_DB/FAMILY_FILES binding
- schema/migration
- 업무용 꿈이음 카드/route
- 반/학생 기본 CRUD
- staff permission

### Phase 2
- 작품 private upload/read
- 월간평가 draft/ready/sent
- 작품 갤러리
- AI 평가 contract

### Phase 3
- guardian auth
- child link
- 보호자 read-only feed
- PWA

### Phase 4
- 공지 targeting
- 읽음 확인
- push contract

### Phase 5
- 비식별 성장 데이터 DATA CORE sync
- 장기 분석

## 완료 기준

- 업무용 홈에 꿈이음 노출
- 상담용에는 미노출
- FAMILY_DB 기반 학생/반 화면
- private 작품 업로드/읽기
- 월간 평가 작성/전달
- 보호자 모바일 read-only MVP
- cross-campus / cross-child 접근 차단
- 기존 DATA CORE 회귀 테스트 통과
