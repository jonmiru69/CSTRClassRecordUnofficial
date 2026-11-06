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
function distance(a,b){
  let last=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next.push(Math.min(next[j-1]+1,last[j]+1,last[j-1]+(a[i-1]===b[j-1]?0:1)));last=next;}
  return last[b.length];
}
export function searchSchools(rows,query,{region='',limit=12}={}){
  const q=fold(query),tokens=q.split(' ').filter(Boolean);
  if(!q&&!region)return [];
  return rows.filter(row=>!region||row.region===region).flatMap(row=>{
    const words=fold([row.name,row.locality,row.schoolId,...(row.aliases??[])].join(' ')).split(' ');
    const score=q===row.schoolId&&q?100:q===acr(row.name)&&q?80:tokens.every(t=>words.some(w=>w.startsWith(t)))?50:
      tokens.length&&tokens.every(t=>words.some(w=>w.startsWith(t)||t.length>=4&&Math.abs(w.length-t.length)<=1&&distance(t,w)<=1))?20:0;
    return score?[{row,score}]:[];
  }).sort((a,b)=>b.score-a.score||a.row.name.localeCompare(b.row.name)).slice(0,limit).map(x=>x.row);
}
export function makeDirectory(fetcher=fetch){
  let manifest,files=new Map();
  const get=async url=>{const res=await fetcher(url);if(!res.ok)throw new Error('The school directory could not load. You can add the school privately.');return res.json();};
  return {async manifest(){return manifest??=await get('/schools/manifest.json');},async rows(region){
    const m=await this.manifest(),entry=m.regions.find(r=>r.id===region);
    if(!entry)return [];
    if(!/^[a-z0-9-]+\.json$/.test(entry.file))throw new Error('Invalid school directory.');
    if(!files.has(region)){
      const rows=await get('/schools/'+entry.file);
      files.set(region,rows.map(r=>({...normalizeSchool(r),region:entry.id,aliases:r.aliases??[],logo:/^\/schools\/logos\/[a-z0-9-]+\.(png|jpeg|jpg)$/.test(r.logo??'')?r.logo:''})));
    }
    return files.get(region);
  }};
}
