Param()

$ErrorActionPreference = "Stop"

$nodeScript = Join-Path $PSScriptRoot "build-helper.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js not found. Install Node.js 24+ and ensure node is on PATH."
}

node $nodeScript
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
