# Entrada real por SendInput (movimiento absoluto genera eventos reales para los hooks de ratón).
# SOLO para probar sobre las ventanas de prueba de Lupa. Nunca pulsa fuera de la zona indicada con -Bounds.
param([string]$Action, [int]$X, [int]$Y, [int]$X2 = 0, [int]$Y2 = 0, [int]$Delta = 0, [string]$Bounds = '')
if ($Bounds -ne '') {
  $b = $Bounds -split ','   # x,y,w,h : región permitida
  foreach ($pt in @(@($X, $Y), @($X2, $Y2))) {
    if ($pt[0] -eq 0 -and $pt[1] -eq 0) { continue }
    if ($pt[0] -lt [int]$b[0] -or $pt[0] -gt [int]$b[0] + [int]$b[2] -or $pt[1] -lt [int]$b[1] -or $pt[1] -gt [int]$b[1] + [int]$b[3]) { throw "Punto ($($pt[0]),$($pt[1])) fuera de la región permitida" }
  }
}
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class SI {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  public static void Send(uint flags, int dx, int dy, uint data) {
    INPUT[] a = new INPUT[1]; a[0].type = 0; a[0].mi.dx = dx; a[0].mi.dy = dy; a[0].mi.mouseData = data; a[0].mi.dwFlags = flags;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void MoveTo(int x, int y) {
    int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
    Send(0x8001, (int)Math.Round(x * 65535.0 / (w - 1)), (int)Math.Round(y * 65535.0 / (h - 1)), 0);   // MOVE|ABSOLUTE
  }
}
"@
switch ($Action) {
  'move'  { [SI]::MoveTo($X, $Y) }
  'click' { [SI]::MoveTo($X, $Y); Start-Sleep -Milliseconds 150; [SI]::Send(0x2, 0, 0, 0); Start-Sleep -Milliseconds 70; [SI]::Send(0x4, 0, 0, 0) }
  'drag'  {
    [SI]::MoveTo($X, $Y); Start-Sleep -Milliseconds 200; [SI]::Send(0x2, 0, 0, 0); Start-Sleep -Milliseconds 120
    for ($i = 1; $i -le 16; $i++) { [SI]::MoveTo([int]($X + ($X2 - $X) * $i / 16), [int]($Y + ($Y2 - $Y) * $i / 16)); Start-Sleep -Milliseconds 25 }
    Start-Sleep -Milliseconds 150; [SI]::Send(0x4, 0, 0, 0)
  }
  'wheel' {
    [SI]::MoveTo($X, $Y); Start-Sleep -Milliseconds 150
    $d = if ($Delta -lt 0) { [uint32](4294967296 + $Delta) } else { [uint32]$Delta }
    [SI]::Send(0x800, 0, 0, $d)
  }
}
"done $Action"
