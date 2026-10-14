(() => {
  "use strict";
  const pending = new Map();
  const groups = { excel: ["xlsx.min.js", "jszip.min.js"], pdf: ["pdf-lib.min.js", "fontkit.umd.min.js"], word: ["docx.iife.js"] };
  function load(file) {
    if (!pending.has(file)) pending.set(file, new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "ASSETS/vendor/" + file;
      script.onload = resolve; script.onerror = () => { pending.delete(file); script.remove(); reject(new Error("Could not load export tools. Check your connection and try again.")); };
      document.head.append(script);
    }));
    return pending.get(file);
  }
  window.CSTRAssets = { async ensure(group) { if (!groups[group]) throw new Error("Unknown export format"); for (const file of groups[group]) await load(file); } };
})();
