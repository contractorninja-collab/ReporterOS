# Run from repo root after: gh auth login
# Creates a new GitHub repo named ReporterOS (change $RepoName if needed) and pushes main.

$ErrorActionPreference = "Stop"
# This file lives in <repo>/scripts/
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$RepoName = "ReporterOS"
$Visibility = "private"  # use "public" if you prefer

gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Log in to GitHub first (browser or token):" -ForegroundColor Yellow
  Write-Host "  gh auth login" -ForegroundColor Cyan
  exit 1
}

$hasOrigin = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Remote 'origin' already exists: $hasOrigin" -ForegroundColor Yellow
  Write-Host "Pushing main..."
  git push -u origin main
  exit $LASTEXITCODE
}

gh repo create $RepoName --$Visibility --source . --remote origin --push
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "If the repo already exists on GitHub, run:" -ForegroundColor Yellow
  Write-Host "  git remote add origin https://github.com/<YOUR_USER>/$RepoName.git" -ForegroundColor Cyan
  Write-Host "  git push -u origin main" -ForegroundColor Cyan
}
