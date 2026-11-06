import {h,p,btn,link,field,status,say,option} from './dom.mjs';
import {connect,authMessage} from './auth.mjs';
import {makeDirectory,searchSchools,provisional,short,KEY,normalizeSchool,fold} from './directory.mjs';
import {POLICY_GATES,PRIVATE_POLICY,TERM_KEYS} from './policy.mjs';
import {practice,recordEditor} from './record.mjs';
import {saveRecovery,readRecovery,classContent} from './recovery.mjs';

const main=document.querySelector('main');
const mode=document.querySelector('meta[name=cstr-mode]')?.content??'closed';
const route=document.body.dataset.route;
const directory=makeDirectory();
const seal='/ASSETS/nationwide/seal.svg';
const app=()=>h('section',{class:'stack'});
const form=()=>h('form',{class:'form'});
const input=(name,props={})=>h('input',{name,...props});
const textInput=(name,max,more={})=>input(name,{type:'text',maxlength:max,required:true,...more});
const submit=label=>h('button',{type:'submit',class:'primary'},label);
const actionRow=(...children)=>h('div',{class:'actions row-actions'},children);
const logo=src=>h('img',{src:src||seal,width:56,height:56,alt:''});
const sector=s=>s==='public'?'Public school':'Private school';
const show=section=>main.replaceChildren(section);
const heading=(title,description)=>{const page=app();page.append(h('h1',{},title));if(description)page.append(p(description,'intro'));return page;};
const safeGet=(key)=>{try{return sessionStorage.getItem(key);}catch{return null;}};
const safeSet=(key,value)=>{try{sessionStorage.setItem(key,value);return true;}catch{return false;}};
const safeDrop=(key)=>{try{sessionStorage.removeItem(key);}catch{}};
let busy=false,activeAuth,unwatch=[],routeGeneration=0;
let loadedAccount=null;
const originStore='class-record-neutral:';
const logoKey=(uid,school)=>originStore+'logo:'+uid+':'+school;
const profileDraftKey=uid=>originStore+'onboarding:'+uid;
const classDraftKey=(uid,school,id)=>originStore+'draft:'+uid+':'+school+':'+id;
function releaseWatches(){for(const fn of unwatch.splice(0))fn();}
function savedLogo(uid,school){const v=safeGet(logoKey(uid,school));return window.CSTRSafeRaster?.safeDataUrl(v,250000)?v:'';}
async function work(button,notice,fn){
  if(busy)return;
  busy=true;if(button)button.disabled=true;say(notice,'Working…');
  try{await fn();}catch(e){say(notice,e instanceof FormError?e.message:authMessage(e),true);}
  finally{busy=false;if(button)button.disabled=false;}
}
class FormError extends Error {}
const fail=(msg)=>{throw new FormError(msg);};
function onSubmit(node,notice,fn){node.addEventListener('submit',e=>{e.preventDefault();void work(e.submitter??node.querySelector('button[type=submit]'),notice,fn);});}
function information(){
  const s=heading('Privacy and use','Class Record is an independent teacher tool.');
  s.append(h('h2',{},'Practice'),p('The practice class uses invented learners. Only numeric sample changes are kept in this tab. It does not submit data to a school.'),
    h('h2',{},'Teacher accounts'),p('Firebase manages sign-in. Your verified email identifies your account. A neutral teacher profile contains a display name and a school preference. An optional uploaded logo stays in this tab. A school preference does not establish affiliation.'),
    h('h2',{},'Learner records'),p('Use identifiable learner records only in a school-authorized workspace. Public-school learner records are unavailable here. Supplementary exports are separate from official school submission.'),
    h('h2',{},'Account help'),p('For CST-R recovery or a privacy request, use the contact in the faculty privacy notice. Send your sign-in email and a brief description. Keep passwords and learner records private.'),
    link('CST-R privacy notice','/policies.html'));
  return s;
}
function closedPage(){
  const preview=mode==='production'&&!activeAuth;
  const s=heading(route==='register'?'Teacher registration':'Sign in',preview
    ?'Create your teacher account on the live Class Record site.'
    :'New teacher registration is temporarily unavailable. You can still open the practice class.');
  s.append(actionRow(preview?link('Open live registration','https://cstr-class-record-global.web.app/register/','primary'):link('Open the practice class','/practice/','primary'),link('CST-R faculty sign-in','/cst-r/','secondary')),link('Privacy and use','/privacy/'));
  return s;
}
function renderSignIn(auth,{reset=false}={}){
  const s=heading(reset?'Reset your password':'Sign in',reset?'Enter the email address you use for your teacher account.':'Use your neutral teacher account or continue to the CST-R faculty workspace.');
  const f=form(),note=status(),email=input('email',{type:'email',autocomplete:'username',required:true,maxlength:254}),password=input('password',{type:'password',autocomplete:'current-password',required:true,maxlength:256});
  f.append(field('Email address',email));
  if(!reset)f.append(field('Password',password));
  f.append(actionRow(submit(reset?'Send reset email':'Sign in'),reset?link('Back to sign in','/signin/'):btn('Forgot password',()=>renderSignIn(auth,{reset:true}),'quiet')),note);
  onSubmit(f,note,async()=>{
    if(reset){await auth.reset(email.value);say(note,'If an account can receive a reset email, check your inbox.');return;}
    await auth.signIn(email.value,password.value);
  });
  if(!reset){
    const google=btn('Continue with Google',e=>work(e.currentTarget,note,()=>auth.google()),'secondary');
    f.append(google);
  }
  s.append(f,actionRow(link('Create a teacher account','/register/'),link('CST-R faculty sign-in','/cst-r/')));show(s);
}
async function renderRegister(auth){
  const s=heading('Create a free teacher account','Verify your email, then review your school and finish setting up your profile.');
  const f=form(),note=status();
  const email=input('email',{type:'email',autocomplete:'username',required:true,maxlength:254});
  const password=input('password',{type:'password',autocomplete:'new-password',minlength:12,maxlength:256,required:true});
  const confirm=input('confirm',{type:'password',autocomplete:'new-password',minlength:12,maxlength:256,required:true});
  const accept=input('accept',{type:'checkbox',required:true});
  const create=submit('Create account'),google=btn('Continue with Google',e=>{
    if(!accept.checked){accept.focus();say(note,'Read and accept the privacy notice to continue.',true);return;}
    void work(e.currentTarget,note,()=>auth.google());
  });
  create.disabled=true;google.disabled=true;
  f.append(field('Email address',email),field('Password · at least 12 characters',password),field('Confirm password',confirm),
    h('label',{class:'check'},accept,h('span',{},'I have read ',link('Privacy and use','/privacy/'),' and understand how my profile is used.')),
    actionRow(create,google),note);
  onSubmit(f,note,async()=>{
    if(password.value!==confirm.value)fail('The passwords do not match.');
    await auth.create(email.value,password.value);
    try{await auth.sendVerification();safeSet(originStore+'verification-sent:'+auth.user.uid,String(Date.now()));}
    catch{/* The verification screen supports retry. */}
  });
  s.append(f,link('Already registered? Sign in','/signin/'));show(s);
  try{
    const enabled=await auth.canRegister();
    create.disabled=!enabled;google.disabled=!enabled;
    if(!enabled)say(note,'Registration is temporarily unavailable. You can still open the practice class.');
  }catch{say(note,'The service could not confirm whether registration is open. Reconnect and reload.',true);}
}
function renderVerify(auth,user){
  const s=heading('Verify your email','Open the verification link in your inbox, then return here.');
  const note=status();
  const verify=btn('I verified my email',e=>work(e.currentTarget,note,async()=>{
    if(!await auth.refreshVerification())fail('This address is not verified yet. Open the email link and try again.');
    await onAccount(auth.user);
  }),'primary');
  const resend=btn('Resend verification',e=>work(e.currentTarget,note,async()=>{
    const key=originStore+'verification-sent:'+user.uid,last=Number(safeGet(key));
    if(Date.now()-last<60000)fail('Wait one minute before sending another verification email.');
    await auth.sendVerification();safeSet(key,String(Date.now()));say(note,'Verification email sent. Check spam if it does not arrive.');
  }));
  s.append(actionRow(verify,resend,btn('Sign out',e=>work(e.currentTarget,note,()=>auth.signOut()),'quiet')),note);show(s);
}
async function setupProfile(auth,user,profile=null){
  let picked=profile?.school??null,logoValue=picked?savedLogo(user.uid,picked.key):'',pickedLogo='',rows=[],searchGeneration=0;
  const s=heading(profile?'School settings':'Choose your school','Preview the name, location and sector. Your selection changes your profile and leaves past classes under their original school.');
  const f=form(),note=status(),display=textInput('name',120,{value:profile?.displayName??'',autocomplete:'name',minlength:2});
  const accept=profile?null:input('accept',{type:'checkbox',required:true});
  const region=h('select',{name:'region'},option('','Choose a region'));
  const query=input('query',{type:'search',maxlength:100,placeholder:'School name, ID or municipality'});
  const results=h('ul',{class:'school-results','aria-label':'School search results'}),directoryNote=p('Checking the school directory…','quiet-copy');
  const preview=h('div',{class:'well school-preview','aria-live':'polite'});
  const ownSchool=h('details',{},h('summary',{},'Add a school privately'));
  const schoolName=textInput('schoolName',160,{required:false,minlength:2}),locality=textInput('locality',120,{required:false,minlength:2});
  const schoolId=textInput('schoolId',6,{required:false,inputmode:'numeric',pattern:'[0-9]{6}'});
  const schoolSector=h('select',{name:'schoolSector'},option('','Choose public or private'),option('public','Public school'),option('private','Private school'));
  const upload=input('logo',{type:'file',accept:'image/png,image/jpeg'});
  const noLogo=btn('Use default seal',()=>{logoValue='';upload.value='';previewSchool();},'quiet');
  function previewSchool(){
    preview.replaceChildren(logo(logoValue||pickedLogo),picked
      ?h('div',{},h('strong',{},picked.name),p(`${sector(picked.sector)} · ${picked.locality}${picked.schoolId?' · '+picked.schoolId:''}`))
      :p('No school selected.'));
  }
  function renderMatches(){
    results.replaceChildren();
    for(const row of searchSchools(rows,query.value,{region:region.value})){
      const item=btn('',()=>{
        picked=normalizeSchool(row);pickedLogo=row.logo;logoValue=savedLogo(user.uid,picked.key);upload.value='';previewSchool();
      },'');
      item.append(h('strong',{},row.name),h('small',{},`${sector(row.sector)} · ${row.locality}`));
      results.append(h('li',{},item));
    }
    if(!results.children.length&&region.value&&query.value)results.append(h('li',{},p('No match. Try a school ID or add the school privately.')));
  }
  query.addEventListener('input',renderMatches);
  region.addEventListener('change',async()=>{
    const request=++searchGeneration;rows=[];renderMatches();
    if(!region.value)return;
    directoryNote.textContent='Loading schools…';
    try{const next=await directory.rows(region.value);if(request!==searchGeneration)return;rows=next;directoryNote.textContent='Search this region or select a listed school.';renderMatches();}
    catch(e){if(request===searchGeneration)directoryNote.textContent=e.message;}
  });
  const add=btn('Preview this school',e=>work(e.currentTarget,note,async()=>{
    let result;try{result=await provisional({name:schoolName.value,locality:locality.value,schoolId:schoolId.value,sector:schoolSector.value});}
    catch(err){fail(err.message);}
    const duplicate=rows.find(row=>result.schoolId
      ?row.schoolId===result.schoolId
      :row.sector===result.sector&&fold(row.name)===fold(result.name)&&fold(row.locality)===fold(result.locality));
    picked=normalizeSchool(duplicate??result);pickedLogo=duplicate?.logo??'';logoValue=savedLogo(user.uid,picked.key);upload.value='';previewSchool();
    say(note,duplicate?'Selected the matching school from the directory.':'School preview ready. Save to finish.');
  }));
  ownSchool.append(h('div',{class:'fields'},field('School name',schoolName),field('Municipality or city',locality),
    field('Sector',schoolSector),field('School ID · optional',schoolId)),add);
  upload.addEventListener('change',async()=>{
    if(!upload.files?.length)return;
    const owner=picked?.key;
    if(!owner){say(note,'Choose a school before adding a logo.',true);upload.value='';return;}
    try{const encoded=await window.CSTRSafeRaster.encode(upload.files[0],{maxEdge:384,maxOutput:250000});if(picked?.key!==owner)return;logoValue=encoded;previewSchool();say(note,'Logo preview ready. It stays in this tab.');}
    catch(e){say(note,e.message,true);upload.value='';}
  });
  const cached=safeGet(profileDraftKey(user.uid));
  if(cached&&!profile){try{const draft=JSON.parse(cached);display.value=draft.displayName; picked=normalizeSchool(draft.school);}catch{}}
  previewSchool();
  f.append(field('Display name',display),h('div',{class:'directory'},directoryNote,field('Region',region),field('Search schools',query),results),ownSchool,
    preview,field('School logo · optional PNG or JPEG',upload),noLogo);
  if(accept)f.append(h('label',{class:'check'},accept,h('span',{},'I have read ',link('Privacy and use','/privacy/'),' and understand how my profile is used.')));
  f.append(actionRow(submit(profile?'Save school settings':'Save profile'),profile&&btn('Back to workspace',()=>workspace(auth,user,profile),'quiet')),note);
  onSubmit(f,note,async()=>{
    if(!picked)fail('Choose a school or preview a privately added school first.');
    let name;try{name=short(display.value,2,120);}catch{fail('Enter a display name from 2 to 120 characters.');}
    safeSet(profileDraftKey(user.uid),JSON.stringify({displayName:name,school:picked}));
    const saved=await auth.saveProfile(name,picked,profile?.revision??0);
    if(logoValue)safeSet(logoKey(user.uid,picked.key),logoValue);else safeDrop(logoKey(user.uid,picked.key));
    safeDrop(profileDraftKey(user.uid));
    if(route!=='teacher'){location.assign('/teacher/');return;}
    await workspace(auth,user,saved);
  });
  s.append(f,btn('Sign out',e=>work(e.currentTarget,note,()=>auth.signOut()),'quiet'));show(s);
  try{
    const manifest=await directory.manifest();
    manifest.regions.forEach(item=>region.append(option(item.id,item.label)));
    directoryNote.textContent=manifest.regions.length?'Select a region to search the available schools.':'Add your school below. Your entry stays in your teacher profile.';
    region.disabled=!manifest.regions.length;query.disabled=!manifest.regions.length;
    if(!manifest.regions.length&&!picked)ownSchool.open=true;
  }catch(e){directoryNote.textContent=e.message;region.disabled=true;query.disabled=true;if(!picked)ownSchool.open=true;}
}
function permitted(grant,key){
  return KEY.test(key)&&grant?.active===true&&grant.sector==='private'&&grant.expiresAt>Date.now()&&grant.policy===PRIVATE_POLICY.id&&grant.grade===6&&grant.subject==='Science'&&
    typeof grant.schoolName==='string'&&grant.schoolName.length<=160&&/^20\d\d-20\d\d$/.test(grant.schoolYear)&&typeof grant.curriculum==='string';
}
function makeClass(uid,key,id,grant,title){
  return {ownerUid:uid,classId:id,schoolKey:key,schoolName:grant.schoolName,schoolYear:grant.schoolYear,curriculum:grant.curriculum,
    grade:grant.grade,subject:grant.subject,policy:grant.policy,template:PRIVATE_POLICY.template,sector:'private',title,archived:false,roster:{},
    periods:Object.fromEntries(TERM_KEYS.map(t=>[t,{hps:{},scores:{},locked:false}])),revision:0};
}
function clearDrafts(uid){
  try{Object.keys(sessionStorage).filter(k=>k.startsWith(originStore+'draft:'+uid+':')).forEach(k=>sessionStorage.removeItem(k));}catch{}
}
function clearSession(uid){
  clearDrafts(uid);
  safeDrop(profileDraftKey(uid));
  safeDrop(originStore+'verification-sent:'+uid);
  try{Object.keys(sessionStorage).filter(k=>k.startsWith(originStore+'logo:'+uid+':')).forEach(safeDrop);}catch{}
}
async function workspace(auth,user,profile){
  releaseWatches();
  loadedAccount={uid:user.uid,profile};
  const s=heading('Your class record',`Welcome, ${profile.displayName}.`),note=status(),area=h('div',{class:'stack'});
  let context=profile.school.key,grants={},privateOpen=false,listRequest=0,canLeave=()=>true;
  const bar=h('div',{class:'school-bar'});
  const settings=btn('School settings',()=>{if(!canLeave())return;releaseWatches();void setupProfile(auth,user,profile);},'quiet');
  const openPractice=link('Open practice class','/practice/','secondary');
  openPractice.addEventListener('click',e=>{if(!canLeave())e.preventDefault();});
  s.append(bar,actionRow(openPractice,btn('Link Google account',e=>work(e.currentTarget,note,async()=>{await auth.linkGoogle();say(note,'Google linked.');})),
    btn('Sign out',e=>{if(canLeave(true))void work(e.currentTarget,note,async()=>{await auth.signOut();clearSession(user.uid);});}, 'quiet')),note,area);
  show(s);
  async function showClasses(){
    canLeave=()=>true;
    const request=++listRequest;
    const valid=Object.entries(grants).filter(([key,g])=>privateOpen&&permitted(g,key));
    if(!valid.some(([key])=>key===context))context=profile.school.key;
    const holder=h('div',{class:'stack'});
    if(valid.length){
      const selector=h('select',{'aria-label':'School context',onchange:e=>{context=e.target.value;void showClasses();}});
      if(!valid.some(([key])=>key===profile.school.key))selector.append(option(profile.school.key,profile.school.name+' · profile'));
      valid.forEach(([key,g])=>selector.append(option(key,g.schoolName+' · Private')));
      selector.value=context;holder.append(field('School context',selector));
    }
    area.replaceChildren(holder);
    const grant=grants[context],schoolContext=context;
    const active=privateOpen&&permitted(grant,context)?{name:grant.schoolName,sector:'private'}:profile.school;
    bar.replaceChildren(logo(savedLogo(user.uid,context)),h('div',{},h('strong',{},active.name),p(sector(active.sector))),settings);
    if(!privateOpen||!permitted(grant,context)){
      holder.append(h('h2',{},profile.school.sector==='public'?'Public-school practice':'Class access'),
        p(profile.school.sector==='public'?'Real learner records are unavailable here. Try the Grade 6 Science practice class.':'You can use a class workspace after your school’s policy and record access are approved.'));return;
    }
    holder.append(h('h2',{},`Classes · ${grant.schoolName}`),p('Loading classes…'));
    let classes;
    try{classes=await auth.classes(context);}catch(e){if(request===listRequest)holder.lastChild.textContent=authMessage(e);return;}
    if(request!==listRequest)return;
    holder.lastChild.remove();
    const list=h('ul',{class:'classes'}),archived=h('details',{},h('summary',{},'Archived classes')),archList=h('ul',{class:'classes'});
    archived.append(archList);
    for(const [id,value] of Object.entries(classes)){
      const item=h('li',{},btn(value.title,()=>openClass({...value,periods:value.periods??{}},false),'secondary'));
      if(value.archived)archList.append(item);else list.append(item);
    }
    if(!list.children.length)holder.append(p('No active classes yet.'));
    else holder.append(list);
    if(archList.children.length)holder.append(archived);
    const f=form(),name=textInput('classTitle',120,{placeholder:'Section name'});
    f.append(field('New Grade 6 Science class',name),submit('Create class'));
    f.addEventListener('submit',e=>{
      e.preventDefault();const id=Array.from({length:12},(_,i)=>'c'+String(i+1).padStart(2,'0')).find(k=>!Object.hasOwn(classes,k)&&!safeGet(classDraftKey(user.uid,context,k)));
      if(!id){say(note,'This school context has reached 12 classes.',true);return;}
      try{openClass(makeClass(user.uid,context,id,grant,short(name.value,1,120)),true);}catch(e){say(note,e.message,true);}
    });
    holder.append(f);
    for(let i=1;i<=12;i++){
      const id='c'+String(i).padStart(2,'0');
      if(!Object.hasOwn(classes,id)&&safeGet(classDraftKey(user.uid,context,id)))
        holder.append(btn('Resume unsaved class '+i,()=>openClass(makeClass(user.uid,context,id,grant,'Unsaved class'),true)));
    }
    function openClass(record,newClass){
      if(context!==schoolContext||!privateOpen||!permitted(grants[context],context))return;
      const key=classDraftKey(user.uid,context,record.classId);
      const meta=['ownerUid','classId','schoolKey','schoolName','schoolYear','curriculum','grade','subject','policy','template','sector'];
      const draft=safeGet(key);
      let recovered=false;
      if(draft)try{
        const local=JSON.parse(draft);
        if(meta.every(m=>local[m]===record[m])&&local.revision===record.revision&&confirm('Resume the unsaved draft for this class?')){
          record={...record,...classContent(local,record)};recovered=true;
        }else if(local.revision!==record.revision){
          say(note,'This tab has an older draft. The newer cloud version is shown. Download the draft for comparison before editing.',true);
        }
      }catch{}
      const draftNotice=status(),wrapper=h('div',{class:'stack wide'},draftNotice);
      let dirty=newClass||recovered,durable=true,sessionRev=record.revision??0;
      const staleDraft=Boolean(draft&&!recovered);
      const historical=record.schoolYear!==grant.schoolYear||record.policy!==grant.policy||record.curriculum!==grant.curriculum;
      const permitEdit=!historical&&!staleDraft&&!record.archived;
      const stillAllowed=()=>privateOpen&&context===schoolContext&&permitted(grants[schoolContext],schoolContext)&&auth.user?.uid===user.uid;
      canLeave=(signOut=false)=>{
        if(!dirty)return true;
        if(signOut)return confirm('Sign out and clear this tab’s unsaved changes? Save or download an encrypted backup to keep them.');
        if(durable)return true;
        say(draftNotice,'Keep this page open until you can save. The draft could not be stored in this tab.',true);return false;
      };
      function checkpoint(){
        dirty=true;
        durable=safeSet(key,JSON.stringify(record));return durable;
      }
      function back(){
        if(!canLeave())return;
        void showClasses();
      }
      async function save(record){
        if(!stillAllowed())fail('Class access ended. Contact your school before continuing.');
        const serialized=JSON.stringify(record),snapshot=JSON.parse(serialized);
        try{
          const saved=await auth.saveClass(snapshot,sessionRev);
          sessionRev=saved.revision;
          record.revision=saved.revision;record.createdAt=saved.createdAt;record.updatedAt=saved.updatedAt;
          dirty=JSON.stringify({...record,revision:snapshot.revision,createdAt:snapshot.createdAt,updatedAt:snapshot.updatedAt})!==serialized;
          if(!dirty)safeDrop(key);else checkpoint();
          say(draftNotice,dirty?'Saved version confirmed. Later edits remain in this tab.':'');
          if(dirty)throw new FormError('Cloud save confirmed for the earlier version. Save the newer draft again.');
        }catch(e){if(dirty)checkpoint();if(e instanceof FormError)throw e;throw new FormError(authMessage(e));}
      }
      if(newClass&&!staleDraft)checkpoint();
      if(staleDraft){
        say(draftNotice,'An existing draft needs review before this class can be edited.',true);
        wrapper.append(btn('Discard this tab’s draft',()=>{if(confirm('Discard the draft in this tab?')){safeDrop(key);void showClasses();}},'quiet'));
      }else if(historical)say(draftNotice,'This historical class is read-only under the current school policy.');
      else if(!newClass){
        wrapper.append(btn(record.archived?'Restore this class':'Archive this class',async e=>{
          if(dirty){say(draftNotice,'Save the current draft before changing its archive status.',true);return;}
          const button=e.currentTarget;button.disabled=true;
          try{await auth.saveClass({...record,archived:!record.archived},sessionRev);await showClasses();}
          catch(error){say(draftNotice,authMessage(error),true);button.disabled=false;}
        },'quiet'));
      }
      const recovery=h('details',{},h('summary',{},'Encrypted class backup'));
      const recoverForm=form(),pass=input('pass',{type:'password',minlength:12,maxlength:256,autocomplete:'off',required:true});
      recoverForm.append(field('Backup passphrase',pass),submit(staleDraft?'Download this tab’s draft':'Download class backup'));
      onSubmit(recoverForm,draftNotice,async()=>{
        if(!stillAllowed())fail('Class access ended.');
        try{
          const data=staleDraft?{...record,...classContent(JSON.parse(draft),record)}:record;
          const blob=await saveRecovery(data,pass.value);
          if(!stillAllowed())fail('Class access ended.');
          const url=URL.createObjectURL(blob),anchor=h('a',{href:url,download:'class-record-'+record.classId+'.classrecord'});
          document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
          pass.value='';say(draftNotice,'Encrypted backup prepared.');
        }catch(e){fail(e.message);}
      });
      recovery.append(recoverForm);
      if(permitEdit){
        const importForm=form(),file=input('backup',{type:'file',accept:'.classrecord',required:true});
        const importPass=input('importPass',{type:'password',minlength:12,maxlength:256,autocomplete:'off',required:true});
        importForm.append(field('Class backup file',file),field('Backup passphrase for restore',importPass),submit('Review backup for restore'));
        onSubmit(importForm,draftNotice,async()=>{
          if(!stillAllowed())fail('Class access ended.');
          let local;try{local=await readRecovery(file.files?.[0],importPass.value,record);}catch(e){fail(e.message);}
          importPass.value='';
          if(!stillAllowed())fail('Class access ended.');
          if(!confirm(`Restore the draft for “${local.title}” with ${Object.keys(local.roster).length} learners? The cloud copy changes only after you save.`)){
            say(draftNotice,'Restore cancelled.');return;
          }
          Object.assign(record,local);checkpoint();renderEditor();say(draftNotice,'Backup restored in this tab. Review before saving.');
        });
        recovery.append(importForm);
      }
      wrapper.append(recovery);
      const editor=h('div',{class:'stack wide'});
      function renderEditor(){editor.replaceChildren(recordEditor(record,{save,onChange:checkpoint,back,readOnly:!permitEdit}));}
      renderEditor();wrapper.append(editor);
      area.replaceChildren(wrapper);
      if(!durable)say(draftNotice,'Draft storage is unavailable. Keep this page open until you can save.',true);
    }
  }
  unwatch.push(auth.watchPrivateOpen(next=>{if(next===privateOpen)return;privateOpen=next;if(!next)clearDrafts(user.uid);void showClasses();}));
  unwatch.push(auth.watchGrants(next=>{
    for(const key of Object.keys(grants))if(!permitted(next[key],key))try{Object.keys(sessionStorage).filter(k=>k.startsWith(originStore+'draft:'+user.uid+':'+key+':')).forEach(safeDrop);}catch{}
    grants=next;void showClasses();
  },()=>{grants={};clearDrafts(user.uid);void showClasses();}));
  let expiryTimer=setInterval(()=>{
    if(Object.entries(grants).some(([key,g])=>g.active&&g.expiresAt<=Date.now())){
      grants=Object.fromEntries(Object.entries(grants).filter(([key,g])=>permitted(g,key)));clearDrafts(user.uid);void showClasses();
    }
  },15000);
  unwatch.push(()=>clearInterval(expiryTimer));
  const checkExit=event=>{if(!canLeave()){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',checkExit);
  unwatch.push(()=>window.removeEventListener('beforeunload',checkExit));
  await showClasses();
}
async function onAccount(user){
  const id=++routeGeneration;
  releaseWatches();
  const auth=activeAuth;
  if(!user){
    if(loadedAccount)clearSession(loadedAccount.uid);
    loadedAccount=null;
    if(route==='register'){void renderRegister(auth);return;}
    if(route==='teacher'){location.replace('/signin/');return;}
    renderSignIn(auth);return;
  }
  const hold=heading('Checking your account','This may take a moment.');show(hold);
  try{
    const state=await auth.legacyStatus();
    if(id!==routeGeneration)return;
    if(state==='legacy'){location.replace('/cst-r/');return;}
    if(state==='held'){
      const s=heading('Account needs review','Use CST-R account recovery if you have an existing faculty account.');
      const note=status();s.append(actionRow(link('CST-R account help','/cst-r/','secondary'),btn('Sign out',e=>work(e.currentTarget,note,()=>auth.signOut()),'quiet')),note);show(s);return;
    }
    if(!user.emailVerified){renderVerify(auth,user);return;}
    const profile=await auth.profile();
    if(id!==routeGeneration)return;
    if(!profile){
      if(!await auth.canRegister()){show(closedPage());return;}
      if(id!==routeGeneration)return;
      await setupProfile(auth,user);return;
    }
    if(route!=='teacher'){location.replace('/teacher/');return;}
    await workspace(auth,user,profile);
  }catch(e){
    if(id!==routeGeneration)return;
    const s=heading('Account access unavailable',authMessage(e)),note=status();
    s.append(actionRow(btn('Try again',()=>void onAccount(auth.user),'primary'),btn('Sign out',x=>work(x.currentTarget,note,()=>auth.signOut()),'quiet')),note);show(s);
  }
}
if(route==='practice')show(practice());
else if(route==='privacy')show(information());
else {
  try{
    activeAuth=await connect(mode);
    if(activeAuth)activeAuth.onChange(user=>void onAccount(user));
    else show(closedPage());
  }catch(e){const s=heading('Sign-in is unavailable',authMessage(e));s.append(link('Try again',location.pathname,'primary'),link('CST-R faculty','/cst-r/'));show(s);}
}
