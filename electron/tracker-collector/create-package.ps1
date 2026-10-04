param(
  [Parameter(Mandatory=$true)][string]$SessionPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [ValidateSet("fast","standard","maximum")][string]$Compression = "standard"
)

$ErrorActionPreference = "Stop"
$session = [System.IO.Path]::GetFullPath($SessionPath)
$output = [System.IO.Path]::GetFullPath($OutputPath)

if (-not (Test-Path -LiteralPath $session -PathType Container)) {
  throw "Session folder was not found."
}

$parent = Split-Path -Parent $output
New-Item -ItemType Directory -Path $parent -Force | Out-Null

if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Force
}

$level = switch ($Compression) {
  "fast" { [System.IO.Compression.CompressionLevel]::Fastest }
  "maximum" { [System.IO.Compression.CompressionLevel]::Optimal }
  default { [System.IO.Compression.CompressionLevel]::Optimal }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $session -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($session.Length).TrimStart('\','/')
    $entryName = $relative.Replace('\','/')
    $entry = $archive.CreateEntry($entryName, $level)
    $entryStream = $entry.Open()
    $fileStream = [System.IO.File]::OpenRead($_.FullName)
    try {
      $fileStream.CopyTo($entryStream)
    } finally {
      $fileStream.Dispose()
      $entryStream.Dispose()
    }
  }
} finally {
  $archive.Dispose()
}

$item = Get-Item -LiteralPath $output
[pscustomobject]@{
  ok = $true
  outputPath = $item.FullName
  bytes = $item.Length
} | ConvertTo-Json -Compress
