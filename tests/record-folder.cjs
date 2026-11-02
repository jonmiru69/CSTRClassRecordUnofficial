'use strict';
// Browser-only fixture instrumentation. All external requests are blocked.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.build-artifacts','record-folder');
const report={checks:[],errors:[],external:[]};
const check=(name,value)=>{assert(value,name);report.checks.push(name);};
const source=fs.readFileSync(path.join(root,'ASSETS/app.js'),'utf8').replace('  initApp();',`  window.__folderQA={state:()=>JSON.stringify(state),context:()=>({activePeriodIndex,sheetEntryView}),period:selectRecordPeriod};
  initApp();`);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.otf':'font/otf'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(error?'Not found':data);});});
const snap=page=>page.evaluate(()=>window.__folderQA.state());
async function ready(page){await page.locator('.sheet-paper').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);}
async function layout(page,label){check(label+' no document overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
async function shot(page,label){await page.screenshot({path:path.join(out,label+'.png'),fullPage:true,animations:'disabled'});}
async function run(){
  fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const config of [{width:1440},{width:768},{width:390},{width:320},{width:1440,dark:true},{width:390,reduced:true}]){
      const label=config.width+(config.dark?'-dark':config.reduced?'-reduced':'-light');console.log('Folder '+label);
      const context=await browser.newContext({viewport:{width:config.width,height:1000},reducedMotion:config.reduced?'reduce':'no-preference',colorScheme:config.dark?'dark':'light'});
      await context.addInitScript(()=>{Element.prototype.requestPointerLock=()=>{};Element.prototype.setPointerCapture=()=>{};});
      await context.route('**/*',route=>{
        const url=route.request().url();if(!url.startsWith(origin+'/')){report.external.push(url);return route.abort();}
        if(new URL(url).pathname.endsWith('/ASSETS/app.js'))return route.fulfill({contentType:'text/javascript',body:source});
        if(new URL(url).pathname==='/test-preview/index.html'){
          let fixture=fs.readFileSync(path.join(root,'test-preview/index.html'),'utf8');
          fixture=fixture.replace('let revision=1;', "state.sections.research.periods=Array.from({length:4},(_,i)=>({...makePeriod('Quarter '+(i%2+1)),quarter:i%2+1,semester:Math.floor(i/2)+1}));let revision=1;");
          fixture=fixture.replace('return ++revision;', 'window.__savedFixture=JSON.stringify(state);return ++revision;');
          return route.fulfill({contentType:'text/html',body:fixture});
        }
        return route.continue();
      });
      const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
      await page.goto(origin+'/test-preview/index.html?screen=record');await ready(page);const before=await snap(page);
      await layout(page,label);await shot(page,'assessment-'+label);
      const recordColors=()=>page.locator('.record-table th,.record-table td,.record-table input,.activity-register table th,.activity-register table td').evaluateAll(es=>es.map(e=>{const s=getComputedStyle(e);return [s.color,s.backgroundColor,s.borderColor];}));
      const remasteredColors=await recordColors();
      await page.locator('link[href*="record-folder.css"]').evaluate(e=>{e.disabled=true;});
      check(label+' record colors match original styles',JSON.stringify(remasteredColors)===JSON.stringify(await recordColors()));
      await page.locator('link[href*="record-folder.css"]').evaluate(e=>{e.disabled=false;});
      check(label+' class color remains blue',await page.locator('.record-section').evaluate(e=>getComputedStyle(e).getPropertyValue('--class-color').trim()==='#0d47a1'));
      check(label+' loaded local display font',await page.evaluate(()=>document.fonts.check('24px "CSTR Serif"')));
      for(const view of ['sheet','activity','one']){
        const tab=page.locator('#view-tab-'+view);await tab.click();
        check(label+' '+view+' tab selected',await tab.getAttribute('aria-selected')==='true');
        check(label+' '+view+' panel named',await page.locator('#record-paper').getAttribute('aria-labelledby')==='view-tab-'+view);
        check(label+' '+view+' select synchronized',await page.locator('[data-entry-view]').inputValue()===view);
        const box=await tab.evaluate(e=>({a:e.getBoundingClientRect().toJSON(),b:e.parentElement.getBoundingClientRect().toJSON()}));
        check(label+' '+view+' tab target visible',box.a.width>=44&&box.a.height>=44&&box.a.left>=box.b.left-1&&box.a.right<=box.b.right+1);
        check(label+' '+view+' preserves records',before===await snap(page));await layout(page,label+' '+view);
      }
      await page.locator('#view-tab-sheet').click();await page.locator('#view-tab-sheet').focus();
      await page.keyboard.press('ArrowRight');check(label+' arrow moves focus',await page.locator('#view-tab-activity').evaluate(e=>e===document.activeElement));
      check(label+' arrow does not silently activate',await page.locator('#view-tab-sheet').getAttribute('aria-selected')==='true');
      await page.keyboard.press('Enter');check(label+' Enter activates view',await page.locator('#view-tab-activity').getAttribute('aria-selected')==='true');
      check(label+' keyboard has no sheet animation',await page.locator('.sheet-paper').evaluate(e=>e.getAnimations().filter(a=>a.playState==='running').length===0));
      await page.keyboard.press('End');check(label+' End focuses last tab',await page.locator('#view-tab-one').evaluate(e=>e===document.activeElement));
      await page.keyboard.press('Home');await page.keyboard.press('Space');check(label+' Home and Space activate first tab',await page.locator('#view-tab-sheet').getAttribute('aria-selected')==='true');

      // Do not wait between requests: the final rendered content must win immediately.
      const rapid=await page.evaluate(()=>{
        document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
        for(const i of [1,0,1,0,1])window.__folderQA.period(i);
        return {index:window.__folderQA.context().activePeriodIndex,locked:document.querySelector('.record-table input[data-score]').disabled,animations:document.querySelector('.sheet-paper').getAnimations().filter(a=>a.playState==='running').length};
      });
      check(label+' rapid changes end at requested period',rapid.index===1&&rapid.locked);
      check(label+' motion respects preference',config.reduced?rapid.animations===0:rapid.animations===1);
      check(label+' rapid period changes preserve data',before===await snap(page));
      await page.waitForTimeout(280);check(label+' final period stays synchronized',await page.evaluate(()=>window.__folderQA.context().activePeriodIndex===1&&document.querySelector('.record-table input[data-score]').disabled));
      await page.evaluate(()=>window.__folderQA.period(0));
      await page.locator('.period-settings>summary').click();
      for(const action of ['add-period','toggle-lock-period','delete-period','export-excel','export-official'])check(label+' options retain '+action,await page.locator('.period-settings [data-action="'+action+'"]').isVisible());
      await layout(page,label+' options');await shot(page,'options-'+label);
      await page.keyboard.press('Escape');check(label+' Escape closes options',await page.locator('.period-settings').evaluate(e=>!e.open));

      if(config.width===1440&&!config.dark){
        // Distinct values prove that navigation does not leak an edit into another period.
        const score=page.locator('.record-table input[data-score]').first();await score.fill('9');await score.press('Tab');
        const edited=JSON.parse(await snap(page));check('Score entry updates owning period',edited.sections.science.periods[0].roster[0].ww[0]==='9');
        await page.evaluate(()=>window.__folderQA.period(1));check('Other period retains original score',await page.locator('.record-table input[data-score]').first().inputValue()==='12');
        await page.evaluate(()=>window.__folderQA.period(0));check('Edit survives round trip',await score.inputValue()==='9');
        check('Unsaved edit reaches session draft',await page.evaluate(()=>JSON.parse(sessionStorage.getItem('cstr-class-record-autosave-draft:synthetic-teacher')).state.sections.science.periods[0].roster[0].ww[0]==='9'));
        await page.locator('#saveChanges').click();await page.waitForTimeout(300);check('Cloud save adapter receives edited score',await page.evaluate(()=>JSON.parse(window.__savedFixture).sections.science.periods[0].roster[0].ww[0]==='9'));
        await score.fill('12');await score.press('Tab');
        const hps=page.locator('.record-table input[data-hps="ww"]').first();await hps.fill('10');
        await page.locator('[data-action="select-period"][data-period="1"]').first().click();
        const changed=JSON.parse(await snap(page));check('Leaving HPS commits cap in old period',changed.sections.science.periods[0].roster.every(r=>Number(r.ww[0])<=10));check('HPS does not leak to new period',changed.sections.science.periods[1].wwHps[0]==='20');
        await page.evaluate(()=>window.__folderQA.period(0));await hps.fill('20');await hps.press('Tab');check('HPS restoration still restores scores',JSON.parse(await snap(page)).sections.science.periods[0].roster[0].ww[0]==='12');
        await page.emulateMedia({media:'print'});check('Folder chrome excluded from print',await page.locator('.folder-toolbar').evaluate(e=>getComputedStyle(e).display==='none'));check('Paper wrapper does not alter print geometry',await page.locator('.sheet-paper').evaluate(e=>getComputedStyle(e).display==='contents'));await page.emulateMedia({media:'screen'});
        await page.locator('.sidebar-nav [data-action="go-records"]').click();await page.locator('[data-group="SHS"]').click();await page.locator('.section-card[data-section="research"]').click();
        const shs=await snap(page);await page.locator('[data-action="select-period"][data-period="2"]').first().click();
        check('Semester 2 selection uses original SHS index',await page.evaluate(()=>window.__folderQA.context().activePeriodIndex===2));
        check('Semester tab and paper label agree',await page.locator('.paper-heading h3').innerText()===await page.locator('.period-tabs [aria-pressed="true"]').innerText().then(s=>s.replace(/[·✓]\s*$/,'').trim()));
        check('Semester change preserves all records',shs===await snap(page));await shot(page,'semester-1440');
      }
      await context.close();
    }
    check('No JavaScript errors',report.errors.length===0);check('No external requests',report.external.length===0);
  }finally{await browser.close();server.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
  console.log('PASS '+report.checks.length+' folder checks');
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
