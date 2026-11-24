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
  const data=fixture(), original=clone(data.book);
  let writes=0,reads=0;
  await page.route('https://synthetic.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body><main><p>Synthetic preview. Invented learners and a simulated Google connection. No live school records.</p></main></body></html>'}));
  await page.goto('https://synthetic.test/');
  for(const file of ['design-system.css','visual-remaster.css','official-sync.css'])await page.addStyleTag({path:path.join(root,'ASSETS',file)});
  await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
  await page.evaluate(({source,email,native})=>{
    window.CSTRMobile={native};
    window.__syncSource=source;
    const user={uid:'synthetic-owner'};
    window.CSTRSync={getCurrentUser:()=>user,onAuthStateChanged(callback){window.__authCallback=callback;return()=>{};}};
    const auth={async setPersistence(){},async signOut(){},async signInWithPopup(){return {user:{email:email||'teacher@cstr.edu.ph',emailVerified:true},credential:{accessToken:'synthetic-token'}};}};
    const firebaseAuth=()=>auth;firebaseAuth.Auth={Persistence:{NONE:'none'}};
    firebaseAuth.GoogleAuthProvider=class {addScope(scope){window.__scope=scope;}setCustomParameters(){}};
    window.firebase={apps:[],auth:firebaseAuth,app:()=>({options:{projectId:'synthetic'}}),initializeApp:()=>({auth:()=>auth})};
  },{source:data.source,email:options.email,native:options.native||false});
  for(const file of ['grading-engine.js','official-sync-engine.js','official-sync.js'])await page.addScriptTag({path:path.join(root,'ASSETS',file)});
  await page.route('https://sheets.googleapis.com/**',async route=>{
    const request=route.request();
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    assert.equal(request.headers().authorization,'Bearer synthetic-token');
    if(request.method()==='POST'){
      writes++;
      for(const {updateCells:change}of request.postDataJSON().requests){
        assert.equal(change.fields,'userEnteredValue');assert.equal(change.start.columnIndex,2);
        const rows=data.book.sheets[0].data[0].rowData;
        change.rows[0].values.forEach((value,i)=>{rows[change.start.rowIndex].values[i+2]=clone(value);});
      }
      if(options.lostResponse)return route.abort('failed');
      return route.fulfill({status:200,headers,contentType:'application/json',body:'{}'});
    }
    reads++;
    const grid=request.url().includes('includeGridData');
    await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(grid?data.book:{...data.book,sheets:data.book.sheets.map(sheet=>({properties:sheet.properties}))})});
  });
  if(!options.native)await page.evaluate(()=>window.CSTROfficialSync.open({getSources:()=>[window.__syncSource]}));
  return {page,data,original,writes:()=>writes,reads:()=>reads};
}
async function prepare(h) {
  const {page}=h;
  await page.getByRole('textbox',{name:'School Google email'}).fill('teacher@cstr.edu.ph');
  await page.getByRole('button',{name:'Connect school account',exact:true}).click();
  await page.getByText('Connected as teacher@cstr.edu.ph',{exact:true}).waitFor();
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
      await h.page.getByText('All selected scores already match. Nothing needs to be written.',{exact:true}).waitFor();
      assert.equal(h.writes(),2);assert(await h.page.getByRole('button',{name:'Fill verified gradesheets',exact:true}).isHidden());
      console.log('PASS browser: a saved correction updates the same linked sheet; repeating unchanged scores makes no write');
      await h.page.close();
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
      await h.page.getByRole('button',{name:'Connect school account',exact:true}).click();
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
      const h=await harness(browser,{native:true});assert.equal(await h.page.evaluate(()=>Boolean(window.CSTROfficialSync)),false);
      assert(!fs.existsSync(path.join(root,'www/ASSETS/official-sync.js')));
      assert(!fs.existsSync(path.join(root,'www/ASSETS/official-sync-engine.js')));
      assert(!fs.readFileSync(path.join(root,'www/index.html'),'utf8').includes('official-sync'));
      console.log('PASS browser and Android package: transfer code is unavailable on native Android');await h.page.close();
    }
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
