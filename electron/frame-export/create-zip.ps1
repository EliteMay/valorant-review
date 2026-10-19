param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw 'Source folder not found' }
if (Test-Path -LiteralPath $Destination) { throw 'Destination already exists' }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $Source, $Destination,
  [System.IO.Compression.CompressionLevel]::Optimal, $false
)
