/* Web-only Google Sheets connection. School OAuth never replaces workspace sign-in. */
(() => {
  'use strict';
  if (window.CSTRMobile?.native || window.Capacitor?.isNativePlatform?.()) return;
  const engine = window.CSTROfficialSyncEngine;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let schoolAuth, connection, currentDialog, epoch = 0;
  const currentOwner = () => window.CSTRSync?.getCurrentUser()?.uid;
  function assertWeb() {
    if (window.CSTRMobile?.native || window.Capacitor?.isNativePlatform?.()) throw new Error('Official gradesheet filling is available on the website only.');
  }
  function reset() {
    epoch++;
    connection = null;
    void schoolAuth?.signOut().catch(() => {});
    currentDialog?.close();
  }
  async function connect(email) {
    assertWeb();
    const expected = email.trim().toLowerCase(), owner = currentOwner(), attempt = ++epoch;
    if (!owner) throw new Error('Sign in to your approved class record account first.');
    if (!/^[^\s@]+@cstr\.edu\.ph$/.test(expected)) throw new Error('Enter your own cstr.edu.ph school email.');
    connection = null;
    if (!schoolAuth) {
      const app = window.firebase.apps.find(app => app.name === 'official-gradesheets') || window.firebase.initializeApp(window.firebase.app().options, 'official-gradesheets');
      schoolAuth = app.auth();
      await schoolAuth.setPersistence(window.firebase.auth.Auth.Persistence.NONE);
    }
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/spreadsheets');
    provider.setCustomParameters({login_hint:expected, prompt:'select_account consent'});
    const result = await schoolAuth.signInWithPopup(provider);
    try {
      if (attempt !== epoch || currentOwner() !== owner) throw new Error('Your class record account changed. Connect again.');
      if (!result.user.emailVerified || result.user.email?.toLowerCase() !== expected) throw new Error('You selected a different Google account. Connect with the school email you entered.');
      if (!result.credential?.accessToken) throw new Error('Google did not grant a Sheets access token. Connect again and allow the requested access.');
      connection = { token:result.credential.accessToken, email:expected, owner, expires:Date.now()+50*60*1000 };
      return expected;
    } finally { await schoolAuth.signOut(); }
  }
  async function api(path, options = {}) {
    assertWeb();
    const active = connection;
    if (!active || active.owner !== currentOwner() || active.expires <= Date.now()) {
      connection = null;
      throw new Error('Connect your school Google account again. The temporary connection has expired.');
    }
    let response;
    try { response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      ...options, cache:'no-store', referrerPolicy:'no-referrer',
      headers:{Authorization:`Bearer ${active.token}`, ...(options.body ? {'Content-Type':'application/json'} : {})}
    }); } catch (_) { throw new Error('Google could not be reached. Check your connection and preview again before retrying.'); }
    if (connection !== active || currentOwner() !== active.owner) throw new Error('The connected account changed during the request.');
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) connection = null;
      const disabled = body.error?.details?.some(item => item.reason === 'SERVICE_DISABLED');
      if (disabled) throw new Error('The site administrator must enable Google Sheets API in the existing Firebase Google Cloud project.');
      if (response.status === 403) throw new Error('This school account cannot access or edit the selected cells, or Sheets API access is not enabled. Check the account and ask the registrar or site administrator.');
      throw new Error(`Google Sheets request failed (${response.status}). Preview again before retrying.`);
    }
    return body;
  }
  const quote = title => `'${title.replace(/'/g,"''")}'`;
  async function metadata(id) {
    return api(`${id}?fields=${encodeURIComponent('spreadsheetId,properties(title),sheets(properties)')}`);
  }
  async function read(id, sheetId) {
    const book = await metadata(id), sheet = book.sheets.find(s=>s.properties.sheetId === sheetId);
    if (!sheet || sheet.properties.sheetType !== 'GRID') throw new Error('Choose an existing subject grid tab.');
    if (sheet.properties.gridProperties.rowCount > 3000) throw new Error('This sheet is larger than the verified template. Ask the site administrator to inspect it before transferring.');
    const range = `${quote(sheet.properties.title)}!A1:G${sheet.properties.gridProperties.rowCount}`;
    return api(`${id}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=${encodeURIComponent('spreadsheetId,properties(title),namedRanges,sheets(properties,protectedRanges,merges,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue))))')}`);
  }
  function storageKey(owner, source, year) { return `cstr-official-link:${owner}:${year}:${source.id}`; }
  function restore(owner, source, year) {
    try { return JSON.parse(localStorage.getItem(storageKey(owner,source,year)) || '{}'); } catch (_) { return {}; }
  }
  function message(dialog, text, error = false) {
    const box = dialog.querySelector('[data-sync-status]');
    box.textContent = text;
    box.classList.toggle('sync-error',error);
  }
  function open({getSources, selectedClassId = null}) {
    assertWeb();
    currentDialog?.close();
    const owner = currentOwner();
    if (!owner) return;
    const sources = getSources(), dialog = document.createElement('dialog');
    const year = sources[0]?.schoolYear || '';
    let preview = null, busy = false, stopped = false, mutating = false;
    const jobs = sources.map(source => ({source, binding:restore(owner,source,year)}));
    dialog.className = 'official-sync-dialog';
    dialog.setAttribute('aria-labelledby','officialSyncTitle');
    dialog.innerHTML = `<div class="sync-heading"><h2 id="officialSyncTitle">Fill official gradesheets</h2><button type="button" class="button button-secondary" data-sync-close>Close</button></div>
      <p>Transfer finished grading periods from your class record into the registrar’s Google Sheets. Unfinished periods are excluded.</p>
      <div class="sync-connection"><label>School Google email<input type="email" autocomplete="email" data-sync-email placeholder="Your school email" value="${escape(connection?.owner === owner ? connection.email : '')}"></label><button type="button" class="button button-secondary" data-sync-connect>Connect school account</button><button type="button" class="button button-ghost" data-sync-disconnect ${connection?'':'hidden'}>Disconnect</button></div>
      <p data-sync-account>${connection?.owner === owner ? `Connected as ${escape(connection.email)}` : 'Choose your school account in Google’s sign-in window. This keeps your class record signed in.'}</p>
      <label class="sync-year">School year<input data-sync-year value="${escape(year)}" placeholder="2026-2027" pattern="[0-9]{4}-[0-9]{4}" required></label>
      <div data-sync-jobs>${jobs.map((job,i)=>`<fieldset class="sync-job" data-sync-job="${i}"><legend><label><input type="checkbox" data-sync-include ${!selectedClassId || job.source.section.id===selectedClassId?'checked':''}>${escape(job.source.section.subject)} · ${escape(job.source.section.level)} · ${escape(job.source.section.section)}</label></legend><p>${job.source.semester ? `Semester ${job.source.semester} · `:''}${job.source.periods.length} finished period${job.source.periods.length===1?'':'s'}: ${job.source.periods.map(p=>escape(p.name)).join(', ')}</p><div class="sync-link-row"><label>Official Google Sheets link<input type="url" data-sync-link value="${escape(job.binding.link||'')}" placeholder="Paste the file link from the registrar"></label><button type="button" class="button button-secondary" data-sync-check="${i}">Check link</button></div><label>Subject tab<select data-sync-tab disabled><option value="">Check the link first</option></select></label><div data-sync-heading-check></div><p data-sync-job-status role="status"></p></fieldset>`).join('')}</div>
      ${jobs.length?'':'<p>No finished grading periods are available in the active classes. Complete a period before transferring.</p>'}
      <p class="sync-privacy">Scores go directly to Google Sheets under your school account. No passwords are stored. The Google connection lasts only in this page. ChatGPT is not involved in the transfer.</p>
      <p data-sync-status role="status" aria-live="polite"></p><div data-sync-preview></div>
      <div class="sync-actions"><button type="button" class="button button-secondary" data-sync-edit hidden>Edit links and classes</button><button type="button" class="button button-primary" data-sync-preview-button ${jobs.length?'':'disabled'}>Preview finished periods</button><button type="button" class="button button-secondary" data-sync-report hidden>Download change report</button><button type="button" class="button button-primary" data-sync-apply hidden>Fill verified gradesheets</button></div>`;
    document.body.append(dialog);
    currentDialog = dialog;
    const active = () => !stopped && dialog.open && currentOwner() === owner;
    const field = i => dialog.querySelector(`[data-sync-job="${i}"]`);
    const selectedJobs = () => jobs.filter((job,i)=>field(i).querySelector('[data-sync-include]').checked);
    const schoolYear = () => dialog.querySelector('[data-sync-year]').value.trim();
    const liveSources = () => getSources().map(source=>({...source,schoolYear:schoolYear()}));
    function invalidate() {
      preview = null;
      dialog.querySelector('[data-sync-preview]').replaceChildren();
      dialog.querySelector('[data-sync-apply]').hidden = true;
      dialog.querySelector('[data-sync-report]').hidden = true;
      dialog.querySelector('[data-sync-edit]').hidden = true;
      dialog.querySelector('[data-sync-jobs]').hidden = false;
      dialog.querySelector('.sync-year').hidden = false;
      dialog.querySelector('.sync-connection').hidden = false;
      dialog.querySelector('[data-sync-preview-button]').hidden = false;
    }
    function lock(value) {
      busy = value;
      dialog.querySelectorAll('input,select,button').forEach(control=>{
        control.disabled = value || (control.matches('[data-sync-tab]') && !jobs[Number(control.closest('[data-sync-job]').dataset.syncJob)]?.metadata);
      });
    }
    async function action(task) {
      if (busy) return;
      lock(true);
      try { await task(); } catch(error) { if(active()) message(dialog,error.message,true); }
      finally { if(active()) lock(false); }
    }
    async function headingCheck(i) {
      const job = jobs[i], box = field(i);
      job.heading = null;
      const book = await read(job.metadata.spreadsheetId,Number(box.querySelector('[data-sync-tab]').value));
      if(!active()) return;
      const inspection = engine.inspect({...job.source,schoolYear:schoolYear()},book,Number(box.querySelector('[data-sync-tab]').value));
      job.heading = inspection;
      const ack = `${inspection.officialSection}|${inspection.officialSubject}`;
      const remembered = job.binding.acknowledgedHeading === ack;
      box.querySelector('[data-sync-heading-check]').innerHTML = inspection.mismatches.length
        ? `<p>${inspection.mismatches.map(escape).join('<br>')}</p><label class="sync-ack"><input type="checkbox" data-sync-ack ${remembered?'checked':''}>I verified that these class and subject names identify the same class.</label>` : '';
      box.querySelector('[data-sync-job-status]').textContent = `${book.properties.title} · ${inspection.sheet.properties.title}. Template and school year checked.`;
    }
    async function check(i) {
      invalidate();
      const job = jobs[i], box = field(i), link = box.querySelector('[data-sync-link]').value.trim();
      job.metadata = null; job.heading = null;
      const parsed = engine.spreadsheetLink(link), book = await metadata(parsed.id);
      if(!active()) return;
      job.metadata = book;
      const tabs = book.sheets.filter(s=>s.properties.sheetType==='GRID'), select = box.querySelector('[data-sync-tab]');
      select.innerHTML = '<option value="">Choose the official subject tab</option>'+tabs.map(s=>`<option value="${s.properties.sheetId}">${escape(s.properties.title)}</option>`).join('');
      const candidate = tabs.find(s=>s.properties.sheetId === parsed.sheetId) || tabs.find(s=>s.properties.sheetId === job.binding.sheetId) || tabs.find(s=>engine.subjectKey(s.properties.title) === engine.subjectKey(job.source.section.subject));
      if(candidate){ select.value = String(candidate.properties.sheetId); await headingCheck(i); }
      else box.querySelector('[data-sync-job-status]').textContent = `${book.properties.title}. Choose your subject tab.`;
    }
    async function makePlans() {
      const live = liveSources(), selected = selectedJobs();
      if(!selected.length) throw new Error('Select at least one class with finished periods.');
      const plans = [];
      for(const job of selected){
        const i = jobs.indexOf(job), box = field(i), sheetValue = box.querySelector('[data-sync-tab]').value;
        if(!job.metadata || !sheetValue) throw new Error(`Check the official link and subject tab for ${job.source.section.subject} · ${job.source.section.section}.`);
        const link = engine.spreadsheetLink(box.querySelector('[data-sync-link]').value);
        if(link.id !== job.metadata.spreadsheetId) throw new Error('A gradesheet link changed. Check it again.');
        const source = live.find(s=>s.id === job.source.id);
        if(!source) throw new Error('The source class or completion status changed. Close and reopen this transfer.');
        const ack = box.querySelector('[data-sync-ack]')?.checked && job.heading ? `${job.heading.officialSection}|${job.heading.officialSubject}` : null;
        plans.push({...engine.plan(source,await read(link.id,Number(sheetValue)),Number(sheetValue),ack),acknowledgedHeading:ack});
      }
      engine.requests(plans); // Detect two classes targeting the same cells before any write.
      return plans;
    }
    dialog.querySelector('[data-sync-connect]').onclick = () => action(async()=>{
      invalidate();
      const email = await connect(dialog.querySelector('[data-sync-email]').value);
      if(!active())return;
      dialog.querySelector('[data-sync-account]').textContent = `Connected as ${email}`;
      dialog.querySelector('[data-sync-disconnect]').hidden = false;
      message(dialog,'School account connected. Check the official link for each selected class.');
      for (const job of selectedJobs()) {
        const i = jobs.indexOf(job);
        if (field(i).querySelector('[data-sync-link]').value.trim()) await check(i);
      }
    });
    dialog.querySelector('[data-sync-disconnect]').onclick = () => {
      epoch++; connection = null; invalidate();
      dialog.querySelector('[data-sync-account]').textContent = 'Disconnected. Connect your school account before reading or filling gradesheets.';
      dialog.querySelector('[data-sync-disconnect]').hidden = true;
    };
    dialog.querySelectorAll('[data-sync-check]').forEach(button=>button.onclick=()=>action(()=>check(Number(button.dataset.syncCheck))));
    dialog.querySelectorAll('[data-sync-tab]').forEach((select,i)=>select.onchange=()=>action(async()=>{invalidate();await headingCheck(i);}));
    dialog.addEventListener('input', event=>{
      if(event.target.matches('[data-sync-link],[data-sync-year],[data-sync-email],[data-sync-include],[data-sync-ack]')) invalidate();
      if(event.target.matches('[data-sync-link]')) { const job = jobs[Number(event.target.closest('[data-sync-job]').dataset.syncJob)];job.metadata=null;job.heading=null; }
    });
    dialog.querySelector('[data-sync-preview-button]').onclick = () => action(async()=>{
      invalidate(); message(dialog,'Matching completed periods and checking official cells…');
      const plans = await makePlans();
      if(!active())return;
      const count = plans.reduce((n,p)=>n+p.source.periods.length,0), changes=plans.reduce((n,p)=>n+p.changes.length*3,0), overwrites=plans.reduce((n,p)=>n+p.overwrites,0);
      const html = plans.map(p=>`<details class="sync-review"><summary>${escape(p.source.section.subject)} · ${escape(p.source.section.section)} · ${p.allRows.length} learner-period matches</summary><p>${escape(p.title)} → ${escape(p.sheetTitle)}</p><div class="sync-table-wrap"><table><caption>Full-precision weighted scores. Display rounded to three decimals.</caption><thead><tr><th>Learner</th><th>Quarter</th><th>Cells</th><th>WW</th><th>PT</th><th>QA</th><th>Existing WW / PT / QA</th></tr></thead><tbody>${p.allRows.map(r=>`<tr><th scope="row">${escape(r.name)}</th><td>${r.quarter}</td><td>C${r.row+1}:E${r.row+1}</td>${r.values.map(v=>`<td>${v.toFixed(3)}</td>`).join('')}<td>${r.before.map(v=>escape(v.numberValue ?? v.stringValue ?? 'blank')).join(' / ')}</td></tr>`).join('')}</tbody></table></div></details>`).join('');
      dialog.querySelector('[data-sync-preview]').innerHTML = `<h3>Review the transfer</h3><p>${count} finished periods selected across ${plans.length} class targets. ${changes} input cells will be written; ${overwrites} existing values will change. Names, other periods, formatting, and formulas are preserved.</p>${html}${overwrites?'<label class="sync-ack"><input type="checkbox" data-sync-overwrite>I reviewed the existing scores and approve replacing the values shown above.</label>':''}<p>Updates are atomic within each workbook. Separate workbooks are filled in sequence. Keep other editors out of these input cells while filling.</p>`;
      preview = {plans,source:JSON.stringify(plans.map(p=>p.source)),email:connection.email};
      dialog.querySelector('[data-sync-apply]').hidden = changes===0;
      dialog.querySelector('[data-sync-report]').hidden = false;
      dialog.querySelector('[data-sync-edit]').hidden = false;
      dialog.querySelector('[data-sync-jobs]').hidden = true;
      dialog.querySelector('.sync-year').hidden = true;
      dialog.querySelector('.sync-connection').hidden = true;
      dialog.querySelector('[data-sync-preview-button]').hidden = true;
      for(const job of selectedJobs()){
        const i=jobs.indexOf(job),box=field(i),plan=plans.find(p=>p.sourceId===job.source.id);
        const binding={link:box.querySelector('[data-sync-link]').value,sheetId:plan.sheetId,acknowledgedHeading:plan.acknowledgedHeading};
        try{localStorage.setItem(storageKey(owner,job.source,schoolYear()),JSON.stringify(binding));}catch(_){}
      }
      message(dialog,changes?'Preview ready. Review the matches before filling.':'All selected scores already match. Nothing needs to be written.');
      dialog.scrollTop = 0;
    });
    dialog.querySelector('[data-sync-edit]').onclick=()=>{invalidate();message(dialog,'Choose the classes and check their official links.');};
    dialog.querySelector('[data-sync-report]').onclick = () => {
      if(!preview)return;
      const report={createdAt:new Date().toISOString(),schoolAccount:preview.email,results:preview.results||[],targets:preview.plans.map(p=>({spreadsheetId:p.spreadsheetId,sheetId:p.sheetId,sheetTitle:p.sheetTitle,schoolYear:p.source.schoolYear,semester:p.source.semester,changes:p.changes}))};
      const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), link=document.createElement('a');
      link.href=url;link.download='official-gradesheet-change-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    };
    dialog.querySelector('[data-sync-apply]').onclick = () => action(async()=>{
      const reviewed=preview;
      if(!reviewed)throw new Error('Preview the completed periods first.');
      if(dialog.querySelector('[data-sync-overwrite]') && !dialog.querySelector('[data-sync-overwrite]').checked)throw new Error('Review and approve the existing scores before replacing them.');
      message(dialog,'Rechecking the source, names, cells, and school-account permissions…');
      const plans=await makePlans();
      if(!active())return;
      if(JSON.stringify(plans.map(p=>p.source))!==reviewed.source || connection?.email!==reviewed.email || plans.some((p,i)=>p.fingerprint!==reviewed.plans[i]?.fingerprint || p.sheetId!==reviewed.plans[i]?.sheetId || p.spreadsheetId!==reviewed.plans[i]?.spreadsheetId)){
        invalidate();throw new Error('The source or official gradesheet changed after preview. Create a fresh preview.');
      }
      const groups=new Map();
      for(const plan of plans){if(!groups.has(plan.spreadsheetId))groups.set(plan.spreadsheetId,[]);groups.get(plan.spreadsheetId).push(plan);}
      reviewed.results=[]; mutating=true;
      dialog.querySelector('[data-sync-apply]').hidden=true;
      try{
        for(const [id,group] of groups){
          if(!active())throw new Error('The class record account changed. Remaining workbooks were not filled.');
          const live = liveSources();
          if(plans.some(plan=>JSON.stringify(live.find(source=>source.id===plan.sourceId))!==JSON.stringify(plan.source))) throw new Error('A source class changed while filling. Create a fresh preview for remaining workbooks.');
          const updates=engine.requests(group);
          if(!updates.length){reviewed.results.push({id,status:'already matched'});continue;}
          // Recheck this workbook immediately before its atomic batch. There is
          // no Sheets compare-and-swap primitive; never claim a transaction across files.
          for(const plan of group){
            const fresh=engine.plan(plan.source,await read(id,plan.sheetId),plan.sheetId,plan.acknowledgedHeading);
            if(fresh.fingerprint!==plan.fingerprint)throw new Error('An official workbook changed while another was filled. Preview remaining work again.');
          }
          message(dialog,`Filling ${group[0].title}…`);
          let writeError;
          try{await api(`${id}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:updates})});}catch(error){writeError=error;}
          // A failed network response can follow a committed batch. Read back,
          // never blindly retry a write with an uncertain result.
          let verified=false;
          try{verified=true;for(const plan of group)if(!engine.verify(plan,await read(id,plan.sheetId)))verified=false;}catch(_){verified=false;}
          reviewed.results.push({id,status:verified?'filled and verified':'not verified'});
          if(!verified)throw new Error(`${group[0].title}: the update could not be verified. ${writeError?.message || 'The readback differs from the preview.'} Stop and check this workbook before retrying. Remaining workbooks were not filled.`);
        }
        message(dialog,`Finished: ${reviewed.results.length} workbook${reviewed.results.length===1?'':'s'} checked. Every selected WW/PT/QA value was read back and verified.`);
      }catch(error){message(dialog,`${error.message} Results: ${reviewed.results.map(r=>`${r.id}: ${r.status}`).join('; ')||'No workbook verified.'}`,true);}
      finally{mutating=false;dialog.querySelector('[data-sync-preview-button]').textContent='Create a fresh preview';dialog.querySelector('[data-sync-preview-button]').hidden=false;preview=reviewed;}
    });
    dialog.querySelector('[data-sync-close]').onclick=()=>dialog.close();
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>{stopped=true;if(currentDialog===dialog)currentDialog=null;dialog.remove();},{once:true});
    const beforeUnload=event=>{if(mutating){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',beforeUnload);
    dialog.addEventListener('close',()=>window.removeEventListener('beforeunload',beforeUnload),{once:true});
    dialog.showModal();
    if(connection?.owner === owner && connection.expires > Date.now()) void action(async()=>{
      for(const job of selectedJobs()){
        const i=jobs.indexOf(job);
        if(field(i).querySelector('[data-sync-link]').value.trim())await check(i);
      }
    });
  }
  let observedOwner = currentOwner();
  window.CSTRSync?.onAuthStateChanged(user=>{if(user?.uid!==observedOwner){reset();observedOwner=user?.uid;}});
  window.addEventListener('pagehide',reset);
  window.CSTROfficialSync = {open,reset};
})();
