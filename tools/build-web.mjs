import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {stampAssets} from './asset-versions.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'site-dist');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
// Spark Hosting forbids APKs; the verified feed uses existing Pages APK URLs.
for(const file of ['index.html','policies.html','ASSETS','downloads'])await cp(path.join(root,file),path.join(out,file),{recursive:true,filter:source=>!source.endsWith('.apk')});
for(const file of ['index.html','policies.html'])await writeFile(path.join(out,file),await stampAssets(await readFile(path.join(out,file),'utf8'),out));
console.log('Static website packaged in site-dist. Native code, dependencies, tests and signing material are excluded.');
