import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {normalizeSchool,short,fold} from '../ASSETS/nationwide/directory.mjs';

const [input,out]=process.argv.slice(2);
if(!input||!out)throw new Error('Usage: node tools/import-school-directory.mjs approved-source.json new-output-directory');
const dest=resolve(out);
const source=JSON.parse(await readFile(input,'utf8'));
const https=value=>{try{return new URL(value).protocol==='https:';}catch{return false;}};
if(!/^\d{4}-\d{2}-\d{2}$/.test(source.snapshot)||!/^\d{4}-\d{2}-\d{2}$/.test(source.rightsConfirmedOn)||
  !https(source.sourceUrl)||!https(source.rightsEvidenceUrl)||!Array.isArray(source.schools))throw new Error('Record an official source, date and reviewed redistribution evidence first.');
const version=short(source.version,1,64),regions=new Map(),seen=new Set();
for(const row of source.schools){
  if(typeof row.schoolId!=='string'||!/^\d{6}$/.test(row.schoolId)||seen.has(row.schoolId))throw new Error('Invalid or repeated School ID.');
  if(typeof row.region!=='string'||!/^[-a-z0-9]{1,16}$/.test(row.region))throw new Error('Invalid region code.');
  const school=normalizeSchool({...row,key:'d'+row.schoolId,directoryVersion:version});
  const label=short(row.regionLabel,2,100),aliases=(row.aliases??[]).map(a=>short(a,1,120));
  if(!fold(school.name)||!fold(school.locality)||aliases.length>12)throw new Error('Invalid school entry.');
  if(!regions.has(row.region))regions.set(row.region,{label,rows:[]});
  const bucket=regions.get(row.region);
  if(bucket.label!==label)throw new Error('Inconsistent region label.');
  bucket.rows.push({...school,aliases});seen.add(row.schoolId);
}
if(!seen.size)throw new Error('No approved rows supplied.');
await mkdir(dest,{recursive:false});
const manifest={version,snapshot:source.snapshot,sourceUrl:source.sourceUrl,rightsEvidenceUrl:source.rightsEvidenceUrl,
  rightsConfirmedOn:source.rightsConfirmedOn,coverage:[],regions:[]};
for(const [id,{label,rows}] of [...regions].sort(([a],[b])=>a.localeCompare(b))){
  const file=id+'.json';
  rows.sort((a,b)=>a.name.localeCompare(b.name)||a.schoolId.localeCompare(b.schoolId));
  await writeFile(resolve(dest,file),JSON.stringify(rows)+'\n',{flag:'wx'});
  manifest.regions.push({id,label,file});
  manifest.coverage.push({region:id,public:rows.filter(r=>r.sector==='public').length,private:rows.filter(r=>r.sector==='private').length});
}
await writeFile(resolve(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(`Prepared ${seen.size} school rows in ${regions.size} regions for review.`);
