# Pastes "Copy for Word" HTML into a new Word document (invisibly) and checks what Word
# made of it. Must run in Windows PowerShell 5.1 (STA, for the clipboard):
#   powershell -NoProfile -STA -File test/office/verify-paste.ps1              (uses out/*.cfhtml samples)
#   powershell -NoProfile -STA -File test/office/verify-paste.ps1 -FromClipboard -ExpectName sample-word-chords.html
# -FromClipboard pastes whatever is on the clipboard now (e.g. after clicking "Copy for Word").
# NOTE: this replaces the current clipboard contents.
param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\..\out'),
  [switch]$FromClipboard,
  [string]$ExpectName = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$OutDir = (Resolve-Path $OutDir).Path
$spec = Get-Content (Join-Path $OutDir 'expect.json') -Raw | ConvertFrom-Json

function Set-HtmlClipboard([string]$cfFile) {
  $bytes = [IO.File]::ReadAllBytes($cfFile)
  $data = New-Object Windows.Forms.DataObject
  $data.SetData('HTML Format', (New-Object IO.MemoryStream(, $bytes)))
  $data.SetData([Windows.Forms.DataFormats]::UnicodeText, 'plain text flavour')
  [Windows.Forms.Clipboard]::SetDataObject($data, $true)
}

$cases = @()
if ($FromClipboard) {
  $cases += [pscustomobject]@{ name = if ($ExpectName) { $ExpectName } else { 'clipboard' }; cf = $null }
} else {
  foreach ($entry in $spec.html.PSObject.Properties) {
    $cf = Join-Path $OutDir ([IO.Path]::ChangeExtension($entry.Name, '.cfhtml'))
    $cases += [pscustomobject]@{ name = $entry.Name; cf = $cf }
  }
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$docsBefore = $word.Documents.Count
$results = @()
try {
  foreach ($case in $cases) {
    if ($case.cf) { Set-HtmlClipboard $case.cf }
    $doc = $word.Documents.Add()
    try {
      $word.Selection.PasteAndFormat(16)   # wdFormatOriginalFormatting
      $headings = 0; $pageBreakBefore = 0; $pageBreakChars = 0; $tabs = 0; $nbspNumbers = 0
      $mono = 0; $keepTogether = 0; $keepWithNext = 0; $indents = @(); $normalish = 0
      # Index loop: `foreach` over Word's COM Paragraphs collection can spin forever in PS 5.1.
      $count = $doc.Paragraphs.Count
      for ($i = 1; $i -le $count; $i++) {
        $p = $doc.Paragraphs.Item($i)
        $style = $p.Style.NameLocal
        $text = $p.Range.Text
        if ($style -eq 'Heading 1' -or $p.OutlineLevel -eq 1) { $headings++ }
        if ($p.Format.PageBreakBefore -ne 0) { $pageBreakBefore++ }
        if ($text.Contains([string][char]12)) { $pageBreakChars++ }
        if ($p.Format.KeepTogether -ne 0) { $keepTogether++ }
        if ($p.Format.KeepWithNext -ne 0) { $keepWithNext++ }
        if ($p.Range.Font.Name -eq 'Consolas') { $mono++ }
        if ($style -eq 'Normal') { $normalish++ }
        if ($text -match "^\d+`t") {
          $tabs++
          $indents += ('{0:0.0}/{1:0.0}' -f $p.LeftIndent, $p.FirstLineIndent)
        }
        if ($text -match ("^\d+" + [char]0xA0)) { $nbspNumbers++ }
      }
      $e = if ($spec.html.PSObject.Properties.Name -contains $case.name) { $spec.html.($case.name) } else { $null }
      $failed = @()
      if ($e) {
        if ($headings -ne $e.headings) { $failed += "headings $headings/$($e.headings)" }
        if (($pageBreakBefore + $pageBreakChars) -lt $e.pageBreakBefore) { $failed += 'pageBreaks' }
        if ($tabs -ne $e.numberedTabs) { $failed += "tabs $tabs/$($e.numberedTabs)" }
        if ($mono -lt $e.monoParagraphs) { $failed += "mono $mono/$($e.monoParagraphs)" }
        if (@($indents | Where-Object { $_ -ne '25.2/-25.2' }).Count) { $failed += 'indent' }
      }
      $results += [pscustomobject]@{
        case = $case.name; pass = ($failed.Count -eq 0); failed = ($failed -join ', ')
        paragraphs = $doc.Paragraphs.Count; headings = $headings; pbBefore = $pageBreakBefore; pbChars = $pageBreakChars
        tabs = $tabs; nbspNums = $nbspNumbers; indents = (($indents | Select-Object -Unique) -join ' ')
        mono = $mono; keepTogether = $keepTogether; keepWithNext = $keepWithNext; normalStyle = $normalish
        pages = $doc.ComputeStatistics(2)
      }
      # No SaveAs2/ExportAsFixedFormat here: both block forever on a never-saved pasted
      # document in a hidden Word instance (an invisible modal). The checks above suffice.
    } finally {
      $doc.Close(0)
    }
  }
} finally {
  if ($docsBefore -eq 0 -and $word.Documents.Count -eq 0) { $word.Quit() }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
$results | Format-List | Out-String -Width 200
if ($results | Where-Object { -not $_.pass }) { exit 1 }
