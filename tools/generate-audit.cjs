'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||path.join(root,'mobile/audit-reference'));
fs.mkdirSync(out,{recursive:true});
const files=cp.execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(file=>file&&!file.startsWith('.build-artifacts/'));
const csv=[['Path','Bytes','Lines (text only)','SHA256 (workspace bytes)'].join(',')];
let appendix='# Source reference appendix\n\nGenerated from the reviewed checkout. Hashes describe workspace bytes; checkout newline conversion can change text hashes without changing source behavior. Function locations are one-based. Vendored distributions are inventoried, not independently audited line by line.\n\n';
for(const file of files){
 const full=path.join(root,file);if(!fs.existsSync(full)||fs.statSync(full).isDirectory())continue;
 const data=fs.readFileSync(full),text=/\.(?:[cm]?js|mjs|json|css|html|md|txt|xml|gradle|properties|ya?ml)$/.test(file)?data.toString('utf8'):null;
 csv.push([file,data.length,text?text.split(/\r?\n/).length:'',crypto.createHash('sha256').update(data).digest('hex')].map(value=>'"'+String(value).replaceAll('"','""')+'"').join(','));
 if(text&&/\.(?:[cm]?js|mjs)$/.test(file)&&!file.includes('/vendor/')&&!file.startsWith('tests/')){
  const functions=[];text.split(/\r?\n/).forEach((line,index)=>{const match=line.match(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);if(match)functions.push(`| ${index+1} | \`${match[1]}\` |`);});
  if(functions.length)appendix+=`## ${file}\n\n| Line | Function |\n|---:|---|\n${functions.join('\n')}\n\n`;
 }
}
const grading=require(path.join(root,'ASSETS/grading-engine.js'));
appendix+='## Exact subject preset catalog\n\nThese are implemented project values, not independent institutional-policy approval. Custom weights must be reviewed separately.\n\n| Subject | WW | PT | QA/Exam |\n|---|---:|---:|---:|\n'+grading.SUBJECT_PRESETS.map(p=>`| ${p.name.replaceAll('|','/')} | ${p.weights.join(' | ')} |`).join('\n')+'\n\n';
appendix+='## Exact transmutation thresholds\n\nThe implementation checks descending minimum thresholds after normalizing binary noise to twelve decimal places. It does not first round the grade to two or three display decimals. The source table’s printed maxima are included for reference.\n\n| Minimum | Source table maximum | Reported grade |\n|---:|---:|---:|\n'+grading.TRANSMUTATION_TABLE.map(p=>`| ${p.min} | ${p.max} | ${p.grade} |`).join('\n')+'\n';
fs.writeFileSync(path.join(out,'SOURCE-INVENTORY.csv'),csv.join('\n')+'\n');fs.writeFileSync(path.join(out,'SOURCE-REFERENCE.md'),appendix);
console.log(`Inventoried ${csv.length-1} source/assets files; authored function index and exact grading catalogs generated.`);
