'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.build-artifacts/student-report-adjustments');
// Expose fixture state only in this server response, never in the shipped app.
const source=fs.readFileSync(path.join(root,'ASSETS/app.js'),'utf8').replace('  initApp();',`window.__reportQA={state:()=>state,render:()=>{markStateDirty();render();},
 reload:()=>{state=normalizeState(JSON.parse(JSON.stringify(state)));render();},
 period:index=>{activePeriodIndex=index;render();}};\n  initApp();`);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.otf':'font/otf'};
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 if(file===path.join(root,'ASSETS/app.js')){res.writeHead(200,{'Content-Type':'text/javascript'}).end(source);return;}
 fs.readFile(file,(error,data)=>res.writeHead(error?404:200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(error?'Not found':data));
});
async function run(){
 fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(30000);
  page.on('pageerror',error=>console.error('Browser:',error.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(origin+'/test-preview/index.html?screen=record',{waitUntil:'domcontentloaded',timeout:60000});
  const score=page.locator('.record-table input[data-score="ww"][data-row="0"][data-index="0"]');await score.waitFor();
  assert.equal(await score.inputValue(),'12');
  await page.locator('.record-table [data-action="add-score-points"][data-kind="ww"][data-row="0"][data-index="0"]').click();
  const dialog=page.getByRole('dialog',{name:'Add score points with a reason'});
  await dialog.getByLabel('Points to add').fill('2');
  const reason='Verified omitted answer <match> & rechecked';
  await dialog.getByLabel('Reason (required)').fill(reason);await dialog.getByRole('button',{name:'Apply points',exact:true}).click();
  assert.equal(await score.inputValue(),'14');
  await page.keyboard.press('Control+z');
  assert.equal(await score.inputValue(),'12','Universal undo restores both score and its adjustment ledger');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await score.inputValue(),'14','Redo restores the complete adjustment');
  await page.locator('#studentSearch').fill('Alvarez, Sample');await page.locator('[data-action="search-student"]').click();
  const article=page.locator('.student-perf-block').filter({has:page.getByRole('heading',{name:'Science · Saint Sample',exact:true})}).locator('[role="tabpanel"]:visible .report-readable').first();
  await article.waitFor();
  const remarks=article.getByLabel("Teacher's feedback / remarks");
  await remarks.fill('First teacher remark <review> & verify.');
  assert((await article.locator('.report-ledger').innerText()).includes(reason),'Search report must show the added-score reason');
  const svg=article.locator('.student-report-svg');
  assert((await svg.textContent()).includes(reason),'PNG source must include the added-score reason');
  const values=await svg.evaluate(svg=>{
   const activity=[...svg.querySelectorAll('text[x="54"]')].find(t=>t.textContent.startsWith('WW 1 ·'));
   const y=activity.getAttribute('y');
   return [573,655,748,848].map(x=>svg.querySelector(`text[x="${x}"][y="${y}"]`)?.textContent);
  });
  assert.deepEqual(values,['12','+2*','14','20'],'Raw/addition/final/HPS must agree with the sheet');
  await page.evaluate(()=>{
   const serialize=XMLSerializer.prototype.serializeToString;
   XMLSerializer.prototype.serializeToString=function(node){const xml=serialize.call(this,node);if(node.classList?.contains('student-report-svg'))window.__exportedSvg=xml;return xml;};
  });
  const secondReason='Second verified correction after opening the lookup report';
  await page.evaluate(reason=>{
   const period=window.__reportQA.state().sections.science.periods[0];
   CSTRRecordTools.addPoints(period,'ww',0,0,1,reason,'teacher@example.test');
   window.__reportQA.render();
  },secondReason);
  assert.equal(await score.inputValue(),'15','The sheet must reflect the new addition');
  let exportButton=article.locator('[data-action="export-student-png"]');
  async function exportImage(name,expected,notes=[]){
   console.log('Export check:',name);
   const download=page.waitForEvent('download');
   const [saved]=await Promise.all([download,exportButton.click()]).catch(async error=>{throw new Error(error.message+' · '+await page.locator('#saveToast').textContent().catch(()=>''));});
   await saved.saveAs(path.join(out,name+'.png'));
   assert.equal(fs.readFileSync(await saved.path()).subarray(1,4).toString(),'PNG');
   const result=await page.evaluate(()=>{
    const svg=new DOMParser().parseFromString(window.__exportedSvg,'image/svg+xml');
    const activity=[...svg.querySelectorAll('text[x="54"]')].find(t=>t.textContent.startsWith('WW 1 ·'));
    const y=activity.getAttribute('y');
    return {xml:window.__exportedSvg,text:[...svg.querySelectorAll('text')].map(t=>t.textContent).join(' '),
     values:[573,655,748,848].map(x=>svg.querySelector(`text[x="${x}"][y="${y}"]`)?.textContent)};
   });
   assert.deepEqual(result.values,expected,name+': raw, additions, current score and HPS match the sheet');
   for(const note of notes)assert(result.text.includes(note),name+': image must include '+note);
   return result.xml;
  }
  const exported=await exportImage('added-points',['12','+3*','15','20'],[secondReason]);
  assert(exported.includes('Verified omitted answer &lt;match&gt; &amp; rechecked'),'Exported image must preserve the reason');
  assert(exported.includes(secondReason),'Downloaded image must include additions made after the lookup opened');
  assert(exported.includes('First teacher remark &lt;review&gt; &amp; verify.'),'PNG contains teacher remarks');
  await remarks.fill('Latest teacher remark after the first download.');
  await exportImage('updated-remarks',['12','+3*','15','20'],['Latest teacher remark after the first download.']);
  await page.keyboard.press('Control+z');
  await exportImage('undone-remarks',['12','+3*','15','20'],['First teacher remark <review> & verify.']);

  // A normalized cloud replacement must not leave exports attached to old objects.
  const bulkReason='Shared answer-key correction applied to the class';
  await page.evaluate(reason=>{
   const period=window.__reportQA.state().sections.science.periods[0];
   CSTRRecordTools.addBulkPoints(period,'ww',0,'0.5',reason,'teacher@example.test');
   window.__reportQA.reload();
  },bulkReason);
  assert.equal(await score.inputValue(),'15.5');
  const total=await page.locator('.record-table tbody tr').first().locator('.summary-ww-total').innerText();
  await page.evaluate(()=>window.__reportQA.period(1));
  assert.equal(await score.inputValue(),'12','The underlying screen now shows a different period');
  await exportImage('bulk-after-reload',['12','+3.50*','15.5','20'],[bulkReason,secondReason,total+' earned / included HPS']);
  await page.evaluate(()=>window.__reportQA.period(0));

  await page.evaluate(()=>{
   const period=window.__reportQA.state().sections.science.periods[0];
   CSTRRecordTools.adjustHps(period,'ww',0,'20','13');window.__reportQA.render();
  });
  assert.equal(await score.inputValue(),'13');
  await exportImage('capped-additions',['12','+3.50*','13','13'],[bulkReason,'Current score is capped at the revised HPS.']);

  await page.evaluate(()=>{
   const period=window.__reportQA.state().sections.science.periods[0];
   CSTRRecordTools.removePoints(period,'ww',0,0,'Teacher reversed the correction');window.__reportQA.reload();
  });
  assert.equal(await score.inputValue(),'12');
  await exportImage('cancelled-additions',['12','—','12','13'],['Previous adjustment (no longer applied)',
   'Teacher reversed the correction','Previous +0.50: '+bulkReason]);

  await page.evaluate(()=>{
   const period=window.__reportQA.state().sections.science.periods[0];
   CSTRRecordTools.addPoints(period,'ww',0,0,'0.00000001','W'.repeat(500));window.__reportQA.render();
  });
  const precise=await exportImage('precise-long-reason',['12','+0.00000001*','12.00000001','13']);
  assert(precise.includes('+0.00000001 points:'),'Tiny corrections must never round to zero');
  assert(await page.evaluate(xml=>{
   const holder=document.createElement('div');holder.style.cssText='position:absolute;left:-10000px';holder.innerHTML=xml;document.body.append(holder);
   const notes=[...holder.querySelectorAll('text[x="60"]')];
   const fits=notes.every(node=>{const box=node.getBBox();return box.x+box.width<=916;});holder.remove();return fits;
  },precise),'Every long reason line stays inside the report');

  await page.evaluate(()=>{
   const period=window.__reportQA.state().sections.science.periods[0];
   CSTRRecordTools.setScore(period.roster[0],'ww',0,'M');window.__reportQA.render();
  });
  assert.equal(await score.inputValue(),'M');
  await exportImage('missing-score',['M','—','M','13'],['M · Missing · counted as 0 / HPS']);

  let unexpectedDownload=false;page.on('download',()=>{unexpectedDownload=true;});
  await page.evaluate(()=>{
   window.__reportQA.state().sections.science.periods[0].roster[0].name='Different learner';window.__reportQA.render();
  });
  await exportButton.click();
  await page.getByText('Image export failed: This roster or period changed. Reopen the student report before saving its image.').waitFor();
  assert(!unexpectedDownload,'A changed roster row must never download the old learner snapshot');
  assert(await exportButton.isEnabled(),'Export recovers after a changed-record warning');
  await page.locator('.search-result-modal [data-action="close-modal"]').click();
  await page.locator('#view-tab-one').click();
  const one=page.locator('.editable-student-report');
  assert((await one.locator('.report-ledger').innerText()).includes('W'.repeat(500)),'One-learner report preserves the complete reason history');
  await one.getByLabel("Teacher's feedback / remarks").fill('One learner latest remark');
  exportButton=one.locator('[data-action="export-student-png"]');
  await exportImage('one-learner',['M','—','M','13'],['One learner latest remark','+0.00000001']);
  const oneScore=one.locator('input[data-score="ww"][data-index="0"]');
  await oneScore.fill('10');await page.keyboard.press('Control+z');
  assert.equal(await oneScore.inputValue(),'M','Undo direct score edit preserves the attendance mark and ledger');
  await page.keyboard.press('Control+Shift+z');assert.equal(await oneScore.inputValue(),'10');
  const hps=one.locator('input[data-hps="ww"][data-index="0"]');
  await hps.fill('8');await hps.press('Tab');assert.equal(await oneScore.inputValue(),'8');
  await page.keyboard.press('Control+z');
  assert.equal(await oneScore.inputValue(),'10','Undo HPS change restores capped scores together');
  assert.equal(await hps.inputValue(),'13');
  const title=one.locator('textarea[data-activity-kind="ww"][data-activity-index="0"][data-activity-field="title"]');
  await title.fill('Changed activity title');await page.keyboard.press('Control+z');
  assert.equal(await title.inputValue(),'Matter and measurement','Activity metadata participates in universal undo');
  await page.locator('#view-tab-sheet').click();
  await score.focus();
  await score.evaluate(input=>{const data=new DataTransfer();data.setData('text/plain','9\t7');input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  assert.equal(await score.inputValue(),'9');await page.keyboard.press('Control+z');
  assert.equal(await score.inputValue(),'10','A multi-cell paste undoes as one action');
  assert.equal(await page.locator('.record-table input[data-score="ww"][data-row="0"][data-index="1"]').inputValue(),'');
  console.log('PASS actual PNG downloads match current scores, individual/bulk reasons, cloud replacement, source period, HPS caps, cancellations and attendance marks; changed rows cannot export stale data.');
 }finally{await browser.close();server.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
