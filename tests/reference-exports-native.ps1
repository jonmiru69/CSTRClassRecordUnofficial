param([string]$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
$ErrorActionPreference='Stop'
$out=Join-Path $Root '.build-artifacts/reference-exports'
$manifest=Get-Content (Join-Path $out 'manifest.json') -Raw | ConvertFrom-Json
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.AutomationSecurity=3
try {
 foreach($case in $manifest){
  $book=$null
  try {
   $book=$excel.Workbooks.Open((Join-Path $out ($case.label+'.xlsx')),0,$true)
   $excel.CalculateFullRebuild();$sheet=$book.Worksheets.Item(1)
   $actual=[double]$sheet.Range($case.cells[0]).Value2
   if([Math]::Abs($actual-[double]$case.initial)-gt 0.00000001){throw ($case.label+' initial mismatch '+$actual+' vs '+$case.initial)}
   if([double]$sheet.Range($case.cells[1]).Value2-ne [double]$case.grade){throw ($case.label+' grade mismatch')}
   if($sheet.Range($case.cells[2]).Value2-ne $case.descriptor){throw ($case.label+' descriptor mismatch')}
   if($case.label -in @('preset-0','preset-9','sparse')){$pdf=Join-Path $out ($case.label+'-native.pdf');if(Test-Path -LiteralPath $pdf){Remove-Item -LiteralPath $pdf};$book.ExportAsFixedFormat(0,$pdf)}
   Write-Output ('PASS native Excel recalculation: '+$case.label)
  } finally {if($book){$book.Close($false)}}
 }
} finally {$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$word.Options.Pagination=$false
try {
 foreach($label in @('official','completed-Q1-Q2')){
  $doc=$null
  try {$doc=$word.Documents.Open((Join-Path $out ($label+'.docx')),$false,$true);$pdf=Join-Path $out ($label+'-word-native.pdf');if(Test-Path -LiteralPath $pdf){Remove-Item -LiteralPath $pdf};$doc.ExportAsFixedFormat($pdf,17);Write-Output ('PASS native Word render: '+$label)} finally {if($doc){$doc.Close(0)}}
 }
} finally {$word.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)}
