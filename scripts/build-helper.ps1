Param()

$ErrorActionPreference = "Stop"

$projectPath = Join-Path $PSScriptRoot "..\native\WinImeWatcher\WinImeWatcher.csproj"
$outputPath = Join-Path $PSScriptRoot "..\resources\bin\win-x64"

if (Test-Path $outputPath) {
  Remove-Item -Recurse -Force $outputPath
}

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

dotnet publish $projectPath `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:PublishTrimmed=false `
  -p:DebugType=None `
  -p:DebugSymbols=false `
  -o $outputPath

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$exePath = Join-Path $outputPath "WinImeWatcher.exe"
if (-not (Test-Path $exePath)) {
  throw "Expected helper executable at $exePath after publish."
}

$stream = [System.IO.File]::OpenRead($exePath)
try {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $sha256.ComputeHash($stream)
  }
  finally {
    $sha256.Dispose()
  }
}
finally {
  $stream.Dispose()
}

$hash = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
$hashPath = "$exePath.sha256"
Set-Content -LiteralPath $hashPath -Value $hash -NoNewline -Encoding ascii

Write-Host "Wrote helper hash sidecar: $hashPath"
Write-Host $hash
