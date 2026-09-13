param(
  [switch]$SyncProductionSnapshot
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$javaExe = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Recurse -Filter java.exe -ErrorAction Stop | Select-Object -First 1 -ExpandProperty FullName
$javaBin = Split-Path -Parent $javaExe
$env:JAVA_HOME = Split-Path -Parent $javaBin
$env:Path = "$javaBin;$env:Path"

New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot 'tmp') | Out-Null
$emulatorLog = Join-Path $repoRoot 'tmp\v2.2t-emulator.log'
$emulatorErrorLog = Join-Path $repoRoot 'tmp\v2.2t-emulator-error.log'
$previewLog = Join-Path $repoRoot 'tmp\v2.2t-preview.log'
$previewErrorLog = Join-Path $repoRoot 'tmp\v2.2t-preview-error.log'

Start-Process -FilePath 'npm.cmd' -ArgumentList '--prefix', 'functions', 'exec', 'firebase', '--', 'emulators:start', '--project', 'demo-pm-dashboard-v22t', '--only', 'auth,firestore,functions' -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $emulatorLog -RedirectStandardError $emulatorErrorLog

for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  if ((Test-NetConnection -ComputerName '127.0.0.1' -Port 8080 -InformationLevel Quiet)) { break }
  Start-Sleep -Seconds 1
}
if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port 8080 -InformationLevel Quiet)) {
  throw "Firestore Emulator did not start. Read $emulatorLog"
}

$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
node (Join-Path $repoRoot 'scripts\seed-v2.2t-emulator.mjs')
if ($SyncProductionSnapshot) {
  node (Join-Path $repoRoot 'scripts\sync-v2.2t-local-data.mjs') --allow-production-snapshot-read
  if ($LASTEXITCODE -ne 0) {
    throw 'Production snapshot sync failed.'
  }
}
if (-not (Test-NetConnection -ComputerName '127.0.0.1' -Port 4173 -InformationLevel Quiet)) {
  Start-Process -FilePath 'npx.cmd' -ArgumentList '--yes', 'http-server', '.', '-p', '4173', '-c-1' -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $previewLog -RedirectStandardError $previewErrorLog
}
Write-Output 'Open http://127.0.0.1:4173/'
