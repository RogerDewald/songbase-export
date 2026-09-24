# Opens every sample .pptx in PowerPoint (no window) and checks it against out/expect.json:
# slide count, the planned font size on every lyric slide, and a real overflow test using
# PowerPoint's own text layout (TextRange.BoundHeight/BoundWidth vs the shape).
# Also exports the first slides as PNG for a visual check and prints the measured
# line-height ratio used to calibrate LINE_HEIGHT in extension/shared/slides.js.
# Run after `npm run samples`:  pwsh -File test/office/verify-pptx.ps1
param([string]$OutDir = (Join-Path $PSScriptRoot '..\..\out'), [int]$PngSlides = 4)
$ErrorActionPreference = 'Stop'
$OutDir = (Resolve-Path $OutDir).Path
$spec = Get-Content (Join-Path $OutDir 'expect.json') -Raw | ConvertFrom-Json

$app = New-Object -ComObject PowerPoint.Application
# PowerPoint is single-instance: if the user has decks open we attach to THEIR app,
# so we must never Quit() it in that case.
$presBefore = $app.Presentations.Count
$results = @()
try {
  foreach ($entry in $spec.pptx.PSObject.Properties) {
    $path = Join-Path $OutDir $entry.Name
    $e = $entry.Value
    $pres = $app.Presentations.Open($path, -1, 0, 0)   # ReadOnly, not Untitled, no window
    try {
      $n = $pres.Slides.Count
      $sizeMismatch = @(); $overflow = @(); $lineMismatch = @(); $ratios = @()
      for ($i = 1; $i -le $n; $i++) {
        $slide = $pres.Slides.Item($i)
        $pt = $e.sizes[$i - 1]
        if ($null -ne $pt) {
          $shape = $slide.Shapes.Item(1)
          $tr = $shape.TextFrame.TextRange
          if ([math]::Abs($tr.Font.Size - $pt) -gt 0.01) { $sizeMismatch += "$i($($tr.Font.Size)/$pt)" }
          if ($tr.Paragraphs().Count -ne $e.lines[$i - 1]) { $lineMismatch += "$i($($tr.Paragraphs().Count)/$($e.lines[$i - 1]))" }
          $bh = $tr.BoundHeight; $bw = $tr.BoundWidth
          if ($bh -gt $shape.Height + 0.5 -or $bw -gt $shape.Width + 0.5) { $overflow += "$i(h $([math]::Round($bh))/$([math]::Round($shape.Height)) w $([math]::Round($bw))/$([math]::Round($shape.Width)))" }
          $rendered = $tr.Lines().Count
          $ratios += [math]::Round($bh / ($rendered * $pt), 3)
        }
        if ($i -le $PngSlides) {
          $png = Join-Path $OutDir ('{0}-slide{1}.png' -f [IO.Path]::GetFileNameWithoutExtension($entry.Name), $i)
          $slide.Export($png, 'PNG', 1280, 720)
        }
      }
      $failed = @()
      if ($n -ne $e.slides) { $failed += "slides $n/$($e.slides)" }
      if ($sizeMismatch.Count) { $failed += "size " + ($sizeMismatch -join ' ') }
      if ($lineMismatch.Count) { $failed += "lines " + ($lineMismatch -join ' ') }
      if ($overflow.Count) { $failed += "overflow " + ($overflow -join ' ') }
      $results += [pscustomobject]@{
        file = $entry.Name; pass = ($failed.Count -eq 0); failed = ($failed -join '; '); slides = $n
        lineHeightRatio = if ($ratios.Count) { '{0:0.000}..{1:0.000}' -f ($ratios | Measure-Object -Minimum).Minimum, ($ratios | Measure-Object -Maximum).Maximum } else { '' }
      }
    } finally {
      $pres.Close()
    }
  }
} finally {
  if ($presBefore -eq 0 -and $app.Presentations.Count -eq 0) { $app.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
$results | Format-List | Out-String -Width 200
if ($results | Where-Object { -not $_.pass }) { exit 1 }
