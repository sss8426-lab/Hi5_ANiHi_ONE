$ErrorActionPreference = 'Stop'

$loginId = Read-Host -Prompt '로그인 ID'
$securePassword = Read-Host -Prompt '새 임시 비밀번호(12자 이상)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:DATA_CORE_RESET_LOGIN_ID = $loginId
  $env:DATA_CORE_RESET_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  & node (Join-Path $PSScriptRoot 'reset-standalone-password.mjs')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item Env:DATA_CORE_RESET_LOGIN_ID -ErrorAction SilentlyContinue
  Remove-Item Env:DATA_CORE_RESET_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
