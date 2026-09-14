# DATA CORE 자료보관함 대용량 디자인 파일 업로드

기준일: 2026-09-14

## 목적

자료보관함에서 Illustrator(`.ai`), Photoshop(`.psd`, `.psb`) 등 큰 원본 파일을 Worker의 단일 `multipart/form-data` 요청으로 전부 파싱하지 않고 Cloudflare R2 multipart upload로 저장한다.

기존 R2 원본, 기존 `file_objects`, 이미지 thumbnail 경로 및 일반 DATA CORE 업로드 정책은 변경하지 않는다.

## 경계

- `<= 50 MiB`: 기존 simple upload 경로 유지
- `> 50 MiB`: 자료보관함 전용 R2 multipart upload
- 자료보관함 전용 최대 파일 크기: `2 GiB`
- generic DATA CORE의 기존 `100 MB` 제한: 유지
- multipart chunk: `16 MiB`
- 브라우저 part 동시 업로드: 최대 `3`
- part는 `Blob.slice()`로 생성하고 Base64/전체 ArrayBuffer 복사를 하지 않는다.

## 파일 정책

허용 여부는 MIME 단일 값이 아니라 기존 실행파일 차단 정책을 기준으로 한다. `.ai`, `.psd`, `.psb`, `.clip`, `.eps`, `.pdf`, `.zip`은 opaque binary 자료로 저장할 수 있다.

계속 차단하는 확장자:

`exe`, `dll`, `bat`, `cmd`, `com`, `msi`, `scr`, `ps1`, `vbs`, `js`, `mjs`, `jar`

`.ai`의 MIME은 브라우저에 따라 `application/postscript`, `application/pdf`, 빈 문자열 등이 될 수 있다. 빈 값 또는 비정상 MIME은 `application/octet-stream`으로 저장한다. 원본 파일명은 `file_objects.original_file_name`에 보존한다.

`.ai/.psd/.psb/.clip/.eps/.zip`은 native preview 또는 thumbnail decode 대상이 아니다. 특히 `.ai`가 `application/pdf`로 들어와도 inline preview하지 않고 attachment로 다운로드한다.

## API

### 업로드 시작

`POST /api/data-core/library/uploads`

```json
{
  "folderId": "...",
  "fileName": "원본.ai",
  "mimeType": "application/postscript",
  "sizeBytes": 123456789
}
```

서버가 인증, 자료보관함 write 권한, campus/folder scope, 파일명, 크기, 차단 확장자를 다시 검증하고 R2 multipart session을 만든다.

### part 저장

`PUT /api/data-core/library/uploads/:sessionId/parts/:partNumber`

body는 raw binary다. `multipart/form-data`로 다시 감싸지 않는다.

### 완료

`POST /api/data-core/library/uploads/:sessionId/complete`

```json
{
  "parts": [
    { "partNumber": 1, "etag": "..." }
  ]
}
```

모든 part가 연속인지 확인하고 R2 complete 후 object 존재/크기를 검증한다. 검증이 끝난 다음에만 `file_objects`를 생성하고 audit log를 기록한다.

### 취소

`DELETE /api/data-core/library/uploads/:sessionId`

진행 중 multipart를 `abort()`하고 session을 `aborted`로 변경한다. 기존 완료 파일에는 영향을 주지 않는다.

## 업로드 세션

별도 테이블 대신 기존 `data_records`를 사용한다.

- `record_type`: `library-upload-session`
- `source_app`: `data-core-library`
- status: `pending`, `uploading`, `completed`, `aborted`, `failed`
- metadata: `fileId`, `folderId`, `r2Key`, `uploadId`, `fileName`, `mimeType`, `sizeBytes`, `chunkSize`, `partCount`, `campusId`, `ownerUserId`, `createdAt`, `expiresAt` 등

완료 전에는 `file_objects`가 존재하지 않으므로 일반 자료 목록에 보이지 않는다.

## 보안

모든 start/part/complete/abort 요청은 기존 자료보관함 인증·same-origin 정책을 통과해야 한다. part/complete/abort는 session 소유자도 확인한다. 브라우저가 전달하는 `campusId`를 권한 근거로 사용하지 않는다.

R2 key/secret 또는 public R2 URL을 브라우저에 노출하지 않는다.

## 실패·재시도

part 실패 시 완료된 part의 ETag를 같은 페이지의 queue state에 유지하여 실패 part부터 다시 시도한다. complete 단계 실패 시 새 세션으로 다시 시작한다. 취소 시 진행 XHR을 abort하고 서버 R2 multipart도 abort한다.

R2 complete 뒤 DB/audit/session finalize가 실패하면 이번 요청에서 만든 신규 R2 object와 `file_objects`만 보상 삭제한다. R2 complete 이전 실패는 multipart session을 abort하여 중간 part를 정상 파일로 남기지 않는다.

## 검증 대상

- 1 MiB / 49 MiB: simple upload 선택
- 51 MiB / 110 MiB / 250 MiB: multipart 선택
- `.ai`, `.psd`, `.psb`, `.zip`
- 빈 MIME / `application/postscript` / `.ai + application/pdf`
- Unicode 파일명 / 동일 파일명 중복
- 실행파일 차단 / 2 GiB 초과 사전 차단
- cross-campus/session-owner 거부
- part retry / cancel
- 마지막 part가 5 MiB 미만인 complete
- download SHA-256 byte equality
- 기존 image thumbnail/gallery 회귀

실제 학원 운영 파일은 자동 테스트 fixture로 사용하지 않는다.
