# Reinicia solo Lupa (deja la página de prueba abierta).
param([string]$Bounds = '', [string]$Extra = '{}')
$root = 'C:\Users\jovag\Lupa'
Set-Location $root
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$pf = Join-Path $env:TEMP 'lupa.pid'
if (Test-Path -LiteralPath $pf) { $old = [int](Get-Content -LiteralPath $pf); & taskkill.exe /T /F /PID $old 2>$null | Out-Null }
Start-Sleep -Milliseconds 800
if ($Bounds -ne '' -or $Extra -ne '{}') {
  $ud = Join-Path $env:APPDATA 'Lupa'
  $obj = [ordered]@{ showTip = $false }
  if ($Bounds -ne '') { $obj['bounds'] = ($Bounds | ConvertFrom-Json) }
  foreach ($p in ($Extra | ConvertFrom-Json).PSObject.Properties) { $obj[$p.Name] = $p.Value }
  [System.IO.File]::WriteAllText((Join-Path $ud 'settings.json'), ($obj | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
}
$env:LUPA_DEBUG = '1'; $env:LUPA_DEBUG_PORT = '9333'
Set-Content -Path "$env:TEMP\lupa-run.log" -Value ''
Set-Content -Path "$env:TEMP\lupa-run.err" -Value ''
$p = Start-Process -FilePath $electron -ArgumentList "." -PassThru -RedirectStandardOutput "$env:TEMP\lupa-run.log" -RedirectStandardError "$env:TEMP\lupa-run.err"
Set-Content -LiteralPath $pf -Value $p.Id
"lupa pid $($p.Id)"
