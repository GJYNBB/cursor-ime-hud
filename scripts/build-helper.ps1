Param()

$ErrorActionPreference = "Stop"

$projectPath = Join-Path $PSScriptRoot "..\\native\\WinImeWatcher\\WinImeWatcher.csproj"
$outputPath = Join-Path $PSScriptRoot "..\\resources\\bin\\win-x64"

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
