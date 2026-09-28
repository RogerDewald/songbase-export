# Checks the page-sharing feature against REAL Word layout. Run after `npm run samples`:
#   pwsh -File test/office/verify-pages.ps1                                  .docx samples, heights, line pitch
#   powershell -NoProfile -STA -File test/office/verify-pages.ps1 -Paste     also the "Copy for Word" HTML
#     (the -Paste run needs Windows PowerShell 5.1 in STA for the clipboard, and first:
#      node tools/cfhtml.mjs out/sample-word-pairs.html out/sample-word-forced.html
#      NOTE: -Paste replaces the current clipboard contents.)
#
# What it proves, per sample:
#  * pairs / forced : every song starts on the page the plan says, and NO song spans two pages.
#                     `forced` over-pairs two tall songs on purpose: Word must move song 2 whole
#                     to page 2 (the keep-together chain), not split it.
#  * heights        : Word's distance from a song's title to a trailing paragraph matches the
#                     planner's estimate within 1.5%.
#  * pitch          : Word's single-line height for each font matches LINE_FACTOR within 0.6%.
param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\..\out'),
  [switch]$Paste
)
$ErrorActionPreference = 'Stop'
$OutDir = (Resolve-Path $OutDir).Path
$spec = Get-Content (Join-Path $OutDir 'expect.json') -Raw | ConvertFrom-Json
if (-not $spec.pages) { throw 'expect.json has no `pages` section: run `npm run samples` first.' }
Add-Type -AssemblyName System.Drawing
$installed = (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name
if ($Paste) { Add-Type -AssemblyName System.Windows.Forms }

function Set-HtmlClipboard([string]$cfFile) {
  $bytes = [IO.File]::ReadAllBytes($cfFile)
  $data = New-Object Windows.Forms.DataObject
  $data.SetData('HTML Format', (New-Object IO.MemoryStream(, $bytes)))
  $data.SetData([Windows.Forms.DataFormats]::UnicodeText, 'plain text flavour')
  [Windows.Forms.Clipboard]::SetDataObject($data, $true)
}
function Top($doc, [int]$n) { $r = $doc.Paragraphs.Item($n).Range; $r.Collapse(1); return [double]$r.Information(6) }   # points from page top
function StartPage($doc, [int]$n) { $r = $doc.Paragraphs.Item($n).Range; $r.Collapse(1); return [int]$r.Information(3) }
function EndPage($doc, [int]$n) { $r = $doc.Paragraphs.Item($n).Range; $r.MoveEnd(1, -1) | Out-Null; $r.Collapse(0); return [int]$r.Information(3) }

# Where each song starts and ends. A song's title is a "Heading 1" (.docx) or an outline-level-1 paragraph (paste).
function Get-SongPages($doc, $titles) {
  $count = $doc.Paragraphs.Count
  $starts = @()
  for ($i = 1; $i -le $count; $i++) {
    $p = $doc.Paragraphs.Item($i)
    $text = ($p.Range.Text -replace "[\r\n\a]", '').Trim()
    if ($titles -contains $text -and ($p.Style.NameLocal -eq 'Heading 1' -or $p.OutlineLevel -eq 1)) { $starts += $i }
  }
  $songs = @()
  for ($k = 0; $k -lt $starts.Count; $k++) {
    $last = if ($k + 1 -lt $starts.Count) { $starts[$k + 1] - 1 } else { $count }
    $songs += [pscustomobject]@{ start = StartPage $doc $starts[$k]; end = EndPage $doc $last; first = $starts[$k]; last = $last }
  }
  return $songs
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$docsBefore = $word.Documents.Count
$results = @()
try {
  # ---- page placement
  foreach ($entry in $spec.pages.PSObject.Properties) {
    $e = $entry.Value
    $isHtml = $e.kind -eq 'html'
    if ($isHtml -and -not $Paste) { continue }
    $failed = @()
    if ($isHtml) {
      $cf = Join-Path $OutDir ([IO.Path]::ChangeExtension($entry.Name, '.cfhtml'))
      if (-not (Test-Path $cf)) { throw "missing $cf (run tools/cfhtml.mjs first)" }
      Set-HtmlClipboard $cf
      $doc = $word.Documents.Add()
      $word.Selection.PasteAndFormat(16) | Out-Null
    } else {
      $doc = $word.Documents.Open((Join-Path $OutDir $entry.Name), $false, $true)
    }
    try {
      $songs = Get-SongPages $doc @($e.titles)
      if ($songs.Count -ne @($e.titles).Count) { $failed += "found $($songs.Count) of $(@($e.titles).Count) titles" }
      $split = @($songs | Where-Object { $_.start -ne $_.end }).Count
      if ($split) { $failed += "$split song(s) split across pages" }
      $got = @($songs | ForEach-Object { $_.start })
      $want = @($e.startPages)
      if (($got -join ',') -ne ($want -join ',')) { $failed += "start pages $($got -join ',') expected $($want -join ',')" }
      $pages = $doc.ComputeStatistics(2)
      if ($pages -ne $e.pageCount) { $failed += "pages $pages expected $($e.pageCount)" }
      $results += [pscustomobject]@{ check = 'pages'; sample = $entry.Name; pass = ($failed.Count -eq 0); detail = if ($failed) { $failed -join '; ' } else { "starts=$($got -join ',') pages=$pages" } }
    } finally { $doc.Close(0) }
  }

  # ---- estimate vs Word, title to sentinel
  foreach ($entry in $spec.heights.PSObject.Properties) {
    $doc = $word.Documents.Open((Join-Path $OutDir $entry.Name), $false, $true)
    try {
      $measured = (Top $doc $doc.Paragraphs.Count) - (Top $doc 1)
      $err = 100 * ($entry.Value.estimate - $measured) / $measured
      $results += [pscustomobject]@{ check = 'height'; sample = $entry.Name; pass = ([math]::Abs($err) -le 1.5); detail = ('estimate {0:N1}pt vs Word {1:N1}pt ({2:+0.00;-0.00}%)' -f $entry.Value.estimate, $measured, $err) }
    } finally { $doc.Close(0) }
  }

  # ---- line pitch per font
  foreach ($entry in $spec.pitch.PSObject.Properties) {
    $e = $entry.Value
    if ($installed -notcontains $e.font) { $results += [pscustomobject]@{ check = 'pitch'; sample = $entry.Name; pass = $true; detail = "skipped: $($e.font) is not installed here" }; continue }
    $doc = $word.Documents.Open((Join-Path $OutDir $entry.Name), $false, $true)
    try {
      $factor = (((Top $doc 21) - (Top $doc 1)) / 20) / $e.sizePt
      $err = 100 * ($e.factor - $factor) / $factor
      $results += [pscustomobject]@{ check = 'pitch'; sample = $entry.Name; pass = ([math]::Abs($err) -le 0.6); detail = ('{0}: table {1:N4} vs Word {2:N4} ({3:+0.00;-0.00}%)' -f $e.font, $e.factor, $factor, $err) }
    } finally { $doc.Close(0) }
  }
} finally {
  # Quit only an instance we own with nothing else open; never close a user's documents.
  if ($docsBefore -eq 0 -and $word.Documents.Count -eq 0) { $word.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
$results | Format-Table check, sample, pass, detail -AutoSize -Wrap | Out-String -Width 220
$bad = @($results | Where-Object { -not $_.pass })
"{0} checks, {1} failed" -f $results.Count, $bad.Count
if ($bad.Count) { exit 1 }
