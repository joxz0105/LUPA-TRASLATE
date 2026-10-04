# Prueba del control de transparencia con clics y arrastre reales (solo dentro de la región de prueba).
Set-Location 'C:\Users\jovag\Lupa'
$bounds = '0,0,1100,760'
function LupaEval($js) { node test\cdp.js eval $js }
function BtnPos($id) {
  $r = (LupaEval "(() => { const w = window.__lupa.state.win.bounds; const b = document.getElementById('$id').getBoundingClientRect(); return JSON.stringify({x: Math.round(w.x + b.left + b.width/2), y: Math.round(w.y + b.top + b.height/2)}) })()") | ConvertFrom-Json
  $r | ConvertFrom-Json
}
$o = BtnPos 'opacityBtn'
.\test\input.ps1 -Action click -X $o.x -Y $o.y -Bounds $bounds | Out-Null
Start-Sleep -Milliseconds 400
$sl = (LupaEval "(() => { const w = window.__lupa.state.win.bounds; const b = document.getElementById('opacityRange').getBoundingClientRect(); return JSON.stringify({l: Math.round(w.x + b.left), r: Math.round(w.x + b.right), y: Math.round(w.y + b.top + b.height/2)}) })()") | ConvertFrom-Json | ConvertFrom-Json
"control deslizante: de $($sl.l) a $($sl.r), y=$($sl.y)"
foreach ($pct in 75, 40, 0, 100) {
  $px = [int]($sl.l + ($sl.r - $sl.l) * $pct / 100)
  if ($pct -eq 100) { $px = $sl.r - 2 }
  if ($pct -eq 0) { $px = $sl.l + 2 }
  .\test\input.ps1 -Action click -X $px -Y $sl.y -Bounds $bounds | Out-Null
  Start-Sleep -Milliseconds 300
  "clic al $pct% -> " + (LupaEval "JSON.stringify({value: document.getElementById('opacityRange').value, glass: getComputedStyle(document.getElementById('lens')).getPropertyValue('--glass'), setting: window.__lupa.state.settings.opacityOverlay})")
}
$a = [int]($sl.l + ($sl.r - $sl.l) * 0.1)
$b = [int]($sl.l + ($sl.r - $sl.l) * 0.6)
.\test\input.ps1 -Action drag -X $a -Y $sl.y -X2 $b -Y2 $sl.y -Bounds $bounds | Out-Null
Start-Sleep -Milliseconds 300
"tras arrastrar el control de ~10% a ~60% -> " + (LupaEval "document.getElementById('opacityValue').textContent")
.\test\input.ps1 -Action click -X $o.x -Y $o.y -Bounds $bounds | Out-Null
