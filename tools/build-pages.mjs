import {cp,mkdir,rm,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'pages-dist');
await access(path.join(root,'site-dist/index.html'));
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
// Keep the release feed and APK URLs compatible with installed Android apps.
await cp(path.join(root,'downloads'),path.join(out,'downloads'),{recursive:true});
const entry=target=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="${target}"><title>CST-R Class Record — Continue to workspace</title></head><body><main><h1>CST-R Class Record</h1><p>The teacher workspace has moved to its protected hosting address.</p><p><a href="${target}" target="_top" rel="noopener">Continue to the class record</a></p><p>Sign in with your approved account. Your successfully saved cloud records use the same account.</p></main></body></html>`;
await writeFile(path.join(out,'index.html'),entry('https://cstr-class-record-global.web.app/'));
await writeFile(path.join(out,'policies.html'),entry('https://cstr-class-record-global.web.app/policies.html'));
console.log('Pages entry and compatible Android downloads packaged in pages-dist. No teacher workspace or grade-entry controls are served here.');
