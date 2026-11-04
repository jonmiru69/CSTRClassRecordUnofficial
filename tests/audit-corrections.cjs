'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),grading=require('../ASSETS/grading-engine.js'),record=require('../ASSETS/record-tools.js');
const noop=()=>{};
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),key:i=>[...map.keys()][i],get length(){return map.size;},map};}
function harness(){
 const element={dataset:{theme:'light'},addEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],classList:{add:noop,remove:noop,toggle:noop},style:{},setAttribute:noop,append:noop,remove:noop};
 const sessionStorage=storage(),localStorage=storage();let disk={},signedOut=false,failSignOut=false;
 const mobile={checkpoint:async()=>{disk=Object.fromEntries([...sessionStorage.map].filter(([k])=>/^cstr-class-record-(autosave-draft|history):/.test(k)));},clearRecovery:async()=>{disk={};}};
 const context={console,Date,Math,setTimeout:()=>0,clearTimeout:noop,setInterval:()=>0,clearInterval:noop,sessionStorage,localStorage,matchMedia:()=>({matches:false,addEventListener:noop}),document:{querySelector:s=>s==='#app'?element:null,querySelectorAll:()=>[],addEventListener:noop,documentElement:element,body:element},window:{addEventListener:noop,CSTRGrading:grading,CSTRRecordTools:record,CSTRMobile:mobile,CSTRRegistration:{clear:noop},CSTRSync:{configured:true,signOut:async()=>{if(failSignOut)throw new Error('Synthetic signout failure');signedOut=true;}}},requestAnimationFrame:noop,ResizeObserver:class{observe(){}},alert:noop,confirm:()=>true};
 context.document.createElement=()=>({...element});
 let source=fs.readFileSync(path.join(root,'ASSETS/app.js'),'utf8').replace('  initApp();',`window.hooks={sanitizeScoreValue,learnerResult,officialExportPayload,officialExportReadiness,isLearnerAssessmentComplete,renderReportResultHtml,getPeriodInputIntegrity,performLogout,persistLocalDraft,createInitialState,setState(v){state=normalizeState(v);activeSectionId=activeRegistry()[0]?.id;activePeriodIndex=0;},getState:()=>state};`);
 vm.runInNewContext(source,context);
 return {h:context.window.hooks,sessionStorage,localStorage,mobile,get disk(){return disk;},get signedOut(){return signedOut;},failSignOut(){failSignOut=true;}};
}
const section={id:'synthetic',subject:'Custom',gradingCategory:'custom',group:'JHS',level:'8',section:'Test',gradingMode:'school-transmutation',weights:[20,50,30],rosterSize:1};
function period(q,score='10'){return {quarter:q,name:'Quarter '+q,locked:false,wwDates:[''],ptDates:[''],qaDates:['','',''],wwHps:['10'],ptHps:['10'],qaHps:['10','10','10'],roster:[{name:'Synthetic, Learner',ww:[score],pt:[score],qa:[score,score,score]}]};}
function state(h,periods,calendar='legacy',sec=section){const s=h.createInitialState();s.registry=[sec];s.sections={[sec.id]:{periods}};if(calendar==='trimester'){s.calendarMode=calendar;s.registryTri=[sec];s.sectionsTri={[sec.id]:{periods}};}return s;}
async function main(){
 const a=harness(),h=a.h;
 for(const token of ['-5','1e2','8/10','1,5','1.2.3','Infinity','0x10']){
  assert.equal(h.sanitizeScoreValue(token),token);assert.equal(grading.numberOrNull(token),null);
  h.setState(state(h,[period(1,token)]));const p=h.getState().sections.synthetic.periods[0];
  assert.equal(h.learnerResult(p.roster[0],p,section).initial.precise,null);assert(h.getPeriodInputIntegrity(p).invalidScores>0);
  assert.throws(()=>record.addPoints(p,'ww',0,0,1,'Cannot repair an invalid token by adding points'));
 }
 for(const token of ['0','0.00','.5','8.50','10.'])assert.equal(grading.numberOrNull(token),Number(token));
 assert.equal(h.sanitizeScoreValue(' m '),'M');
 console.log('PASS Invalid pasted/typed tokens retain their meaning and block grades; zero, decimals and attendance codes remain supported.');
 const sheet=period(1);
 sheet.wwHps=['10','10','10',''];
 sheet.wwDates=['','','',''];
 sheet.roster[0].ww=['0','','11','A'];
 sheet.roster[0].pt=['E'];
 h.setState(state(h,[sheet]));
 const review=h.getPeriodInputIntegrity(h.getState().sections.synthetic.periods[0]);
 assert.equal(review.pending,1);
 assert.equal(review.aboveHps,1);
 assert.equal(review.missingHps,1);
 assert.equal(review.invalidScores,0);
 console.log('PASS Tommy flags configured blanks and out-of-range scores while preserving recorded zero and attendance codes.');
 h.setState(state(h,[period(1)]));const target={...section,gradingMode:'zero-based'},p=period(1,'8');
 assert.equal(h.learnerResult(p.roster[0],p,target).initial.transmuted,80);
 assert.equal(h.learnerResult(p.roster[0],p,section).initial.transmuted,83);
 assert(h.renderReportResultHtml({section:target,period:p,result:h.learnerResult(p.roster[0],p,target),complete:true}).includes('Reported grade'));
 const research={...target,weights:[40,60,0]},rp=period(1,'8');rp.qaHps=['','',''];rp.roster[0].qa=['','',''];
 assert(h.isLearnerAssessmentComplete(rp.roster[0],rp,research));
 console.log('PASS Cross-class results, report labels and completion use the owning class grading mode and weights.');
 h.setState(state(h,[period(1),period(3,'8'),period(4,'6')]));let payload=h.officialExportPayload();
 assert.equal(payload.students[0].periods[1].periodical,undefined);assert.equal(payload.students[0].periods[2].periodical,83);assert.equal(payload.students[0].periods[3].periodical,72);
 const terms=[period(1),period(3,'8')];terms[0].term=1;terms[1].term=3;h.setState(state(h,terms,'trimester'));payload=h.officialExportPayload();assert.equal(payload.students[0].periods[1].periodical,undefined);assert.equal(payload.students[0].periods[2].periodical,83);
 const shs={...section,group:'SHS'};const quarters=[period(2,'8'),period(1)];quarters[0].semester=2;quarters[1].semester=1;h.setState(state(h,quarters,'legacy',shs));payload=h.officialExportPayload();assert.equal(payload.students[0].periods[0].periodical,100);assert.equal(payload.students[0].periods[3].periodical,83);
 for(const periods of [[period(1),period(1)],[period(1),period(5)]]){h.setState(state(h,periods));assert.equal(h.officialExportReadiness(h.officialExportPayload()).type,'error');}
 console.log('PASS JHS, SHS and trimester exports keep gaps and explicit identities; duplicates and out-of-range periods block export.');
 h.setState(state(h,[1,2,3,4].map(q=>period(q,''))));payload=h.officialExportPayload();assert.equal(h.officialExportReadiness(payload).type,'warning');assert.equal(payload.provisional,true);assert.equal(payload.students[0].finalGrade,null);
 h.setState(state(h,[1,2,3,4].map(q=>period(q))));payload=h.officialExportPayload();assert.equal(h.officialExportReadiness(payload).type,'success');assert.equal(payload.provisional,false);assert.equal(payload.students[0].finalGrade,100);
 console.log('PASS Missing scores remain provisional with no final grade; fully completed records remain ready.');
 a.sessionStorage.setItem('cstr-class-record-login','true');a.sessionStorage.setItem('cstr-class-record-user','synthetic');h.persistLocalDraft();assert(Object.keys(a.disk).length);await h.performLogout();assert(a.signedOut);assert.equal(Object.keys(a.disk).length,0);assert.equal(a.sessionStorage.length,0);
 const failed=harness();failed.h.setState(state(failed.h,[period(1)]));failed.sessionStorage.setItem('cstr-class-record-login','true');failed.sessionStorage.setItem('cstr-class-record-user','synthetic');failed.h.persistLocalDraft();failed.failSignOut();await failed.h.performLogout();assert(Object.keys(failed.disk).length);assert.equal(failed.sessionStorage.getItem('cstr-class-record-login'),'true');
 console.log('PASS Successful logout clears durable/session recovery; failed signout preserves the recoverable draft.');
 // Exercise the actual native bridge queue, not only an app-level test double.
 let nativeDisk='',releaseWrite;const gate=new Promise(resolve=>releaseWrite=resolve),store=storage();store.setItem('cstr-class-record-autosave-draft:synthetic','draft');
 const ctx={window:{},Capacitor:{isNativePlatform:()=>true},registerPlugin:name=>name==='CSTRRecovery'?{read:async()=>({data:''}),write:async({data})=>{await gate;nativeDisk=data;},clear:async()=>{nativeDisk='';}}:{},App:{addListener:noop},Browser:{},Filesystem:{readdir:()=>Promise.resolve({files:[]})},Share:{},Directory:{Cache:'cache'},sessionStorage:store,document:{documentElement:{dataset:{}},addEventListener:noop}};
 const bridge=fs.readFileSync(path.join(root,'mobile/native-entry.js'),'utf8').replace(/^import .*;\r?\n/gm,'');vm.runInNewContext(bridge,ctx);await ctx.window.CSTRMobile.ready;
 const checkpoint=ctx.window.CSTRMobile.checkpoint();const clear=ctx.window.CSTRMobile.clearRecovery();store.map.clear();releaseWrite();await Promise.all([checkpoint,clear]);assert.equal(nativeDisk,'');
 console.log('PASS Native clear queues behind an in-flight checkpoint and leaves no durable draft.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
