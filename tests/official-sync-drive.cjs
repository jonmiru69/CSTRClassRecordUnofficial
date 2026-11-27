'use strict';
const assert=require('node:assert/strict'),drive=require('../ASSETS/official-sync-drive.js'),engine=require('../ASSETS/official-sync-engine.js'),{fixture}=require('./official-sync.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
(async()=>{
  const calls=[];
  const listing=await drive.discover(async(path,opts,isDrive)=>{
    assert(isDrive);calls.push(path);
    const q=new URLSearchParams(path.split('?')[1]);assert.equal(q.get('corpora'),'user');assert.equal(q.get('includeItemsFromAllDrives'),'true');assert(!q.get('q').includes('parents'));assert(q.get('q').includes('trashed = false'));
    if(q.has('pageToken'))return {files:[{id:'book2',name:'Individually shared sheet',mimeType:'application/vnd.google-apps.spreadsheet'},{id:'excel',name:'Official.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}]};
    return {nextPageToken:'next',files:[{id:'book',name:'Official',mimeType:'application/vnd.google-apps.spreadsheet'}]};
  },()=>true);
  assert.equal(listing.files.length,2);assert.equal(listing.unsupported.length,1);assert.equal(calls.length,2);
  await assert.rejects(()=>drive.discover(async()=>({incompleteSearch:true}),()=>true),/incomplete/);
  const {source,book}=fixture(),files=[{id:book.spreadsheetId,name:'misleading title'}];
  const options={engine,alive:()=>true,progress:()=>{},metadata:async()=>book,read:async()=>book};
  const before=copy(book);
  assert((await drive.align([source],files,options))[0].match);
  assert.equal((await drive.align([source],[...files,...files.map(f=>({...f,id:'duplicate'}))],options))[0].match,null);
  assert((await drive.align([source,copy(source)],files,options)).every(row=>!row.match));
  for(const mutate of [s=>s.schoolYear='2027-2028',s=>s.section.subject='Mathematics',s=>s.section.section='Another section',s=>s.section.weights=[30,40,30],s=>s.periods[0].roster.forEach(l=>l.name='Unknown '+l.name)]){
    const wrong=copy(source);mutate(wrong);assert.equal((await drive.align([wrong],files,options))[0].match,null);
  }
  await assert.rejects(()=>drive.align([source],files,{...options,read:async()=>{throw Error('permission denied')}}),/permission denied/);
  await assert.rejects(()=>drive.align([source],files,{...options,alive:()=>false}),/stopped/);
  assert.deepEqual(copy(book),before);
  console.log('PASS Drive: account-wide pagination including individually shared sheets without a parent-folder constraint, incomplete-list refusal, content matching, ambiguity/conflict refusal, wrong metadata rejection, account cancellation and no source mutation');
})().catch(e=>{console.error(e);process.exitCode=1});
