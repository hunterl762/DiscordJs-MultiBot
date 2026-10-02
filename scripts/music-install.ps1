$ErrorActionPreference = 'Stop'
Write-Host '[Music] Refreshing local music dependencies...'
$old = Join-Path $PSScriptRoot '..\node_modules\@iamtraction\play-dl'
if (Test-Path $old) { Remove-Item -Recurse -Force $old }
Push-Location (Join-Path $PSScriptRoot '..')
try {
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
  npm run check:music
  if ($LASTEXITCODE -ne 0) { throw 'music dependency check failed' }
  Write-Host '[Music] Dependencies refreshed successfully.'
} finally {
  Pop-Location
}
