(() => {
  "use strict";
  let active=null,opener=null,hidden=[];
  const selector='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]';
  const focusable=d=>[...d.querySelectorAll(selector)].filter(e=>e.getClientRects().length);
  function sync() {
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(e=>e.getClientRects().length);
    const next=dialogs.at(-1)||null;
    if(next===active)return;
    for(const [el,prior] of hidden)el.inert=prior;hidden=[];
    if(!next){active=null;if(opener?.isConnected)opener.focus();opener=null;return;}
    if(!active)opener=document.activeElement;active=next;
    if(!active.hasAttribute('aria-label')&&!active.hasAttribute('aria-labelledby'))active.setAttribute('aria-label',active.querySelector('h2,h3')?.textContent||'Workspace dialog');
    active.setAttribute('aria-modal','true');active.tabIndex=-1;
    let branch=active;
    while(branch.parentElement&&branch.parentElement!==document.documentElement){for(const sibling of branch.parentElement.children){if(sibling!==branch&&!['SCRIPT','STYLE','DIALOG'].includes(sibling.tagName)){hidden.push([sibling,sibling.inert]);sibling.inert=true;}}branch=branch.parentElement;}
    (focusable(active)[0]||active).focus();
  }
  new MutationObserver(sync).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('keydown',e=>{
    if(!active||document.querySelector('dialog[open]'))return;
    if(e.key==='Tab'){const list=focusable(active);const first=list[0]||active,last=list.at(-1)||active;if(e.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){e.preventDefault();first.focus();}e.stopImmediatePropagation();}
    if(e.key==='Escape'){const close=active.querySelector('[data-action="close-modal"],[data-action="onboard-cancel"],[data-action="cancel-logout"]');if(close){e.preventDefault();e.stopImmediatePropagation();close.click();}}
  },true);
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||active)return;
    const open=[...document.querySelectorAll('.period-settings[open],.roster-options[open],.column-options[open]')];
    const panel=open.at(-1);
    if(panel){e.preventDefault();panel.removeAttribute('open');panel.querySelector('summary')?.focus();}
  });
  const popupSelector='.period-settings,.roster-options,.column-options';
  function placePopup(details){
    if(!details?.open)return;
    const panel=details.querySelector('.period-toolbar,.bulk-column-tools');
    if(!panel)return;
    panel.style.top='';panel.style.bottom='';panel.style.maxHeight='';
    panel.style.translate='0';
    const margin=12,anchor=details.querySelector('summary').getBoundingClientRect();
    if(details.matches('.column-options,.period-settings')){
      const before=panel.getBoundingClientRect();
      const above=Math.max(180,anchor.top-margin-8),below=Math.max(180,innerHeight-anchor.bottom-margin-8);
      if(before.bottom>innerHeight-margin&&above>below){panel.style.top='auto';panel.style.bottom='calc(100% + 8px)';panel.style.maxHeight=`${above}px`;}
      else if(before.bottom>innerHeight-margin)panel.style.maxHeight=`${below}px`;
    }
    const rect=panel.getBoundingClientRect();
    const appLeft=document.querySelector('.app-main')?.getBoundingClientRect().left||0;
    const leftEdge=Math.max(margin,Math.min(appLeft+margin,innerWidth-80));
    const shift=rect.left<leftEdge ? leftEdge-rect.left : rect.right>innerWidth-margin ? innerWidth-margin-rect.right : 0;
    panel.style.translate=`${shift}px 0`;
  }
  document.addEventListener('toggle',e=>{if(e.target.matches(popupSelector))requestAnimationFrame(()=>placePopup(e.target));},true);
  window.addEventListener('resize',()=>document.querySelectorAll(`${popupSelector.split(',').map(x=>x+'[open]').join(',')}`).forEach(placePopup),{passive:true});
  sync();
})();
