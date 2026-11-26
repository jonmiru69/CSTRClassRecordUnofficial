'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const {fixture}=require('./grade-policy.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.build-artifacts/activity-summary');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'chrome'});
  try{
    const page=await browser.newPage();
    for(const file of ['vendor/jszip.min.js','export-names.js','grading-engine.js','record-tools.js','school-excel.js'])await page.addScriptTag({path:file==='school-excel.js'&&process.env.CSTR_SUMMARY_SOURCE?process.env.CSTR_SUMMARY_SOURCE:path.join(root,'ASSETS',file)});
    const saved=fixture(0);saved.metadata={teacherName:'Synthetic Teacher',schoolYear:'2026–2027'};
    saved.period.wwDates=['2026-11-26','2026-12-01'];
    saved.period.activityMeta.ww[0]={title:'=Evidence journal <draft> & reflection',topic:'Energy transfers\nClassroom observations',competency:'Explain evidence and justify conclusions.'};
    saved.period.activityMeta.pt[1]={title:'Group investigation',topic:'Saved topic',competency:'Saved competency'};
    const sparse=structuredClone(saved);
    for(const kind of ['ww','pt','qa']){sparse.period[kind+'Hps'].unshift('');sparse.period[kind+'Dates'].unshift('');sparse.period.activityMeta[kind].unshift({});sparse.period.roster[0][kind].unshift('');}
    const empty=fixture(0);
    for(const kind of ['ww','pt','qa']){empty.period[kind+'Hps'].fill('');empty.period[kind+'Dates'].fill('');empty.period.activityMeta[kind].fill({});empty.period.roster[0][kind].fill('');}
    const dense=structuredClone(saved);
    dense.period.activityMeta.ww[0].topic='Long saved explanation. '.repeat(300);
    const reserved=structuredClone(saved);reserved.section.subject='Activities and Topics';
    for(const [label,payload] of [['saved',saved],['sparse',sparse],['empty',empty],['dense',dense],['reserved-name',reserved]]){
      const result=await page.evaluate(async({payload,template})=>{
        const built=await CSTRSchoolExcel.build(payload,{templateBytes:Uint8Array.from(atob(template),c=>c.charCodeAt(0))}),zip=await JSZip.loadAsync(built.bytes);
        const part=zip.file('xl/worksheets/sheet2.xml');if(!part)return {missing:true};
        const d=new DOMParser().parseFromString(await part.async('string'),'application/xml'),w=new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'),'application/xml'),s=new DOMParser().parseFromString(await zip.file('xl/styles.xml').async('string'),'application/xml');
        const rows=[...d.querySelectorAll('sheetData row')].map(r=>({values:[...r.children].map(c=>c.querySelector('t')?.textContent||''),sizes:[...r.children].map(c=>Number(s.querySelector('fonts').children[Number(s.querySelector('cellXfs').children[Number(c.getAttribute('s'))].getAttribute('fontId'))].querySelector('sz').getAttribute('val')))}));
        return {bytes:Array.from(built.bytes),rows,hiddenColumns:d.querySelectorAll('col[hidden="1"]').length,view:d.querySelector('sheetView').getAttribute('showRowColHeaders'),grid:d.querySelector('sheetView').getAttribute('showGridLines'),fit:d.querySelector('pageSetup').getAttribute('fitToHeight'),sheets:[...w.querySelectorAll('sheet')].map(n=>n.getAttribute('name')),areas:[...w.querySelectorAll('definedName[name="_xlnm.Print_Area"]')].map(n=>n.textContent)};
      },{payload,template:fs.readFileSync(path.join(root,'ASSETS/templates/cstr-class-record.xlsx')).toString('base64')});
      assert(!result.missing,'summary must have independent columns on its own worksheet');
      assert.equal(result.sheets.length,2);assert.equal(result.areas.length,2);
      assert.equal(new Set(result.sheets.map(n=>n.toLowerCase())).size,2,'worksheet names must be unique');
      assert.equal(result.hiddenColumns,0);assert.equal(result.view,'0');assert.equal(result.grid,'0');
      const values=result.rows.map(r=>r.values);
      assert.deepEqual(values.find(r=>r[0]==='No.'),['No.','Date','Activity','Topic','Learning competency','HPS']);
      if(label==='empty')assert.equal(values.filter(r=>r[0]==='No activities recorded.').length,3);
      else{
        const first=values.find(r=>r[2]===saved.period.activityMeta.ww[0].title);
        assert(first,'saved activity title must be literal text without Excel column prefixes');
        assert.equal(first[0],label==='sparse'?'2':'1');assert.equal(first[1],'26 Nov 2026');
        assert.equal(first[4],saved.period.activityMeta.ww[0].competency);assert.equal(first[5],'20');
        const topic=label==='dense'?values.filter(r=>r[0]==='1'||(!r[0]&&r[3])).map(r=>r[3]).join(''):first[3];
        assert.equal(topic,payload.period.activityMeta.ww[label==='sparse'?1:0].topic);
        assert(result.rows.filter(r=>r.values[2]===first[2]).every(r=>r.sizes.every(size=>size===16)));
        assert.equal(result.fit,label==='dense'?'0':'1');
      }
      fs.writeFileSync(path.join(out,label+'.xlsx'),Buffer.from(result.bytes));
      console.log('PASS',label,'saved content, date/activity/topic alignment, readable fonts and print layout');
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
