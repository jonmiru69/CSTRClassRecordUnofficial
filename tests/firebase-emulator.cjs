'use strict';
// Optional real RTDB emulator tests. Requires Firebase Emulator Suite and dev dependencies.
const fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,set,get,serverTimestamp}=require('firebase/database');
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
  const ns='nationwide-v1', schoolKey='d900002';
  const grant={active:true,expiresAt:Date.now()+360000,sector:'private',schoolName:'Example Academy',schoolYear:'2026-2027',curriculum:'Example curriculum',grade:6,subject:'Science',policy:'private-g6-science-v1'};
  await env.withSecurityRulesDisabled(async ctx=>{
    const d=ctx.database();
    await set(ref(d,'cstr-registration-approved/revoked'),false);
    await set(ref(d,'cstr-registration-approved/old-owner'),{approvedAt:10,approvedBy:'developer-verified'});
    await set(ref(d,'cstr-class-record-data/old-owner'),{version:4,teacher:{name:'Original owner'}});
    await set(ref(d,ns+'/holds/held'),{reason:'hold'});
    await set(ref(d,ns+'/privateGrants/pilot/'+schoolKey),grant);
  });
  const old=env.authenticatedContext('old-owner').database(),revoked=env.authenticatedContext('revoked').database();
  await assertSucceeds(get(ref(old,'cstr-class-record-data/old-owner')));
  await assertFails(get(ref(revoked,'cstr-class-record-data/revoked')));
  await assertFails(set(ref(revoked,'cstr-class-record-data/revoked'),{...next,_syncRevision:1}));
  await assertFails(set(ref(alice,data),{...next,teacher:true,_syncRevision:3,_syncSavedAt:serverTimestamp()}));
  await assertFails(set(ref(alice,data),{...next,_syncRevision:3,_syncSavedAt:serverTimestamp(),unexpected:'x'.repeat(524288)}));
  await assertFails(set(ref(alice,data),{...next,_syncRevision:3,_syncSavedAt:serverTimestamp(),sections:{synthetic:{periods:[{roster:[{name:'x'.repeat(524288)}]}]}}}));
  await assertSucceeds(set(ref(alice,data),{...next,_syncRevision:3,_syncSavedAt:serverTimestamp(),
    calendarMode:'legacy',registry:[{id:'synthetic',group:'JHS',section:'Fixture',subject:'Science',weights:[20,50,30],archived:false}],
    sections:{synthetic:{periods:[{name:'First',locked:false,wwDates:[''],wwHps:['10'],roster:[{name:'Synthetic learner',ww:['8'],scoreAdjustments:{ww:{0:{raw:'7',entries:[{points:1,reason:'Synthetic evidence',at:'2026-11-06T01:00:00Z',actor:'Fixture'}]}}}}]}]}}}));
  const pilot=env.authenticatedContext('pilot',{email_verified:true}).database(),peer=env.authenticatedContext('peer',{email_verified:true}).database();
  const unverified=env.authenticatedContext('unverified',{email_verified:false}).database(),held=env.authenticatedContext('held',{email_verified:true}).database();
  const school={key:schoolKey,schoolId:'900002',name:'Example Academy',sector:'private',locality:'Example city',directoryVersion:'fixture-v1'};
  const profile={displayName:'Synthetic teacher',school,revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  const profilePath=id=>ns+'/profiles/'+id;
  const classPath=(id,key=schoolKey,slot='c01')=>ns+'/privateRecords/'+id+'/'+key+'/'+slot;
  const record={ownerUid:'pilot',classId:'c01',schoolKey,schoolName:grant.schoolName,schoolYear:grant.schoolYear,
    curriculum:grant.curriculum,grade:6,subject:'Science',policy:grant.policy,template:'private-supplementary-v1',sector:'private',
    title:'Synthetic science',archived:false,roster:{r01:'Synthetic learner'},periods:{t1:{locked:false,hps:{w1:10},scores:{r01:{w1:0}}}},
    revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await assertFails(set(ref(pilot,profilePath('pilot')),profile));
  await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database(),ns+'/control/registration'),true));
  await assertFails(set(ref(unverified,profilePath('unverified')),profile));
  await assertFails(set(ref(held,profilePath('held')),profile));
  await assertFails(set(ref(old,profilePath('old-owner')),profile));
  await assertFails(set(ref(pilot,profilePath('peer')),profile));
  await assertFails(set(ref(pilot,profilePath('pilot')),{...profile,role:'admin'}));
  await assertSucceeds(set(ref(pilot,profilePath('pilot')),profile));
  await assertSucceeds(set(ref(peer,profilePath('peer')),profile));
  await assertFails(get(ref(peer,profilePath('pilot'))));
  await assertFails(set(ref(peer,ns+'/privateGrants/peer/'+schoolKey),grant));
  await assertFails(set(ref(pilot,classPath('pilot')),record));
  await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database(),ns+'/control/privateRecords'),true));
  await assertFails(set(ref(pilot,classPath('pilot')),{...record,sector:'public'}));
  await assertFails(set(ref(pilot,classPath('pilot')),{...record,grade:7}));
  await assertFails(set(ref(pilot,classPath('pilot')),{...record,roster:{r61:'Overflow'}}));
  await assertFails(set(ref(pilot,classPath('pilot')),{...record,periods:{t1:{locked:false,hps:{w1:10},scores:{r01:{w1:11}}}}}));
  await assertSucceeds(set(ref(pilot,classPath('pilot')),record));
  await assertFails(get(ref(peer,classPath('pilot'))));
  await assertFails(get(ref(pilot,ns+'/privateRecords/pilot')));
  await assertFails(set(ref(peer,classPath('peer')),{...record,ownerUid:'peer'}));
  await assertFails(set(ref(pilot,classPath('pilot')),record));
  await assertFails(set(ref(pilot,classPath('pilot','d900001')),{...record,schoolKey:'d900001'}));
  const saved=(await get(ref(pilot,classPath('pilot')))).val();
  await assertFails(set(ref(pilot,classPath('pilot')),{...saved,schoolYear:'2027-2028',revision:2,updatedAt:serverTimestamp()}));
  await assertSucceeds(set(ref(pilot,classPath('pilot')),{...saved,archived:true,revision:2,updatedAt:serverTimestamp()}));
  await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database(),ns+'/privateGrants/pilot/'+schoolKey+'/active'),false));
  await assertFails(get(ref(pilot,classPath('pilot'))));
  await assertFails(set(ref(pilot,classPath('pilot')),{...saved,revision:3,updatedAt:serverTimestamp()}));
  console.log('RTDB emulator security checks passed.');
 } finally {await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
