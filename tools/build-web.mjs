import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {stampAssets} from './asset-versions.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'site-dist');
const mode=process.env.CSTR_NATIONWIDE_MODE||'production';
if(!['closed','emulator','production'].includes(mode))throw new Error('Unknown nationwide build mode.');
const routes={signin:'Sign in',register:'Teacher registration',teacher:'Teacher workspace',practice:'Grade 6 Science practice',privacy:'Privacy and use'};
if(path.dirname(out)!==root||path.basename(out)!=='site-dist')throw new Error('Unexpected Hosting output directory.');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
// Spark Hosting forbids APKs; the verified feed uses existing Pages APK URLs.
for(const file of ['policies.html','ASSETS','downloads'])await cp(path.join(root,file),path.join(out,file),{recursive:true,filter:source=>!source.endsWith('.apk')});
const legacy=await stampAssets(await readFile(path.join(root,'index.html'),'utf8'),out);
await mkdir(path.join(out,'cst-r'),{recursive:true});
const legacyHead='<head>\n    <base href="/">\n    <meta name="cstr-hosted-build" content="true">'+
  (mode==='emulator'?'\n    <meta name="cstr-legacy-emulator" content="true">':'')+
  (mode!=='emulator'?'\n    <meta name="cstr-legacy-approval" content="deployed-rules">':'');
await writeFile(path.join(out,'cst-r','index.html'),legacy.replace('<head>',legacyHead));
await writeFile(path.join(out,'policies.html'),await stampAssets(await readFile(path.join(out,'policies.html'),'utf8'),out));
await cp(path.join(root,'nationwide','index.html'),path.join(out,'index.html'));
const shell=await readFile(path.join(root,'nationwide','shell.html'),'utf8');
for(const [route,title] of Object.entries(routes)){
  const dir=path.join(out,route);
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'index.html'),shell.replace('__MODE__',mode).replace('__ROUTE__',route).replace('__TITLE__',title));
}
const workflow=await readFile(path.join(root,'nationwide','workflow.html'),'utf8');
const styleLinks=legacy.match(/<link rel="stylesheet"[^>]*>/g)??[];
const scripts=new Map([...legacy.matchAll(/<script src="([^"?]+)[^"]*"[^>]*><\/script>/g)].map(match=>[match[1],match[0]]));
const shared=['theme','asset-loader','file-delivery','safe-raster','backup','grading-engine','record-tools','stable-dom',
  'performance-analysis','review-accessibility','interaction-polish'];
const supportScripts=shared.map(name=>scripts.get(`ASSETS/${name}.js`));
const sharedApp=scripts.get('ASSETS/app.js')?.match(/src="([^"]+)"/)?.[1];
const layout=legacy.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
if(!sharedApp||!layout||supportScripts.includes(undefined))throw new Error('Missing shared workspace assets');
await writeFile(path.join(out,'ASSETS','nationwide','shared-workspace-layout.js'),layout);
await mkdir(path.join(out,'workflow'),{recursive:true});
await writeFile(path.join(out,'workflow','index.html'),workflow.replace('__MODE__',mode).replace('__APP__',sharedApp)
  .replace('__STYLES__',styleLinks.join('\n  ')).replace('__SCRIPTS__',supportScripts.join('\n  ')));
await cp(path.join(root,'nationwide',mode==='emulator'?'schools-fixture':'schools'),path.join(out,'schools'),{recursive:true});
console.log('Static website packaged in site-dist. Native code, dependencies, tests and signing material are excluded.');
