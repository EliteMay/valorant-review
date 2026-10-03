$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "native\bin"
$inputSource = Join-Path $root "native\input-telemetry\main.cpp"
$inputExe = Join-Path $outDir "vreview-input-telemetry.exe"
$trackerSource = Join-Path $root "native\tracker-collector\main.cpp"
$trackerExe = Join-Path $outDir "vreview-tracker-helper.exe"

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
  throw "cl.exe was not found. Run from a Visual Studio Developer shell or initialize MSVC first."
}

New-Item -ItemType Directory -Path $outDir -Force | Out-Null

function Build-Helper([string]$Source, [string]$Output, [string]$Name) {
  Push-Location $root
  try {
    & cl.exe /nologo /std:c++17 /O2 /EHsc /DUNICODE /D_UNICODE $Source /Fe:$Output /link /SUBSYSTEM:CONSOLE user32.lib kernel32.lib
    if ($LASTEXITCODE -ne 0) {
      throw "$Name build failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
  if (-not (Test-Path $Output)) {
    throw "$Name executable was not produced."
  }
  Write-Host "Built $Output"
}

Build-Helper $inputSource $inputExe "Input telemetry helper"
Build-Helper $trackerSource $trackerExe "Tracker collector helper"
