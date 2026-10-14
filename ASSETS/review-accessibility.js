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
  // Compact entry keeps existing score inputs and their validation/event handlers.
  function focusControls(){
    const wrap=document.querySelector('.table-wrap');if(!wrap||wrap.previousElementSibling?.classList.contains('entry-focus-controls'))return;
    const panel=document.createElement('div');panel.className='entry-focus-controls';
    panel.innerHTML='<label>Entry view <select aria-label="Entry view"><option value="all">Full grade sheet</option><option value="one">One learner</option></select></label><label hidden>Learner <select aria-label="Learner to display"></select></label><p>WW: Written work · PT: Performance tasks · QA: Assessment · HPS: Highest possible score. Use the full sheet to edit dates and HPS.</p>';
    const [mode,learner]=panel.querySelectorAll('select');
    const rows=[...wrap.querySelectorAll('tbody tr')].filter(r=>r.querySelector('[data-score]'));
    rows.forEach((r,i)=>{const option=document.createElement('option');option.value=i;option.textContent=r.querySelector('[data-name-row]')?.value||r.querySelector('input:not([data-score])')?.value||'Learner '+(i+1);learner.append(option);});
    const update=()=>{
      const focused=mode.value==='one';learner.parentElement.hidden=!focused;wrap.classList.toggle('one-learner',focused);
      rows.forEach((r,i)=>{r.hidden=focused&&i!==Number(learner.value);
        learner.options[i].textContent=r.querySelector('[data-name-row]')?.value||r.querySelector('input:not([data-score])')?.value||'Learner '+(i+1);
        for(const cell of r.querySelectorAll('td')){
          const input=cell.querySelector('[data-score]');
          if(input){const kind=input.dataset.score,index=input.dataset.index;const hps=wrap.querySelector('[data-hps="'+kind+'"][data-index="'+index+'"]')?.value||'not set';cell.dataset.focusLabel=kind.toUpperCase()+' '+(Number(index)+1)+' · HPS '+hps;}
          else if(cell.classList.contains('name-cell'))cell.dataset.focusLabel='Learner name';
          else {const label=[...cell.classList].find(c=>/^summary-(ww|pt|qa)-(total|ps|ws)$/.test(c));cell.dataset.focusLabel=label?label.replace('summary-','').replaceAll('-',' ').replace('ps','percentage').replace('ws','weighted'):cell.classList.contains('initial-cell')?'Initial grade':cell.classList.contains('transmuted-cell')?'Transmuted grade':cell.classList.contains('descriptor-cell')?'Descriptor':'';}
        }
      });
    };
    mode.onchange=update;learner.onchange=update;
    wrap.addEventListener('input',e=>{if(e.target.matches('[data-name-row],[data-hps]'))update();});
    wrap.before(panel);
  }
  new MutationObserver(focusControls).observe(document.getElementById('app'),{childList:true,subtree:true});focusControls();sync();
})();
