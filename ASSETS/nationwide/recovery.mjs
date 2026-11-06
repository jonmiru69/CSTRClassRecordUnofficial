import {SLOTS,TERM_KEYS,scoreValue} from './policy.mjs';
const idKeys=['ownerUid','classId','schoolKey','schoolName','schoolYear','curriculum','grade','subject','policy','template','sector'];
const rosterKey=/^r(0[1-9]|[1-5][0-9]|60)$/;
const MAX_FILE=700000;
const type='class-record-private-class-v1';
const bytes=new TextEncoder(),decode=new TextDecoder('utf-8',{fatal:true});
const base64=b=>btoa(Array.from(new Uint8Array(b),n=>String.fromCharCode(n)).join(''));
function un64(value,max){
  if(typeof value!=='string'||value.length>max||value.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('Invalid backup encoding.');
  return Uint8Array.from(atob(value),c=>c.charCodeAt(0));
}
async function derive(password,salt){
  const material=await crypto.subtle.importKey('raw',bytes.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o);
const keys=(value,allowed)=>plain(value)&&Object.keys(value).every(k=>allowed.includes(k));
export function classContent(source,target){
  if(!plain(source)||!idKeys.every(k=>source[k]===target[k])||typeof source.title!=='string'||source.title.length<1||source.title.length>120||
      !keys(source.periods??{},TERM_KEYS))throw new Error('This backup is for a different class, school context, or account.');
  const allowed=SLOTS.map(([k])=>k);
  const roster=source.roster??{};
  if(!plain(roster)||Object.entries(roster).some(([key,name])=>!rosterKey.test(key)||typeof name!=='string'||name.length<1||name.length>120))throw new Error('The backup roster is invalid.');
  for(const period of Object.values(source.periods??{})){
    if(!keys(period,['locked','hps','scores'])||typeof period.locked!=='boolean'||!keys(period.hps??{},allowed)||!plain(period.scores??{}))throw new Error('A backup term is invalid.');
    for(const value of Object.values(period.hps??{}))if(typeof value!=='number'||scoreValue(value)===null||value<.001||value>10000)throw new Error('A maximum score is invalid.');
    for(const [row,values] of Object.entries(period.scores??{})){
      if(!Object.hasOwn(roster,row)||!keys(values,allowed))throw new Error('The backup contains an unknown learner or assessment.');
      for(const [slot,value] of Object.entries(values))if(typeof value!=='number'||scoreValue(value)===null||typeof period.hps?.[slot]!=='number'||value>period.hps[slot])throw new Error('The backup contains an invalid score.');
    }
  }
  return {title:source.title,roster:structuredClone(roster),periods:structuredClone(source.periods??{})};
}
export async function saveRecovery(record,password){
  if(typeof password!=='string'||password.length<12)throw new Error('Choose a backup passphrase with at least 12 characters.');
  const copy={...Object.fromEntries(idKeys.map(k=>[k,record[k]])),...classContent(record,record)};
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes.encode(type)},await derive(password,salt),bytes.encode(JSON.stringify(copy)));
  const envelope=JSON.stringify({format:type,salt:base64(salt),iv:base64(iv),ciphertext:base64(ciphertext)});
  if(envelope.length>MAX_FILE)throw new Error('This class exceeds the backup size limit.');
  return new Blob([envelope],{type:'application/json'});
}
export async function readRecovery(file,password,record){
  if(!file||!Number.isSafeInteger(file.size)||file.size<30||file.size>MAX_FILE)throw new Error('Choose a valid class backup under 700 KB.');
  let data;
  try{
    const envelope=JSON.parse(await file.text());
    if(!keys(envelope,['format','salt','iv','ciphertext'])||envelope.format!==type)throw new Error('Invalid format');
    const salt=un64(envelope.salt,24),iv=un64(envelope.iv,16),cipher=un64(envelope.ciphertext,MAX_FILE);
    if(salt.length!==16||iv.length!==12||cipher.length<16)throw new Error('Invalid salt or IV');
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:bytes.encode(type)},await derive(password,salt),cipher);
    data=JSON.parse(decode.decode(clear));
  }catch{throw new Error('The backup could not be decrypted. Check the file and passphrase.');}
  return classContent(data,record);
}
