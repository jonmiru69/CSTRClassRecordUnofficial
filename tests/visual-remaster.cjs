'use strict';
// Browser checks use only tests/create-mobile-preview.cjs and invented records.
// No production credentials or Firebase endpoints are used. Requires local Chrome.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'.build-artifacts','visual-remaster');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.otf':'font/otf','.json':'application/json'};
const report={checks:[],screenshots:[],network:[],errors:[]};
let origin;
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream'});res.end(error?'Not found':data);});
});
const app=fs.readFileSync(path.join(root,'ASSETS/app.js'),'utf8');
assert(app.includes('  initApp();'));
const instrumented=app.replace('  initApp();','  window.__visualRecordState=()=>JSON.stringify(state);\n  window.__visualRefresh=render;\n  initApp();');
function check(name,condition){assert(condition,name);report.checks.push(name);}
async function settle(page){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});await page.waitForTimeout(800);}
async function layout(page,label){const size=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));check(label+' has no document overflow',size.width<=size.viewport+1);}
async function shot(page,name){await settle(page);const file=name+'.png';await page.screenshot({path:path.join(out,file),fullPage:true,animations:'disabled'});report.screenshots.push(file);}
async function snapshot(page){return page.evaluate(()=>window.__visualRecordState());}
async function contrast(page,selector,label){
  const value=await page.locator(selector).first().evaluate(e=>{
    const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
    const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    let parent=e,bg;
    while(parent){const c=rgb(getComputedStyle(parent).backgroundColor);if(c.length===3||c[3]===1){bg=c;break;}parent=parent.parentElement;}
    const fg=luminance(rgb(getComputedStyle(e).color)),back=luminance(bg||[255,255,255]);return (Math.max(fg,back)+.05)/(Math.min(fg,back)+.05);
  });check(label+' contrast is at least 4.5:1',value>=4.5);
}
async function closeModal(page){await page.locator('.modal-backdrop [data-action="close-modal"]').first().click();}
async function period(page,index,width){if(width<=1000)await page.locator('[data-mobile-period]').selectOption(String(index));else await page.locator(`[data-action="select-period"][data-period="${index}"]`).first().click();}
async function run(){
  fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const config of [{width:1440,theme:'light'},{width:1440,theme:'dark'},{width:1024,theme:'light'},{width:1000,theme:'light'},{width:768,theme:'light'},{width:390,theme:'light'},{width:390,theme:'dark'},{width:320,theme:'light'},{width:390,theme:'light',reduced:true}]){
      const {width,theme}=config,label=`${width}-${theme}${config.reduced?'-reduced':''}`;
      console.log('Checking '+label);
      const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=1000,colorScheme:theme,reducedMotion:config.reduced?'reduce':'no-preference',acceptDownloads:true});
      await context.addInitScript(()=>{Element.prototype.requestPointerLock=()=>{};Element.prototype.setPointerCapture=()=>{};});
      await context.route('**/*',async route=>{
        const url=route.request().url();
        if(!url.startsWith(origin+'/')){report.network.push(url);return route.abort();}
        if(new URL(url).pathname.endsWith('/ASSETS/app.js'))return route.fulfill({contentType:'text/javascript',body:instrumented});
        if(/\/(?:firebase-sync|firebase-compat\.bundle)\.js/.test(url))return route.fulfill({contentType:'text/javascript',body:'/* Production services intentionally disabled in visual QA. */'});
        return route.continue();
      });
      const page=await context.newPage();page.on('pageerror',e=>report.errors.push({label,message:e.message}));
      const activate=control=>width<=1000?control.tap():control.click();
      await page.goto(origin+'/');await settle(page);await layout(page,label+' sign-in');
      check(label+' sign-in retains email/password and Google actions',await page.locator('#signinEmail').isVisible()&&await page.locator('#signinPassword').isVisible()&&await page.locator('[data-action="google-login"]').isVisible());
      const greeting=page.locator('#tommy-welcome');
      await activate(page.getByRole('button',{name:'About AI Tommy'}));
      check(label+' login shortcut opens Tommy',await greeting.locator('.tommy-helper-body').isVisible());
      await page.evaluate(()=>window.__visualRefresh());
      check(label+' login greeting stays open after refresh',await greeting.locator('.tommy-helper-body').isVisible());
      await greeting.locator('summary').press('Enter');
      check(label+' login greeting closes with keyboard',!(await greeting.locator('.tommy-helper-body').isVisible()));
      if(width===1440||width===390)await shot(page,'welcome-'+label);
      await page.locator('[data-open-policies]').first().click();check(label+' privacy dialog opens',await page.locator('#policy-dialog').evaluate(e=>e.open));await page.keyboard.press('Escape');check(label+' privacy dialog closes',!(await page.locator('#policy-dialog').evaluate(e=>e.open)));
      if(config.reduced)check('Reduced motion suppresses welcome animations',(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length))===0);
      await page.goto(origin+'/test-preview/index.html');await page.locator('.recent-class-row').first().waitFor();await settle(page);const before=await snapshot(page);await layout(page,label+' overview');
      await activate(greeting.locator('summary'));
      await page.evaluate(()=>window.__visualRefresh());
      check(label+' workspace greeting stays open after refresh',await greeting.locator('.tommy-helper-body').isVisible());
      await contrast(page,'.workspace-intro h2',label+' desk heading');
      await contrast(page,'.metric-card p',label+' metric labels');
      if(width>1000)await contrast(page,'.app-sidebar button[aria-current="page"] .action-label',label+' active navigation');
      const order=await page.locator('.workspace-intro,.metric-grid,.dashboard-hero').evaluateAll(es=>Object.fromEntries(es.map(e=>[e.className,e.getBoundingClientRect().top])));
      check(label+' teacher introduction leads the overview',order['dashboard-hero']<order['workspace-intro']&&order['workspace-intro']<order['metric-grid']);
      if(width===1440||width===390)await shot(page,'desk-'+label);
      if(width>1000){await page.locator('[data-action="toggle-sidebar"]').click();await layout(page,label+' collapsed navigation');await page.locator('[data-action="toggle-sidebar"]').click();}
      await page.locator('.recent-class-row').first().click();await settle(page);await layout(page,label+' assessment');
      const sheetTommy=page.locator('#tommy-sheet-check');
      await activate(sheetTommy.locator('summary'));
      await sheetTommy.getByRole('heading',{name:/Blank scores/}).waitFor();
      const issueList=await sheetTommy.locator('.tommy-issue-grid').elementHandle();
      const themeToggle=page.locator('.app-header [data-toggle-theme]');
      const oppositeTheme=theme==='dark'?'light':'dark';
      const folderColors=()=>page.locator('.sheet-folder,.sheet-paper,.folder-tab').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor));
      const initialColors=await folderColors();
      await page.evaluate(()=>{
        const start=document.startViewTransition.bind(document);
        window.__themeTransitions=[];
        document.startViewTransition=update=>{
          const transition=start(update);
          window.__themeTransitions.push(transition.ready.then(()=>{
            const root=document.documentElement;
            return ['root','theme-control'].map(name=>getComputedStyle(root,`::view-transition-new(${name})`).animationName);
          },()=>[]));
          return transition;
        };
      });
      await activate(themeToggle);
      await page.waitForFunction(next=>document.documentElement.dataset.theme===next,oppositeTheme);
      const switchedColors=await folderColors();
      check(label+' theme changes the paper, folder and every tab',initialColors.every((color,index)=>color!==switchedColors[index]));
      const transitions=await page.evaluate(()=>Promise.all(window.__themeTransitions));
      check(label+' pointer theme motion follows the reduced-motion preference',config.reduced?transitions.length===0:
        JSON.stringify(transitions)===JSON.stringify([['theme-ripple','theme-lift']]));
      await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-theme-ripple'));
      await contrast(page,'.folder-tab[aria-selected="false"]',label+' inactive folder tab');
      if(width>1000){
        const entry=page.locator('.record-table tbody tr[data-learner-row]:not(.row-category) td.name-cell').first();
        check(label+' ordinary grade-sheet cells use the active palette',await entry.evaluate(cell=>getComputedStyle(cell).backgroundColor)===
          (oppositeTheme==='dark'?'rgb(25, 46, 60)':'rgb(255, 255, 255)'));
        await contrast(page,'.record-table tbody tr[data-learner-row]:not(.row-category) input[data-name-row]',label+' learner name');
      }
      check(label+' grade-sheet theme switch preserves Tommy’s open review',await sheetTommy.getByRole('heading',{name:/Blank scores/}).isVisible());
      await page.evaluate(()=>window.__visualRefresh());
      check(label+' grade-sheet review stays open after refresh',await sheetTommy.getByRole('heading',{name:/Blank scores/}).isVisible());
      check(label+' refresh retains the open review’s content nodes',await issueList.evaluate(node=>node.isConnected));
      await issueList.dispose();
      await themeToggle.press('Space');
      check(label+' keyboard restores the original palette',JSON.stringify(await folderColors())===JSON.stringify(initialColors));
      check(label+' keyboard skips the ripple',(await page.evaluate(()=>window.__themeTransitions.length))===transitions.length);
      if(width===1440&&theme==='light'){
        await themeToggle.evaluate(button=>{
          for(let i=0;i<3;i++)button.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
        });
        await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-theme-ripple'));
        check('Rapid toggles persist and apply the final choice',await page.evaluate(()=>document.documentElement.dataset.theme==='dark'&&localStorage.getItem('cstr-theme')==='dark'));
        await page.evaluate(()=>{document.startViewTransition=undefined;});
        await activate(themeToggle);
        check('Theme switches without View Transitions support',JSON.stringify(await folderColors())===JSON.stringify(initialColors));
      }
      check(label+' theme changes leave student records intact',before===await snapshot(page));
      await activate(sheetTommy.locator('summary'));
      if(width===1440||width===390)await shot(page,'assessment-'+label);
      check(label+' navigation does not mutate records',before===await snapshot(page));
      await page.locator('[data-entry-view]').selectOption('one');await page.locator('[data-entry-row]').waitFor();await layout(page,label+' one learner');
      check(label+' learner view does not mutate records',before===await snapshot(page));
      await page.locator('[data-entry-view]').selectOption(width<=1000?'activity':'sheet');
      await period(page,1,width);await settle(page);
      const scores=page.locator(width<=1000?'.phone-entry input[data-score]':'.record-table input[data-score]');
      check(label+' locked score inputs remain disabled',await scores.first().isDisabled());
      await period(page,0,width);await settle(page);
      check(label+' period selection does not mutate records',before===await snapshot(page));
      const input=page.locator(width<=1000?'.phone-entry input[data-score]':'.record-table input[data-score]').first();
      await input.fill('0');await input.press('Tab');await settle(page);
      check(label+' score zero survives input',JSON.parse(await snapshot(page)).sections.science.periods[0].roster[0].ww[0]==='0');
      await input.fill('A');await input.press('Tab');await settle(page);
      check(label+' attendance mark survives input',JSON.parse(await snapshot(page)).sections.science.periods[0].roster[0].ww[0]==='A');
      await input.fill('999');await input.press('Tab');await settle(page);
      check(label+' over-HPS input is visibly invalid',await page.locator('input[data-score][aria-invalid="true"],input[data-score].invalid').count()>0);
      await input.fill('12');await input.press('Tab');await settle(page);
      const edit=JSON.parse(await snapshot(page));const initial=JSON.parse(before);
      check(label+' restored score leaves original records unchanged',JSON.stringify(edit)===JSON.stringify(initial));
      if(width>1000){
        await page.locator('.period-settings>summary').click();await page.locator('[data-action="export-official"]').click();await page.locator('.modal-backdrop').waitFor();await layout(page,label+' export dialog');
        check(label+' official PDF and Word controls retained',await page.locator('[data-action="export-official-pdf"]').count()===1&&await page.locator('[data-action="export-official-word"]').count()===1);await shot(page,'export-'+label);await closeModal(page);
      }
      await page.locator(width<=1000?'.mobile-navigation [data-action="go-records"]':'.sidebar-nav [data-action="go-records"]').click();await page.locator('.section-card').first().waitFor();await layout(page,label+' class directory');
      if(width===1440||width===390)await shot(page,'classes-'+label);
      await page.locator('[data-action="select-group"][data-group="SHS"]').click();check(label+' senior high directory retains its class',await page.locator('.section-card').innerText().then(s=>s.includes('Research Electives')));
      await page.locator('[data-action="open-add-class"]').first().click();await layout(page,label+' add-class dialog');await closeModal(page);
      if(width>1000)await page.locator('[data-action="open-settings"]').first().click();else{await page.locator('[data-action="mobile-more"]').click();await page.locator('.modal-backdrop [data-action="open-settings"]').click();}
      await page.locator('.settings-modal').waitFor();await layout(page,label+' settings');if(width===1440||width===390)await shot(page,'settings-'+label);await closeModal(page);
      check(label+' presentation controls preserve all records',before===await snapshot(page));
      if(width===1440&&theme==='light'){
        await page.locator('.sidebar-nav [data-action="go-home"]').click();await page.locator('.recent-class-row').first().click();
        await page.emulateMedia({media:'print'});await settle(page);
        const printStyles=()=>page.locator('.record-table').evaluate(e=>[e,...e.querySelectorAll('th,td,input')].slice(0,60).map(x=>{const c=getComputedStyle(x);return [c.font,c.color,c.backgroundColor,c.position,c.padding,c.border,c.display];}));
        const styled=await printStyles();await page.locator('link[href*="visual-remaster.css"]').evaluate(e=>{e.disabled=true;});await settle(page);
        check('Grade-sheet print styles remain identical without remaster CSS',JSON.stringify(styled)===JSON.stringify(await printStyles()));
        await page.locator('link[href*="visual-remaster.css"]').evaluate(e=>{e.disabled=false;});await page.emulateMedia({media:'screen'});
      }
      if(width===390&&theme==='light'&&!config.reduced){
        await page.locator('.mobile-navigation [data-action="go-home"]').click();await page.evaluate(()=>document.documentElement.style.fontSize='200%');await layout(page,'200% phone text');
      }
      await context.close();
    }
    check('No page JavaScript errors',report.errors.length===0);check('No network requests to external services',report.network.length===0);
  }finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));server.close();}
  console.log(`PASS ${report.checks.length} browser checks; ${report.screenshots.length} screenshots. See .build-artifacts/visual-remaster/report.json`);
}
run().catch(e=>{console.error(e);server.close();process.exitCode=1;});
