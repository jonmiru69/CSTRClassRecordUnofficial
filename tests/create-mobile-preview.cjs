'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace(/<script src="ASSETS\/(?:vendor\/firebase-compat\.bundle|firebase-sync|registration)\.js[^"<]*"><\/script>/g,'');
const fixture=`<script>
(() => {
  const names=['Alvarez, Sample','Bautista, Demo','Cruz, Example','De la Cruz, Sample','Fernandez, Demo','Garcia, Example'];
  const classes=[['science','Science','Saint Sample','JHS','Grade 8',[20,50,30]],['research','Research Electives','Demo Section','SHS','Grade 11',[40,60,0]]];
  const makePeriod=(name,locked=false)=>({name,locked,quarter:1,semester:0,wwDates:['2026-11-01','2026-11-02'],ptDates:['2026-11-03'],qaDates:['2026-11-04','2026-11-05','2026-11-06'],wwHps:['20','15'],ptHps:['30'],qaHps:['20','20','40'],activityMeta:{ww:[{title:'Matter and measurement',competency:'Analyze physical properties',topic:'Measurement',role:''},{title:'Scientific investigation',competency:'',topic:'Inquiry',role:''}],pt:[{title:'Laboratory performance',role:''}],qa:[{title:'Short test 1',role:'st1'},{title:'Short test 2',role:'st2'},{title:'Term exam',role:'te'}]},roster:names.map((name,i)=>({name,ww:[String(12+i),''],pt:[String(22+i)],qa:['15','17','32']}))});
  let state={version:4,teacher:{name:'Synthetic Teacher',level:'Secondary',specialization:'Science',bio:'Preview uses invented records only.'},photo:'',registry:classes.map(([id,subject,section,group,level,weights])=>({id,subject,section,group,level,weights,gradingMode:'school-transmutation',rosterSize:6,theme:'blue',accent:'blue',archived:false})),sections:Object.fromEntries(classes.map(([id])=>[id,{periods:[makePeriod('Quarter 1'),makePeriod('Quarter 2',true)]}])),calendarMode:'legacy',registryTri:[],sectionsTri:{},trimesterModeSeen:false};
  let revision=1;const user={uid:'synthetic-teacher',email:'teacher@example.test',displayName:'Synthetic Teacher',providerData:[{providerId:'password'}]};
  localStorage.setItem('cstr-class-record-welcome-seen:synthetic-teacher','true');
  window.CSTRRegistration={isApproved:async()=>true,clear(){}};
  const updateCase=new URLSearchParams(location.search).get('update');
  if(updateCase){
    window.CSTRMobile={native:true,ready:Promise.resolve(),checkpoint:async()=>{},clearRecovery:async()=>{},getInfo:async()=>({version:'1.0.0',build:'10000'}),verifyRelease:async()=>({valid:updateCase!=='wrong-key'}),enableUpdateAlerts:async()=>({granted:false}),openDownload:async()=>{},openWebsite:async()=>{}};
    const originalFetch=window.fetch.bind(window);
    window.fetch=(url,options)=>String(url).endsWith('downloads/latest.json')?(updateCase==='offline'?Promise.reject(new Error('Synthetic offline test')):Promise.resolve(new Response(JSON.stringify({schemaVersion:1,appId:'ph.cstr.classrecord.unofficial',available:true,version:'1.0.99',versionCode:10099,minimumSupportedVersionCode:10050,sha256:updateCase==='malformed'?'bad':'a'.repeat(64),certificateSha256:'b'.repeat(64),bytes:6000000,url:'https://jonmiru69.github.io/CSTRClassRecordUnofficial/downloads/CSTR-Class-Record-1.0.99.apk',notes:'Synthetic update prompt. This is not a published APK.'}),{status:200,headers:{'Content-Type':'application/json'}}))):originalFetch(url,options);
  }
  window.CSTRSync={configured:true,clientId:'preview',ready:Promise.resolve(user),getCurrentUser:()=>user,getUserProfile:async()=>({dataKey:user.uid,name:user.displayName}),hasPasswordProvider:()=>true,onAuthStateChanged(callback){setTimeout(()=>callback(user),30);return()=>{};},subscribe(key,callback){setTimeout(()=>callback(JSON.parse(JSON.stringify(state)),{revision,savedAt:Date.now(),isOwnEcho:true}),30);return()=>{};},async save(key,next,expected){if(expected!==revision)throw Object.assign(new Error('Synthetic conflict'),{code:'sync/conflict',remoteState:state,revision});state=JSON.parse(JSON.stringify(next));return ++revision;},signOut:async()=>{}};
})();</script>`;
html=html.replace(/<script src="ASSETS\/app\.js[^"<]*"><\/script>/,fixture+'<script src="ASSETS/app.js?v=preview"></script>');
html=html.replaceAll('="ASSETS/','="../ASSETS/');
html=html.replace('<div id="app"','<p style="margin:0;padding:8px 16px;background:#731c32;color:white;font:16px Arial">Synthetic mobile preview. No live teacher records.</p><div id="app"');
html=html.replace('</body>',`<script>
if(new URLSearchParams(location.search).get('text')==='200')document.documentElement.style.fontSize='200%';
if(new URLSearchParams(location.search).get('screen')==='record'){
  const observer=new MutationObserver(()=>{const button=document.querySelector('.recent-class-row');if(button){observer.disconnect();button.click();}});
  observer.observe(document.querySelector('#app'),{childList:true,subtree:true});
}
</script></body>`);
fs.mkdirSync(path.join(root,'test-preview'),{recursive:true});fs.writeFileSync(path.join(root,'test-preview/index.html'),html);
// Export templates and lazy vendor URLs are root-relative in the actual app.
fs.cpSync(path.join(root,'ASSETS'),path.join(root,'test-preview/ASSETS'),{recursive:true});
fs.cpSync(path.join(root,'downloads'),path.join(root,'test-preview/downloads'),{recursive:true});
console.log('Synthetic browser preview: http://127.0.0.1:8765/test-preview/index.html');
