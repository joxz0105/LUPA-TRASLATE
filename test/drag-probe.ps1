# Sondeo: ¿llegan pointerdown al documento al arrastrar sobre la barra? Uso: .\test\drag-probe.ps1 [-Label texto]
param([string]$Label = 'sonda')
Set-Location 'C:\Users\jovag\Lupa'
$bounds = '0,0,1100,760'
function L($js) { node test\cdp.js eval $js }
$g = (L "(() => { const w = window.__lupa.state.win.bounds; const b = document.querySelector('.spacer').getBoundingClientRect(); return JSON.stringify({x: Math.round(w.x + b.left + b.width/2), y: Math.round(w.y + b.top + b.height/2)}) })()") | ConvertFrom-Json | ConvertFrom-Json
L "(() => { window.__pd = []; if (!window.__pdHooked) { window.__pdHooked = true; for (const t of ['pointerdown','pointerup','mousedown']) document.addEventListener(t, e => window.__pd.push(t), true); } return 'ok' })()" | Out-Null
$before = L "JSON.stringify(window.__lupa.state.win.bounds)"
$ex = $g.x + 40
$ey = $g.y + 25
.\test\input.ps1 -Action move -X 560 -Y 420 -Bounds $bounds | Out-Null
Start-Sleep -Milliseconds 250
.\test\input.ps1 -Action drag -X $g.x -Y $g.y -X2 $ex -Y2 $ey -Bounds $bounds | Out-Null
Start-Sleep -Milliseconds 500
$after = L "JSON.stringify(window.__lupa.state.win.bounds)"
"[$Label] eventos=" + (L "JSON.stringify(window.__pd)") + " | antes=$before | despues=$after"
