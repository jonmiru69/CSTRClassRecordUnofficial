import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const target=fileURLToPath(new URL('../firebase-database-rules.json',import.meta.url));
const source=JSON.parse(await readFile(target,'utf8'));
const rules=source.rules;
const oldApproval="root.child('cstr-registration-approved').child(auth.uid)";
const legacyActive=`(${oldApproval}.val() === true || (${oldApproval}.child('approvedAt').isNumber() && ${oldApproval}.child('approvedAt').val() > 0 && ${oldApproval}.child('approvedBy').isString() && ${oldApproval}.child('approvedBy').val().length > 0 && ${oldApproval}.child('active').val() !== false && ${oldApproval}.child('revoked').val() !== true))`;
for(const branch of ['cstr-class-record-bindings','cstr-class-record-users','cstr-class-record-data']){
  for(const node of Object.values(rules[branch])) for(const op of ['.read','.write']){
    if(typeof node[op]==='string') node[op]=node[op].replace(`${oldApproval}.exists()`,legacyActive);
  }
}
const child=(key)=>`newData.child('${key}')`;
const strict=(fields,required=Object.keys(fields))=>({
  '.validate':required.length?`newData.hasChildren(${JSON.stringify(required)})`:"newData.hasChildren()",
  ...fields,'$other':{'.validate':false}
});
const text=(max,min=0)=>({'.validate':`newData.isString() && newData.val().length >= ${min} && newData.val().length <= ${max}`});
const shape=(re)=>({'.validate':`newData.isString() && newData.val().matches(/${re}/)`});
const number=(min,max)=>({'.validate':`newData.isNumber() && newData.val() >= ${min} && newData.val() <= ${max}`});
const bool={'.validate':'newData.isBoolean()'};
const exact=(x)=>({'.validate':`newData.val() === ${JSON.stringify(x)}`});
const map=(name,re,rule)=>({[name]:{...rule,'.validate':`$${name.slice(1)}.matches(/${re}/) && (${rule['.validate']??'true'})`}});

const legacy=rules['cstr-class-record-data'].$key;
legacy['.validate']=legacy['.validate'].split(" && newData.child('teacher').hasChildren()")[0]+" && newData.child('teacher').hasChildren()";
legacy.teacher=strict({name:text(240),age:{'.validate':"(newData.isString() && newData.val().length <= 40) || (newData.isNumber() && newData.val() >= 0 && newData.val() <= 150)"},level:text(120),specialization:text(300),bio:text(4000)},[]);
const scalar=(max)=>({'.validate':`(newData.isString() && newData.val().length <= ${max}) || newData.isNumber() || newData.isBoolean()`});
const legacyList=(variable,width,schema)=>({'.validate':'newData.hasChildren()',...map(variable,`^(0|[1-9][0-9]{0,${width-1}})$`,schema)});
const activities=legacyList('$activityIndex',3,strict({title:text(1000),competency:text(4000),topic:text(1000),role:text(60)},[]));
const pointsEntry=strict({points:number(0,1000000),reason:text(500),at:text(48),actor:text(200)},[]);
const entries=legacyList('$entryIndex',3,pointsEntry);
const history=legacyList('$historyIndex',3,strict({raw:scalar(64),applied:scalar(64),entries,endedAt:text(48),reason:text(500)},[]));
const adjustments=legacyList('$assessmentIndex',3,strict({raw:scalar(64),entries,history},[]));
const origins=legacyList('$originIndex',3,strict({score:scalar(64),hps:scalar(64),applied:scalar(64)},[]));
const components=(shape)=>strict({ww:shape,pt:shape,qa:shape},[]);
const learner=strict({
  name:text(400),ww:legacyList('$markIndex',3,scalar(120)),pt:legacyList('$markIndex',3,scalar(120)),qa:legacyList('$markIndex',3,scalar(120)),
  hpsOriginals:components(origins),scoreAdjustments:components(adjustments)
},[]);
const legacyPeriod=strict({
  name:text(240),locked:bool,quarter:number(0,100),semester:number(0,100),term:number(0,100),
  wwDates:legacyList('$dateIndex',3,scalar(80)),ptDates:legacyList('$dateIndex',3,scalar(80)),qaDates:legacyList('$dateIndex',3,scalar(80)),
  wwHps:legacyList('$hpsIndex',3,scalar(120)),ptHps:legacyList('$hpsIndex',3,scalar(120)),qaHps:legacyList('$hpsIndex',3,scalar(120)),
  activityMeta:components(activities),roster:legacyList('$learnerIndex',4,learner)
},[]);
const legacySection=strict({periods:legacyList('$periodIndex',2,legacyPeriod)},['periods']);
const legacyRegistry=strict({
  id:text(180,1),group:text(24),level:text(120),section:text(240),subject:text(240),theme:text(120),accent:text(120),archived:bool,
  gradingCategory:text(240),gradingMode:text(60),rosterSize:number(0,10000),
  weights:{'.validate':'newData.hasChildren()',...map('$weight','^[0-2]$',number(0,100))},
  excelSettings:strict({schoolYear:text(24),teacherName:text(240),checkerName:text(240),reviewerName:text(240),principalName:text(240)},[])
},['id']);
// Historical scalar class metadata is retained. Unknown structures and oversized values are rejected.
legacyRegistry.$other=scalar(512);
for(const key of ['registry','registryTri']) legacy[key]=legacyList('$classIndex',3,legacyRegistry);
for(const key of ['sections','sectionsTri']) legacy[key]={'.validate':'newData.hasChildren()',...map('$sectionId','^.{1,180}$',legacySection)};
legacy.calendarMode=shape('^(legacy|trimester)$');
legacy.trimesterModeSeen=bool;
legacy.photo={'.validate':"newData.isString() && newData.val().length <= 2000000 && (newData.val() === '' || newData.val().matches(/^data:image\\/(png|jpeg);base64,[A-Za-z0-9+\\/=]+$/))"};
for(const key of ['version','_syncRevision','_syncProtocol','_syncSavedAt','_syncClientId'])legacy[key]={'.validate':true};
legacy.$other={'.validate':false};

