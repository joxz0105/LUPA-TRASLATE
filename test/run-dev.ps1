# Lanza la página de prueba (ventana Electron) y Lupa en modo depuración, con la lente en una posición conocida.
param(
  [string]$Page = 'test\fixtures\article.html',
  [string]$Bounds = '{"x":20,"y":110,"width":760,"height":520}',
  [string]$Extra = '{}'
)
$root = 'C:\Users\jovag\Lupa'
Set-Location $root
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'

# cerrar instancias anteriores de prueba (arboles completos, por PID)
foreach ($f in 'lupa.pid', 'page.pid') {
  $pf = Join-Path $env:TEMP $f
  if (Test-Path -LiteralPath $pf) { $old = [int](Get-Content -LiteralPath $pf); & taskkill.exe /T /F /PID $old 2>$null | Out-Null }
}
Start-Sleep -Milliseconds 800

# página de prueba
$pg = Start-Process -FilePath $electron -ArgumentList @("test\page-window.js", $Page, "0", "0", "1100", "760") -PassThru
Set-Content -LiteralPath (Join-Path $env:TEMP 'page.pid') -Value $pg.Id
Start-Sleep -Seconds 3

# ajustes (JSON sin BOM)
$ud = Join-Path $env:APPDATA 'Lupa'
New-Item -ItemType Directory -Force -Path $ud | Out-Null
$base = $Extra | ConvertFrom-Json
$obj = [ordered]@{ bounds = ($Bounds | ConvertFrom-Json); showTip = $false }
foreach ($p in $base.PSObject.Properties) { $obj[$p.Name] = $p.Value }
[System.IO.File]::WriteAllText((Join-Path $ud 'settings.json'), ($obj | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))

$env:LUPA_DEBUG = '1'; $env:LUPA_DEBUG_PORT = '9333'
Set-Content -Path "$env:TEMP\lupa-run.log" -Value ''
Set-Content -Path "$env:TEMP\lupa-run.err" -Value ''
$p = Start-Process -FilePath $electron -ArgumentList "." -PassThru -RedirectStandardOutput "$env:TEMP\lupa-run.log" -RedirectStandardError "$env:TEMP\lupa-run.err"
Set-Content -LiteralPath (Join-Path $env:TEMP 'lupa.pid') -Value $p.Id
"lupa pid $($p.Id)"
