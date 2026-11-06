import {h,p,btn,field,status,say,option} from './dom.mjs';
import {evaluate,newDemo,scoreValue,assertScope,TERM_KEYS,SLOTS,cleanInitial} from './policy.mjs';
import {downloadXlsx,downloadWord,reportView} from './exports.mjs';

const demoKey='class-record-science6-practice-v1';
export function practice(){
  const demo=newDemo();
  try{
    const saved=JSON.parse(sessionStorage.getItem(demoKey));
    for(const [term,period] of Object.entries(demo.periods)){
      for(const id of Object.keys(demo.roster)){
        const values=saved?.[term]?.[id];if(!values||typeof values!=='object')continue;
        for(const k of Object.keys(period.hps)){
          if(values[k]===null)delete period.scores[id][k];
          else if(scoreValue(values[k])!==null&&values[k]<=period.hps[k])period.scores[id][k]=values[k];
        }
      }
    }
  }catch{/* A fresh practice record is always available. */}
  function checkpoint(){
    try{
      const scores=Object.fromEntries(TERM_KEYS.map(t=>[t,Object.fromEntries(Object.keys(demo.roster).map(id=>[id,Object.fromEntries(Object.keys(demo.periods[t].hps).map(k=>[k,demo.periods[t].scores[id]?.[k]??null]))]))]));
      sessionStorage.setItem(demoKey,JSON.stringify(scores));
      return true;
    }catch{return false;}
  }
  const shell=h('section',{class:'stack wide'});
  function build(){
    shell.replaceChildren(recordEditor(demo,{onChange:checkpoint,reset(){
      const fresh=newDemo();demo.periods=fresh.periods;
      try{sessionStorage.removeItem(demoKey);}catch{}
      build();shell.querySelector('h1').focus();
    }}));
  }
  build();
  return shell;
}
function parseNumber(input,max,{hps=false}={}){
  if(input.value.trim()==='')return null;
  const n=scoreValue(input.value.trim());
  if(n===null||n>max||(hps&&n<.001))throw new Error(hps?'Enter a positive maximum of up to 10,000.':'Enter a score from zero to its maximum, with up to three decimal places.');
  return n;
}
export function recordEditor(record,{onChange=()=>true,reset,save,back,readOnly=false}={}){
  const mode=assertScope(record),synthetic=mode==='practice';
  let termIndex=0,selectedLearner='',mobileMode=window.matchMedia('(max-width: 700px)').matches,reportOpen=false;
  const root=h('section',{class:'stack wide'}),notice=status(),panel=h('div',{class:'stack wide'});
  const actions=h('div',{class:'record-toolbar'}),tabs=h('div',{class:'tabs',role:'group','aria-label':'Grading term'});
  const toolbar=mobileMode?h('details',{},h('summary',{},'Reports and downloads'),actions):actions;
  const intro=synthetic
    ?'Practice with invented learners. Change a score to see the result. Blank required scores stay pending.'
    :`Grade ${record.grade} ${record.subject} · ${record.schoolYear} · ${record.schoolName}`;
  root.append(h('div',{class:'record-head'},h('div',{class:'stack'},h('h1',{tabindex:-1},record.title),p(intro,'intro')),back&&btn('Back to classes',back,'quiet')),tabs,toolbar,notice,panel);
  const term=()=>record.periods[TERM_KEYS[termIndex]]??={locked:false,hps:{},scores:{}};
  const roster=()=>Object.entries(record.roster??{}).sort(([a],[b])=>a.localeCompare(b));
  const get=()=>term().hps??={};
  const scores=(id)=>(term().scores??={})[id]??={};
  const invalid=()=>Array.from(panel.querySelectorAll('[aria-invalid=true]'));
  function changed(){
    if(reportOpen)reportOpen=false;
    const ok=onChange(record);
    say(notice,synthetic?(ok?'Practice changes saved in this tab.':'Practice changes are available while this page stays open.'):(ok?'Draft kept in this tab. Save to confirm it in the cloud.':'Draft is in memory. Keep this page open until you save.'),!ok);
  }
  function updateResult(id,node){
    const g=evaluate(get(),term().scores?.[id]);
    if(g.tg==null){node.replaceChildren(h('span',{},g.issue));return;}
    node.replaceChildren(h('span',{class:'result'},`${g.tg} · ${g.descriptor}`),h('br'),h('small',{},`Initial grade ${cleanInitial(g.ig)}`));
  }
  function numeric(id,key,label,result){
    const input=h('input',{inputmode:'decimal',type:'text','aria-label':label,autocomplete:'off',maxlength:12,
      'data-score-slot':id?key:null,value:(id?term().scores?.[id]?.[key]:get()[key])??'',disabled:readOnly||term().locked||Boolean(id&&!get()[key])});
    input.addEventListener('input',()=>{
      try{
        const max=id?get()[key]??0:10000,value=parseNumber(input,max,{hps:!id});
        if(!id&&Object.values(term().scores??{}).some(s=>s[key]!=null&&(value===null||s[key]>value)))
          throw new Error('Clear or correct the affected learner scores before reducing this maximum.');
        if(value===null)delete (id?scores(id):get())[key];
        else (id?scores(id):get())[key]=value;
        input.removeAttribute('aria-invalid');
        if(id)updateResult(id,result);
        if(!id){
          panel.querySelectorAll('[data-learner]').forEach(n=>updateResult(n.dataset.learner,n));
          panel.querySelectorAll(`[data-score-slot="${key}"]`).forEach(n=>{n.disabled=value===null||readOnly||term().locked;});
        }
        changed();
      }catch(e){input.setAttribute('aria-invalid','true');say(notice,e.message,true);}
    });
    return input;
  }
  function ensureValid(){
    if(invalid().length){invalid()[0].focus();say(notice,'Correct the highlighted entries first.',true);return false;}
    return true;
  }
  function printReport(){
    if(!ensureValid())return;
    reportOpen=true;renderPanel();
    document.body.classList.add('printing');
    window.addEventListener('afterprint',()=>document.body.classList.remove('printing'),{once:true});
    window.print();
  }
  async function runExport(button,fn){
    if(!ensureValid())return;
    button.disabled=true;
    try{await fn(record);say(notice,'Export prepared.');}catch(e){say(notice,e.message,true);}finally{button.disabled=false;}
  }
  function renderPanel(){
    if(reportOpen){panel.replaceChildren(reportView(record));return;}
    const learners=roster();
    if(!learners.some(([id])=>id===selectedLearner))selectedLearner=learners[0]?.[0]??'';
    const current=term(),head=h('tr',{},h('th',{scope:'col'},'Learner'),...SLOTS.map(([,label])=>h('th',{scope:'col'},label)),h('th',{scope:'col'},'Term grade'));
    const body=h('tbody');
    const rows=mobileMode?learners.filter(([id])=>id===selectedLearner):learners;
    if(!synthetic)body.append(h('tr',{},h('th',{scope:'row'},'Highest possible score'),...SLOTS.map(([key,label])=>h('td',{},numeric(null,key,'Maximum '+label))),h('td',{},'—')));
    else body.append(h('tr',{},h('th',{scope:'row'},'Highest possible score'),...SLOTS.map(([key])=>h('td',{},get()[key]??'—')),h('td',{},'—')));
    for(const [id,name] of rows){
      const result=h('td',{class:'score-note','data-learner':id});
      updateResult(id,result);
      body.append(h('tr',{},h('th',{scope:'row'},name),...SLOTS.map(([key,label])=>h('td',{},numeric(id,key,name+' '+label,result))),result));
    }
    if(!learners.length)body.append(h('tr',{},h('td',{colspan:13},'Add a learner to start entering scores.')));
    const table=h('table',{class:'record-table','aria-label':`Term ${termIndex+1} scores`},h('thead',{},head),body);
    const tools=h('div',{class:'row-actions'},btn(mobileMode?'Show full sheet':'Enter by learner',()=>{if(!ensureValid())return;mobileMode=!mobileMode;renderPanel();}));
    if(mobileMode&&learners.length){
      const pick=h('select',{'aria-label':'Choose a learner',onchange:e=>{if(!ensureValid()){e.target.value=selectedLearner;return;}selectedLearner=e.target.value;renderPanel();}});
      learners.forEach(([id,name])=>pick.append(option(id,name)));pick.value=selectedLearner;tools.append(pick);
    }
    if(!synthetic&&!readOnly){
      tools.append(btn(current.locked?'Unlock term':'Lock term',()=>{if(!ensureValid())return;current.locked=!current.locked;changed();renderPanel();}));
      const learnerInput=h('input',{placeholder:'Learner name',maxlength:120,required:true,'aria-label':'Learner name'});
      const learnerForm=h('form',{class:'form',onsubmit:e=>{
        e.preventDefault();if(!ensureValid())return;
        const name=learnerInput.value.trim();
        if(!name||name.length>120)return;
        const next=Array.from({length:60},(_,i)=>'r'+String(i+1).padStart(2,'0')).find(id=>!Object.hasOwn(record.roster??{},id));
        if(!next){say(notice,'This class has reached 60 learners. Create a separate class before adding more.',true);return;}
        (record.roster??={})[next]=name;changed();renderPanel();
      }},field('Learner name',learnerInput),h('button',{type:'submit',class:'secondary'},'Add learner'));
      if(!current.locked)tools.append(learnerForm);
      if(learners.length&&!current.locked){
        const rosterTools=h('details',{},h('summary',{},'Edit the learner list'));
        const edit=h('form',{class:'form'});
        const pick=h('select',{'aria-label':'Learner to edit'});
        const name=h('input',{required:true,maxlength:120,'aria-label':'Corrected learner name'});
        learners.forEach(([id,label])=>pick.append(option(id,label)));
        name.value=record.roster[pick.value];
        pick.addEventListener('change',()=>{name.value=record.roster[pick.value];});
        edit.addEventListener('submit',e=>{
          e.preventDefault();if(!ensureValid())return;
          const v=name.value.trim();
          if(!v){say(notice,'Enter the corrected learner name.',true);return;}
          record.roster[pick.value]=v;changed();renderPanel();
        });
        const remove=btn('Remove learner',()=>{
          if(!ensureValid())return;
          if(Object.values(record.periods).some(p=>p.locked)){say(notice,'Unlock all terms before removing a learner and their scores.',true);return;}
          if(!window.confirm('Remove this learner and their scores from this class?'))return;
          const id=pick.value;
          delete record.roster[id];
          for(const p of Object.values(record.periods))if(p.scores)delete p.scores[id];
          changed();renderPanel();
        },'quiet');
        edit.append(field('Learner',pick),field('Corrected learner name',name),h('button',{type:'submit',class:'secondary'},'Save name'),remove);
        rosterTools.append(edit);tools.append(rosterTools);
      }
    }
    const full=h('div',{class:'grid-wrap',tabindex:0,role:'region','aria-label':'Scrollable score table'},table);
    let entry=full;
    if(mobileMode&&rows.length){
      const [[id,name]]=rows;
      const result=h('p',{class:'well','data-learner':id});updateResult(id,result);
      const scoreFields=h('div',{class:'fields'});
      for(const [key,label] of SLOTS){
        if(!get()[key])continue;
        scoreFields.append(field(`${label} · out of ${get()[key]}`,numeric(id,key,name+' '+label,result)));
      }
      const maxFields=h('div',{class:'fields'});
      if(!synthetic)for(const [key,label] of SLOTS)maxFields.append(field(label,numeric(null,key,'Maximum '+label)));
      const maxima=h('details',{},h('summary',{},'Highest possible scores'),maxFields);
      if(!synthetic)maxima.addEventListener('toggle',()=>{if(!maxima.open&&!invalid().length)renderPanel();});
      entry=h('div',{class:'stack'},!synthetic&&maxima,h('h3',{},name),scoreFields,result);
    }
    panel.replaceChildren(tools,entry,p('Term grades appear after all configured scores have been entered.','quiet-copy'));
  }
  function renderTabs(){
    tabs.replaceChildren(...TERM_KEYS.map((_,i)=>btn('Term '+(i+1),()=>{
      if(!ensureValid())return;
      termIndex=i;reportOpen=false;renderTabs();renderPanel();tabs.children[i].focus();
    },'secondary',{'aria-pressed':String(i===termIndex)})));
  }
  actions.append(
    btn(synthetic?'Download practice XLSX':'Download supplementary XLSX',e=>runExport(e.currentTarget,downloadXlsx)),
    btn('Preview gradesheet',e=>{if(!ensureValid())return;reportOpen=!reportOpen;e.currentTarget.textContent=reportOpen?'Back to scores':'Preview gradesheet';renderPanel();}),
    btn('Print or save PDF',printReport),
    btn('Download Word',e=>runExport(e.currentTarget,downloadWord))
  );
  if(reset)actions.append(btn('Reset practice scores',reset,'quiet'));
  if(save&&!readOnly){
    const saveButton=btn('Save to cloud',async e=>{
      if(!ensureValid())return;const button=e.currentTarget;button.disabled=true;
      try{await save(record);say(notice,'Cloud save confirmed.');}catch(error){say(notice,error.message,true);}finally{button.disabled=false;}
    },'primary');
    if(toolbar===actions)actions.append(saveButton);else toolbar.after(saveButton);
  }
  renderTabs();renderPanel();
  return root;
}
