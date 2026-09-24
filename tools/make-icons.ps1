# Draws the extension icons (a white note and two lyric lines on a blue rounded square)
# at 16/32/48/128 px. Run once:  pwsh -File tools/make-icons.ps1
param([string]$OutDir = (Join-Path $PSScriptRoot '..\extension\icons'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null

foreach ($size in 16, 32, 48, 128) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 128.0

  # Rounded square background.
  $x = 4 * $s; $y = 4 * $s; $w = 120 * $s; $d = 52 * $s
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $w - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $w - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $bg = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 43, 87, 151))
  $g.FillPath($bg, $path)

  $white = [System.Drawing.Brushes]::White
  # Eighth note: head, stem, flag.
  $g.FillEllipse($white, [single](24 * $s), [single](72 * $s), [single](36 * $s), [single](27 * $s))
  $g.FillRectangle($white, [single](51 * $s), [single](24 * $s), [single](9 * $s), [single](62 * $s))
  $flag = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(60 * $s, 24 * $s),
    [System.Drawing.PointF]::new(84 * $s, 38 * $s),
    [System.Drawing.PointF]::new(84 * $s, 52 * $s),
    [System.Drawing.PointF]::new(60 * $s, 40 * $s)
  )
  $g.FillPolygon($white, $flag)
  # Two lyric lines.
  $g.FillRectangle($white, [single](72 * $s), [single](68 * $s), [single](34 * $s), [single](8 * $s))
  $g.FillRectangle($white, [single](72 * $s), [single](86 * $s), [single](24 * $s), [single](8 * $s))

  $file = Join-Path $OutDir "icon$size.png"
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $bg.Dispose(); $path.Dispose()
  "wrote $file"
}
