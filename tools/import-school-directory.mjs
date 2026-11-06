import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {normalizeSchool,short,fold} from '../ASSETS/nationwide/directory.mjs';

const [input,out]=process.argv.slice(2);
if(!input||!out)throw new Error('Usage: node tools/import-school-directory.mjs approved-source.json new-output-directory');
const dest=resolve(out);
const source=JSON.parse(await readFile(input,'utf8'));
const https=value=>{try{return new URL(value).protocol==='https:';}catch{return false;}};
if(!/^\d{4}-\d{2}-\d{2}$/.test(source.snapshot)||!/^\d{4}-\d{2}-\d{2}$/.test(source.rightsConfirmedOn)||
  !https(source.sourceUrl)||!https(source.rightsEvidenceUrl)||!Array.isArray(source.schools))throw new Error('Record an official source, date and reviewed redistribution evidence first.');
const version=short(source.version,1,64),regions=new Map(),seen=new Set(),idPrefixes=new Map();
for(const row of source.schools){
  if(typeof row.schoolId!=='string'||!/^\d{6}$/.test(row.schoolId)||seen.has(row.schoolId))throw new Error('Invalid or repeated School ID.');
  if(typeof row.region!=='string'||!/^[-a-z0-9]{1,16}$/.test(row.region))throw new Error('Invalid region code.');
  const school=normalizeSchool({...row,key:'d'+row.schoolId,directoryVersion:version});
  const label=short(row.regionLabel,2,100),aliases=(row.aliases??[]).map(a=>short(a,1,120));
  if(!fold(school.name)||!fold(school.locality)||aliases.length>12)throw new Error('Invalid school entry.');
  const province=short(row.province,0,120);
  const classification=row.classification==='SUC/LUC'?'u':school.sector==='public'?'p':'r';
  if(classification==='u'&&school.sector!=='public')throw new Error('SUC/LUC entries must be public.');
  if(!regions.has(row.region))regions.set(row.region,{label,rows:[]});
  const bucket=regions.get(row.region);
  if(bucket.label!==label)throw new Error('Inconsistent region label.');
  bucket.rows.push({...school,province,aliases,classification});seen.add(row.schoolId);
  const prefix=row.schoolId.slice(0,3);
  if(!idPrefixes.has(prefix))idPrefixes.set(prefix,new Set());
  idPrefixes.get(prefix).add(row.region);
}
if(!seen.size)throw new Error('No approved rows supplied.');
await mkdir(dest,{recursive:false});
const manifest={version,format:2,schoolYear:source.schoolYear,snapshot:source.snapshot,sourceUrl:source.sourceUrl,
  downloadUrl:source.downloadUrl,sourceSha256:source.sourceSha256,rightsEvidenceUrl:source.rightsEvidenceUrl,
  rightsConfirmedOn:source.rightsConfirmedOn,coverage:[],regions:[],
  idPrefixes:Object.fromEntries([...idPrefixes].sort().map(([prefix,ids])=>[prefix,[...ids].sort()])),seals:{}};
for(const [id,{label,rows}] of [...regions].sort(([a],[b])=>a.localeCompare(b,'en',{numeric:true}))){
  const file=id+'.json';
  rows.sort((a,b)=>a.name.localeCompare(b.name)||a.schoolId.localeCompare(b.schoolId));
  const places=[],placeIndexes=new Map();
  const schools=rows.map(row=>{
    const place=[row.locality,row.province],key=JSON.stringify(place);
    if(!placeIndexes.has(key)){placeIndexes.set(key,places.length);places.push(place);}
    const record=[row.schoolId,row.name,row.classification,placeIndexes.get(key)];
    if(row.aliases.length)record.push(row.aliases);
    return record;
  });
  await writeFile(resolve(dest,file),JSON.stringify({places,schools})+'\n',{flag:'wx'});
  manifest.regions.push({id,label,file});
  manifest.coverage.push({region:id,public:rows.filter(r=>r.sector==='public').length,private:rows.filter(r=>r.sector==='private').length});
}
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
for(const [schoolId,seal] of Object.entries(source.seals??{})){
  if(!seen.has(schoolId)||!https(seal.sourceUrl)||!https(seal.permissionUrl))throw new Error('Record the seal source and permission for a listed School ID.');
  const bytes=await readFile(resolve(dirname(resolve(input)),seal.file));
  if(bytes.length<33||bytes.length>300000||!bytes.subarray(0,8).equals(pngSignature)||bytes.toString('ascii',12,16)!=='IHDR'
      ||[bytes.readUInt32BE(16),bytes.readUInt32BE(20)].some(size=>size<1||size>1024))throw new Error('A shared seal must be a PNG up to 1024 pixels and 300 KB.');
  const file=schoolId+'.png';
  await mkdir(resolve(dest,'logos'),{recursive:true});
  await writeFile(resolve(dest,'logos',file),bytes,{flag:'wx'});
  manifest.seals[schoolId]={file,sourceUrl:seal.sourceUrl,permissionUrl:seal.permissionUrl};
}
await writeFile(resolve(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(`Prepared ${seen.size} school rows in ${regions.size} regions for review.`);
