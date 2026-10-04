# Lupa - helper persistente de Windows: captura de pantalla sin cursor (GDI) + OCR nativo (Windows.Media.Ocr).
# Protocolo: una peticion JSON por linea en stdin, una respuesta JSON por linea en stdout.
#   {"id":1,"cmd":"ocr","path":"C:\\..\\frame.png","lang":"en-US"}                 -> OCR de un PNG
#   {"id":2,"cmd":"ocr-screen","x":0,"y":0,"w":800,"h":500,"lang":"en-US","save":"C:\\..\\f.png"}  -> captura + OCR
#   {"id":3,"cmd":"capture","x":0,"y":0,"w":800,"h":500,"save":"C:\\..\\f.png"}     -> solo captura a PNG
#   <- {"id":N,"ok":true,"lines":[{"text","x","y","w","h","words":[{"t","x","y","w","h"}]}],"w":800,"h":500,"ms":120,"captureMs":20}
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8

# Coordenadas en pixeles fisicos: el proceso debe ser consciente del DPI antes de usar System.Drawing.
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class LupaDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
try { [void][LupaDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { try { [void][LupaDpi]::SetProcessDPIAware() } catch { } }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName System.Drawing
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]

$json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$json.MaxJsonLength = 67108864

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($operation, [Type]$resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $null = $task.Wait(-1)
    return $task.Result
}

$engines = @{}
function Get-Engine([string]$tag) {
    if (-not $engines.ContainsKey($tag)) {
        $engines[$tag] = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language($tag)))
    }
    return $engines[$tag]
}

function Write-Json($obj) {
    [Console]::Out.WriteLine($json.Serialize($obj))
    [Console]::Out.Flush()
}

# GDI no dibuja el puntero del raton y respeta la exclusion de captura de la ventana de Lupa.
function Capture-Screen([int]$x, [int]$y, [int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h))) }
    finally { $g.Dispose() }
    return $bmp
}

function Bitmap-ToSoftware($bmp) {
    $w = $bmp.Width; $h = $bmp.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $bytes = New-Object byte[] ($data.Stride * $h)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    }
    finally { $bmp.UnlockBits($data) }
    $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes)
    return [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer($buffer, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, $w, $h, [Windows.Graphics.Imaging.BitmapAlphaMode]::Ignore)
}

function Run-Ocr($bitmap, [string]$tag) {
    $engine = Get-Engine $tag
    if ($null -eq $engine) { throw "Idioma OCR no disponible: $tag" }
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $outLines = @()
    foreach ($ln in $result.Lines) {
        $words = @()
        $minX = [double]::MaxValue; $minY = [double]::MaxValue; $maxX = 0.0; $maxY = 0.0
        foreach ($w in $ln.Words) {
            $r = $w.BoundingRect
            $words += @{ t = [string]$w.Text; x = [int][Math]::Round($r.X); y = [int][Math]::Round($r.Y); w = [int][Math]::Round($r.Width); h = [int][Math]::Round($r.Height) }
            if ($r.X -lt $minX) { $minX = $r.X }
            if ($r.Y -lt $minY) { $minY = $r.Y }
            if (($r.X + $r.Width) -gt $maxX) { $maxX = $r.X + $r.Width }
            if (($r.Y + $r.Height) -gt $maxY) { $maxY = $r.Y + $r.Height }
        }
        if ($words.Count -eq 0) { continue }
        $outLines += @{
            text = [string]$ln.Text
            x = [int][Math]::Round($minX); y = [int][Math]::Round($minY)
            w = [int][Math]::Round($maxX - $minX); h = [int][Math]::Round($maxY - $minY)
            words = $words
        }
    }
    return , $outLines
}

$langs = @()
foreach ($l in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) { $langs += $l.LanguageTag }
Write-Json @{ ready = $true; langs = $langs; maxDim = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension; screen = $true }

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    $id = 0
    try {
        $req = $json.DeserializeObject($line)
        $id = [int]$req['id']
        $cmd = [string]$req['cmd']
        if ($cmd -eq '') { $cmd = 'ocr' }
        $sw = [System.Diagnostics.Stopwatch]::StartNew()

        if ($cmd -eq 'ocr') {
            $bytes = [System.IO.File]::ReadAllBytes([string]$req['path'])
            $stream = New-Object System.IO.MemoryStream(, $bytes)
            $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($stream)
            $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
            $lines = Run-Ocr $bitmap ([string]$req['lang'])
            $bitmap.Dispose(); $stream.Dispose()
            Write-Json @{ id = $id; ok = $true; lines = $lines; w = [int]$decoder.PixelWidth; h = [int]$decoder.PixelHeight; ms = [int]$sw.ElapsedMilliseconds }
        }
        elseif ($cmd -eq 'ocr-screen' -or $cmd -eq 'capture') {
            $x = [int]$req['x']; $y = [int]$req['y']; $w = [int]$req['w']; $h = [int]$req['h']
            if ($w -lt 8 -or $h -lt 8) { throw "Zona de captura demasiado pequena ($w x $h)" }
            $bmp = Capture-Screen $x $y $w $h
            $captureMs = [int]$sw.ElapsedMilliseconds
            try {
                if ($req.ContainsKey('save') -and [string]$req['save'] -ne '') { $bmp.Save([string]$req['save'], [System.Drawing.Imaging.ImageFormat]::Png) }
                if ($cmd -eq 'capture') {
                    Write-Json @{ id = $id; ok = $true; lines = @(); w = $w; h = $h; ms = [int]$sw.ElapsedMilliseconds; captureMs = $captureMs }
                }
                else {
                    $soft = Bitmap-ToSoftware $bmp
                    $lines = Run-Ocr $soft ([string]$req['lang'])
                    $soft.Dispose()
                    Write-Json @{ id = $id; ok = $true; lines = $lines; w = $w; h = $h; ms = [int]$sw.ElapsedMilliseconds; captureMs = $captureMs }
                }
            }
            finally { $bmp.Dispose() }
        }
        else { throw "Comando desconocido: $cmd" }
    }
    catch {
        Write-Json @{ id = $id; ok = $false; error = [string]$_.Exception.Message }
    }
}
