param([Parameter(Mandatory=$true)][string]$Archive)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../outputs/university-logo-source'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$stream=[IO.File]::OpenRead((Resolve-Path -LiteralPath $Archive).Path)
$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read,$false,[Text.Encoding]::GetEncoding(949))
try {
  foreach($entry in $zip.Entries) {
    if($entry.FullName -notmatch '\.(png|jpg|jpeg|gif|webp)$'){continue}
    $target=[IO.Path]::GetFullPath((Join-Path $root $entry.FullName))
    if(-not $target.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe archive path'}
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
  }
} finally {$zip.Dispose()}
