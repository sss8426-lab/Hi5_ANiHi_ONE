$ErrorActionPreference = 'Stop'

$loginId = Read-Host -Prompt '마스터 로그인 ID'
$securePassword = Read-Host -Prompt '마스터 비밀번호(12자 이상)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:DATA_CORE_BOOTSTRAP_LOGIN_ID = $loginId
  $env:DATA_CORE_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  & node (Join-Path $PSScriptRoot 'create-standalone-master.mjs')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item Env:DATA_CORE_BOOTSTRAP_LOGIN_ID -ErrorAction SilentlyContinue
  Remove-Item Env:DATA_CORE_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
