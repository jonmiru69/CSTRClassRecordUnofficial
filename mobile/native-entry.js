import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const native = Capacitor.isNativePlatform();
const Recovery = registerPlugin('CSTRRecovery');
const Updates = registerPlugin('CSTRUpdates');
let exportQueue = Promise.resolve();
let recoveryQueue = Promise.resolve();
async function saveFile(blob, filename) {
  if (!native) return false;
  // Serialize exports, so a second export cannot replace a file still being shared.
  const task = async () => {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-160);
    if (blob.size > 30 * 1024 * 1024) throw new Error('Export is larger than the app’s 30 MB sharing limit. Use the website for this export.');
    const data = await new Promise((resolve,reject) => {
      const reader = new FileReader(); reader.onerror = reject;
      reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
    });
    const { uri } = await Filesystem.writeFile({path:`exports/${Date.now()}-${safeName}`,data,directory:Directory.Cache,recursive:true});
    await Share.share({title:safeName,files:[uri],dialogTitle:'Save or share your class record'});
    return true;
  };
  const result = exportQueue.then(task,task); exportQueue = result.catch(() => {}); return result;
}
window.CSTRMobile = {
  native,
  ready: native ? Recovery.read().then(({data}) => {
    if (!data) return;
    const saved = JSON.parse(data);
    // No login flag, password, auth token, or application state is restored implicitly.
    for (const [key,value] of Object.entries(saved)) if (/^cstr-class-record-(autosave-draft|history):/.test(key) && typeof value === 'string') sessionStorage.setItem(key,value);
  }).catch(() => { window.CSTRRecoveryUnavailable = true; }) : Promise.resolve(),
  saveFile,
  getInfo: () => App.getInfo(),
  verifyRelease: release => Updates.verifyRelease(release),
  enableUpdateAlerts: () => Updates.enableAlerts(),
  minimize: () => App.minimizeApp(),
  async openDownload(url) {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.hostname!=='jonmiru69.github.io'||!/^\/CSTRClassRecordUnofficial\/downloads\/CSTR-Class-Record-\d+\.\d+\.\d+\.apk$/.test(parsed.pathname))throw new Error('Unrecognized APK download.');
    await Browser.open({url});
  },
  async checkpoint() {
    if (!native) return;
    const data = {};
    for (let i=0;i<sessionStorage.length;i++) {
      const key = sessionStorage.key(i);
      if (/^cstr-class-record-(autosave-draft|history):/.test(key)) data[key] = sessionStorage.getItem(key);
    }
    const task=()=>Object.keys(data).length?Recovery.write({data:JSON.stringify(data)}):Recovery.clear();
    const result=recoveryQueue.then(task,task);recoveryQueue=result.catch(()=>{});await result;
  },
  async clearRecovery() {
    if (!native) return;
    const result = recoveryQueue.then(() => Recovery.clear());
    recoveryQueue = result.catch(() => {});
    await result;
  },
  async openWebsite() { await Browser.open({url:'https://jonmiru69.github.io/CSTRClassRecordUnofficial/'}); }
};
if (native) {
  document.documentElement.dataset.native = 'android';
  App.addListener('backButton', () => window.dispatchEvent(new Event('cstr-back')));
  App.addListener('appStateChange', ({isActive}) => window.dispatchEvent(new Event(isActive ? 'cstr-resume' : 'cstr-background')));
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if(url.protocol==='mailto:'){
      event.preventDefault();
      if(url.pathname.toLowerCase()==='sanchezramil2202@gmail.com')Updates.openSupport().catch(error=>alert(error.message));
      else alert('Open your email app to contact '+url.pathname);
      return;
    }
    if (url.origin !== location.origin && ['https:','mailto:'].includes(url.protocol)) {
      event.preventDefault(); Browser.open({url:url.href}).catch(() => alert('Could not open this link. Open it in your browser.'));
    }
  });
  // Exports are temporary app-private cache files. Clear abandoned files on next launch.
  Filesystem.readdir({path:'exports',directory:Directory.Cache}).then(({files}) => Promise.all(files.map(file => Filesystem.deleteFile({path:`exports/${file.name}`,directory:Directory.Cache})))).catch(() => {});
}
