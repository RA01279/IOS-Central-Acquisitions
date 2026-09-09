# Run after node scripts/test-demand-pptx.mjs.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$pptxPath = Join-Path $PSScriptRoot '../.tmp-pptx/demand-regression.pptx'
$archive = [IO.Compression.ZipFile]::OpenRead($pptxPath)
$checked = 0
$links = 0
try {
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -notmatch '\.(xml|rels)$') { continue }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $doc = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
    $checked++
    foreach ($relationship in $doc.SelectNodes('//*[local-name()="Relationship"]')) {
      if ($relationship.Type -like '*/hyperlink') {
        if ($relationship.Target -ne 'https://example.com/?a=1&b=2') {
          throw "Hyperlink URL was changed: $($relationship.Target)"
        }
        $links++
      }
    }
  }
  if ($links -ne 1) { throw "Expected one preserved company-name hyperlink; found $links" }
  Write-Output "$checked XML parts parsed successfully; company-name hyperlink preserved without double escaping."
} finally { $archive.Dispose() }
