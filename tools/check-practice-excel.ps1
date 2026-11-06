param([string] $Workbook = '.build-artifacts/nationwide/Grade-6-Science-SYNTHETIC-PRACTICE.xlsx')
$ErrorActionPreference='Stop'
$inputPath=(Resolve-Path -LiteralPath $Workbook).Path
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false
$excel.EnableEvents=$false
$excel.AskToUpdateLinks=$false
$excel.AutomationSecurity=3
try {
  $book=$excel.Workbooks.Open($inputPath,0,$true)
  try {
    $excel.CalculateFullRebuild()
    $term=$book.Worksheets.Item('Term 1')
    $final=$book.Worksheets.Item('Final grades')
    $expected=@{N8=88;N9=75;N10=60;N11=''}
    foreach($entry in $expected.GetEnumerator()){
      $actual=$term.Range($entry.Key).Value2
      if($actual -ne $entry.Value){throw "Term 1 $($entry.Key) expected '$($entry.Value)', got '$actual'."}
    }
    if($final.Range('E7').Value2 -ne ''){throw 'Incomplete terms produced a final grade.'}
    $term.Range('M9').Value2=69.995
    $excel.CalculateFullRebuild()
    if($term.Range('N9').Value2 -ne 74){throw '69.995 incorrectly crossed the 70.00 cutoff.'}
    $term.Range('M9').Value2=71.18
    $excel.CalculateFullRebuild()
    if($term.Range('N9').Value2 -ne 76){throw '71.18 did not enter its inclusive cutoff.'}
    "PASS Excel $($excel.Version) recalculated 88, 75 and 60, kept pending rows blank, and applied 69.995/71.18 cutoffs."
  } finally {$book.Close($false)}
} finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
}
