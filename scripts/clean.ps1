Param()

$ErrorActionPreference = "Stop"

$paths = @(
  (Join-Path $PSScriptRoot "..\\out"),
  (Join-Path $PSScriptRoot "..\\.vscode-test"),
  (Join-Path $PSScriptRoot "..\\resources\\bin"),
  (Join-Path $PSScriptRoot "..\\native\\ime-watcher\\target")
)

foreach ($path in $paths) {
  if (Test-Path $path) {
    Remove-Item -Recurse -Force $path
  }
}
