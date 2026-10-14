(() => {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = bytes => { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); };
  const un64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function key(password, salt) {
    const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:600000, hash:"SHA-256"}, material, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
  }
  function validate(value) {
    if (!value || value.version !== 4 || !value.teacher || typeof value.teacher !== "object" || Array.isArray(value.teacher)) throw new Error("Unsupported class-record backup.");
    for (const k of ["registry", "registryTri"]) if (value[k] != null && !Array.isArray(value[k])) throw new Error("Invalid class registry.");
    for (const k of ["sections", "sectionsTri"]) if (value[k] != null && (typeof value[k] !== "object" || Array.isArray(value[k]))) throw new Error("Invalid class sections.");
    for (const [registryKey, sectionsKey] of [["registry","sections"],["registryTri","sectionsTri"]]) {
      const registry=value[registryKey]||[]; const sections=value[sectionsKey]||{}; const ids=new Set();
      if(registry.length>1000)throw new Error("Backup contains too many classes.");
      for(const section of registry){
        if(!section||typeof section!=="object"||typeof section.id!=="string"||!section.id||/[.#$\[\]/]/.test(section.id)||ids.has(section.id))throw new Error("Invalid or duplicate class identifier.");
        ids.add(section.id);
        if(typeof section.subject!=="string" || !["JHS","SHS"].includes(section.group) || (section.section!=null && typeof section.section!=="string") || (section.level!=null && typeof section.level!=="string"))throw new Error("Invalid class details.");
        if(!Array.isArray(section.weights)||section.weights.length!==3||section.weights.some(w=>typeof w!=="number"||!Number.isFinite(w)||w<0||w>100)||Math.abs(section.weights.reduce((a,b)=>a+b,0)-100)>.001)throw new Error("Invalid assessment weights.");
        const bucket=sections[section.id];if(!bucket||!Array.isArray(bucket.periods)||!bucket.periods.length||bucket.periods.length>100)throw new Error("Invalid grading periods.");
        for(const period of bucket.periods){
          if(!period||!Array.isArray(period.roster)||period.roster.length>10000)throw new Error("Invalid learner roster.");
          for(const kind of ["ww","pt","qa"]){if(!Array.isArray(period[kind+"Dates"])||!Array.isArray(period[kind+"Hps"])||period[kind+"Dates"].length>1000||period[kind+"Dates"].length!==period[kind+"Hps"].length)throw new Error("Invalid assessment columns.");}
          for(const learner of period.roster)if(!learner||typeof learner.name!=="string"||["ww","pt","qa"].some(k=>!Array.isArray(learner[k])||learner[k].length!==period[k+"Dates"].length))throw new Error("Invalid learner scores.");
        }
      }
    }
    const walk = (v, depth=0) => { if (depth > 30) throw new Error("Backup is too deeply nested."); if (v && typeof v === "object") for (const k of Object.keys(v)) { if (["__proto__","constructor","prototype"].includes(k)) throw new Error("Unsafe backup property."); walk(v[k],depth+1); } };
    walk(value); return value;
  }
  async function encrypt(value, password) {
    validate(value); if (password.length < 12) throw new Error("Use at least 12 characters for the backup passphrase.");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({name:"AES-GCM",iv}, await key(password,salt),enc.encode(JSON.stringify(value)));
    return {format:"CSTR-encrypted-backup",version:1,algorithm:"AES-256-GCM",kdf:"PBKDF2-SHA256",iterations:600000,salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)};
  }
  async function decrypt(envelope,password) {
    if (envelope.format !== "CSTR-encrypted-backup" || envelope.version !== 1 || envelope.iterations !== 600000 || envelope.algorithm !== "AES-256-GCM" || envelope.kdf !== "PBKDF2-SHA256") throw new Error("Unsupported backup format.");
    const salt=un64(envelope.salt),iv=un64(envelope.iv); if(salt.length!==16||iv.length!==12) throw new Error("Invalid backup header.");
    try { return validate(JSON.parse(dec.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv},await key(password,salt),un64(envelope.ciphertext))))); }
    catch (_) { throw new Error("Unable to restore: incorrect passphrase, damaged file, or invalid record."); }
  }
  function askPassword(confirmAgain=false) {
    return new Promise(resolve => {
      const dialog=document.createElement("dialog"); dialog.className="modal backup-dialog";
      dialog.innerHTML='<form method="dialog"><h2>Encrypted backup passphrase</h2><p>Use at least 12 characters. Store it safely: the developer cannot recover it.</p><label>Passphrase<input name="passphrase" type="password" autocomplete="off" minlength="12" required></label>'+(confirmAgain?'<label>Confirm passphrase<input name="confirmation" type="password" autocomplete="off" required></label>':'')+'<p role="alert"></p><div class="stack-actions"><button type="button" class="button button-secondary" data-cancel>Cancel</button><button class="button button-primary" type="submit">Continue</button></div></form>';
      for(const type of ["keydown","copy","cut","paste"]) dialog.addEventListener(type,event=>event.stopPropagation());
      document.body.append(dialog); dialog.showModal();
      dialog.querySelector("input").focus();
      dialog.querySelector("[data-cancel]").onclick=()=>dialog.close();
      dialog.querySelector("form").onsubmit=e=>{e.preventDefault();const form=e.target;if(confirmAgain&&form.passphrase.value!==form.confirmation.value){dialog.querySelector('[role="alert"]').textContent="Passphrases do not match.";return;}dialog.returnValue=form.passphrase.value;dialog.close();};
      dialog.onclose=()=>{const result=dialog.returnValue||null;dialog.remove();resolve(result);};
    });
  }
  window.CSTRBackup = { encrypt, decrypt, validate,
    async download(value) {
      const password=await askPassword(true); if(!password)return;
      const data=await encrypt(value,password);const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download="CSTR-backup-"+new Date().toISOString().replace(/[:.]/g,"-")+".cstrbackup";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    },
    async importFile() {
      const file=await new Promise(resolve=>{const input=document.createElement("input");input.type="file";input.accept=".cstrbackup";input.onchange=()=>resolve(input.files[0]||null);input.oncancel=()=>resolve(null);input.click();});
      if(!file)return null;if(file.size>25000000)throw new Error("Backup exceeds the 25 MB import limit.");
      const envelope=JSON.parse(await file.text());const password=await askPassword();if(!password)return null;return decrypt(envelope,password);
    }
  };
})();
