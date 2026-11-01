import {cp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'site-dist');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const file of ['index.html','policies.html','ASSETS','downloads'])await cp(path.join(root,file),path.join(out,file),{recursive:true});
console.log('Static website packaged in site-dist. Native code, dependencies, tests and signing material are excluded.');
