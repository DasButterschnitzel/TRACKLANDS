# Windows smoke test for the NSIS installer (CI, windows-latest):
# silent per-user install, version and signature report, launch (the game's
# WebView2 must start and the page must write its storage), close, silent
# uninstall. Fails on anything unexpected; prints what it saw.
param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$version = (Get-Content package.json | ConvertFrom-Json).version
$identifier = (Get-Content src-tauri/tauri.conf.json | ConvertFrom-Json).identifier
Write-Host "installer: $Installer ($([math]::Round((Get-Item $Installer).Length / 1MB, 1)) MB)"
$sig = Get-AuthenticodeSignature $Installer
Write-Host "installer signature: $($sig.Status)"

$p = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -Wait
if ($p.ExitCode -ne 0) { throw "installer exit code $($p.ExitCode)" }
$dir = Join-Path $env:LOCALAPPDATA 'TRACKLANDS'
$exe = Join-Path $dir 'TRACKLANDS.exe'
if (-not (Test-Path $exe)) { Get-ChildItem $env:LOCALAPPDATA | Format-Table Name; throw "TRACKLANDS.exe not installed at $exe" }
$vi = (Get-Item $exe).VersionInfo
Write-Host "installed: $exe, product version $($vi.ProductVersion), file version $($vi.FileVersion)"
if (-not $vi.ProductVersion.StartsWith($version.Split('-')[0])) { throw "installed version $($vi.ProductVersion) is not $version" }

$data = Join-Path $env:LOCALAPPDATA $identifier
$app = Start-Process -FilePath $exe -PassThru
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  if ($app.HasExited) { throw "TRACKLANDS exited during start-up (exit code $($app.ExitCode))" }
  # the page has run when WebView2 has written the game's local storage
  if (Test-Path (Join-Path $data 'EBWebView/Default/Local Storage')) { $ok = $true; break }
}
Write-Host "WebView2 data folder:"; if (Test-Path $data) { Get-ChildItem -Recurse -Depth 2 $data | Select-Object -First 25 | Format-Table FullName }
if (-not $ok) { Stop-Process -Id $app.Id -Force; throw 'the game page did not start (no WebView2 local storage after 120 s)' }
Start-Sleep -Seconds 10
if ($app.HasExited) { throw "TRACKLANDS exited after start-up (exit code $($app.ExitCode))" }
Write-Host "TRACKLANDS running (pid $($app.Id)), page storage present"
Stop-Process -Id $app.Id -Force
Start-Sleep -Seconds 2

$un = Join-Path $dir 'uninstall.exe'
if (-not (Test-Path $un)) { throw "uninstaller missing: $un" }
Start-Process -FilePath $un -ArgumentList '/S' -Wait
for ($i = 0; $i -lt 30 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $exe) { throw 'TRACKLANDS.exe still present after uninstall' }
Write-Host 'uninstalled cleanly'
