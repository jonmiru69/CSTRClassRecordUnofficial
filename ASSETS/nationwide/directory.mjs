export const KEY=/^(?:d\d{6}|p[0-9a-f]{24})$/;
export const fold=s=>String(s??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const short=(s,min,max)=>{const t=String(s??'').trim().replace(/\s+/gu,' ');if(t.length<min||t.length>max||/[\p{C}]/u.test(t))throw new Error('Check the length and spelling of the school details.');return t;};
export function normalizeSchool(v) {
  const schoolId=String(v.schoolId??'').trim(), key=String(v.key??'');
  if(!KEY.test(key)||!['public','private'].includes(v.sector)||! /^(?:\d{6})?$/.test(schoolId)||key.startsWith('d')&&key.slice(1)!==schoolId)throw new Error('Choose a valid school and sector.');
  return {key,name:short(v.name,2,160),sector:v.sector,locality:short(v.locality,2,120),schoolId,directoryVersion:short(v.directoryVersion,1,64)};
}
export async function provisional(fields){
  const name=short(fields.name,2,160),locality=short(fields.locality,2,120),schoolId=String(fields.schoolId??'').trim();
  if(!fold(name)||!fold(locality))throw new Error('Enter the school name and municipality.');
  const identity=JSON.stringify([fold(name),fold(locality),fields.sector,schoolId]);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
  const key='p'+Array.from(new Uint8Array(bytes).slice(0,12),n=>n.toString(16).padStart(2,'0')).join('');
  return normalizeSchool({key,name,locality,schoolId,sector:fields.sector,directoryVersion:'private-provisional-v1'});
}
const acr=s=>fold(s).split(' ').map(w=>w[0]).join('');
const schoolWords={es:'elementary school',nhs:'national high school',shs:'senior high school',jhs:'junior high school'};
const expand=s=>fold(s).replace(/\b(?:es|nhs|shs|jhs)\b/g,word=>schoolWords[word]);
const index=new WeakMap();
function terms(row){
  let indexed=index.get(row);
  if(!indexed){
    const name=expand(row.name);
    const words=expand([row.name,row.locality,row.province,row.regionLabel,row.schoolId,...(row.aliases??[])].join(' ')).split(' ');
    indexed={name,compact:name.replaceAll(' ',''),acronym:acr(name),words};
    index.set(row,indexed);
  }
  return indexed;
}
function oneEdit(a,b){
  if(Math.abs(a.length-b.length)>1)return false;
  let first=0;
  while(first<a.length&&a[first]===b[first])first++;
  if(first===a.length)return true;
  if(a.length===b.length)return a.slice(first+1)===b.slice(first+1);
  return a.length>b.length?a.slice(first+1)===b.slice(first):a.slice(first)===b.slice(first+1);
}
export function searchSchools(rows,query,{region='',limit=12}={}){
  const q=expand(query),tokens=q.split(' ').filter(Boolean),compact=q.replaceAll(' ','');
  if(!q&&!region)return [];
  const scope=region?rows.filter(row=>row.region===region):rows;
  if(!q)return scope.slice(0,limit);
  if(/^\d{6}$/.test(q))return scope.filter(row=>row.schoolId===q).slice(0,limit);
  const matches=scope.flatMap(row=>{
    const {name,compact:compactName,acronym,words}=terms(row);
    const score=q===name||compact===compactName?100:q===acronym?85:name.startsWith(q)?80:
      compact.length>=4&&compactName.startsWith(compact)?65:
      tokens.every(token=>words.some(word=>word.startsWith(token)))?50:0;
    return score?[{row,score}]:[];
  }).sort((a,b)=>b.score-a.score||a.row.name.localeCompare(b.row.name)||a.row.schoolId.localeCompare(b.row.schoolId));
  if(matches.length)return matches.slice(0,limit).map(match=>match.row);
  return scope.filter(row=>tokens.every(token=>terms(row).words.some(word=>word.startsWith(token)||token.length>=4&&oneEdit(token,word)))).slice(0,limit);
}
const https=value=>{try{return new URL(value).protocol==='https:';}catch{return false;}};
function catalogSeal(manifest,schoolId){
  const entry=manifest.seals?.[schoolId];
  return entry?.file===schoolId+'.png'&&https(entry.sourceUrl)&&https(entry.permissionUrl)
    ?{logo:'/schools/logos/'+entry.file,sealSource:entry.sourceUrl}:{logo:'',sealSource:''};
}
export function makeDirectory(fetcher=fetch){
  let manifestPromise,allRows;
  const files=new Map();
  async function get(url){
    try{
      const response=await fetcher(url,{signal:AbortSignal.timeout(15000)});
      if(response.ok)return await response.json();
    }catch{/* A retry can load the catalog again. */}
    throw new Error('Could not load the school directory. Try again or add your school manually.');
  }
  const manifest=()=>manifestPromise??=get('/schools/manifest.json?v=2').catch(error=>{manifestPromise=null;throw error;});
  function shard(m,entry){
    if(!/^[a-z0-9-]+\.json$/.test(entry.file))throw new Error('Invalid school directory.');
    if(!files.has(entry.id)){
      const read=get('/schools/'+entry.file).then(data=>{
        const rows=Array.isArray(data)?data:data.schools.map(([schoolId,name,kind,place,aliases])=>{
          const [locality,province]=data.places[place];
          return {schoolId,key:'d'+schoolId,name,sector:kind==='r'?'private':'public',classification:kind==='u'?'SUC/LUC':'',
            locality,province,directoryVersion:m.version,aliases};
        });
        return rows.map(row=>({...normalizeSchool(row),province:row.province??'',region:entry.id,regionLabel:entry.label,
          classification:row.classification??'',aliases:row.aliases??[],...catalogSeal(m,row.schoolId)}));
      }).catch(error=>{files.delete(entry.id);throw error;});
      files.set(entry.id,read);
    }
    return files.get(entry.id);
  }
  async function rows(region='',query=''){
    const m=await manifest();
    if(region){
      const entry=m.regions.find(row=>row.id===region);
      return entry?shard(m,entry):[];
    }
    if(/^\d{6}$/.test(query)&&m.idPrefixes){
      const ids=m.idPrefixes[query.slice(0,3)]??[];
      return (await Promise.all(m.regions.filter(entry=>ids.includes(entry.id)).map(entry=>shard(m,entry)))).flat();
    }
    return allRows??=Promise.all(m.regions.map(entry=>shard(m,entry))).then(data=>data.flat()).catch(error=>{allRows=null;throw error;});
  }
  return {manifest,rows,async school(id){
    if(!/^\d{6}$/.test(id))return undefined;
    return (await rows('',id)).find(row=>row.schoolId===id);
  }};
}
