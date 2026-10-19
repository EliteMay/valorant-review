param(
  [Parameter(Mandatory = $true)][string]$TargetDir,
  [switch]$PersistUserEnvironment
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $TargetDir) {
  throw "TargetDir already exists. Choose a new empty folder to avoid overwriting an existing environment."
}
$PythonLauncher = Get-Command py -ErrorAction Stop
& $PythonLauncher.Source -3.11 -m venv $TargetDir
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 virtual environment creation failed.' }
$exe = Join-Path $TargetDir 'Scripts\python.exe'
$requirements = Join-Path $PSScriptRoot '..\electron\vision\requirements-vision.txt'
& $exe -m pip install --disable-pip-version-check --no-input --only-binary=:all: -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'OpenCV installation failed.' }
& $exe -c 'import cv2; print(cv2.__version__)'
if ($LASTEXITCODE -ne 0) { throw 'OpenCV import failed.' }
if ($PersistUserEnvironment) {
  [Environment]::SetEnvironmentVariable('VREVIEW_VISION_PYTHON', $exe, 'User')
  Write-Output 'Saved VREVIEW_VISION_PYTHON for new application launches.'
}
Write-Output ('Vision Python: ' + $exe)
