# Opens every sample .docx in Word (invisibly) and checks it against out/expect.json.
# Run after `npm run samples`:  pwsh -File test/office/verify-docx.ps1
# A repair prompt or conversion dialog fails the run (alerts are off, so Open throws).
param([string]$OutDir = (Join-Path $PSScriptRoot '..\..\out'))
$ErrorActionPreference = 'Stop'
$OutDir = (Resolve-Path $OutDir).Path
$expect = Get-Content (Join-Path $OutDir 'expect.json') -Raw | ConvertFrom-Json

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$docsBefore = $word.Documents.Count
$results = @()
try {
  foreach ($entry in $expect.docx.PSObject.Properties) {
    $path = Join-Path $OutDir $entry.Name
    $e = $entry.Value
    $doc = $word.Documents.Open($path, $false, $true)
    try {
      $headings = 0; $pageBreaks = 0; $tabs = 0; $mono = 0; $keepTogether = 0; $indentOk = $true
      # Index loop: `foreach` over Word's COM Paragraphs collection can spin forever in PS 5.1.
      $count = $doc.Paragraphs.Count
      for ($i = 1; $i -le $count; $i++) {
        $p = $doc.Paragraphs.Item($i)
        $style = $p.Style.NameLocal
        if ($style -eq 'Heading 1') { $headings++ }
        if ($p.Format.PageBreakBefore -ne 0) { $pageBreaks++ }
        if ($p.Format.KeepTogether -ne 0) { $keepTogether++ }
        if ($style -like 'Verse (chords)' -or $style -like 'Chorus (chords)') {
          $mono++
          if ($p.Range.Font.Name -ne 'Consolas') { $indentOk = $false }
        }
        $text = $p.Range.Text
        if ($style -eq 'Verse' -and $text -match "^\d+`t") {
          $tabs++
          # hanging indent: first line at 0, wrapped/soft-broken lines at 0.35in (25.2pt)
          if ([math]::Abs($p.LeftIndent - 25.2) -gt 0.1 -or [math]::Abs($p.FirstLineIndent + 25.2) -gt 0.1) { $indentOk = $false }
        }
      }
      $pdf = [IO.Path]::ChangeExtension($path, '.pdf')
      $doc.ExportAsFixedFormat($pdf, 17)
      $pages = $doc.ComputeStatistics(2)
      $checks = [ordered]@{
        paragraphs      = @($doc.Paragraphs.Count, $e.paragraphs)
        headings        = @($headings, $e.headings)
        pageBreakBefore = @($pageBreaks, $e.pageBreakBefore)
        numberedTabs    = @($tabs, $e.numberedTabs)
        monoParagraphs  = @($mono, $e.monoParagraphs)
      }
      $failed = @($checks.Keys | Where-Object { $checks[$_][0] -ne $checks[$_][1] })
      if (-not $indentOk) { $failed += 'indent/font' }
      $results += [pscustomobject]@{
        file = $entry.Name; pass = ($failed.Count -eq 0); failed = ($failed -join ','); pages = $pages
        paragraphs = $doc.Paragraphs.Count; keepTogether = $keepTogether; compatibilityMode = $doc.CompatibilityMode
      }
    } finally {
      $doc.Close(0)
    }
  }
} finally {
  # Quit only an instance we own with nothing else open.
  if ($docsBefore -eq 0 -and $word.Documents.Count -eq 0) { $word.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
$results | Format-Table -AutoSize | Out-String -Width 200
if ($results | Where-Object { -not $_.pass }) { exit 1 }
