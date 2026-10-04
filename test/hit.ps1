# Solo lectura: ¿qué ventana "ve" el sistema en un punto de la pantalla? (hit-test real, sin pulsar nada)
#   .\test\hit.ps1 -X 300 -Y 400
param([int]$X, [int]$Y)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int x; public int y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(PT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
}
"@
$pt = New-Object W+PT; $pt.x = $X; $pt.y = $Y
$h = [W]::WindowFromPoint($pt); $top = [W]::GetAncestor($h, 2)
$sb = New-Object System.Text.StringBuilder 256; [void][W]::GetWindowText($top, $sb, 256)
$ex = [W]::GetWindowLong($top, -20)
"({0},{1}) -> '{2}' exStyle=0x{3:X} transparent={4}" -f $X, $Y, $sb.ToString(), $ex, (($ex -band 0x20) -ne 0)
