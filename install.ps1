# orbit installer (Windows) — irm https://raw.githubusercontent.com/shalinda-j/Orbit/main/install.ps1 | iex
# Clones (or updates) orbit, installs deps, and links the `orbit` command via npm.
$ErrorActionPreference = 'Stop'
# PowerShell 7.3+ turns a non-zero native exit code into a terminating error too;
# on Windows PowerShell 5.1 this variable is simply ignored, so we still guard with Assert-Ok.
$PSNativeCommandUseErrorActionPreference = $true

$Repo = if ($env:ORBIT_REPO) { $env:ORBIT_REPO } else { 'https://github.com/shalinda-j/Orbit.git' }
$Dir  = if ($env:ORBIT_HOME) { $env:ORBIT_HOME } else { Join-Path $HOME '.orbit-cli' }

function Need($cmd, $msg) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Error $msg }
}
# Windows PowerShell 5.1 does NOT abort on a non-zero native exit code, so check it explicitly.
# Without this, a failed git/npm would silently continue and we'd wrongly print "Done".
function Assert-Ok($msg) {
  if ($LASTEXITCODE -ne 0) { Write-Error "$msg (exit $LASTEXITCODE)" }
}

Need node 'Node.js 18+ is required - https://nodejs.org'
Need git  'git is required'
Need npm  'npm is required'

$major = [int](node -p 'process.versions.node.split(".")[0]')
Assert-Ok 'failed to determine Node.js version'
if ($major -lt 18) { Write-Error "Node.js 18+ required (found $(node -v))" }

if (Test-Path (Join-Path $Dir '.git')) {
  Write-Host "> Updating orbit in $Dir"
  git -C $Dir pull --ff-only
  Assert-Ok 'git pull failed'
} else {
  Write-Host "> Cloning orbit into $Dir"
  git clone --depth 1 $Repo $Dir
  Assert-Ok 'git clone failed'
}

Push-Location $Dir
try {
  Write-Host '> Installing dependencies'
  npm install --omit=dev
  Assert-Ok 'npm install failed'
  Write-Host '> Linking the orbit command'
  npm install -g .
  Assert-Ok 'npm install -g failed'
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Done. Run: orbit   (or `orbit connect` to add a provider).'
