(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.CSTRRelease=api;})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  function validate(value) {
    if(!value || value.schemaVersion!==1 || value.available!==true || value.appId!=='ph.cstr.classrecord.unofficial')return null;
    if(!Number.isSafeInteger(value.versionCode)||value.versionCode<1||!/^\d+\.\d+\.\d+$/.test(value.version)||!Number.isSafeInteger(value.minimumSupportedVersionCode)||value.minimumSupportedVersionCode<0||value.minimumSupportedVersionCode>value.versionCode)return null;
    if(!/^[a-f0-9]{64}$/i.test(value.sha256)||!/^[a-f0-9]{64}$/i.test(value.certificateSha256)||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>150*1024*1024)return null;
    let url;try{url=new URL(value.url);}catch(_){return null;}
    if(url.protocol!=='https:'||url.hostname!=='jonmiru69.github.io'||url.username||url.password||url.port||url.search||url.hash||!/^\/CSTRClassRecordUnofficial\/downloads\/CSTR-Class-Record-\d+\.\d+\.\d+\.apk$/.test(url.pathname))return null;
    return {...value,notes:String(value.notes||'Reliability and usability improvements.').slice(0,2000),url:url.href};
  }
  function updateFor(release,installed) {const valid=validate(release);return valid&&Number.isSafeInteger(installed)&&valid.versionCode>installed?{...valid,required:installed<valid.minimumSupportedVersionCode}:null;}
  return {validate,updateFor};
});
