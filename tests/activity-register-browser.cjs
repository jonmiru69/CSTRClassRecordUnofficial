'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'ASSETS/app.js'),'utf8').replace('  initApp();',`  window.__registerQA={period:()=>currentPeriod(),lock(value){currentPeriod().locked=value;render();},switchPeriod:selectRecordPeriod};\n  initApp();`);
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  if(file.endsWith(path.sep+'ASSETS'+path.sep+'app.js')){res.setHeader('Content-Type','text/javascript');res.end(source);return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'));res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await page.goto(origin+'/test-preview/index.html?screen=record');await page.locator('.activity-register').waitFor();
    const cell=(r,c)=>page.locator(`.activity-register [data-register-row="${r}"][data-register-col="${c}"]`);
    const input=(r,c)=>cell(r,c).locator('input,textarea');
    const period=()=>page.evaluate(()=>structuredClone(__registerQA.period()));
    const clipboard=(type,text='')=>page.evaluate(({type,text})=>{
      const data=new DataTransfer();data.setData('text/plain',text);
      document.activeElement.dispatchEvent(new ClipboardEvent(type,{bubbles:true,cancelable:true,clipboardData:data}));
      return data.getData('text/plain');
    },{type,text});
    const before=await period();
    const matrix=[['=Literal activity','Line one\nLine "two"','11/26/2026','10'],['Second activity','Second topic','2026-11-27','30']];
    const text=await page.evaluate(rows=>CSTRActivityGrid.stringify(rows),matrix);
    await input(0,0).click();await clipboard('paste',text);
    let p=await period();assert.equal(p.activityMeta.ww[0].title,matrix[0][0]);assert.equal(p.activityMeta.ww[0].topic,matrix[0][1]);
    assert.equal(p.wwDates[0],'2026-11-26');assert.equal(p.wwHps[0],'10');assert.equal(p.roster[0].ww[0],'10');
    assert.equal(p.activityMeta.ww[1].topic,'Second topic');assert.equal(p.wwHps[1],'30');
    await page.keyboard.press('Control+z');assert.deepEqual(await period(),before,'one undo must restore the entire block and HPS-adjusted scores');
    await page.keyboard.press('Control+Shift+z');p=await period();assert.equal(p.activityMeta.ww[0].title,matrix[0][0]);
    console.log('PASS rectangular paste, quoted multiline text, dates, HPS cap, and atomic undo/redo');

    await cell(1,1).scrollIntoViewIfNeeded();
    const a=await input(0,0).boundingBox(),b=await input(1,1).boundingBox();
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await page.mouse.up();
    assert.equal(await page.locator('.register-cell-selected').count(),4,'drag must select a rectangle');
    let copied=await clipboard('copy');
    assert.deepEqual(await page.evaluate(text=>CSTRActivityGrid.parse(text),copied),matrix.map(r=>r.slice(0,2)));
    await input(0,0).click();await page.keyboard.press('Shift+ArrowDown');await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await page.locator('.register-cell-selected').count(),4,'Shift+arrows must extend the range');
    await page.keyboard.press('Delete');p=await period();assert.equal(p.activityMeta.ww[0].title,'');assert.equal(p.activityMeta.ww[1].topic,'');
    await page.keyboard.press('Control+z');
    await page.locator('[data-register-column="1"]').click();await clipboard('paste','Alternating one\nAlternating two');
    p=await period();assert.deepEqual(['ww','pt','qa'].flatMap(k=>p.activityMeta[k].map(m=>m.topic)),Array.from({length:6},(_,i)=>i%2?'Alternating two':'Alternating one'));
    await page.keyboard.press('Control+z');
    console.log('PASS mouse dragging, Shift+arrow selection, multiline copy, clear and undo');

    await page.locator('[data-register-column="1"]').click();assert.equal(await page.locator('.register-cell-selected').count(),6);
    await clipboard('paste','Shared topic');p=await period();assert(['ww','pt','qa'].every(k=>p.activityMeta[k].every(m=>m.topic==='Shared topic')));
    await page.keyboard.press('Control+z');
    await page.locator('[data-register-select-row="0"]').click();await page.locator('[data-register-select-row="2"]').click({modifiers:['Shift']});
    assert.equal(await page.locator('.register-cell-selected').count(),12);
    assert.equal((await page.evaluate(text=>CSTRActivityGrid.parse(text),await clipboard('copy'))).length,3);
    await page.locator('[data-register-column="0"]').click();await page.locator('[data-register-column="1"]').click({modifiers:['Shift']});assert.equal(await page.locator('.register-cell-selected').count(),12);
    await input(0,0).click();await page.locator('[data-register-extend]').click();await input(2,1).click();assert.equal(await page.locator('.register-cell-selected').count(),6);await page.locator('[data-register-extend]').click();
    console.log('PASS whole rows/columns, Shift+heading ranges, scalar fill, and tap-to-extend selection');

    await input(0,0).click();const unchanged=await period();
    await clipboard('paste','Bad title\tTopic\t2026-02-31\t20');assert.deepEqual(await period(),unchanged);
    await clipboard('paste','Bad title\tTopic\t2026-11-26\tinvalid');assert.deepEqual(await period(),unchanged);
    await input(5,3).focus();await clipboard('paste','10\t20');assert.deepEqual(await period(),unchanged,'out-of-bounds paste must not partially modify a block');
    await input(0,2).focus();await clipboard('paste','12/31/2026');assert.equal((await period()).wwDates[0],'2026-12-31','date paste must bypass the old calendar paste blocker');
    await page.keyboard.press('Control+z');
    console.log('PASS invalid dates/HPS and overflow are atomic; calendar cells accept valid pasted dates');

    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{throw new Error('Denied');},writeText:async text=>{window.__copied=text;}}}));
    await input(0,0).click();await page.locator('[data-register-command="paste"]').click();await page.locator('.register-paste-dialog').waitFor();
    await page.getByLabel('Copied activity cells').fill('Dialog title\tDialog topic');await page.getByRole('button',{name:'Apply paste',exact:true}).click();
    p=await period();assert.equal(p.activityMeta.ww[0].title,'Dialog title');assert.equal(p.activityMeta.ww[0].topic,'Dialog topic');
    await page.locator('[data-register-command="copy"]').click();await page.waitForFunction(()=>window.__copied==='Dialog title\tDialog topic');
    await clipboard('cut');p=await period();assert.equal(p.activityMeta.ww[0].title,'');assert.equal(p.activityMeta.ww[0].topic,'');await page.keyboard.press('Control+z');
    console.log('PASS paste dialog fallback, toolbar copy, range cut and undo');
    await page.locator('[data-register-column="0"]').click();await page.locator('.activity-register select[data-activity-field="role"]').first().focus();
    const protectedPeriod=await period();await clipboard('paste','Must not paste into old selection');assert.deepEqual(await period(),protectedPeriod);assert.equal(await page.locator('.register-cell-selected').count(),0);
    await input(5,3).focus();await page.keyboard.press('Tab');assert(await page.evaluate(()=>!document.activeElement.closest('[data-register-cell]')),'Tab must leave the last grid cell');
    await input(0,0).focus();await page.keyboard.press('Shift+Tab');assert(await page.evaluate(()=>!document.activeElement.closest('[data-register-cell]')),'Shift+Tab must leave the first grid cell');
    console.log('PASS assessment-group controls remain separate and Tab can exit the grid');

    await page.evaluate(()=>__registerQA.lock(true));await page.locator('[data-register-column="0"]').click();
    const locked=await period();assert((await clipboard('copy')).includes('Dialog title'));
    await clipboard('paste','Blocked');await clipboard('cut');await page.keyboard.press('Delete');assert.deepEqual(await period(),locked);
    await page.evaluate(()=>{__registerQA.lock(false);__registerQA.switchPeriod(1);});assert.equal(await page.locator('.register-cell-selected').count(),0,'period navigation must clear selection');
    await page.evaluate(()=>__registerQA.switchPeriod(0));await input(0,0).click();await page.keyboard.press('Control+a');assert.equal(await page.locator('.register-cell-selected').count(),24);
    await page.keyboard.press('Escape');assert.equal(await page.locator('.register-cell-selected').count(),1);
    await input(0,0).click();
    assert.equal(await input(0,0).evaluate(field=>{field.setSelectionRange(0,6);const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});field.dispatchEvent(event);return event.defaultPrevented;}),false,'single-field text selection must keep native copy');
    assert.deepEqual(errors,[]);console.log('PASS locked-period protection, copy while locked, Ctrl+A/Escape, and navigation reset');
    const out=path.join(root,'.build-artifacts/activity-register');fs.mkdirSync(out,{recursive:true});await page.locator('[data-register-column="1"]').click();await page.locator('.activity-register').screenshot({path:path.join(out,'range-selection.png')});
    await page.setViewportSize({width:390,height:844});await page.locator('#view-tab-sheet').click();
    await input(0,0).click();await page.locator('[data-register-extend]').click();await input(1,1).click();assert.equal(await page.locator('.register-cell-selected').count(),4);
    await page.locator('[data-register-command="paste"]').click();await page.locator('.register-paste-dialog').waitFor();
    const box=await page.locator('.register-paste-dialog').boundingBox();assert(box.x>=0&&box.x+box.width<=390,'mobile paste dialog must fit the viewport');
    await page.getByLabel('Copied activity cells').fill('Mobile title\tMobile topic');await page.getByRole('button',{name:'Apply paste',exact:true}).click();
    p=await period();assert.equal(p.activityMeta.ww[0].title,'Mobile title');assert.equal(p.activityMeta.ww[1].topic,'Mobile topic');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
    console.log('PASS phone range selection, repeated rectangular paste, paste dialog sizing, and no document overflow');
    await page.setViewportSize({width:1440,height:1000});
    const score=(r,c)=>page.locator(`.record-table tbody [data-score="ww"][data-row="${r}"][data-index="${c}"]`);
    await score(0,0).focus();await score(0,0).dispatchEvent('mousedown',{button:0,buttons:1});await score(1,1).dispatchEvent('mouseover',{buttons:1});await page.evaluate(()=>document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})));
    assert.equal(await page.locator('.register-cell-selected').count(),0,'grade-sheet selection must release register selection');
    assert.equal(await page.locator('.record-table .cell-selected').count(),4);
    p=await period();assert.equal(await clipboard('copy'),p.roster.slice(0,2).map(learner=>learner.ww.slice(0,2).join('\t')).join('\n'));
    assert.deepEqual(errors,[]);console.log('PASS existing grade-sheet range copy remains independent of the activity register');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
