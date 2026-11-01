import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const [apk,signerJar,version,code,notes='Updated class record workflows and reliability fixes.']=process.argv.slice(2);
if(!apk||!signerJar||!/^\d+\.\d+\.\d+$/.test(version)||!Number.isSafeInteger(Number(code)))throw new Error('Usage: publish-release.mjs apk apksigner.jar version versionCode [notes]');
const root=path.resolve(import.meta.dirname,'..');
// The feed is written only after Android’s signature verifier accepts the actual APK.
const output=execFileSync(process.env.CSTR_JAVA||'java',['-jar',signerJar,'verify','--verbose','--print-certs',apk],{encoding:'utf8'});
const certificate=output.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1]?.toLowerCase();
if(!certificate)throw new Error('No verified APK signing certificate. Release was not published.');
const bytes=await readFile(apk),name=`CSTR-Class-Record-${version}.apk`;
await mkdir(path.join(root,'downloads'),{recursive:true});await copyFile(apk,path.join(root,'downloads',name));
let previous;try{previous=JSON.parse(await readFile(path.join(root,'downloads/latest.json'),'utf8'));}catch(_){}
if(previous?.available&&previous.versionCode>Number(code))throw new Error('Refusing to publish a lower version.');
if(previous?.available&&previous.certificateSha256!==certificate)throw new Error('Signing key changed. Existing users could not upgrade.');
const release={schemaVersion:1,appId:'ph.cstr.classrecord.unofficial',available:true,version,versionCode:Number(code),minimumSupportedVersionCode:0,sha256:createHash('sha256').update(bytes).digest('hex'),certificateSha256:certificate,bytes:bytes.length,url:`https://jonmiru69.github.io/CSTRClassRecordUnofficial/downloads/${name}`,publishedAt:new Date().toISOString(),notes:String(notes).slice(0,2000)};
await writeFile(path.join(root,'downloads/latest.json'),JSON.stringify(release,null,2)+'\n');
console.log(`Verified release ${version}: ${bytes.length} bytes, SHA-256 ${release.sha256}`);
