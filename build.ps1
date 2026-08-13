$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronDist = Join-Path $root 'node_modules\electron\dist'
$appName = 'MonsterSirenCloudMusic'
$out = Join-Path $root 'dist'
$appDir = Join-Path $out $appName

if (-not (Test-Path $electronDist)) {
    Write-Error "Electron runtime not found at $electronDist. Run 'npm install' first."
    exit 1
}

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Path $appDir | Out-Null

Write-Host "Copying Electron runtime..."
Copy-Item -Path (Join-Path $electronDist '*') -Destination $appDir -Recurse -Force

$exe = Join-Path $appDir 'electron.exe'
if (Test-Path $exe) {
    Rename-Item $exe ($appName + '.exe')
}

$defApp = Join-Path $appDir 'resources\default_app.asar'
if (Test-Path $defApp) { Remove-Item $defApp }

$resApp = Join-Path $appDir 'resources\app'
New-Item -ItemType Directory -Path $resApp -Force | Out-Null
foreach ($f in @('main.js','preload.js','index.html','styles.css','renderer.js','msr.svg','package.json')) {
    Copy-Item (Join-Path $root $f) $resApp
}

Write-Host ""
Write-Host "Build complete:"
Write-Host "  Launcher : $appDir\$appName.exe"
Write-Host "  App files: $resApp"
