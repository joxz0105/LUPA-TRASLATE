# Compone la captura de escritorio (sin la lente, por la protección de captura) con la captura del renderizador (con alfa).
param([string]$Screen, [string]$Overlay, [int]$X, [int]$Y, [string]$Out)
Add-Type -AssemblyName System.Drawing
$bg = [System.Drawing.Image]::FromFile($Screen)
$fg = [System.Drawing.Image]::FromFile($Overlay)
$bmp = New-Object System.Drawing.Bitmap $bg.Width, $bg.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($bg, 0, 0, $bg.Width, $bg.Height)
$g.DrawImage($fg, $X, $Y, $fg.Width, $fg.Height)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $bg.Dispose(); $fg.Dispose()
"saved $Out"
