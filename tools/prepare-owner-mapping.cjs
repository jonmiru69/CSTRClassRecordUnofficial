'use strict';
// Local preparation only. Never connects to Firebase or changes the source backup.
const fs=require('node:fs'),path=require('node:path');
const [backupPath,mappingsPath,outputPath]=process.argv.slice(2);
if(!backupPath||!mappingsPath||!outputPath){console.error('Usage: node tools/prepare-owner-mapping.cjs PRIVATE_BACKUP.json VERIFIED_OWNERS.json OUTPUT_PATCH.json');process.exit(1);}
if(fs.existsSync(outputPath))throw new Error('Output exists. Choose a new filename; no file was overwritten.');
const backup=JSON.parse(fs.readFileSync(backupPath,'utf8')),mappings=JSON.parse(fs.readFileSync(mappingsPath,'utf8'));
if(!Array.isArray(mappings)||!mappings.length)throw new Error('Expected a nonempty verified-owner array.');
const updates={},uids=new Set(),keys=new Set();
for(const item of mappings){
 const {uid,dataKey,email,name,ownershipVerified}=item;
 if(ownershipVerified!==true)throw new Error('Every mapping must be independently verified by the developer.');
 for(const value of [uid,dataKey])if(typeof value!=='string'||!value.trim()||/[.#$\[\]/]/.test(value))throw new Error('Invalid Firebase path segment.');
 if(typeof email!=='string'||!email.includes('@')||typeof name!=='string'||name.length>120)throw new Error('Supply the verified sign-in email and name (maximum 120 characters).');
 if(uids.has(uid)||keys.has(dataKey))throw new Error('Duplicate UID or dataKey; one workspace per teacher is supported.');
 uids.add(uid);keys.add(dataKey);
 if(!backup['cstr-class-record-data']?.[dataKey])throw new Error('Record is absent from the supplied private backup.');
 const previous=backup['cstr-class-record-bindings']?.[dataKey];
 if(previous?.boundUid&&previous.boundUid!==uid)throw new Error('Existing binding disagrees. Resolve ownership separately before proceeding.');
 const profile=backup['cstr-class-record-users']?.[uid];
 if(profile?.dataKey&&profile.dataKey!==dataKey)throw new Error('UID already has another workspace. Do not overwrite or merge it with this tool.');
 const timestamp=Date.now();
 updates['cstr-registration-approved/'+uid]={approvedAt:timestamp,approvedBy:'developer-verified'};
 updates['cstr-class-record-users/'+uid]={...(profile||{}),dataKey,email,name,isLegacy:dataKey!==uid};
 if(dataKey!==uid)updates['cstr-class-record-bindings/'+dataKey]={boundUid:uid,boundEmail:email,boundName:name,boundAt:timestamp};
}
fs.writeFileSync(outputPath,JSON.stringify(updates,null,2),{flag:'wx'});
console.log('Prepared '+mappings.length+' mapping(s). No server changes made. Review the patch privately. Do not import this multi-location patch through the root JSON Import command. See APPLY-CHANGES.md.');
