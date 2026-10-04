# Instantánea compuesta de lo que ve el usuario: escritorio + lente. Uso: .\test\snap.ps1 -Name nombre [-X 20 -Y 90]
param([string]$Name = 'snap', [int]$X = 20, [int]$Y = 90)
Set-Location 'C:\Users\jovag\Lupa'
$s = Join-Path $env:TEMP "$Name-screen.png"; $r = Join-Path $env:TEMP "$Name-lens.png"; $o = Join-Path $env:TEMP "$Name.png"
& .\test\screen.ps1 -Out $s | Out-Null
node test\cdp.js shot $r | Out-Null
& .\test\composite.ps1 -Screen $s -Overlay $r -X $X -Y $Y -Out $o
