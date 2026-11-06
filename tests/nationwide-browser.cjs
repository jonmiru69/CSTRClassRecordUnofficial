'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const emulate=process.argv.includes('--emulator');
const root=path.join(__dirname,'..'),out=path.join(root,'.build-artifacts','nationwide');
fs.mkdirSync(out,{recursive:true});
const password='synthetic-strong-2026';
const email='synthetic-pilot@example.test';
const legacyEmail='synthetic-faculty@example.test';
const project='demo-cstr-review';
const adminHost='http://127.0.0.1:9099';
async function post(path,data){
  const response=await fetch(adminHost+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const json=await response.json();assert(response.ok,JSON.stringify(json));return json;
}
async function installFixtures(){
  const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
  const {ref,set}=require('firebase/database');
  const env=await initializeTestEnvironment({projectId:project,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(path.join(root,'firebase-database-rules.json'),'utf8')}});
  const account=await post('/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-cstr-local',{email:legacyEmail,password,returnSecureToken:true});
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.database(),uid=account.localId;
    await set(ref(db,'nationwide-v1/control'),{registration:true,privateRecords:false});
    await set(ref(db,'cstr-registration-approved/'+uid),{approvedAt:1,approvedBy:'developer-verified'});
    await set(ref(db,'cstr-class-record-users/'+uid),{dataKey:'legacy-synthetic-record',name:'Synthetic CST-R faculty',isLegacy:true});
    await set(ref(db,'cstr-class-record-bindings/legacy-synthetic-record'),{boundUid:uid});
    await set(ref(db,'cstr-class-record-data/legacy-synthetic-record'),{version:4,teacher:{name:'Synthetic CST-R faculty'},_syncRevision:5});
  });
  return env;
}
async function run(){
  execFileSync(process.execPath,['tools/build-web.mjs'],{cwd:root,stdio:'pipe',env:{...process.env,CSTR_NATIONWIDE_MODE:emulate?'emulator':'closed'}});
  const {serve}=await import('../tools/preview-nationwide.mjs');
  const {server,origin}=await serve();
  const browser=await chromium.launch({channel:'chrome',headless:true});
  let env;
  try{
    if(emulate)env=await installFixtures();
    const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:960}});
    const unexpected=[];
    await context.route('**/*',r=>{
      const url=new URL(r.request().url());
      if(url.origin===origin||emulate&&['http://127.0.0.1:9099','http://127.0.0.1:9000'].includes(url.origin))return r.continue();
      unexpected.push(url.hostname);return r.abort();
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/');
    await page.getByRole('heading',{name:'Grades that add up.'}).waitFor();
    await page.screenshot({path:path.join(out,'landing-desktop.png'),fullPage:true});
    await page.getByRole('link',{name:'Try a practice class'}).click();
    await page.getByRole('heading',{name:'Grade 6 Science'}).waitFor();
    assert.doesNotMatch(await page.locator('main').innerText(),/\bundefined\b/);
    assert.match(await page.locator('[data-learner=r02]').innerText(),/^75/);
    assert.match(await page.locator('[data-learner=r03]').innerText(),/^60/);
    assert.match(await page.locator('[data-learner=r04]').innerText(),/blank stays pending/);
    const score=page.getByRole('textbox',{name:'Example learner 2 WW 1'});
    await score.fill('100');
    assert.equal(await score.getAttribute('aria-invalid'),'true');
    await score.fill('');
    assert.match(await page.locator('[data-learner=r02]').innerText(),/blank stays pending/);
    await score.fill('14');
    assert.match(await page.locator('[data-learner=r02]').innerText(),/^75/);
    let filePromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download practice XLSX'}).click();
    let file=await filePromise;
    await file.saveAs(path.join(out,'Grade-6-Science-SYNTHETIC-PRACTICE.xlsx'));
    await page.getByRole('button',{name:'Preview gradesheet'}).click();
    await page.getByRole('heading',{name:'Supplementary gradesheet'}).waitFor();
    assert.match(await page.locator('.report-paper').innerText(),/Synthetic practice/);
    filePromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download Word'}).click();
    file=await filePromise;
    await file.saveAs(path.join(out,'Supplementary-gradesheet-SYNTHETIC.docx'));
    await page.evaluate(()=>{window.print=()=>{window.__testPrint=true;};});
    await page.getByRole('button',{name:'Print or save PDF'}).click();
    assert.equal(await page.evaluate(()=>window.__testPrint),true);
    assert(await page.locator('body').evaluate(body=>body.classList.contains('printing')));
    const pdf=await page.pdf({path:path.join(out,'Supplementary-gradesheet-SYNTHETIC.pdf'),format:'A4'});
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
    await page.setViewportSize({width:390,height:850});
    await page.goto(origin+'/practice/');
    assert(await page.getByRole('combobox',{name:'Choose a learner'}).isVisible());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,'practice-phone.png'),fullPage:true});
    await page.goto(origin+'/');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,'landing-phone.png'),fullPage:true});
    if(!emulate){
      await page.goto(origin+'/register/');
      await page.getByText('New teacher accounts are paused while the pilot is reviewed.').waitFor();
      assert.equal(await page.locator('input').count(),0);
      assert.deepEqual(unexpected,[]);
    }else{
      await page.setViewportSize({width:1060,height:900});
      await page.goto(origin+'/register/');
      await page.getByLabel('Email address').fill(email);
      await page.getByLabel('Password · at least 12 characters').fill(password);
      await page.getByLabel('Confirm password').fill(password);
      await page.getByRole('checkbox').check();
      await page.getByRole('button',{name:'Create account'}).click();
      await page.getByRole('heading',{name:'Verify your email'}).waitFor();
      let code;
      for(let i=0;i<25&&!code;i++){
        const payload=await (await fetch(adminHost+'/emulator/v1/projects/'+project+'/oobCodes')).json();
        code=payload.oobCodes?.find(x=>x.email===email)?.oobCode;
        if(!code)await new Promise(r=>setTimeout(r,200));
      }
      assert(code,'Verification mail must be generated in the emulator');
      await page.evaluate(code=>firebase.auth().applyActionCode(code),code);
      await page.getByRole('button',{name:'I verified my email'}).click();
      await page.getByRole('heading',{name:'Choose your school'}).waitFor();
      await page.getByLabel('Display name').fill('Synthetic teacher');
      await page.getByLabel('Region',{exact:true}).selectOption('demo');
      await page.getByLabel('Search schools').fill('ELA');
      await page.getByRole('button',{name:/Example Learning Academy/}).click();
      await page.getByRole('button',{name:'Save profile'}).click();
      await page.getByRole('heading',{name:'Your class record'}).waitFor();
      await page.getByText('Example Learning Academy',{exact:true}).waitFor();
      const uid=await page.evaluate(()=>firebase.auth().currentUser.uid);
      const {ref,set,update,get}=require('firebase/database');
      await env.withSecurityRulesDisabled(async ctx=>{
        const db=ctx.database();
        await update(ref(db,'nationwide-v1'),{'control/privateRecords':true,
          ['privateGrants/'+uid+'/d900002']:{active:true,expiresAt:Date.now()+300000,sector:'private',schoolName:'Example Learning Academy',
            schoolYear:'2026-2027',curriculum:'Example private curriculum',grade:6,subject:'Science',policy:'private-g6-science-v1'}});
      });
      await page.getByLabel('New Grade 6 Science class').fill('Synthetic pilot class');
      await page.getByRole('button',{name:'Create class'}).click();
      await page.getByLabel('Learner name',{exact:true}).fill('Invented learner');
      await page.getByRole('button',{name:'Add learner'}).click();
      await page.getByRole('textbox',{name:'Maximum WW 1',exact:true}).fill('10');
      await page.getByRole('textbox',{name:'Invented learner WW 1',exact:true}).fill('0');
      await page.getByRole('button',{name:'Save to cloud'}).click();
      await page.getByText('Cloud save confirmed.',{exact:true}).waitFor();
      const token=await page.evaluate(()=>firebase.auth().currentUser.getIdToken());
      const ownRest=await fetch('http://127.0.0.1:9000/nationwide-v1/privateRecords/'+uid+'/d900002/c01.json?ns='+project+'&auth='+encodeURIComponent(token));
      assert.equal(ownRest.status,200);
      const crossRest=await fetch('http://127.0.0.1:9000/nationwide-v1/privateRecords/unrelated/d900002/c01.json?ns='+project+'&auth='+encodeURIComponent(token));
      assert([401,403].includes(crossRest.status));
      await page.getByRole('button',{name:'Back to classes'}).click();
      await page.getByRole('button',{name:'Synthetic pilot class'}).waitFor();
      await page.getByRole('button',{name:'School settings'}).click();
      await page.getByText('Add a school privately',{exact:true}).click();
      await page.getByLabel('School name',{exact:true}).fill('Invented public school');
      await page.getByLabel('Municipality or city').fill('Invented city');
      await page.getByRole('button',{name:'Preview this school'}).click();
      await page.getByRole('button',{name:'Save school settings'}).click();
      await page.getByText('Invented public school',{exact:true}).waitFor();
      await env.withSecurityRulesDisabled(async ctx=>{
        const original=(await get(ref(ctx.database(),'nationwide-v1/privateRecords/'+uid+'/d900002/c01'))).val();
        assert.equal(original.schoolName,'Example Learning Academy');assert.equal(original.periods.t1.scores.r01.w1,0);
      });
      await page.getByRole('button',{name:'Sign out',exact:true}).click();
      await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
      await page.getByLabel('Email address').fill(legacyEmail);
      await page.getByLabel('Password',{exact:true}).fill(password);
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.waitForURL('**/cst-r/');
      await page.getByText('Synthetic CST-R faculty',{exact:false}).first().waitFor();
      await env.withSecurityRulesDisabled(async ctx=>{
        const old=(await get(ref(ctx.database(),'cstr-class-record-data/legacy-synthetic-record'))).val();
        assert.deepEqual(old,{version:4,teacher:{name:'Synthetic CST-R faculty'},_syncRevision:5});
      });
    }
    assert.deepEqual(errors,[]);
    console.log(emulate?'PASS browser onboarding, verified school profile, private class and preserved CST-R binding.':'PASS closed launch, responsive practice and neutral XLSX/Word exports.');
  }finally{await browser.close();await env?.cleanup();server.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
