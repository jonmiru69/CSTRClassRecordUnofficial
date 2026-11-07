'use strict';
// Optional real RTDB emulator tests. Requires Firebase Emulator Suite and dev dependencies.
const fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,set,get}=require('firebase/database');
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-cstr-review',database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(path.join(__dirname,'../firebase-database-rules.json'),'utf8')}});
 try {
  await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database()),{'cstr-registration-approved':{alice:true,bob:true},'cstr-class-record-bindings':{legacy:{boundUid:'alice'}},'cstr-class-record-data':{alice:{version:4,teacher:{name:'Test'},_syncRevision:1},legacy:{version:4,teacher:{name:'Old'}}}}));
  const alice=env.authenticatedContext('alice').database(),bob=env.authenticatedContext('bob').database(),pending=env.authenticatedContext('pending').database(),anonymous=env.unauthenticatedContext().database();
  const data='cstr-class-record-data/alice';
  await assertSucceeds(get(ref(alice,data)));await assertFails(get(ref(bob,data)));await assertFails(get(ref(anonymous,data)));await assertFails(get(ref(pending,'cstr-class-record-data/pending')));
  await assertSucceeds(get(ref(alice,'cstr-class-record-data/legacy')));
  await assertFails(set(ref(alice,'cstr-registration-approved/alice'),true));
  await assertFails(set(ref(alice,'cstr-class-record-bindings/new'),{boundUid:'alice'}));
  await assertFails(set(ref(alice,'cstr-registration-tickets/test'),{used:true}));
  const next={version:4,teacher:{name:'Test'},_syncProtocol:2,_syncRevision:2,_syncSavedAt:Date.now(),_syncClientId:'test'};
  await assertSucceeds(set(ref(alice,data),next));await assertFails(set(ref(alice,data),next));
  await assertFails(set(ref(alice,data),null));
  await assertFails(set(ref(alice,data),{version:4,teacher:{name:'Old client'}}));
  console.log('RTDB emulator security checks passed.');
 } finally {await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
