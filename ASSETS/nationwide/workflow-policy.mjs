import {CORE_GRADES,CORE_SUBJECTS,evaluate,exampleLearner,newDemo,scoreValue,SLOTS,TERM_KEYS,WORKFLOW_PRACTICE} from './policy.mjs';

export const practiceLimits=Object.freeze({ww:5,pt:3,qa:3});
const kinds=Object.keys(practiceLimits);
const slotGroups={ww:SLOTS.slice(0,5),pt:SLOTS.slice(5,8),qa:SLOTS.slice(8)};
const category=name=>/^(?:boys|girls)$/i.test(name);
export const validPracticeName=value=>value===''||exampleLearner(value)||category(value);
const allowedColors=['purple','green','blue','red','charcoal','baby-blue','deep-red','yellow','orange','pink','gray','black','brown'];
const isSameWeights=weights=>Array.isArray(weights)&&weights.length===3&&weights.every((value,index)=>value===[20,50,30][index]);
const requiredName='Use an invented name from Example learner 1 through Example learner 60.';

export function practiceClass(id,section='',theme='blue',grade=6,subject='Science'){
  if(!CORE_GRADES.includes(grade)||!CORE_SUBJECTS.includes(subject))throw new Error('Choose a supported grade and core subject.');
  return {id,section,theme:allowedColors.includes(theme)?theme:'blue',group:'JHS',level:'Grade '+grade,subject,
    gradingCategory:subject,weights:[20,50,30],gradingMode:'school-transmutation',rosterSize:4,archived:false};
}
const gradeOf=section=>CORE_GRADES.find(grade=>section?.level==='Grade '+grade);
function toSlots(source){
  const values={};
  for(const kind of kinds)for(const [index,[slot]] of slotGroups[kind].entries()){
    const value=source[kind]?.[index];
    if(value!==undefined&&value!==null&&value!=='')values[slot]=value;
  }
  return values;
}
const maxima=period=>Object.fromEntries(kinds.map(kind=>[kind,period[kind+'Hps']]));
const learnerId=name=>'r'+name.slice(16).padStart(2,'0');

export function calculatePracticeLearner(learner,period,result){
  const value=evaluate(toSlots(maxima(period)),toSlots(learner));
  if(value.tg==null){
    for(const kind of kinds)result[kind]={...result[kind],percentage:null,weighted:null};
    result.initial={precise:null,rounded:null,transmuted:null,descriptor:'—',error:value.issue};
    return result;
  }
  const percentages=[value.written,value.performance,value.exams];
  kinds.forEach((kind,index)=>{
    result[kind]={...result[kind],percentage:percentages[index],weighted:percentages[index]*[.2,.5,.3][index]};
  });
  result.initial={precise:value.ig,rounded:Math.round(value.ig*1000)/1000,transmuted:value.tg,descriptor:value.descriptor};
  return result;
}

export function practiceRecord(section,periods){
  const grade=gradeOf(section);
  if(!grade||!CORE_SUBJECTS.includes(section.subject)||!isSameWeights(section.weights))
    throw new Error('This report supports Grades 4–10 core subjects, SY 2026–2027.');
  const result={...WORKFLOW_PRACTICE,grade,subject:section.subject,schoolName:'Example school',synthetic:true,roster:{},periods:{}};
  for(const [index,period] of periods.entries()){
    const term=TERM_KEYS[(period.term??index+1)-1];
    if(!term||result.periods[term])throw new Error('Each term needs a distinct term number.');
    const hps=toSlots(maxima(period)),scores={};
    for(const [key,value] of Object.entries(hps)){
      const maximum=scoreValue(value);
      if(maximum===null||maximum<.001||maximum>10000)throw new Error(`Correct the maximum scores in ${period.name} before exporting.`);
      hps[key]=maximum;
    }
    for(const learner of period.roster){
      const name=learner.name.trim();
      if(!name||category(name))continue;
      if(!exampleLearner(name))throw new Error(requiredName);
      const id=learnerId(name);
      if(Object.hasOwn(scores,id))throw new Error(`${name} appears more than once in ${period.name}. Use a distinct practice name for each learner.`);
      result.roster[id]=name;
      scores[id]=toSlots(learner);
      for(const [key,value] of Object.entries(scores[id])){
        const numeric=scoreValue(value);
        scores[id][key]=numeric===null?String(value):numeric;
      }
    }
    result.periods[term]={hps,scores,locked:period.locked};
  }
  return result;
}

