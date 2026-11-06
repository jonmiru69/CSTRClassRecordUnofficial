import {connect,authMessage} from './auth.mjs';
import {downloadXlsx,downloadWord,reportView} from './exports.mjs';
import {h,link} from './dom.mjs';
import {CORE_GRADES,CORE_SUBJECTS} from './policy.mjs';
import {calculatePracticeLearner,initialPracticeState,practiceClass,practiceLimits,practiceRecord,validPracticeName,validatePracticeState} from './workflow-policy.mjs';

const root=document.querySelector('#app');
const mode=document.querySelector('meta[name=cstr-mode]').content;
const sharedApp=document.querySelector('meta[name=cstr-shared-app]').content;
const modeLabel='Core subjects · Grades 4–10 · SY 2026–2027 · Three terms';
const workKey='saved-workspace';
let stop;
function status(title,description){
  root.replaceChildren(h('section',{class:'workflow-status'},h('h1',{},title),h('p',{},description),
    link('Teacher workspace','/teacher/'),link('CST-R faculty','/cst-r/')));
}
function scopedStorage(prefix){
  return {
    getItem(key){return sessionStorage.getItem(prefix+key);},
    setItem(key,value){sessionStorage.setItem(prefix+key,value);},
    removeItem(key){sessionStorage.removeItem(prefix+key);},
    clear(){
      for(const key of Object.keys(sessionStorage))if(key.startsWith(prefix))sessionStorage.removeItem(key);
    }
  };
}
function loadApp(){
  return new Promise((resolve,reject)=>{
    const script=h('script',{src:sharedApp,onload:resolve,onerror:()=>reject(new Error('The workspace could not load. Reload and try again.'))});
    document.body.append(script);
  });
}
function openReports(record){
  const dialog=h('dialog',{class:'workflow-report-dialog','aria-labelledby':'workflow-report-title'});
  const report=reportView(record);
  report.querySelector('h2').id='workflow-report-title';
  const message=h('p',{role:'status'});
  const word=h('button',{class:'button button-secondary',type:'button',onclick:async()=>{
    word.disabled=true;
    try{await downloadWord(record);}catch(error){message.textContent=error.message;}
    finally{word.disabled=false;}
  }},'Save Word');
  const print=h('button',{class:'button button-primary',type:'button',onclick:()=>window.print()},'Print or save PDF');
  const close=h('button',{class:'button button-secondary',type:'button',onclick:()=>dialog.close()},'Close');
  dialog.append(report,h('div',{class:'stack-actions workflow-report-actions'},word,print,close),message);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.append(dialog);dialog.showModal();
}
function install(auth,user,profile){
  const storage=scopedStorage(`class-record-workflow:${user.uid}:${profile.school.key}:`);
  const read=()=>{
    const saved=storage.getItem(workKey);
    return saved===null?{revision:0,data:null}:JSON.parse(saved);
  };
  const workflow={
    session:storage,school:profile.school.name,modeLabel,grades:CORE_GRADES,subjects:CORE_SUBJECTS,
    initialState:initialPracticeState,validateState:validatePracticeState,calculateLearner:calculatePracticeLearner,
    classDefinition:practiceClass,limits:practiceLimits,validName:validPracticeName,
    async workbook(section,periods){await downloadXlsx(practiceRecord(section,periods));},
    reports(section,periods){openReports(practiceRecord(section,periods));}
  };
  window.CSTRSchoolWorkflow=Object.freeze(workflow);
  window.CSTRSync={
    configured:true,ready:Promise.resolve(),
    subscribe(_key,receive,onError){
      const timer=setTimeout(()=>{
        try{
          const saved=read();
          receive(saved.data?validatePracticeState(saved.data):null,{revision:saved.revision,savedAt:saved.savedAt});
        }catch(error){onError(error);}
      },0);
      return ()=>clearTimeout(timer);
    },
    async save(_key,state,revision){
      const current=read();
      if(current.revision!==revision)throw Object.assign(new Error('Reload this tab before saving.'),{
        code:'sync/conflict',revision:current.revision,remoteState:current.data,savedAt:current.savedAt
      });
      const next=revision+1;
      storage.setItem(workKey,JSON.stringify({data:validatePracticeState(state),revision:next,savedAt:Date.now()}));
      return next;
    },
    async signOut(){
      await auth.signOut();
      storage.clear();
      location.replace('/signin/');
    }
  };
}

try{
  const auth=await connect(mode);
  if(!auth)status('Practice workflow is on the live site','Sign in on the main Class Record site to open the shared workspace.');
  else{
    let opened=false;
    stop=auth.onChange(async user=>{
      if(!user){if(opened)return;location.replace('/signin/');return;}
      if(opened)return;
      try{
        const access=await auth.legacyStatus();
        if(auth.user?.uid!==user.uid)return;
        if(access==='legacy'){location.replace('/cst-r/');return;}
        if(access!=='ordinary'||!user.emailVerified){location.replace('/teacher/');return;}
        const profile=await auth.profile();
        if(auth.user?.uid!==user.uid)return;
        if(!profile){location.replace('/teacher/');return;}
        opened=true;
        install(auth,user,profile);
        await loadApp();
        stop?.();
      }catch(error){status('Could not open the practice workflow',authMessage(error));}
    });
  }
}catch(error){status('Could not open the practice workflow',authMessage(error));}
