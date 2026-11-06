import {normalizeSchool,short,KEY} from './directory.mjs';

const NS='nationwide-v1';
const PROJECT={
  apiKey:'AIzaSyBgwxuXawJI_jWrlJ02R9eiPcgNMAN9m_Y',
  authDomain:'cstr-class-record-global.firebaseapp.com',
  databaseURL:'https://cstr-class-record-global-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:'cstr-class-record-global'
};
const DEMO={apiKey:'demo-cstr-local',authDomain:'localhost',databaseURL:'http://127.0.0.1:9000?ns=demo-cstr-review',projectId:'demo-cstr-review'};
const productionHosts=['cstr-class-record-global.web.app','cstr-class-record-global.firebaseapp.com'];
const safeUid=/^[^.#$\[\]/\u0000-\u001f\u007f]{1,128}$/;
const isActive=v=>v===true||Boolean(v&&typeof v.approvedAt==='number'&&v.approvedAt>0&&typeof v.approvedBy==='string'&&v.approvedBy&&v.active!==false&&v.revoked!==true);
let instance;
function sdk(){
  if(window.firebase)return Promise.resolve(window.firebase);
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='/ASSETS/vendor/firebase-compat.bundle.js';
    script.onload=()=>window.firebase?resolve(window.firebase):reject(new Error('Sign-in is unavailable.'));
    script.onerror=()=>reject(new Error('Sign-in is unavailable. Check your connection.'));
    document.head.append(script);
  });
}
function withDeadline(promise,ms=10000){
  let timer;
  return Promise.race([promise,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Object.assign(new Error('The server did not confirm the request.'),{code:'class-record/unconfirmed'})),ms);})]).finally(()=>clearTimeout(timer));
}
export function authMessage(e){
  if(e.code==='class-record/unconfirmed')return 'The server did not confirm the request. Keep this tab open and check your connection before retrying.';
  if(e.code==='class-record/conflict')return 'Another device saved a newer version. Reload it and review your changes before saving again.';
  if(e.code==='auth/too-many-requests')return 'Too many requests. Wait a few minutes and try again.';
  if(e.code==='auth/network-request-failed')return 'The connection dropped. Reconnect and try again.';
  if(['auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(e.code))return 'Google sign-in was cancelled.';
  if(e.code==='auth/account-exists-with-different-credential'||e.code==='auth/credential-already-in-use')
    return 'Sign in using your existing method, then link Google in account settings.';
  if(e.code==='auth/email-already-in-use')return 'If you already have an account, sign in or reset your password.';
  if(['auth/invalid-credential','auth/wrong-password','auth/user-not-found','auth/invalid-login-credentials','auth/user-disabled'].includes(e.code))
    return 'Sign-in failed. Check your details or reset your password.';
  if(e.code==='class-record/closed')return 'New registrations are paused. Existing teachers can still sign in.';
  if(e.code==='PERMISSION_DENIED'||e.code==='permission-denied')return 'This account does not have access here. If you teach at CST-R, use the faculty sign-in.';
  return 'Could not complete that action. Check your details and try again.';
}
const error=code=>Object.assign(new Error(code),{code});
export function connect(mode){
  if(mode==='closed')return Promise.resolve(null);
  if(mode==='emulator'&&!['127.0.0.1','localhost','[::1]'].includes(location.hostname))return Promise.resolve(null);
  if(mode==='production'&&(location.protocol!=='https:'||!productionHosts.includes(location.host)))return Promise.resolve(null);
  if(mode!=='emulator'&&mode!=='production')return Promise.resolve(null);
  return instance??=init(mode).catch(e=>{instance=null;throw e;});
}
async function init(mode){
  const firebase=await sdk(), emu=mode==='emulator';
  const app=firebase.apps.length?firebase.app():firebase.initializeApp(emu?DEMO:PROJECT);
  const auth=app.auth(),db=app.database();
  if(emu){auth.useEmulator('http://127.0.0.1:9099',{disableWarnings:true});db.useEmulator('127.0.0.1',9000);}
  await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
  const get=async path=>(await withDeadline(db.ref(path).once('value'))).val();
  const uid=()=>{const u=auth.currentUser?.uid;if(!u||!safeUid.test(u))throw new Error('Sign in again.');return u;};
  const prefix=(path)=>NS+'/'+path;
  const canRegister=async()=>{
    const url=new URL(emu?DEMO.databaseURL:PROJECT.databaseURL);
    url.pathname='/'+prefix('control/registration')+'.json';
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Could not read registration status.');
    return await response.json()===true;
  };
  const verifyUrl=()=>({url:location.origin+'/register/',handleCodeInApp:false});
  async function saveAt(ref,expected,write){
    if(!Number.isInteger(expected)||expected<0)throw new Error('Invalid revision.');
    // Prime a cold cache before the conditional transaction. The revision is still checked inside it.
    await withDeadline(ref.once('value'));
    const result=await withDeadline(ref.transaction(current=>{
      if((current?.revision??0)!==expected)return;
      return {...write,createdAt:current?.createdAt??firebase.database.ServerValue.TIMESTAMP,
        updatedAt:firebase.database.ServerValue.TIMESTAMP,revision:expected+1};
    },undefined,false),14000);
    if(!result.committed)throw error('class-record/conflict');
    return result.snapshot.val();
  }
  return {
    onChange(cb){return auth.onAuthStateChanged(cb);},
    get user(){return auth.currentUser;},
    canRegister,
    async legacyStatus(){
      const id=uid();
      const [approval,hold]=await Promise.all([get('cstr-registration-approved/'+id),get(prefix('holds/'+id))]);
      return isActive(approval)?'legacy':(approval!=null||hold!=null?'held':'ordinary');
    },
    async signIn(email,password){return withDeadline(auth.signInWithEmailAndPassword(email.trim(),password));},
    async google(){
      return withDeadline(auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()),90000);
    },
    async linkGoogle(){return withDeadline(auth.currentUser.linkWithPopup(new firebase.auth.GoogleAuthProvider()),90000);},
    async create(email,password){
      if(!await canRegister())throw error('class-record/closed');
      if(password.length<12)throw new Error('Use at least 12 characters.');
      return withDeadline(auth.createUserWithEmailAndPassword(email.trim(),password));
    },
    async sendVerification(){return withDeadline(auth.currentUser.sendEmailVerification(verifyUrl()));},
    async refreshVerification(){const user=auth.currentUser;if(!user)return false;await withDeadline(user.reload());await withDeadline(user.getIdToken(true));return user.emailVerified===true;},
    async reset(email){
      try{await withDeadline(auth.sendPasswordResetEmail(email.trim(),{url:location.origin+'/signin/'}));}
      catch(e){if(!['auth/user-not-found','auth/user-disabled'].includes(e.code))throw e;}
    },
    async profile(){return get(prefix('profiles/'+uid()));},
    async saveProfile(displayName,school,expected=0){
      return saveAt(db.ref(prefix('profiles/'+uid())),expected,{displayName:short(displayName,2,120),school:normalizeSchool(school)});
    },
    async grants(){return (await get(prefix('privateGrants/'+uid())))??{};},
    watchPrivateOpen(cb){const ref=db.ref(prefix('control/privateRecords')), listener=ref.on('value',snap=>cb(snap.val()===true),()=>cb(false));return ()=>ref.off('value',listener);},
    watchGrants(cb,onError){const ref=db.ref(prefix('privateGrants/'+uid())), listener=ref.on('value',snap=>cb(snap.val()??{}),onError);return ()=>ref.off('value',listener);},
    async classes(schoolKey){if(!KEY.test(schoolKey))throw new Error('Invalid school.');return (await get(prefix('privateRecords/'+uid()+'/'+schoolKey)))??{};},
    async saveClass(record,expected){
      const ownerUid=uid(),{schoolKey,classId}=record;
      if(!KEY.test(schoolKey)||!/^c(0[1-9]|1[0-2])$/.test(classId)||record.ownerUid!==ownerUid||record.sector!=='private')throw new Error('Invalid class scope.');
      const {revision,createdAt,updatedAt,...write}=record;
      return saveAt(db.ref(prefix('privateRecords/'+ownerUid+'/'+schoolKey+'/'+classId)),expected,write);
    },
    async signOut(){return withDeadline(auth.signOut());}
  };
}