const base="root.child('nationwide-v1')";
const own="auth != null && auth.uid === $uid && auth.token.email_verified === true";
const held=`!${base}.child('holds').child($uid).exists() && !root.child('cstr-registration-approved').child($uid).exists() && !root.child('cstr-class-record-users').child($uid).exists()`;
const account=`${own} && ${held}`;
const registration=`${base}.child('control').child('registration').val() === true`;
const privateOpen=`${base}.child('control').child('privateRecords').val() === true`;
const grant=`${base}.child('privateGrants').child($uid).child($schoolKey)`;
const schoolKey=shape('^(d[0-9]{6}|p[0-9a-f]{24})$');
const schoolYear=shape('^20[0-9]{2}-20[0-9]{2}$');
const school=strict({key:schoolKey,name:text(160,2),sector:shape('^(public|private)$'),locality:text(120,2),schoolId:shape('^([0-9]{6})?$'),directoryVersion:text(64,1)});
const createdAt={'.validate':"newData.isNumber() && newData.val() <= now && (!data.exists() || newData.val() === data.val())"};
const revision={'.validate':"newData.isNumber() && ((!data.exists() && newData.val() === 1) || (data.isNumber() && newData.val() === data.val() + 1))"};
const updatedAt={'.validate':"newData.isNumber() && newData.val() <= now && newData.val() >= now - 60000"};
const profile=strict({displayName:text(120,2),school,revision,createdAt,updatedAt});
profile['.read']=account;
profile['.write']=`${account} && newData.exists() && (data.exists() || ${registration})`;
const roster={...map('$row','^r(0[1-9]|[1-5][0-9]|60)$',text(120,1))};
const scoreKeys='^(w[1-5]|p[1-3]|st1|st2|te)$';
const permittedScore={
  '.validate':`${number(0,10000)['.validate']} && newData.parent().parent().parent().child('hps').child($col).isNumber() && newData.val() <= newData.parent().parent().parent().child('hps').child($col).val() && newData.parent().parent().parent().parent().parent().child('roster').child($row).isString()`
};
const period=strict({hps:map('$col',scoreKeys,number(.001,10000)),scores:map('$row','^r(0[1-9]|[1-5][0-9]|60)$',map('$col',scoreKeys,permittedScore)),locked:bool},['locked']);
const records=strict({
  ownerUid:{'.validate':'newData.isString() && newData.val() === $uid && (!data.exists() || newData.val() === data.val())'},
  classId:{'.validate':"newData.val() === $classId && $classId.matches(/^c(0[1-9]|1[0-2])$/)"},
  schoolKey:{'.validate':'newData.val() === $schoolKey'},
  schoolName:{'.validate':`newData.isString() && newData.val() === ${grant}.child('schoolName').val() && (!data.exists() || newData.val() === data.val())`},
  schoolYear:{'.validate':`${schoolYear['.validate']} && newData.val() === ${grant}.child('schoolYear').val() && (!data.exists() || newData.val() === data.val())`},
  curriculum:{'.validate':`newData.isString() && newData.val() === ${grant}.child('curriculum').val() && (!data.exists() || newData.val() === data.val())`},
  grade:{'.validate':`newData.isNumber() && newData.val() === ${grant}.child('grade').val() && (!data.exists() || newData.val() === data.val())`},
  subject:{'.validate':`newData.isString() && newData.val() === ${grant}.child('subject').val() && (!data.exists() || newData.val() === data.val())`},
  policy:{'.validate':`newData.isString() && newData.val() === ${grant}.child('policy').val() && (!data.exists() || newData.val() === data.val())`},
  template:exact('private-supplementary-v1'),
  sector:exact('private'),title:text(120,1),archived:bool,roster,
  periods:map('$term','^t[1-3]$',period),revision,createdAt,updatedAt
},['ownerUid','classId','schoolKey','schoolName','schoolYear','curriculum','grade','subject','policy','template','sector','title','archived','revision','createdAt','updatedAt']);
const privateAccess=`${account} && $schoolKey.matches(/^(d[0-9]{6}|p[0-9a-f]{24})$/) && ${privateOpen} && ${grant}.child('active').val() === true && ${grant}.child('sector').val() === 'private' && ${grant}.child('expiresAt').isNumber() && ${grant}.child('expiresAt').val() > now && ${grant}.child('policy').val() === 'private-g6-science-v1' && ${grant}.child('grade').val() === 6 && ${grant}.child('subject').val() === 'Science' && ${base}.child('profiles').child($uid).exists()`;
records['.write']=`${privateAccess} && newData.exists()`;
rules['nationwide-v1']={
  control:{registration:{'.read':true,'.write':false},privateRecords:{'.read':true,'.write':false}},
  holds:{$uid:{'.read':'auth != null && auth.uid === $uid','.write':false}},
  profiles:{$uid:profile},
  privateGrants:{$uid:{'.read':account,'.write':false}},
  privateRecords:{$uid:{$schoolKey:{'.read':privateAccess,$classId:records}}}
};
await writeFile(target,JSON.stringify(source,null,2)+'\n');
