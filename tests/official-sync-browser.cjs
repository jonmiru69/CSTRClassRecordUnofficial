'use strict';
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {fixture}=require('./official-sync.cjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.impeccable/review');
const clone=value=>JSON.parse(JSON.stringify(value));
async function harness(browser, options={}) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>console.error('Browser error:',error.message));
  const data=fixture(Boolean(options.partitions));
  const sources=[data.source], books={'synthetic-book':data.book};
  if(options.partitions){
    data.source.partition='ABM';data.source.classPeriodId='synthetic-class';data.source.id='synthetic-ABM';
    const stem=clone(data.source);stem.partition='STEM';stem.id='synthetic-STEM';
    data.source.periods[0].roster.splice(1);stem.periods[0].roster.splice(0,1);sources.push(stem);
    const stemBook=clone(data.book);stemBook.spreadsheetId='synthetic-stem';stemBook.properties.title='Synthetic official STEM gradesheet';
    data.book.properties.title='Synthetic official ABM gradesheet';
    data.book.sheets[0].data[0].rowData[13].values[0]={};
    stemBook.sheets[0].data[0].rowData[10].values[0]={};books['synthetic-stem']=stemBook;
  }
  if(options.sourceOnly)data.source.periods[0].roster[0].name='Unmatched, Synthetic';
  if(options.officialOnly){data.source.periods[0].roster.pop();data.rows[15].values[2]={userEnteredValue:{numberValue:12},formattedValue:'12'};}
  if(options.rounding){
    const period=data.source.periods[0];period.wwHps=[100];period.ptHps=[100];period.qaHps=[120,120,120];
    period.roster[0].ww=[97.38];period.roster[0].pt=[87.653];period.roster[0].qa=[40.3,40.3,40.3];
    [19.476,43.8265,10.075].forEach((numberValue,i)=>data.rows[10].values[i+2]={userEnteredValue:{numberValue},formattedValue:String(numberValue)});
  }
  if(options.quarters)for(const source of sources){
    const second=clone(source.periods[0]);second.quarter=2;second.name='Second quarter';
    second.roster.forEach(learner=>{learner.ww=[20];if(options.emptyQuarter)learner.name='Unmatched '+learner.name;});
    source.periods.push(second);
  }
  if(options.driveDuplicate){books['duplicate-book']=clone(data.book);books['duplicate-book'].spreadsheetId='duplicate-book';}
  const original=clone(data.book);
  let writes=0,reads=0;
  await page.route('https://synthetic.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body><main><p>Synthetic preview. Invented learners and a simulated Google connection. No live school records.</p></main></body></html>'}));
  await page.goto('https://synthetic.test/');
  for(const match of fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/rel="stylesheet" href="ASSETS\/([^"?]+)(?:\?[^"\s]*)?"/g))await page.addStyleTag({path:path.join(root,'ASSETS',match[1])});
  await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
  await page.evaluate(({source,sources,email,native})=>{
    window.CSTRMobile={native};
    window.__syncSources=sources;
    window.__syncSource=window.__syncSources[0];
    const user=window.__workspaceUser={uid:'synthetic-owner',email:'teacher@example.test'};
    window.__schoolSettings={};
    window.CSTRSync={db:{ref(key){return {async once(){return {val:()=>window.__schoolSettings[key]||null};},async transaction(fn){window.__schoolSettings[key]=fn(window.__schoolSettings[key]||null);return {snapshot:{val:()=>window.__schoolSettings[key]}};},async update(value){const next={...window.__schoolSettings[key],...value};for(const field in next)if(next[field]===null)delete next[field];window.__schoolSettings[key]=next;},async set(value){if(window.__failSchoolSave)throw Error('offline');window.__schoolSettings[key]=value;}};}},getCurrentUser:()=>window.__workspaceUser,onAuthStateChanged(callback){window.__authCallback=callback;return()=>{};}};
    const auth={async setPersistence(){},async signOut(){},async signInWithPopup(){return {user:{email:email||'teacher@cstr.edu.ph',emailVerified:true},credential:{accessToken:'synthetic-token'}};}};
    const firebaseAuth=()=>auth;firebaseAuth.Auth={Persistence:{NONE:'none'}};
    firebaseAuth.GoogleAuthProvider=class {addScope(scope){window.__scope=scope;}setCustomParameters(params){window.__oauthPrompt=params.prompt;}};
    window.firebase={apps:[],auth:firebaseAuth,app:()=>({options:{projectId:'synthetic'}}),initializeApp:()=>({auth:()=>auth})};
  },{source:data.source,sources,email:options.email,native:options.native||false});
  for(const file of ['grading-engine.js','official-sync-engine.js','official-sync-drive.js','official-sync.js'])await page.addScriptTag({path:path.join(root,'ASSETS',file)});
  await page.route('https://www.googleapis.com/drive/v3/**',route=>{
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type,x-goog-drive-resource-keys','Access-Control-Allow-Methods':'GET,OPTIONS'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    assert.equal(route.request().headers().authorization,'Bearer synthetic-token');
    if(options.driveError)return route.fulfill({status:403,headers,json:{error:{message:'insufficient authentication scopes',details:[{reason:'ACCESS_TOKEN_SCOPE_INSUFFICIENT'}]}}});
    const url=new URL(route.request().url());
    const result=url.pathname.endsWith('/files/root')?{id:'root',name:'Registrar',mimeType:'application/vnd.google-apps.folder'}:{files:Object.entries(books).map(([id,book])=>({id,name:book.properties.title,mimeType:'application/vnd.google-apps.spreadsheet'}))};
    return route.fulfill({status:200,headers,json:result});
  });
  await page.route('https://sheets.googleapis.com/**',async route=>{
    const request=route.request();
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    const id=new URL(request.url()).pathname.split('/').at(-1).replace(':batchUpdate','');
    const book=books[id];assert(book,'Unexpected target');
    assert.equal(request.headers().authorization,'Bearer synthetic-token');
    if(request.method()==='POST'){
      writes++;
      for(const {updateCells:change}of request.postDataJSON().requests){
        assert.equal(change.fields,'userEnteredValue');assert.equal(change.start.columnIndex,2);
        const rows=book.sheets[0].data[0].rowData;
        change.rows[0].values.forEach((value,i)=>{rows[change.start.rowIndex].values[i+2]=clone(value);});
      }
      if(options.lostResponse)return route.abort('failed');
      return route.fulfill({status:200,headers,contentType:'application/json',body:'{}'});
    }
    reads++;
    const grid=request.url().includes('includeGridData');
    await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(grid?book:{...book,sheets:book.sheets.map(sheet=>({properties:sheet.properties}))})});
  });
  if(!options.native)await page.evaluate(()=>window.CSTROfficialSync.open({getSources:()=>window.__syncSources}));
  return {page,data,original,writes:()=>writes,reads:()=>reads};
}
async function prepare(h) {
  const {page}=h;
  await page.getByRole('textbox',{name:'School Google email'}).fill('teacher@cstr.edu.ph');
  await page.getByRole('button',{name:'Link school account',exact:true}).click();
  await page.getByText(/Connected as teacher@cstr.edu.ph/).waitFor();
  assert.equal(await page.evaluate(()=>window.__oauthPrompt),'select_account');
  await page.getByRole('textbox',{name:'Official Google Sheets link',exact:true}).fill('https://docs.google.com/spreadsheets/d/synthetic-book/edit#gid=7');
  await page.getByRole('button',{name:'Check link',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-sync-check]').disabled);
  assert(!(await page.locator('[data-sync-status]').innerText()).includes('Google could not'),await page.locator('[data-sync-status]').innerText());
  if(!(await page.locator('[data-sync-job-status]').innerText()).includes('Template'))throw new Error(await page.locator('.official-sync-dialog').innerText());
  await page.getByText(/Template and school year checked/).waitFor();
  await page.getByRole('button',{name:'Preview finished periods',exact:true}).click();
  await page.getByText('Preview ready. Review the matches before filling.',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-sync-apply]').disabled);
}
async function main(){
  execFileSync(process.execPath,['tools/build-mobile.mjs'],{cwd:root,stdio:'pipe'});
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    {
      const h=await harness(browser);await prepare(h);
      await h.page.locator('.sync-review summary').click();
      for(const [name,width,height,dark]of [['desktop',1440,1000,false],['mobile',390,844,false],['user-1232',1232,912,false],['dark',1440,1000,true]]){
        await h.page.setViewportSize({width,height});await h.page.evaluate(dark=>document.documentElement.dataset.theme=dark?'dark':'light',dark);
        await h.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert(await h.page.locator('.official-sync-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'Dialog must not overflow horizontally');
        await h.page.screenshot({path:path.join(output,`${name}.png`),fullPage:true,animations:'disabled'});
      }
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/Finished: 1 workbook checked/).waitFor();
      assert.equal(h.writes(),1);
      const before=h.original.sheets[0].data[0].rowData,after=h.data.book.sheets[0].data[0].rowData;
      for(let r=0;r<after.length;r++)for(let c=0;c<7;c++)if(!([10,15].includes(r)&&[2,3,4].includes(c)))assert.deepEqual(after[r]?.values[c],before[r]?.values[c]);
      console.log('PASS browser: verified atomic numeric transfer preserves names, formulas, unused quarters, and formatting');
      // The teacher saves a correction, opens a fresh preview, and fills again.
      // The same linked workbook and school connection remain usable.
      await h.page.evaluate(()=>window.__syncSource.periods[0].roster[0].ww[0]=20);
      await h.page.getByRole('button',{name:'Create a fresh preview',exact:true}).click();
      await h.page.getByText('Preview ready. Review the matches before filling.',{exact:true}).waitFor();
      await h.page.getByRole('checkbox',{name:/I reviewed the existing scores/}).check();
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/Finished: 1 workbook checked/).waitFor();
      assert.equal(h.writes(),2);assert.equal(after[10].values[2].userEnteredValue.numberValue,20);
      await h.page.getByRole('button',{name:'Create a fresh preview',exact:true}).click();
      await h.page.getByText('All matched scores already agree. Nothing needs to be written.',{exact:true}).waitFor();
      assert.equal(h.writes(),2);assert(await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).isHidden());
      console.log('PASS browser: a saved correction updates the same linked sheet; repeating unchanged scores makes no write');
      await h.page.close();
    }
    {
      const h=await harness(browser,{quarters:true});await prepare(h);
      const review=h.page.locator('[data-sync-review]').first();await review.locator('summary').click();
      assert.equal(await review.getByRole('button',{name:'Quarter 1',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await review.locator('tbody tr:visible').count(),2);
      assert.equal(await review.getByRole('button',{name:'Quarter 3',exact:true}).count(),0);
      const reads=h.reads(),source=JSON.stringify(h.data.source);
      await review.locator('.sync-table-wrap').evaluate(node=>{node.style.maxHeight='60px';node.scrollTop=40;});
      await review.getByRole('button',{name:'Quarter 2',exact:true}).focus();
      await h.page.keyboard.press('Enter');
      assert.equal(await review.getByRole('button',{name:'Quarter 2',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await review.locator('[data-sync-quarter-label]').innerText(),'Quarter 2 · 2 matched learners');
      assert.deepEqual(await review.locator('tbody tr:visible td:nth-child(2)').allTextContents(),['2','2']);
      assert.equal(await review.locator('.sync-table-wrap').evaluate(node=>node.scrollTop),0);
      assert.equal(h.reads(),reads);assert.equal(h.writes(),0);assert.equal(JSON.stringify(h.data.source),source);
      await review.locator('.sync-table-wrap').evaluate(node=>node.style.maxHeight='');
      for(const [name,width,height,dark]of [['quarters-desktop',1440,1000,false],['quarters-phone',390,844,false],['quarters-dark',1440,1000,true]]){
        await h.page.setViewportSize({width,height});await h.page.evaluate(dark=>document.documentElement.dataset.theme=dark?'dark':'light',dark);
        assert(await h.page.locator('.official-sync-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
        const selected=review.getByRole('button',{name:'Quarter 2',exact:true}),other=review.getByRole('button',{name:'Quarter 1',exact:true});
        assert.notEqual(await selected.evaluate(node=>getComputedStyle(node).backgroundColor),await other.evaluate(node=>getComputedStyle(node).backgroundColor));
        assert(await selected.evaluate(node=>node.getBoundingClientRect().height>=44));
        await h.page.screenshot({path:path.join(output,`${name}.png`),fullPage:true,animations:'disabled'});
      }
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/Finished: 1 workbook checked/).waitFor();
      assert.equal(h.data.rows[10].values[2].userEnteredValue.numberValue,15);
      assert.equal(h.data.rows[11].values[2].userEnteredValue.numberValue,20);
      assert.equal(await review.getByRole('button',{name:'Quarter 2',exact:true}).getAttribute('aria-pressed'),'true');
      console.log('PASS browser: keyboard quarter filters show one quarter, reset its scroll, keep sources untouched, and transfer every selected quarter');await h.page.close();
    }
    {
      const h=await harness(browser,{quarters:true,emptyQuarter:true});await prepare(h);
      const review=h.page.locator('[data-sync-review]').first();await review.locator('summary').click();
      await review.getByRole('button',{name:'Quarter 2',exact:true}).click();
      assert.equal(await review.locator('tbody tr:visible').count(),0);
      assert(await review.getByText(/No matched learners for this quarter/).isVisible());
      console.log('PASS browser: a finished quarter with no official matches has an explicit empty state');await h.page.close();
    }
    {
      const h=await harness(browser,{rounding:true});await prepare(h);
      await h.page.locator('.sync-review summary').first().click();
      await h.page.getByText('WW/PT/QA scores are rounded to two decimal places before transfer.',{exact:true}).waitFor();
      const displayed=await h.page.locator('.sync-review tbody tr').first().innerText();
      assert(displayed.includes('19.48')&&displayed.includes('43.83')&&displayed.includes('10.08'));
      await h.page.getByRole('checkbox',{name:/I reviewed the existing scores/}).check();
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/Finished: 1 workbook checked/).waitFor();
      assert.deepEqual(h.data.rows[10].values.slice(2,5).map(c=>c.userEnteredValue.numberValue),[19.48,43.83,10.08]);
      assert.equal(h.data.source.periods[0].roster[0].ww[0],97.38);
      await h.page.getByRole('button',{name:'Create a fresh preview',exact:true}).click();
      await h.page.getByText('All matched scores already agree. Nothing needs to be written.',{exact:true}).waitFor();
      assert.equal(h.writes(),1);
      console.log('PASS browser: repairs previous full-precision inputs with two-decimal numeric writes and a zero-write repeat');await h.page.close();
    }
    {
      const h=await harness(browser);await prepare(h);
      h.data.rows[10].values[2]={userEnteredValue:{numberValue:99},formattedValue:'99'};
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/changed after preview/).waitFor();assert.equal(h.writes(),0);
      console.log('PASS browser: stale official cells block the write');await h.page.close();
    }
    {
      const h=await harness(browser);await prepare(h);
      await h.page.evaluate(()=>window.__syncSource.periods[0].complete=false);
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/no completed periods/).waitFor();assert.equal(h.writes(),0);
      console.log('PASS browser: a period becoming unfinished blocks the write');await h.page.close();
    }
    {
      const h=await harness(browser,{email:'wrong@cstr.edu.ph'});
      await h.page.getByRole('textbox',{name:'School Google email'}).fill('teacher@cstr.edu.ph');
      await h.page.getByRole('button',{name:'Link school account',exact:true}).click();
      await h.page.getByText(/selected a different Google account/).waitFor();assert.equal(h.reads(),0);assert.equal(h.writes(),0);
      console.log('PASS browser: wrong school identity never gets a usable connection');await h.page.close();
    }
    {
      const h=await harness(browser,{lostResponse:true});await prepare(h);
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/Finished: 1 workbook checked/).waitFor();assert.equal(h.writes(),1);
      console.log('PASS browser: lost write response is resolved by readback without retrying the write');await h.page.close();
    }
    {
      const h=await harness(browser,{partitions:true,quarters:true});
      await h.page.getByRole('textbox',{name:'School Google email'}).fill('teacher@cstr.edu.ph');
      await h.page.getByRole('button',{name:'Link school account',exact:true}).click();
      await h.page.getByText(/Connected as teacher@cstr.edu.ph/).waitFor();
      for(const [strand,id]of [['B&E / ABM','synthetic-book'],['STEM','synthetic-stem']]){
        const group=h.page.getByRole('group',{name:`General Science 11 · Grade 11 · Saint Sample · ${strand}`,exact:true});
        await group.getByRole('textbox',{name:'Official Google Sheets link',exact:true}).fill(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=7`);
        await group.getByRole('button',{name:'Check link',exact:true}).click();
        await group.getByText(/Template and school year checked/).waitFor();
      }
      await h.page.screenshot({path:path.join(output,'strands.png'),fullPage:true,animations:'disabled'});
      await h.page.getByRole('button',{name:'Preview finished periods',exact:true}).click();
      await h.page.getByText(/2 finished periods selected across 2 official targets/).waitFor();
      const reviews=h.page.locator('[data-sync-review]');
      await reviews.nth(0).locator('summary').click();await reviews.nth(1).locator('summary').click();
      await reviews.nth(0).getByRole('button',{name:'Quarter 2',exact:true}).click();
      assert.equal(await reviews.nth(1).getByRole('button',{name:'Quarter 1',exact:true}).getAttribute('aria-pressed'),'true');
      assert.deepEqual(await reviews.nth(1).locator('tbody tr:visible td:nth-child(2)').allTextContents(),['1']);
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/Finished: 2 workbooks checked/).waitFor();assert.equal(h.writes(),2);
      console.log('PASS browser: B&E/ABM and STEM groups fill separate official files while counting their shared period once');await h.page.close();
    }
    {
      const h=await harness(browser,{officialOnly:true});await prepare(h);
      await h.page.getByText('1 official learner-period rows will stay unchanged',{exact:true}).waitFor();
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/Finished: 1 workbook checked/).waitFor();
      assert.deepEqual(h.data.rows[15].values,h.original.sheets[0].data[0].rowData[15].values);
      console.log('PASS browser: official learners absent from this source period keep their entire existing row unchanged');await h.page.close();
    }
    {
      const h=await harness(browser,{sourceOnly:true});await prepare(h);
      await h.page.getByText('1 source learner-period entries will be skipped',{exact:true}).waitFor();
      await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).click();
      await h.page.getByText(/Finished: 1 workbook checked/).waitFor();
      assert.deepEqual(h.data.rows[10].values,h.original.sheets[0].data[0].rowData[10].values);
      assert.equal(h.data.rows[15].values[2].userEnteredValue.numberValue,0);
      console.log('PASS browser: source-only names are disclosed and skipped while matched learners update correctly');await h.page.close();
    }
    {
      const h=await harness(browser);const page=h.page;
      assert.equal(await page.locator('[data-sync-email]').inputValue(),'');
      assert.equal(await page.locator('[data-sync-guide]').getAttribute('open'),'');
      await page.locator('[data-sync-email]').fill('teacher@cstr.edu.ph');
      await page.locator('[data-sync-connect]').click();
      await page.getByText(/School-email link saved/).waitFor();
      const saved=await page.evaluate(()=>window.__schoolSettings);
      assert.equal(Object.values(saved)[0].email,'teacher@cstr.edu.ph');
      assert(!JSON.stringify(saved).includes('synthetic-token'));
      await page.evaluate(async()=>{window.CSTROfficialSync.reset();await window.CSTROfficialSync.open({getSources:()=>window.__syncSources});});
      assert.equal(await page.locator('[data-sync-email]').inputValue(),'teacher@cstr.edu.ph');
      assert.equal(await page.locator('[data-sync-email]').getAttribute('readonly'),'');
      await page.getByText(/Linked to teacher@cstr.edu.ph/).waitFor();
      await page.locator('[data-sync-disconnect]').click();
      await page.getByText(/School account unlinked/).waitFor();
      await page.evaluate(async()=>{window.CSTROfficialSync.reset();await window.CSTROfficialSync.open({getSources:()=>window.__syncSources});});
      assert.equal(await page.locator('[data-sync-email]').inputValue(),'');
      await page.evaluate(async()=>{window.__workspaceUser={uid:'different-owner',email:'other@example.test'};window.CSTROfficialSync.reset();await window.CSTROfficialSync.open({getSources:()=>window.__syncSources});});
      assert.equal(await page.locator('[data-sync-email]').inputValue(),'');
      await page.evaluate(async()=>{window.__workspaceUser={uid:'preferred-owner',email:'sanchezramil2202@gmail.com'};window.CSTROfficialSync.reset();await window.CSTROfficialSync.open({getSources:()=>window.__syncSources});});
      assert.equal(await page.locator('[data-sync-email]').inputValue(),'rsanchez.faculty@cstr.edu.ph');
      console.log('PASS school link persists in account settings across session resets, stores no OAuth token, isolates owners, honors unlink, and prefills only the requested website account');await page.close();
    }
    for(const scanCase of [{},{driveDuplicate:true},{driveError:true}]){
      const h=await harness(browser,scanCase),page=h.page;
      await page.locator('[data-sync-email]').fill('teacher@cstr.edu.ph');await page.locator('[data-sync-connect]').click();await page.getByText(/School-email link saved/).waitFor();
      await page.locator('[data-sync-folder]').fill('https://drive.google.com/drive/folders/root');await page.locator('[data-sync-scan]').click();
      if(scanCase.driveError){await page.locator('[data-sync-status]').filter({hasText:'allow both spreadsheet access and Drive file-list access'}).waitFor();}
      else {
        await page.getByText(/Folder scan finished/).waitFor();
        if(scanCase.driveDuplicate){assert((await page.locator('[data-sync-scan-results]').innerText()).includes('Ambiguous'));assert.equal(await page.locator('[data-sync-tab]').inputValue(),'');}
        else {assert.equal(await page.locator('[data-sync-tab]').inputValue(),'7');await page.locator('[data-sync-preview-button]').click();await page.getByText('Preview ready. Review the matches before filling.',{exact:true}).waitFor();}
      }
      assert.equal(h.writes(),0);await page.close();
    }
    console.log('PASS browser: folder scan aligns unique content matches for preview without writes; duplicates remain unresolved; missing Drive scope gives reconnect instructions');
    {
      const h=await harness(browser,{native:true});assert.equal(await h.page.evaluate(()=>Boolean(window.CSTROfficialSync)),false);
      assert(!fs.existsSync(path.join(root,'www/ASSETS/official-sync.js')));
      assert(!fs.existsSync(path.join(root,'www/ASSETS/official-sync-engine.js')));
      assert(!fs.existsSync(path.join(root,'www/ASSETS/official-sync-drive.js')));
      assert(!fs.readFileSync(path.join(root,'www/index.html'),'utf8').includes('official-sync'));
      console.log('PASS browser and Android package: transfer code is unavailable on native Android');await h.page.close();
    }
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
