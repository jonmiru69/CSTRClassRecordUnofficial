export const CUTOFFS=Object.freeze([0,4.68,9.35,14.01,18.68,23.35,28.01,32.68,37.34,42.01,46.67,51.34,56.01,60.67,65.34,70,71.18,72.36,73.54,74.72,75.90,77.08,78.26,79.44,80.62,81.80,82.98,84.16,85.34,86.52,87.70,88.88,90.06,91.24,92.42,93.60,94.78,95.96,97.14,98.32,99.50]);
export const SLOTS=Object.freeze([
  ['w1','WW 1'],['w2','WW 2'],['w3','WW 3'],['w4','WW 4'],['w5','WW 5'],
  ['p1','PT 1'],['p2','PT 2'],['p3','PT 3'],['st1','ST1'],['st2','ST2'],['te','Term exam']
].map(Object.freeze));
export const TERM_KEYS=Object.freeze(['t1','t2','t3']);
export const PUBLIC_DEMO=Object.freeze({id:'do015-2026-ks2-science-1',schoolYear:'2026-2027',sector:'public',
  curriculum:'Revised K to 10',grade:6,subject:'Science',template:'science6-practice-v1',mode:'synthetic'});
export const PRIVATE_POLICY=Object.freeze({id:'private-g6-science-v1',grade:6,subject:'Science',template:'private-supplementary-v1',sector:'private'});
export const CORE_SUBJECTS=Object.freeze(['Science','Mathematics','English','Filipino','Araling Panlipunan']);
export const CORE_GRADES=Object.freeze([4,5,6,7,8,9,10]);
export const WORKFLOW_PRACTICE=Object.freeze({...PUBLIC_DEMO,id:'do015-2026-core-workflow',template:'core-workflow-practice-v1'});
export const exampleLearner=name=>/^Example learner (?:[1-9]|[1-5][0-9]|60)$/.test(name);
export const POLICY_GATES=Object.freeze([
  ['Kindergarten and Grade 1','Descriptive progress reports and approved templates'],
  ['Grades 2–3 transition','Year-specific reporting, Makabansa and template approval'],
  ['Grades 4–10','Subject-specific workbook and policy approval'],
  ['Strengthened SHS','Cohort, subject weights, term units and workbook approval'],
  ['Non-Strengthened Grade 12','Legacy weights, 2026 conversion and the correct workbook'],
  ['2027–2028 and later','Zero-based scope, reporting floor and approved templates']
].map(Object.freeze));
export const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
export const present=(v)=>v!==''&&v!=null;
export const scoreValue=(v)=>present(v)&&/^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(String(v))?Number(v):null;
export const descriptor=(n)=>n>=90?'Advancing':n>=80?'Benchmarking':n>=75?'Connecting':n>=65?'Developing':'Emerging';
export const cleanInitial=(ig)=>Math.round(ig*1e12)/1e12;
export function transmute(ig){
  if(!finite(ig)||ig<0||ig>100+1e-10)return null;
  const cleaned=cleanInitial(ig);
  let i=CUTOFFS.length-1;
  while(i>0&&cleaned<CUTOFFS[i])i--;
  return 60+i;
}
export function evaluate(hps={},scores={}) {
  const cells=Object.fromEntries(SLOTS.map(([k])=>[k,{h:scoreValue(hps[k]),s:scoreValue(scores[k])}]));
  const required=['st1','st2','te'];
  for(const [k] of SLOTS) {
    const {h,s}=cells[k], hasH=present(hps[k]), hasS=present(scores[k]);
    if(hasH&&(h===null||h<.001||h>10000))return {issue:'Set a valid positive maximum score.'};
    if(hasS&&(s===null||h===null||s>h))return {issue:'Use a numeric score between zero and the maximum.'};
    if(required.includes(k)&&!hasH)return {issue:'Set maximum scores for ST1, ST2 and the term exam.'};
    if(hasH&&!hasS)return {issue:'Enter every configured score; a blank stays pending.'};
  }
  function ratio(prefix) {
    const a=Object.entries(cells).filter(([k,{h}])=>k.startsWith(prefix)&&h!==null).map(([,v])=>v);
    return a.length?a.reduce((s,v)=>s+v.s,0)/a.reduce((s,v)=>s+v.h,0):null;
  }
  const w=ratio('w'),p=ratio('p');
  if(w===null||p===null)return {issue:'Configure at least one written work and one performance task.'};
  const ex=.3*cells.st1.s/cells.st1.h+.3*cells.st2.s/cells.st2.h+.4*cells.te.s/cells.te.h;
  const ig=w*20+p*50+ex*30,tg=transmute(ig);
  return {ig,tg,descriptor:descriptor(tg),written:w*100,performance:p*100,exams:ex*100};
}
export function finalGrade(grades) {
  return grades.length===3&&grades.every(g=>Number.isInteger(g)&&g>=60&&g<=100)
    ? Math.round(grades.reduce((a,b)=>a+b,0)/3):null;
}
export const DEMO_HPS=Object.freeze({w1:20,w2:25,w3:20,w4:20,p1:25,p2:25,st1:20,st2:20,te:40});
export const DEMO_IDS=Object.freeze(['r01','r02','r03','r04']);
const worked={w1:17,w2:22,w3:20,w4:15,p1:20,p2:23,st1:15,st2:18,te:35};
const rate=n=>Object.fromEntries(Object.entries(DEMO_HPS).map(([k,v])=>[k,v*n]));
export function newDemo(){
  const roster=Object.fromEntries(DEMO_IDS.map((id,i)=>[id,'Example learner '+(i+1)]));
  const periods=Object.fromEntries(TERM_KEYS.map((t,i)=>[t,{locked:false,hps:{...DEMO_HPS},scores:{
    r01:i===0?{...worked}:rate(i===1?.8:.9),r02:rate(.7),r03:rate(0),r04:{w1:12}
  }}]));
  return {...PUBLIC_DEMO,title:'Grade 6 Science',schoolName:'Example school',roster,periods,synthetic:true};
}
export function assertScope(record){
  if(record.synthetic===true&&record.id===WORKFLOW_PRACTICE.id&&record.template===WORKFLOW_PRACTICE.template&&
    record.schoolYear===WORKFLOW_PRACTICE.schoolYear&&record.curriculum===WORKFLOW_PRACTICE.curriculum&&
    CORE_GRADES.includes(record.grade)&&CORE_SUBJECTS.includes(record.subject)&&record.schoolName==='Example school'&&
    Object.entries(record.roster??{}).every(([id,name])=>exampleLearner(name)&&id==='r'+name.slice(16).padStart(2,'0')))return 'practice';
  if(record.synthetic===true&&record.template===PUBLIC_DEMO.template&&record.id===PUBLIC_DEMO.id&&
    record.schoolYear===PUBLIC_DEMO.schoolYear&&record.curriculum===PUBLIC_DEMO.curriculum&&
    record.grade===PUBLIC_DEMO.grade&&record.subject===PUBLIC_DEMO.subject&&record.schoolName==='Example school'&&
    JSON.stringify(record.roster)===JSON.stringify(newDemo().roster))return 'practice';
  if(record.sector==='private'&&record.template===PRIVATE_POLICY.template&&record.policy===PRIVATE_POLICY.id&&
    record.grade===PRIVATE_POLICY.grade&&record.subject===PRIVATE_POLICY.subject&&typeof record.ownerUid==='string')return 'private';
  throw new Error('This class has no supported grading and export policy.');
}
