# Run after node tests/school-excel-browser.cjs on Windows with Microsoft Excel.
# Uses synthetic workbooks only; never changes the user's open Excel instance,
# printer preferences, or source files. PDF rendering does not send print jobs.
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../.build-artifacts/school-excel/native'), [string[]]$Cases)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.build-artifacts/school-excel'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
[void](New-Item -ItemType Directory -Force -Path $output)
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
if ($Cases) { $manifest = @($manifest | Where-Object { $_.label -in $Cases }) }
function Check($condition, $message) { if (!$condition) { throw $message } }
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AutomationSecurity = 3
$reports = [Collections.Generic.List[object]]::new()
try {
  foreach ($case in $manifest) {
    $book = $null
    try {
      $book = $excel.Workbooks.Open((Join-Path $source ($case.label + '.xlsx')), 0, $true)
      $excel.CalculateFullRebuild()
      Check ($book.Worksheets.Count -eq 1) "$($case.label): original worksheet structure changed"
      $sheet = $book.Worksheets.Item(1)
      foreach ($s in @($sheet)) {
        Check ($s.PageSetup.Zoom -eq $false -and $s.PageSetup.FitToPagesWide -eq 1 -and $s.PageSetup.FitToPagesTall -eq 1) "$($case.label): automatic one-page fitting missing"
        Check ($s.PageSetup.PaperSize -eq 14 -and $s.PageSetup.Orientation -eq 2) "$($case.label): incorrect Folio landscape setup"
        Check ($s.PageSetup.CenterHorizontally -and $s.PageSetup.CenterVertically) "$($case.label): centering missing"
        foreach ($margin in @($s.PageSetup.LeftMargin,$s.PageSetup.RightMargin,$s.PageSetup.TopMargin,$s.PageSetup.BottomMargin)) {Check ([Math]::Abs($margin-18) -lt .01) "$($case.label): unequal margins"}
        Check ($s.PageSetup.PrintArea.Split(',').Count -eq 2) "$($case.label): separate original register print area missing"
        Check ($s.PageSetup.PrintTitleRows -eq '' -and $s.PageSetup.PrintTitleColumns -eq '') "$($case.label): record header would leak into register"
        $s.DisplayPageBreaks = $true
      }
      Check ([Math]::Abs([double]$sheet.Range($case.cells[0]).Value2 - $case.initial) -lt 0.000000001) "$($case.label): recalculated initial grade differs"
      Check ([double]$sheet.Range($case.cells[1]).Value2 -eq $case.grade) "$($case.label): recalculated reported grade differs"
      Check ($sheet.Range($case.cells[2]).Value2 -eq $case.descriptor) "$($case.label): recalculated descriptor differs"
      if ($case.label -ne 'expanded-grouped-record') {
        Check ($sheet.VPageBreaks.Count -eq 0) "$($case.label): last column spills onto another sheet of paper"
      }
      foreach ($c in $sheet.Range("C17:$($case.cells[0] -replace '\d+$','')18").Cells) {
        Check ($c.Text -notmatch '^#{3,}$') "$($case.label): overflow at $($c.Address()), text=$($c.Text), width=$($c.Width), font=$($c.Font.Size), format=$($c.NumberFormat)"
      }
      $lastColumn=$sheet.UsedRange.Columns.Count
      $registerStart=[int]([regex]::Match($sheet.PageSetup.PrintArea.Split(',')[1],'\$A\$(\d+)').Groups[1].Value)+5
      foreach ($r in @($registerStart)) {
        foreach ($c in $sheet.Range($sheet.Cells.Item($r,3),$sheet.Cells.Item($r,$lastColumn)).Cells) {
        Check ($c.Text -notmatch '^#{3,}$') "$($case.label): register date overflow at $($c.Address())"
        }
      }
      $oldScore = $sheet.Range('C19').Value2
      $sheet.Range('C19').Value2 = [double]$case.changedScore
      $excel.CalculateFullRebuild()
      Check ([Math]::Abs([double]$sheet.Range($case.cells[0]).Value2 - $case.changedInitial) -lt 0.000000001) "$($case.label): score edit does not recalculate correctly"
      Check ([double]$sheet.Range($case.cells[1]).Value2 -eq $case.changedGrade) "$($case.label): edited reported grade differs"
      if ($oldScore -is [string]) { $sheet.Range('C19').Formula = $oldScore }
      else { $sheet.Range('C19').Value2 = [double]$oldScore }
      $excel.CalculateFullRebuild()
      if ($case.label -in @('preset-0','print-layout','thirty-learners','many-learners','long-activity','fractional-weights','pending-and-attendance')) {
        $pdf = Join-Path $output ($case.label + '.pdf')
        if (Test-Path -LiteralPath $pdf) { Remove-Item -LiteralPath $pdf }
        $book.ExportAsFixedFormat(0, $pdf)
      }
      $reports.Add([pscustomobject]@{Case=$case.label; Scale='automatic one page per print area'; Paper='13 x 8.5 in'; Initial=$sheet.Range($case.cells[0]).Value2; Grade=$sheet.Range($case.cells[1]).Value2; Recalculation='passed'; HorizontalBreaks=$sheet.VPageBreaks.Count})
      Write-Output "PASS $($case.label): native calculation, edit/recalculate/restore, equal margins, dates, and fitting"
    } finally { if ($book) { $book.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) } }
  }
  $reports | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'results.json')
} finally { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel); [GC]::Collect(); [GC]::WaitForPendingFinalizers() }
