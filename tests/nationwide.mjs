import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {evaluate,transmute,newDemo,finalGrade,CUTOFFS,assertScope} from '../ASSETS/nationwide/policy.mjs';
import {makeDirectory,provisional,searchSchools,normalizeSchool} from '../ASSETS/nationwide/directory.mjs';
import {xlsxBook} from '../ASSETS/nationwide/exports.mjs';
import {saveRecovery,readRecovery} from '../ASSETS/nationwide/recovery.mjs';
const context={console,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,atob,btoa};
context.window=context;
runInNewContext(readFileSync(new URL('../ASSETS/vendor/xlsx.min.js',import.meta.url),'utf8'),context);
const {XLSX}=context;
const demo=newDemo(),t=demo.periods.t1;
assert.equal(evaluate(t.hps,t.scores.r01).tg,88);
assert.equal(evaluate(t.hps,t.scores.r02).tg,75);
assert.equal(evaluate(t.hps,t.scores.r03).tg,60);
assert.equal(evaluate(t.hps,t.scores.r04).tg,undefined);
assert.equal(evaluate(t.hps,{...t.scores.r01,te:'E'}).tg,undefined);
assert.equal(evaluate(t.hps,{...t.scores.r01,te:41}).tg,undefined);
assert.equal(evaluate({...t.hps,st2:null},t.scores.r01).tg,undefined);
assert.equal(finalGrade([80,81,81]),81);
assert.equal(finalGrade([80,81,undefined]),null);
CUTOFFS.forEach((cut,i)=>{
  assert.equal(transmute(cut),60+i);
  if(i)assert.equal(transmute(Number((cut-.01).toFixed(2))),59+i);
});
assert.equal(transmute(69.995),74);
assert.throws(()=>assertScope({...demo,roster:{r01:'Arbitrary name'}}));
assert.throws(()=>assertScope({...demo,synthetic:false}));
const file=XLSX.write(xlsxBook(XLSX,demo),{type:'array',bookType:'xlsx'});
const rebuilt=XLSX.read(file,{type:'array'});
assert.deepEqual(Array.from(rebuilt.SheetNames),['Read me','Term 1','Term 2','Term 3','Final grades','Cutoffs']);
assert.equal(rebuilt.Sheets['Term 1'].N9.v,75);
assert.match(rebuilt.Sheets['Term 1'].N9.f,/MATCH\(ROUND\(M9,12\)/);
assert.equal(rebuilt.Sheets['Term 1'].N10.v,60);
assert.ok(!rebuilt.Sheets['Term 1'].N11.v);
assert.equal(rebuilt.Sheets['Term 1'].A8.v,'Example learner 1');
const school=await provisional({name:'Escuéla Example',locality:'Metro City',schoolId:'123456',sector:'public'});
assert.equal(school.key,(await provisional({name:'Escuela Example',locality:'metro city',schoolId:'123456',sector:'public'})).key);
assert.equal(searchSchools([{...school,region:'demo'}],'esquela',{region:'demo'})[0].key,school.key);
assert.throws(()=>normalizeSchool({...school,key:'d111111'}));
const catalogRequests=[];
const officialCatalog=makeDirectory(async url=>{
  const path=new URL(url,'https://example.test').pathname.replace('/schools/','');
  catalogRequests.push(path);
  return new Response(readFileSync(new URL('../nationwide/schools/'+path,import.meta.url)));
});
const manifest=await officialCatalog.manifest();
assert.equal(manifest.regions.length,18);
assert.equal(manifest.schoolYear,'2025–2026');
const katingal=await officialCatalog.school('117788');
assert.deepEqual([katingal.name,katingal.region,katingal.province,katingal.locality,katingal.sector,katingal.logo],
  ['Katingal-an Elementary School','nir','NEGROS OCCIDENTAL','SAN CARLOS CITY','public','']);
assert.ok(catalogRequests.length<10,'Exact School ID should load only candidate regions');
const nationwide=await officialCatalog.rows();
assert.equal(nationwide.length,60168);
assert.equal(new Set(nationwide.map(row=>row.schoolId)).size,nationwide.length);
assert.equal(new Set(nationwide.map(row=>row.region)).size,18);
for(const query of ['KATINGAL-AN ELEMENTARY SCHOOL','katingalan es','117788','katingal san carlos']){
  assert.equal(searchSchools(nationwide,query)[0]?.schoolId,'117788',query);
}
assert.equal(searchSchools(nationwide,'117788',{region:'region-1'}).length,0);
assert.ok(nationwide.some(row=>row.region==='ncr'&&row.sector==='private'));
const demoManifest={version:'sealed-test',regions:[{id:'demo',label:'Example region',file:'demo.json'}],seals:{
  '900001':{file:'900001.png',sourceUrl:'https://example.test/school-seal',permissionUrl:'https://example.test/permission'},
  '900002':{file:'external.png',sourceUrl:'https://example.test/other',permissionUrl:'https://example.test/permission'}
}};
const sealedCatalog=makeDirectory(async url=>new Response(JSON.stringify(url.includes('manifest')
  ?demoManifest:{places:[['Example Municipality','Example Province']],schools:[['900001','First School','p',0],['900002','Second School','r',0]]})));
assert.equal((await sealedCatalog.school('900001')).logo,'/schools/logos/900001.png');
assert.equal((await sealedCatalog.school('900002')).logo,'');
const privateRecord={ownerUid:'a',classId:'c01',schoolKey:'d900002',schoolName:'Example',schoolYear:'2026-2027',curriculum:'Example',
  grade:6,subject:'Science',policy:'private-g6-science-v1',template:'private-supplementary-v1',sector:'private',title:'Example class',
  roster:{r01:'Example learner'},periods:{t1:{locked:false,hps:{w1:20},scores:{r01:{w1:0}}}}};
const passphrase='synthetic local test';
const backup=await saveRecovery(privateRecord,passphrase);
assert.equal((await readRecovery(backup,passphrase,privateRecord)).periods.t1.scores.r01.w1,0);
await assert.rejects(()=>readRecovery(backup,passphrase,{...privateRecord,ownerUid:'b'}),/different class/);
await assert.rejects(()=>readRecovery(backup,'another passphrase',privateRecord),/could not be decrypted/);
console.log('PASS Grade 6 policy, workbook, unsupported scope and school directory.');
