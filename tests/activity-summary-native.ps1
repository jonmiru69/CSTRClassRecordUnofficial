# Run after activity-summary-browser.cjs. Synthetic files only; no print jobs.
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.build-artifacts/activity-summary'))
$output=Join-Path $source 'native'
[void](New-Item -ItemType Directory -Force -Path $output)
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.AutomationSecurity=3
try {
  foreach($name in @('saved','sparse','empty','dense','reserved-name','many-activities')) {
    $book=$null
    try {
      $book=$excel.Workbooks.Open((Join-Path $source ($name+'.xlsx')),0,$true)
      $summary=$book.Worksheets.Item(2)
      if($summary.PageSetup.FitToPagesWide-ne 1 -or $summary.PageSetup.FitToPagesTall-ne 1){throw "$name does not fit one summary page"}
      if($summary.PageSetup.PrintTitleRows-ne ''){throw "$name repeats its header"}
      $summary.ExportAsFixedFormat(0,(Join-Path $output ($name+'.pdf')))
      Write-Output "PASS $name native one-page summary export"
    } finally {if($book){$book.Close($false);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book)}}
  }
} finally {$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
