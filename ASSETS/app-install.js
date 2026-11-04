(() => {
  'use strict';
  const native=!!window.CSTRMobile?.native;
  const feed=native?'https://jonmiru69.github.io/CSTRClassRecordUnofficial/downloads/latest.json':new URL('downloads/latest.json',location.href).href;
  let release=null,installed=null,checking=null,lastCheck=0,promptedVersion=0,opener=null;
  let measuredNav=null;
  const navObserver=new ResizeObserver(entries=>{
    const height=Math.max(76,Math.ceil(entries[0].target.getBoundingClientRect().height));
    document.documentElement.style.setProperty('--phone-nav',height+'px');
  });
  function measureText(){document.documentElement.classList.toggle('large-text',parseFloat(getComputedStyle(document.documentElement).fontSize)>=24);}
  measureText();window.addEventListener('resize',measureText,{passive:true});
  const dialog=document.createElement('dialog');dialog.className='install-dialog';dialog.setAttribute('aria-labelledby','installTitle');document.body.append(dialog);
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function contents(message='') {
    const update=installed&&release?CSTRRelease.updateFor(release,Number(installed.build)):null;
    const downloadControl=release&&(!native||!installed||release.versionCode>Number(installed.build))?`<button type="button" class="install-download" data-download-apk>${native?'Download update':'Download Android APK'}</button>`:'<p>No newer Android APK is available for this installation.</p>';
    dialog.innerHTML=`<button type="button" class="install-close" data-close-install aria-label="Close">×</button><h2 id="installTitle">${update?'Update your class record':'Class records. On Android.'}</h2><p>${update?`Version ${escape(release.version)} is ready. Update promptly to receive the latest fixes.`:'A phone layout built for entering scores, with the same approved account and cloud records.'}</p>${release?`<p class="install-release-info">Version ${escape(release.version)} · ${(release.bytes/1048576).toFixed(1)} MB · Android 7.0 or later</p>${downloadControl}${release.notes.trim() ? `<section aria-label="What’s new"><h3>What’s new</h3><p>${escape(release.notes)}</p></section>` : ''}<details><summary>Verify this download</summary><p class="install-release-info">SHA-256: ${escape(release.sha256)}</p><p>Only install the file linked from this website. Android checks the signing identity when updating an existing installation.</p></details>`:'<p role="status">The Android download is not available yet. Use the website while the signed release is prepared.</p>'}${native?`<p>Installed: ${escape(installed?.version||'checking…')}. Save pending changes or create an encrypted backup before updating. Keep the app installed: an update should replace it.</p><div class="mobile-menu-actions"><button type="button" class="button button-secondary" data-check-update>Check for updates</button><button type="button" class="button button-secondary" data-enable-update-alerts>Enable update alerts</button></div><p>Alerts check periodically when Android allows background work. You will also be prompted inside the app; no notification permission is required for that prompt.</p>`:'<ol><li>Download the APK on your Android phone.</li><li>Open the file. If Android asks, allow this browser to install this app, then install.</li><li>Sign in with your approved email and password. For a Google account, add a password in website Settings first.</li></ol><p>Check the cloud save status before changing devices. Internet is required for approval, cloud loading and synchronization.</p><p>The APK is for Android. Continue using the website on other devices.</p>'}<p data-install-status role="status">${escape(message)}</p>`;
  }
  function open(message='') {opener=document.activeElement;contents(message);if(!dialog.open)dialog.showModal();}
  function announce() {
    const update=release&&installed?CSTRRelease.updateFor(release,Number(installed.build)):null;
    if(!update)return;
    let banner=document.querySelector('.update-banner');
    if(!banner){banner=document.createElement('aside');banner.className='update-banner';banner.setAttribute('aria-label','App update available');banner.innerHTML='<span role="status"></span><button type="button" data-open-install>Update now</button>';document.body.prepend(banner);}
    banner.querySelector('span').textContent=`${update.required?'Important update':'Update available'}: ${release.version}. Save your work and update now.`;
    if(promptedVersion!==release.versionCode){promptedVersion=release.versionCode;open();}
  }
  async function check(force=false) {
    if(checking)return checking;
    if(!force&&Date.now()-lastCheck<60000)return;
    checking=(async()=>{
      try{
        if(native&&!installed)installed=await window.CSTRMobile.getInfo();
        const response=await fetch(feed,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error('Update service is unavailable. Try again when connected.');
        const result=await response.json(),validated=CSTRRelease.validate(result);
        if(result.available===true&&!validated)throw new Error('The release information could not be verified. Please try again later.');
        if(native&&validated&&validated.versionCode>Number(installed.build)) {
          if(!(await window.CSTRMobile.verifyRelease(validated)).valid)throw new Error('This update uses a different signing identity. Keep your installed app and contact support.');
        }
        release=validated;
        lastCheck=Date.now();if(dialog.open)contents(native&&(!release||release.versionCode<=Number(installed.build))?'You have the latest published version.':'');announce();
      }catch(error){release=null;document.querySelector('.update-banner')?.remove();if(dialog.open)contents(error.message);}
      finally{checking=null;}
    })();return checking;
  }
  function addEntry() {
    const nav=document.querySelector('.mobile-navigation');
    if(nav!==measuredNav){navObserver.disconnect();measuredNav=nav;if(nav)navObserver.observe(nav);}
    const host=document.querySelector('.welcome-tools');
    if(host&&!host.querySelector('[data-open-install]')){const button=document.createElement('button');button.type='button';button.className='install-entry';button.dataset.openInstall='';button.textContent=native?'App updates':'Get Android app';host.append(button);}
    const account=document.querySelector('.sidebar-account-tools');
    if(account&&!account.querySelector('[data-open-install]')){const button=document.createElement('button');button.type='button';button.className='sidebar-link';button.dataset.openInstall='';button.textContent=native?'App updates':'Get Android app';account.append(button);}
  }
  let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;addEntry();});}).observe(document.querySelector('#app'),{childList:true,subtree:true});addEntry();
  document.addEventListener('click',async event=>{
    if(event.target.closest('[data-open-install]')){document.querySelector('.mobile-menu-backdrop')?.remove();open();void check(true);}
    if(event.target.closest('[data-close-install]'))dialog.close();
    if(event.target.closest('[data-check-update]')){contents('Checking for updates…');await check(true);}
    if(event.target.closest('[data-enable-update-alerts]')){
      try{const result=await window.CSTRMobile.enableUpdateAlerts();contents(result.granted?'Android update alerts enabled.':'Notifications are disabled. In-app update prompts still work; you can enable alerts in Android Settings.');}catch(_){contents('Could not enable alerts. Try again from Android Settings.');}
    }
    if(event.target.closest('[data-download-apk]')&&release){
      const before=new Event('cstr-before-update',{cancelable:true});if(native&&!window.dispatchEvent(before)){dialog.close();return;}
      try {
        if(native){await window.CSTRMobile.checkpoint();await window.CSTRMobile.openDownload(release.url);}
        else location.assign(release.url);
      }catch(error){contents('Could not start the download. Check your connection and try again.');}
    }
  });
  dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus();});
  if(native){void check(true);window.addEventListener('cstr-resume',()=>void check(true));window.addEventListener('online',()=>void check(true));setInterval(()=>{if(!document.hidden)void check();},5*60*1000);}
  const baseline=window.visualViewport?.height||innerHeight;
  window.visualViewport?.addEventListener('resize',()=>{
    const editing=document.activeElement?.matches('input,textarea,select');
    document.documentElement.classList.toggle('keyboard-open',!!editing&&window.visualViewport.height<baseline*.75);
    if(editing)document.activeElement.scrollIntoView({block:'center'});
  });
})();
