Param()

$ErrorActionPreference = "Stop"

$manifestPath = Join-Path $PSScriptRoot "..\native\WinImeWatcher\Cargo.toml"
$outputPath = Join-Path $PSScriptRoot "..\resources\bin\win-x64"
$rustTarget = "x86_64-pc-windows-msvc"

if (-not $IsWindows -and $env:OS -ne "Windows_NT") {
  throw "WinImeWatcher.exe must be built on Windows with the Rust MSVC toolchain. Run npm run test:unit on non-Windows development machines."
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "Rust toolchain not found. Install Rust stable from https://rustup.rs/ and ensure cargo is on PATH."
}

if (Get-Command rustup -ErrorAction SilentlyContinue) {
  rustup target add $rustTarget
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

if (Test-Path $outputPath) {
  Remove-Item -Recurse -Force $outputPath
}

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

cargo build --manifest-path $manifestPath --release --target $rustTarget

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$builtExePath = Join-Path $PSScriptRoot "..\native\WinImeWatcher\target\$rustTarget\release\WinImeWatcher.exe"
if (-not (Test-Path $builtExePath)) {
  throw "Expected Rust helper executable at $builtExePath after cargo build."
}

$exePath = Join-Path $outputPath "WinImeWatcher.exe"
Copy-Item -LiteralPath $builtExePath -Destination $exePath -Force

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
