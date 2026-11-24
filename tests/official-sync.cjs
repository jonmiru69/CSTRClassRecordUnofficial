'use strict';
const assert = require('node:assert/strict');
const engine = require('../ASSETS/official-sync-engine.js');
const clone = value => JSON.parse(JSON.stringify(value));
const string = stringValue => ({userEnteredValue:{stringValue},formattedValue:stringValue});
const number = numberValue => ({userEnteredValue:{numberValue},formattedValue:String(numberValue)});
const formula = formulaValue => ({userEnteredValue:{formulaValue},formattedValue:'0'});
function fixture(shs = false) {
  const section={id:'synthetic-science',subject:shs?'General Science 11':'Science',level:shs?'Grade 11':'Grade 8',section:'Saint Sample',group:shs?'SHS':'JHS',weights:[20,50,30],gradingMode:'school-transmutation',...(shs?{gradingCategory:'SHS Core Subjects / Other Academic Electives'}:{})};
  const period={name:'First grading',quarter:1,semester:shs?1:0,complete:true,wwHps:[20],ptHps:[40],qaHps:[20,20,40],roster:[{name:'Alvarez, Sample A.',ww:[15],pt:[35],qa:[10,18,36]},{name:'Bautista, Demo B.',ww:[0],pt:[0],qa:[0,0,0]}]};
  const source={id:'synthetic-source',section,calendarMode:'legacy',schoolYear:'2026-2027',semester:shs?1:null,periods:[period]};
  const rows=[];
  rows[0]={values:[string('CST-R FORM 1')]};
  rows[5]={values:[string('REPORT ON RATINGS S.Y. 2026-2027')]};
  if(shs)rows[6]={values:[string('FIRST SEMESTER')]};
  rows[7]={values:[string(`${shs?'Yr.& Sec: 11':'YEAR & SECTION: 8'}- St. Sample SUBJECT: ${shs?'General Science':'Science & Technology'}`)]};
  rows[9]={values:['NAMES',shs?'Quarter':'PERIOD','Written Works (20%)','Performance Task (50%)','Quarterly Asses. (30%)','Initial Grade','Periodical Grade'].map(string)};
  const count=shs?2:4;
  for(let s=0;s<2;s++)for(let q=1;q<=count+1;q++){
    const r=10+s*(count+1)+q-1;
    rows[r]={values:[q===1?string(`${s+1}. ${period.roster[s].name}`):{},q<=count?number(q):string('F'),{},{},{},q<=count?formula(`=C${r+1}+D${r+1}+E${r+1}`):{},formula('=60')]};
  }
  const book={spreadsheetId:'synthetic-book',properties:{title:'Synthetic official gradesheet'},sheets:[{properties:{sheetId:7,title:shs?'Gen Science':'SCIENCE',sheetType:'GRID',gridProperties:{rowCount:1000,columnCount:26}},data:[{rowData:rows}]}]};
  return {source,book,period,rows};
}
const tests=[];
const test=(name,run)=>tests.push([name,run]);
test('matches exact normalized names and writes weighted values including actual zero',()=>{
  const {source,book}=fixture(), plan=engine.plan(source,book,7);
  assert.equal(plan.allRows.length,2);
  assert.deepEqual(plan.allRows[0].values,[15,43.75,23.4]);
  assert.deepEqual(plan.allRows[1].values,[0,0,0]);
  const requests=engine.requests([plan]);
  assert.equal(requests.length,2);
  for(const {updateCells:r} of requests){assert.equal(r.fields,'userEnteredValue');assert.equal(r.start.columnIndex,2);assert.equal(r.rows[0].values.length,3);}
});
test('excludes unfinished periods even if locked or given a conflicting quarter',()=>{
  const {source,book}=fixture();source.periods.push({...clone(source.periods[0]),complete:false,locked:true,quarter:1});
  assert.equal(engine.plan(source,book,7).allRows.length,2);
  source.periods[0].complete=false;
  assert.throws(()=>engine.plan(source,book,7),/no completed periods/);
});
test('rejects pending scores despite a claimed complete flag',()=>{
  const {source,book,period}=fixture();period.roster[0].ww[0]='';
  assert.throws(()=>engine.plan(source,book,7),/incomplete or invalid WW/);
});
test('does not require completed periods to be locked',()=>{
  const {source,book,period}=fixture();period.locked=false;assert.equal(engine.plan(source,book,7).changes.length,2);
});
test('matches reordered rosters by name instead of row',()=>{
  const {source,book,period}=fixture();period.roster.reverse();
  assert.equal(engine.plan(source,book,7).allRows[0].row,15);
});
test('retains diacritics, normalizes whitespace, and removes only list numbers',()=>{
  assert.equal(engine.nameKey(' 1.  De la Cruz,   Demo A. '),engine.nameKey('De la Cruz, Demo A.'));
  assert.notEqual(engine.nameKey('Peña, Sample'),engine.nameKey('Pena, Sample'));
});
test('rejects source learners without a match and duplicate learner names',()=>{
  for(const which of ['source duplicate','target duplicate','missing']){
    const {source,book,period,rows}=fixture();
    if(which==='source duplicate')period.roster[1].name=period.roster[0].name;
    if(which==='target duplicate')rows[15].values[0]=clone(rows[10].values[0]);
    if(which==='missing')period.roster[0].name='Different, Person';
    assert.throws(()=>engine.plan(source,book,7),/Duplicate|No exact/);
  }
});
test('preserves official history when a learner has no source entry for this quarter',()=>{
  const {source,book,period,rows}=fixture();period.roster.pop();rows[15].values[2]=number(12);
  const plan=engine.plan(source,book,7);assert.equal(plan.allRows.length,1);assert.equal(plan.untouched.length,1);
  assert.equal(plan.untouched[0].quarter,1);assert.equal(plan.untouched[0].row,15);assert.equal(plan.untouched[0].values[0],'12');
  assert(engine.requests([plan]).every(request=>request.updateCells.start.rowIndex!==15));
});
test('rejects wrong year, grade, weights, and template',()=>{
  for(const [r,c,value] of [[5,0,'REPORT ON RATINGS S.Y. 2025-2026'],[7,0,'YEAR & SECTION: 9- St. Sample SUBJECT: Science'],[9,2,'Written Works (30%)'],[0,0,'Different form']]){
    const {source,book,rows}=fixture();rows[r].values[c]=string(value);assert.throws(()=>engine.plan(source,book,7));
  }
});
test('requires explicit verification of different section or subject labels',()=>{
  const {source,book}=fixture();source.section.section='Different section';
  assert.throws(()=>engine.plan(source,book,7),/Verify this mapping explicitly/);
  assert.equal(engine.plan(source,book,7,'St. Sample|Science & Technology').allRows.length,2);
});
test('requires two-quarter semester layout and verifies its semester',()=>{
  const {source,book,rows}=fixture(true);assert.equal(engine.plan(source,book,7).allRows.length,2);
  source.semester=2;source.periods[0].semester=2;assert.throws(()=>engine.plan(source,book,7),/semester does not match/);
  source.semester=1;source.periods[0].semester=1;rows[12].values[1]=number(3);assert.throws(()=>engine.plan(source,book,7),/period count/);
});
test('requires the explicit source strand to match its official file',()=>{
  const {source,book}=fixture(true);source.partition='ABM';book.properties.title='Official Our Lady of Consolation - STEM';
  assert.throws(()=>engine.plan(source,book,7),/matching official strand file/);
  book.properties.title='Official Our Lady of Consolation - ABM';assert.equal(engine.plan(source,book,7).allRows.length,2);
  source.partition='STEM';assert.throws(()=>engine.plan(source,book,7),/matching official strand file/);
  book.properties.title='Official Our Lady of Consolation - STEM';assert.equal(engine.plan(source,book,7).allRows.length,2);
});
test('rejects duplicate, missing, and invalid completed period identities',()=>{
  const {source,book,period}=fixture();source.periods.push(clone(period));assert.throws(()=>engine.plan(source,book,7),/Two completed/);
  source.periods.pop();delete period.quarter;assert.throws(()=>engine.plan(source,book,7),/valid quarter/);
});
test('rejects unsupported trimester and zero-based grading',()=>{
  const {source,book}=fixture();source.calendarMode='trimester';assert.throws(()=>engine.plan(source,book,7),/Trimester/);
  source.calendarMode='legacy';source.section.gradingMode='zero-based';assert.throws(()=>engine.plan(source,book,7),/Zero-based/);
});
test('preserves every formula and refuses formulas in the input cells',()=>{
  const {source,book,rows}=fixture();rows[10].values[2]=formula('=10');assert.throws(()=>engine.plan(source,book,7),/is a formula/);
  rows[10].values[2]={};rows[10].values[5]={};assert.throws(()=>engine.plan(source,book,7),/Missing official grade formulas/);
});
test('checks sheet-level protections, unprotected exceptions, and named ranges',()=>{
  const {source,book}=fixture(),sheet=book.sheets[0];
  sheet.protectedRanges=[{range:{sheetId:7},requestingUserCanEdit:false}];assert.throws(()=>engine.plan(source,book,7),/cannot edit/);
  sheet.protectedRanges[0].unprotectedRanges=[{sheetId:7,startColumnIndex:2,endColumnIndex:5}];assert.equal(engine.plan(source,book,7).allRows.length,2);
  sheet.protectedRanges=[{namedRangeId:'inputs',requestingUserCanEdit:false}];book.namedRanges=[{namedRangeId:'inputs',range:{sheetId:7,startColumnIndex:2,endColumnIndex:5}}];assert.throws(()=>engine.plan(source,book,7),/cannot edit/);
  sheet.protectedRanges[0].requestingUserCanEdit=true;assert.equal(engine.plan(source,book,7).changes.length,2);
});
test('checks permissions even for absent input cells',()=>{
  const {source,book,rows}=fixture();rows[10].values[2]=undefined;
  book.sheets[0].protectedRanges=[{range:{sheetId:7,startColumnIndex:2,endColumnIndex:3},requestingUserCanEdit:false}];
  assert.throws(()=>engine.plan(source,book,7),/cannot edit/);
});
test('detects overlapping class targets including already matching scores',()=>{
  const {source,book}=fixture(),plan=engine.plan(source,book,7);
  assert.throws(()=>engine.requests([plan,plan]),/same official period row/);
});
test('detects changes, counts overwrites, and verifies values plus preserved formulas',()=>{
  const {source,book,rows}=fixture(),plan=engine.plan(source,book,7);
  assert.equal(engine.verify(plan,book),false);
  for(const r of plan.allRows)r.values.forEach((v,i)=>rows[r.row].values[i+2]=number(v));
  assert.equal(engine.verify(plan,book),true);
  assert.equal(engine.plan(source,book,7).changes.length,0);
  assert.notEqual(plan.fingerprint,engine.plan(source,book,7).fingerprint);
  rows[10].values[2]=number(99);assert.equal(engine.plan(source,book,7).overwrites,1);
  rows[10].values[5]=formula('=SUM(C11:E11)');assert.equal(engine.verify(plan,book),false);
});
test('accepts only canonical HTTPS Google Sheets links',()=>{
  assert.deepEqual(engine.spreadsheetLink('https://docs.google.com/spreadsheets/d/synthetic-book/edit#gid=7'),{id:'synthetic-book',sheetId:7});
  for(const url of ['https://drive.google.com/drive/u/2/home','https://docs.google.com.evil.test/spreadsheets/d/id/edit','http://docs.google.com/spreadsheets/d/id/edit'])assert.throws(()=>engine.spreadsheetLink(url));
});
if(require.main===module)for(const [name,run]of tests){run();console.log(`PASS ${name}`);}
module.exports={fixture};