export function initialPracticeState(){
  const sample=newDemo(),section=practiceClass('science-practice','Practice A');
  const periods=TERM_KEYS.map((term,index)=>{
    const source=sample.periods[term];
    return {name:`Term ${index+1}`,term:index+1,quarter:0,semester:0,locked:false,
      ...Object.fromEntries(kinds.flatMap(kind=>[
        [kind+'Dates',slotGroups[kind].map(()=>'')],
        [kind+'Hps',slotGroups[kind].map(([slot])=>source.hps[slot]??'')]
      ])),
      activityMeta:Object.fromEntries(kinds.map(kind=>[kind,slotGroups[kind].map(([slot])=>({
        title:'',competency:'',topic:'',role:kind==='qa'?slot:''
      }))])),
      roster:Object.entries(sample.roster).map(([id,name])=>({name,...Object.fromEntries(kinds.map(kind=>[
        kind,slotGroups[kind].map(([slot])=>source.scores[id]?.[slot]??'')
      ]))}))};
  });
  return {version:4,workflow:WORKFLOW_PRACTICE.id,teacher:{name:'Practice teacher',level:'Elementary',specialization:'Science'},
    photo:'',calendarMode:'trimester',trimesterModeSeen:true,registry:[],sections:{},
    registryTri:[section],sectionsTri:{[section.id]:{periods}}};
}

export function validatePracticeState(state){
  if(state?.workflow!==WORKFLOW_PRACTICE.id||state.calendarMode!=='trimester'||state.registry?.length||
    !Array.isArray(state.registryTri)||state.registryTri.length>12||!state.sectionsTri)
    throw new Error('This backup must come from a three-term core-subject practice workspace.');
  const classes=new Set();
  for(const section of state.registryTri){
    if(!/^(?:science-practice|class-[a-z0-9-]{1,64})$/.test(section?.id??'')||classes.has(section.id)||section.group!=='JHS'||
      !gradeOf(section)||!CORE_SUBJECTS.includes(section.subject)||section.gradingMode!=='school-transmutation'||!isSameWeights(section.weights))
      throw new Error('This class uses a different grading policy.');
    classes.add(section.id);
    const periods=Object.hasOwn(state.sectionsTri,section.id)?state.sectionsTri[section.id].periods:null;
    if(!Array.isArray(periods)||periods.length<1||periods.length>3)throw new Error('Practice classes use up to three terms.');
    const terms=new Set();
    for(const period of periods){
      if(![1,2,3].includes(period.term)||terms.has(period.term)||!Array.isArray(period.roster)||period.roster.length>60)
        throw new Error('Check the term numbers and the 60-learner limit.');
      terms.add(period.term);
      for(const kind of kinds){
        const maximum=period[kind+'Hps'],dates=period[kind+'Dates'];
        if(!Array.isArray(maximum)||!Array.isArray(dates)||maximum.length!==dates.length||maximum.length<1||
          maximum.length>practiceLimits[kind]||kind==='qa'&&maximum.length!==3)
          throw new Error('Check the practice policy’s assessment limits.');
      }
      const names=new Set();
      for(const learner of period.roster){
        if(typeof learner.name!=='string'||!validPracticeName(learner.name.trim()))throw new Error(requiredName);
        const name=learner.name.trim();
        if(exampleLearner(name)&&names.has(name))throw new Error(`Use distinct practice names in ${period.name}.`);
        names.add(name);
        if(kinds.some(kind=>!Array.isArray(learner[kind])||learner[kind].length!==period[kind+'Hps'].length||
          learner[kind].some(value=>!['string','number'].includes(typeof value))))
          throw new Error('Learner scores must match the term’s assessment columns.');
      }
    }
  }
  if(Object.keys(state.sectionsTri).some(id=>!classes.has(id)))throw new Error('This backup has records outside its class list.');
  return state;
}
