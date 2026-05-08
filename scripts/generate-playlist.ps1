[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$musicDir = Join-Path $root "mus"
$lyricsDir = Join-Path $root "lrc"
$coversDir = Join-Path $root "img"
$outFile = Join-Path $root "playlist.json"

function Get-Names([string]$dir) {
  if (-not (Test-Path $dir)) { return @() }
  return Get-ChildItem $dir -File |
    Where-Object { $_.Name -ne ".gitkeep" } |
    Select-Object -ExpandProperty Name |
    Sort-Object
}

$music = Get-Names $musicDir
$lyrics = Get-Names $lyricsDir
$covers = Get-Names $coversDir

$obj = [ordered]@{
  music = $music
  lyrics = $lyrics
  covers = $covers
}

($obj | ConvertTo-Json -Depth 4) | Set-Content -Path $outFile -Encoding UTF8
Write-Output "Updated: $outFile"
