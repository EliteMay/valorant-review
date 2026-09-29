$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "native\input-telemetry\main.cpp"
$outDir = Join-Path $root "native\bin"
$outExe = Join-Path $outDir "vreview-input-telemetry.exe"

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
  throw "cl.exe was not found. Run from a Visual Studio Developer shell or initialize MSVC first."
}

New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Push-Location $root
try {
  & cl.exe /nologo /std:c++17 /O2 /EHsc /DUNICODE /D_UNICODE $source /Fe:$outExe /link /SUBSYSTEM:WINDOWS user32.lib kernel32.lib
  if ($LASTEXITCODE -ne 0) {
    throw "Input telemetry helper build failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

if (-not (Test-Path $outExe)) {
  throw "Input telemetry helper executable was not produced."
}

Write-Host "Built $outExe"
