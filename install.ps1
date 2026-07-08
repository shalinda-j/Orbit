# orbit installer (Windows) — irm https://raw.githubusercontent.com/shalinda-j/Orbit/main/install.ps1 | iex
# Clones (or updates) orbit, installs deps, and links the `orbit` command via npm.
$ErrorActionPreference = 'Stop'

$Repo = if ($env:ORBIT_REPO) { $env:ORBIT_REPO } else { 'https://github.com/shalinda-j/Orbit.git' }
$Dir  = if ($env:ORBIT_HOME) { $env:ORBIT_HOME } else { Join-Path $HOME '.orbit-cli' }

function Need($cmd, $msg) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Error $msg }
}
Need node 'Node.js 18+ is required - https://nodejs.org'
Need git  'git is required'
Need npm  'npm is required'

$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 18) { Write-Error "Node.js 18+ required (found $(node -v))" }

if (Test-Path (Join-Path $Dir '.git')) {
  Write-Host "> Updating orbit in $Dir"
  git -C $Dir pull --ff-only
} else {
  Write-Host "> Cloning orbit into $Dir"
  git clone --depth 1 $Repo $Dir
}

Push-Location $Dir
try {
  Write-Host '> Installing dependencies'
  npm install --omit=dev
  Write-Host '> Linking the orbit command'
  npm install -g .
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Done. Run: orbit   (or `orbit connect` to add a provider).'
