/* Fill the school's native OOXML template. Do not round-trip it through a cell
   serializer: that drops its logo, print settings, validation and native styles.
   All learner text is written as text, never interpreted as a formula. */
(function (root) {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const parse = xml => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid school template XML.');
    return doc;
  };
  const serialize = doc => new XMLSerializer().serializeToString(doc);
  const col = index => { let text = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text; return text; };
  const colIndex = letters => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const address = value => { const match = /^([A-Z]+)(\d+)$/.exec(value); if (!match) throw new Error('Invalid cell address.'); return { c: colIndex(match[1]), r: Number(match[2]) }; };
  const el = (doc, name, attrs = {}) => { const node = doc.createElementNS(NS, name); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v))); return node; };
  const present = value => value !== null && value !== undefined && String(value).trim() !== '';
  const sum = terms => terms.length ? `SUM(${terms.join(',')})` : '0';
  const roleLabel = role => ({ st1: 'ST1', st2: 'ST2', te: 'TE', cognitive: 'Cognitive', affective: 'Affective', behavioral: 'Behavioral' })[role] || '';

  function validate(payload) {
    const { section, period } = payload;
    if (!section || !period || !Array.isArray(period.roster)) throw new Error('Open a class record first.');
    if (!Array.isArray(section.weights) || section.weights.length !== 3 || section.weights.some(w => typeof w !== 'number' || !Number.isFinite(w) || w < 0) || Math.abs(sumNumbers(section.weights) - 100) > 1e-8) throw new Error('Subject weights must total 100%.');
    const issue = root.CSTRGrading.gradingIssue(section); if(issue)throw new Error(issue);
    for (const kind of ['ww', 'pt', 'qa']) {
      const hps = period[kind + 'Hps'], dates = period[kind + 'Dates'];
      if (!Array.isArray(hps) || !Array.isArray(dates) || hps.length !== dates.length) throw new Error('Assessment columns are inconsistent.');
      if (hps.length > 1000) throw new Error('Too many assessment columns.');
      for (const learner of period.roster) {
        if (!Array.isArray(learner[kind]) || learner[kind].length !== hps.length) throw new Error('Learner scores and assessment columns do not align.');
      }
      if (section.weights[['ww','pt','qa'].indexOf(kind)] === 0) continue;
      const options = root.CSTRGrading.componentOptions(section, period, kind);
      hps.forEach((value, index) => {
        if (present(value) && (root.CSTRGrading.numberOrNull(value) === null || Number(value) <= 0)) throw new Error(`${kind.toUpperCase()} ${index + 1}: enter a positive HPS.`);
        if (present(value) && options.groups && !options.groups.some(g => g.id === options.roles[index])) throw new Error(`${kind.toUpperCase()} ${index + 1}: select its assessment group or domain in the activity register.`);
      });
      for (const learner of period.roster) {
        if (root.CSTRRecordTools?.getRowCategory(learner)) continue;
        learner[kind].forEach((value, index) => {
          if (!present(value)) return;
          const maximum = root.CSTRGrading.numberOrNull(hps[index]);
          if (maximum === null || maximum <= 0) throw new Error(`${kind.toUpperCase()} ${index + 1}: a score has no positive HPS.`);
          if (root.CSTRGrading.isAttendanceCode(value)) return;
          const number = root.CSTRGrading.numberOrNull(value);
          if (number === null || number < 0 || number > maximum) throw new Error(`${kind.toUpperCase()} ${index + 1}: a score is outside zero to HPS.`);
        });
      }
    }
    if (period.roster.length > 10000) throw new Error('Too many learner rows.');
  }
  const sumNumbers = list => list.reduce((total, value) => total + value, 0);

  // SUMIF and SUMPRODUCT evaluate ranges natively without Ctrl+Shift+Enter.
  // Compact ranges keep formulas within Excel's 8,192-character limit even
  // when a teacher adds many activities. There is no N(range) array coercion.
  function groupTerms(columns, row) {
    const segments = [];
    for (const c of columns) {
      const last = segments[segments.length-1];
      if (last && last[1]+1===c) last[1]=c; else segments.push([c,c]);
    }
    const terms = segments.map(([start,end]) => {
      const scores = `${col(start)}${row}:${col(end)}${row}`, hps = `${col(start)}$18:${col(end)}$18`;
      const invalid = `COLUMNS(${scores})-COUNT(${scores})-COUNTBLANK(${scores})-COUNTIF(${scores},"A")-COUNTIF(${scores},"M")-COUNTIF(${scores},"E")-COUNTIF(${scores},"L")+COLUMNS(${hps})-COUNT(${hps})-COUNTBLANK(${hps})+SUMPRODUCT(--ISNUMBER(${hps}),--(${hps}<=0))+SUMPRODUCT(--ISNUMBER(${scores}),--(${scores}<0))+SUMPRODUCT(--ISNUMBER(${scores}),--(${scores}>${hps}))+SUMPRODUCT(--(${scores}<>""),--(${hps}=""))`;
      return { configured:`SUM(${hps})`,denominator:`SUM(${hps})-SUMIF(${scores},"E",${hps})-SUMIF(${scores},"L",${hps})`,numerator:`SUM(${scores})`,invalid };
    });
    return Object.fromEntries(['configured','denominator','numerator','invalid'].map(key => [key,sum(terms.map(term=>`(${term[key]})`))]));
  }

  async function build(payload, options = {}) {
    if (!root.JSZip || !root.CSTRGrading) throw new Error('School Excel export tools are unavailable.');
    validate(payload);
    const { section, period } = payload, metadata = payload.metadata || {};
    const input = options.templateBytes || await (async () => {
      const response = await fetch(new URL('ASSETS/templates/cstr-class-record.xlsx?v=20261025', document.baseURI));
      if (!response.ok) throw new Error('The school Excel template could not be loaded. Refresh and retry.');
      return response.arrayBuffer();
    })();
    const zip = await root.JSZip.loadAsync(input);
    const doc = parse(await zip.file('xl/worksheets/sheet1.xml').async('string'));
    const sheet = doc.documentElement, sheetData = sheet.getElementsByTagNameNS(NS, 'sheetData')[0];
    const original = options.preserveInputs === true;
    const lengths = { ww: period.wwHps.length, pt: period.ptHps.length, qa: period.qaHps.length };
    const added = { ww: Math.max(0, lengths.ww - 10), pt: Math.max(0, lengths.pt - 8), qa: Math.max(0, lengths.qa - 3) };
    const mapCol = c => c + (c >= 12 ? added.ww : 0) + (c >= 22 ? added.pt : 0) + (c >= 27 ? added.qa : 0);
    const extraRows = Math.max(0, period.roster.length - 45), mapRow = r => r + (r >= 64 ? extraRows : 0);
    const mapRef = ref => ref.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (_, ac, c, ar, r) => `${ac}${col(mapCol(colIndex(c)))}${ar}${mapRow(Number(r))}`);
    const lastLearnerRow = 63 + extraRows, lastCol = mapCol(34);
    // Remove the source file's unused formatting-only tail before cloning.
    for(const row of [...sheetData.children])if(Number(row.getAttribute('r'))>82)row.remove();
    const baseRows = new Map([...sheetData.children].map(row => [Number(row.getAttribute('r')), row.cloneNode(true)]));
    const oldMerges = [...sheet.getElementsByTagNameNS(NS, 'mergeCell')].map(node => node.getAttribute('ref'));
    const originalStyles = new Map([...sheet.getElementsByTagNameNS(NS, 'c')].map(c => [c.getAttribute('r'), c.getAttribute('s')]));
    // Map all native cell positions and view/range properties before adding data.
    for (const row of [...sheetData.children]) {
      const oldRow = Number(row.getAttribute('r'));
      if (oldRow > 82) { row.remove(); continue; }
      row.setAttribute('r', mapRow(oldRow)); row.removeAttribute('spans');
      for (const c of [...row.children]) c.setAttribute('r', mapRef(c.getAttribute('r')));
    }
    for (const node of sheet.querySelectorAll('[ref],[sqref],[activeCell],[topLeftCell]')) {
      for (const attr of ['ref', 'sqref', 'activeCell', 'topLeftCell']) if (node.hasAttribute(attr)) node.setAttribute(attr, mapRef(node.getAttribute(attr)));
    }
    const rows = new Map([...sheetData.children].map(row => [Number(row.getAttribute('r')), row]));
    let cells;
    function ensureRow(r, sourceRow) {
      if (rows.has(r)) return rows.get(r);
      const node = sourceRow ? baseRows.get(sourceRow).cloneNode(true) : el(doc, 'row');
      node.setAttribute('r', r); node.removeAttribute('hidden'); node.removeAttribute('spans');
      for (const c of [...node.children]) {
        const originalAddress = address(c.getAttribute('r'));
        c.setAttribute('r', `${col(mapCol(originalAddress.c))}${r}`);
        [...c.children].forEach(n => n.remove()); c.removeAttribute('t');
      }
      rows.set(r, node);
      if(cells) for(const c of [...node.children]) cells.set(c.getAttribute('r'),c);
      return node;
    }
    for (let r = 64; r <= lastLearnerRow; r++) ensureRow(r, 57);
    cells = new Map([...rows.values()].flatMap(row => [...row.children].map(c => [c.getAttribute('r'), c])));
    function cell(c, r, style) {
      const key = `${col(c)}${r}`;
      if (!cells.has(key)) {
        const node = el(doc, 'c', { r: key }); if (style !== undefined && style !== null) node.setAttribute('s', style);
        ensureRow(r).appendChild(node); cells.set(key, node);
      }
      return cells.get(key);
    }
    function write(c, r, value, formula) {
      const node = cell(c, r);
      [...node.children].forEach(n => n.remove()); node.removeAttribute('t');
      if (formula !== undefined) {
        const f = el(doc, 'f'); f.textContent = formula; node.appendChild(f);
        const v = el(doc, 'v');
        if (typeof value !== 'number' || !Number.isFinite(value)) { node.setAttribute('t', 'str'); v.textContent = value == null ? '' : String(value); }
        else v.textContent = String(value);
        node.appendChild(v);
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        const v = el(doc, 'v'); v.textContent = String(value); node.appendChild(v);
      } else if (present(value)) {
        node.setAttribute('t', 'inlineStr'); const inline = el(doc, 'is'), t = el(doc, 't');
        t.setAttribute('xml:space', 'preserve'); t.textContent = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); inline.appendChild(t); node.appendChild(inline);
      }
    }
    const W = (oldCol, oldRow, value, formula) => write(mapCol(colIndex(oldCol)), mapRow(oldRow), value, formula);
    const rawColumns = { ww: Array.from({ length: Math.max(10, lengths.ww) }, (_, i) => 2 + i), pt: Array.from({ length: Math.max(8, lengths.pt) }, (_, i) => mapCol(14) + i), qa: Array.from({ length: Math.max(3, lengths.qa) }, (_, i) => mapCol(24) + i) };
    // New score columns inherit the corresponding native raw-score style.
    for (const [kind, columns] of Object.entries(rawColumns)) {
      const sourceCol = { ww: 'K', pt: 'V', qa: 'AA' }[kind];
      for (let r = 14; r <= lastLearnerRow; r++) {
        const sourceR = Math.min(r, 57);
        for (const c of columns) cell(c, r, originalStyles.get(`${sourceCol}${sourceR}`) || originalStyles.get(`${sourceCol}19`));
      }
    }
    const stylesDoc=parse(await zip.file('xl/styles.xml').async('string'));
    const cellXfs=stylesDoc.getElementsByTagNameNS(NS,'cellXfs')[0],dateStyles=new Map();
    let numFmts=stylesDoc.getElementsByTagNameNS(NS,'numFmts')[0];
    if(!numFmts){numFmts=el(stylesDoc,'numFmts',{count:0});stylesDoc.documentElement.insertBefore(numFmts,stylesDoc.documentElement.firstChild);}
    function writeDate(c,r,value,format){
      const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
      if(!match){write(c,r,value);return;}
      const time=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]));
      if(new Date(time).toISOString().slice(0,10)!==value){write(c,r,value);return;}
      write(c,r,(time-Date.UTC(1899,11,30))/86400000);
      const node=cell(c,r),base=Number(node.getAttribute('s')||0),key=base+'|'+format;
      if(!dateStyles.has(key)){
        const numFmtId=Math.max(163,...[...numFmts.children].map(n=>Number(n.getAttribute('numFmtId'))))+1;
        numFmts.appendChild(el(stylesDoc,'numFmt',{numFmtId,formatCode:format}));numFmts.setAttribute('count',numFmts.children.length);
        const clone=cellXfs.children[base].cloneNode(true);clone.setAttribute('numFmtId',numFmtId);clone.setAttribute('applyNumberFormat','1');
        dateStyles.set(key,cellXfs.children.length);cellXfs.appendChild(clone);
      }
      node.setAttribute('s',dateStyles.get(key));
    }
    const rowHasData = learner => present(learner?.name) || ['ww','pt','qa'].some(k => (learner?.[k] || []).some(present));
    const lastUsedIndex = period.roster.reduce((last, learner, index) => rowHasData(learner) ? index : last, -1);
    for (let r = 19; r <= lastLearnerRow; r++) {
      const row = ensureRow(r);
      if (r - 19 <= lastUsedIndex) row.removeAttribute('hidden');
      if (!original) for (let c = 0; c <= lastCol; c++) write(c, r, '');
    }
    if (!original) {
      W('AG', 11, metadata.schoolYear || '');
      W('A', 13, period.name || ''); W('H', 13, `${section.level || ''}${section.section ? ' - ' + section.section : ''}`);
      W('O', 13, metadata.teacherName || ''); W('AG', 13, section.subject || '');
      W('B', 68, metadata.teacherName || ''); W('C', 68, metadata.checkerName || ''); W('O', 68, metadata.reviewerName || ''); W('Y', 68, metadata.principalName || '');
      W('B', 69, 'Subject Teacher'); W('C', 69, 'Subject Area Coordinator');
      W('O', 69, section.group === 'SHS' ? 'SHS Coordinator' : 'JHS Coordinator');
      let number = 0;
      period.roster.forEach((learner, index) => {
        const r = 19 + index, category = root.CSTRRecordTools?.getRowCategory(learner);
        write(0, r, present(learner.name) && !category ? ++number : ''); write(1, r, learner.name || '');
        if (category) return;
        for (const kind of ['ww','pt','qa']) learner[kind].forEach((value, i) => write(rawColumns[kind][i], r, root.CSTRGrading.isAttendanceCode(value) ? String(value).trim().toUpperCase() : root.CSTRGrading.numberOrNull(value) ?? (present(value) ? value : '')));
      });
    }
    const weights = section.weights, rules = root.CSTRGrading.subjectRules(section.gradingCategory || section.subject), teOnly = rules.examMode === 'te-only';
    W('C', 14, `WRITTEN WORKS (${weights[0]}%)`, `"WRITTEN WORKS ("&TEXT(${col(mapCol(13))}$18,"0%")&")"`); W('O', 14, `PERFORMANCE TASK (${weights[1]}%)`, `"PERFORMANCE TASK ("&TEXT(${col(mapCol(23))}$18,"0%")&")"`);
    W('Y', 14, `${payload.calendarMode === 'trimester' ? 'TERM' : 'QUARTERLY'} ASSESSMENT (${weights[2]}%)`, `"${payload.calendarMode === 'trimester' ? 'TERM' : 'QUARTERLY'} ASSESSMENT ("&TEXT(${col(mapCol(31))}$18,"0%")&")"`);
    W('C', 15, `Activities/Exercises\n${weights[0]}%`, `"Activities/Exercises"&CHAR(10)&TEXT(${col(mapCol(13))}$18,"0%")`); W('O', 15, `Performance Check/Performance Tasks\n${weights[1]}%`, `"Performance Check/Performance Tasks"&CHAR(10)&TEXT(${col(mapCol(23))}$18,"0%")`);
    W('AH', 14, section.gradingMode === 'zero-based' ? 'REPORTED GRADE' : 'TRANSMUTED GRADE');
    for (const [key, value] of [['N',weights[0]/100],['X',weights[1]/100],['AF',weights[2]/100],['AB',teOnly?0:.3],['AC',teOnly?0:.3],['AD',teOnly?1:.4],['AE',100]]) W(key,18,value);
    for (const [c, text] of [['AB',`WS ST1\n(${teOnly?0:30}%)`],['AC',`WS ST2\n(${teOnly?0:30}%)`],['AD',`WS TE\n(${teOnly?100:40}%)`]]) W(c,15,text);
    for (const kind of ['ww','pt','qa']) {
      rawColumns[kind].forEach((c, index) => {
        const value = period[kind + 'Hps'][index];
        if (!original) write(c,18,root.CSTRGrading.numberOrNull(value) ?? '');
        if (kind !== 'qa') { if (!original) writeDate(c,17,period[kind + 'Dates'][index] || '', 'm/d'); }
        else {
          const role = period.activityMeta?.qa?.[index]?.role || root.CSTRGrading.defaultRole('qa',index,section.gradingCategory || section.subject);
          write(c,15,[roleLabel(role) || `EX ${index+1}`, period.qaDates[index] || '', {st1:'Long Quiz / Unit Test / Chapter Test',st2:'Monthly Exam',te:payload.calendarMode==='trimester'?'Term Exam':'Quarterly Exam'}[role] || ''].filter(Boolean).join('\n'));
        }
      });
    }
    const totalCols = { ww: mapCol(12), pt: mapCol(22) }, wsCols = { ww: mapCol(13), pt: mapCol(23), qa: mapCol(31) };
    for (const kind of ['ww','pt']) {
      const columns = rawColumns[kind], hpsTotal = sum(columns.map(c => `${col(c)}18`));
      write(totalCols[kind],18, sumNumbers(period[kind+'Hps'].map(x => root.CSTRGrading.numberOrNull(x)||0)),hpsTotal);
    }
    const preset=root.CSTRGrading.SUBJECT_PRESETS.find(item=>item.name===(section.gradingCategory||section.subject));
    const fixedWeights=preset ? [['N',weights[0]/100],['X',weights[1]/100],['AF',weights[2]/100]] : [];
    if(weights[2]>0)fixedWeights.push(['AB',teOnly?0:.3],['AC',teOnly?0:.3],['AD',teOnly?1:.4]);
    const subjectWeightGuard=fixedWeights.map(([c,value])=>`ABS(${col(mapCol(colIndex(c)))}$18-${value})>0.0000000001`);
    const tierFormula = ref => root.CSTRGrading.TRANSMUTATION_TABLE.slice(0,-1).reduceRight((tail,tier) => `IF(ROUND(${ref},12)>=${tier.min},${tier.grade},${tail})`,'60');
    const resultCells = [];
    for (let r = 19; r <= lastLearnerRow; r++) {
      const learner = period.roster[r-19] || { name:'', ww:[],pt:[],qa:[] };
      const category = root.CSTRRecordTools?.getRowCategory(learner);
      if (category) continue;
      const result = root.CSTRGrading.calculateLearner(learner,period,section), named = present(learner.name);
      const setFormula = (c,f,v) => { if(f.length>8192)throw new Error('Excel formula length exceeded. Keep activities from the same assessment group adjacent, or reduce the number of columns.'); write(c,r,named ? v : '',f); resultCells.push(`${col(c)}${r}`); };
      if(!original){
        const headingCells=period.roster.slice(0,r-18).flatMap((item,index)=>root.CSTRRecordTools?.getRowCategory(item)?[`$B${19+index}`]:[]);
        const numbering=`SUMPRODUCT(--($B$19:$B${r}<>""))${headingCells.length?'-'+sum(headingCells.map(ref=>`IF(${ref}<>"",1,0)`)):''}`;
        const cache=period.roster.slice(0,r-18).filter(item=>present(item.name)&&!root.CSTRRecordTools?.getRowCategory(item)).length;
        setFormula(0,`IF($B${r}="","",${numbering})`,cache);
      }
      for (const kind of ['ww','pt']) {
        const columns = rawColumns[kind], t = groupTerms(columns,r), component = result[kind];
        setFormula(totalCols[kind],`IF($B${r}="","",${sum(columns.map(c=>`${col(c)}${r}`))})`,component.rawTotal);
        let percentage, denominator;
        const options = root.CSTRGrading.componentOptions(section,period,kind);
        if (options.groups) {
          const terms = options.groups.map(g=>({...g,...groupTerms(columns.filter((_,i)=>options.roles[i]===g.id),r)}));
          denominator=sum(terms.map(g=>`IF(${g.denominator}>0,${g.share},0)`));
          percentage=`IF(OR(${terms.map(g=>`${g.configured}=0`).join(',')}),"",IF(${denominator}=0,"",${sum(terms.map(g=>`IF(${g.denominator}>0,${g.numerator}/${g.denominator}*100*${g.share},0)`))}/${denominator}))`;
        } else percentage=`IF(${t.denominator}=0,"",${col(totalCols[kind])}${r}/${t.denominator}*100)`;
        const ws=`${col(wsCols[kind])}$18`;
        const weighted = options.groups
          ? `IF(OR(${options.groups.map(g=>`${groupTerms(columns.filter((_,i)=>options.roles[i]===g.id),r).configured}=0`).join(',')}),"",IF(${denominator}=0,"",(${percentage})*${ws}))`
          : `IF(${t.denominator}=0,"",${col(totalCols[kind])}${r}/${t.denominator}*100*${ws})`;
        setFormula(wsCols[kind],`IF($B${r}="","",IF(${ws}=0,0,IF(${t.invalid}>0,NA(),${weighted})))`,component.weighted);
      }
      const qaOptions=root.CSTRGrading.componentOptions(section,period,'qa');
      const qaGroups=(teOnly?['te']:['st1','st2','te']).map(role=>({role,...groupTerms(rawColumns.qa.filter((_,i)=>qaOptions.roles[i]===role),r)}));
      const qaCellRefs=[];
      for(const [i,role] of ['st1','st2','te'].entries()) {
        const c=mapCol(27+i),g=qaGroups.find(g=>g.role===role),weight=`${col(c)}$18`,ref=`${col(c)}${r}`;
        qaCellRefs.push(ref);
        let cache='';
        if(g&&weights[2]>0){const item=result.qa.groups?.find(g=>g.id===role);if(item?.percentage!=null)cache=item.percentage*(teOnly?1:[.3,.3,.4][i]);}
        setFormula(c,`IF($B${r}="","",IF(${col(wsCols.qa)}$18=0,"",${g?`IF(${g.invalid}>0,NA(),IF(${g.denominator}=0,"",${g.numerator}/${g.denominator}*100*${weight}))`:'""'}))`,cache);
      }
      const activeShare=sum(qaCellRefs.map((ref,i)=>`IF(ISNUMBER(${ref}),${col(mapCol(27+i))}$18,0)`));
      const qaReady=qaGroups.map(g=>`${g.configured}>0`).join(',');
      const qaPS=`IF(AND(${qaReady||'FALSE'}),IF(${activeShare}=0,"",SUM(${qaCellRefs.join(',')})/${activeShare}),"")`;
      setFormula(mapCol(30),`IF($B${r}="","",IF(${col(wsCols.qa)}$18=0,"",${qaPS}))`,result.qa.percentage);
      setFormula(wsCols.qa,`IF($B${r}="","",IF(${col(wsCols.qa)}$18=0,0,IF(ISNUMBER(${col(mapCol(30))}${r}),${col(mapCol(30))}${r}*${col(wsCols.qa)}$18,"")))`,result.qa.weighted);
      const wsRefs=Object.values(wsCols).map(c=>`${col(c)}${r}`), ig=`${col(mapCol(32))}${r}`, grade=`${col(mapCol(33))}${r}`;
      setFormula(mapCol(32),`IF($B${r}="","",IF(OR(COUNT(${Object.values(wsCols).map(c=>`${col(c)}$18`).join(',')})<>3,ABS(SUM(${Object.values(wsCols).map(c=>`${col(c)}$18`).join(',')})-1)>0.00000001${subjectWeightGuard.length?','+subjectWeightGuard.join(','):''}),NA(),IF(COUNT(${wsRefs.join(',')})=3,SUM(${wsRefs.join(',')}),"")))`,result.initial.precise);
      setFormula(mapCol(33),`IF(ISNUMBER(${ig}),${section.gradingMode==='zero-based'?`ROUND(ROUND(${ig},12),0)`:tierFormula(ig)},"")`,result.initial.transmuted);
      setFormula(mapCol(34),`IF(ISNUMBER(${grade}),IF(${grade}>=90,"Advancing",IF(${grade}>=80,"Benchmarking",IF(${grade}>=75,"Connecting",IF(${grade}>=65,"Developing","Emerging")))),"")`,result.initial.transmuted===null?'':result.initial.descriptor);
    }
    // Append wrapping variants; all original style IDs remain unchanged.
    const wrappedStyles=new Map();
    function wrapCell(c,r) {
      const node=cell(c,r),baseStyle=Number(node.getAttribute('s')||0);
      if(!wrappedStyles.has(baseStyle)){
        const clone=cellXfs.children[baseStyle].cloneNode(true);let alignment=clone.getElementsByTagNameNS(NS,'alignment')[0];
        if(!alignment){alignment=el(stylesDoc,'alignment');clone.appendChild(alignment);}
        alignment.setAttribute('wrapText','1');clone.setAttribute('applyAlignment','1');
        wrappedStyles.set(baseStyle,cellXfs.children.length);cellXfs.appendChild(clone);
      }
      node.setAttribute('s',wrappedStyles.get(baseStyle));
    }
    if(!original){
      for(let r=19;r<=lastLearnerRow;r++){
        const learner=period.roster[r-19];if(!learner)continue;
        wrapCell(1,r);
        const lines=String(learner.name||'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/29)),0);
        if(lines>1){ensureRow(r).setAttribute('ht',Math.max(16.2,lines*14));ensureRow(r).setAttribute('customHeight','1');}
      }
      for(const c of ['H','O','AG'].map(c=>mapCol(colIndex(c))))wrapCell(c,13);
      const headerLines=Math.max(1,Math.ceil(String(section.subject||'').length/38),Math.ceil(String(metadata.teacherName||'').length/50),Math.ceil(String(section.level+' '+section.section).length/25));
      if(headerLines>1){ensureRow(13).setAttribute('ht',Math.max(28.5,headerLines*14+3));ensureRow(13).setAttribute('customHeight','1');}
      for(const c of ['B','C','O','Y'].map(c=>mapCol(colIndex(c))))wrapCell(c,mapRow(68));
      const signatureLines=Math.max(1,Math.ceil(String(metadata.teacherName||'').length/29),...['checkerName','reviewerName','principalName'].map(k=>Math.ceil(String(metadata[k]||'').length/45)));
      if(signatureLines>1){ensureRow(mapRow(68)).setAttribute('ht',signatureLines*14);ensureRow(mapRow(68)).setAttribute('customHeight','1');}
    }
    // Preserve the native merges, extending only for extra score/learner columns.
    const merges=sheet.getElementsByTagNameNS(NS,'mergeCells')[0];
    const mergeRefs=oldMerges.map(mapRef);
    for(let i=3;i<rawColumns.qa.length;i++)mergeRefs.push(`${col(rawColumns.qa[i])}15:${col(rawColumns.qa[i])}17`);
    const register={};
    for(const kind of ['ww','pt','qa'])register[kind]=period[kind+'Hps'].flatMap((hps,index)=>{
      const meta=period.activityMeta?.[kind]?.[index]||{},date=period[kind+'Dates'][index]||'';
      if(!present(hps)&&!present(date)&&!['title','topic','competency'].some(k=>present(meta[k])))return [];
      const role=meta.role||root.CSTRGrading.defaultRole(kind,index,section.gradingCategory || section.subject);
      return [{column:`${col(rawColumns[kind][index])}`,date,title:[meta.title,roleLabel(role)].filter(Boolean).join(' - '),topic:[meta.topic,meta.competency].filter(Boolean).join('\n'),hps}];
    });
    const summaryLength=original ? 7 : Math.max(7,...Object.values(register).map(items=>items.length));
    const endRow=mapRow(75)+summaryLength;
    if(!original){
      // Normalize only the originally irregular summary merges. Everything above
      // the activity table keeps the school's exact merges and native assets.
      for(let i=mergeRefs.length-1;i>=0;i--)if(address(mergeRefs[i].split(':')[0]).r>=mapRow(76))mergeRefs.splice(i,1);
      for(let i=0;i<summaryLength;i++){
        const r=mapRow(76)+i; ensureRow(r,76);
        for(let c=2;c<=lastCol;c++)write(c,r,'');
        for(const [kind,start,dateEnd,titleStart,titleEnd,topicStart,topicEnd] of [['ww',2,3,4,9,10,14],['pt',15,16,17,22,23,24],['qa',25,26,27,32,33,34]]){
          const entry=register[kind][i];
          for(const [a,b] of [[start,dateEnd],[titleStart,titleEnd],[topicStart,topicEnd]])mergeRefs.push(`${col(mapCol(a))}${r}:${col(mapCol(b))}${r}`);
          cell(mapCol(start),r).setAttribute('s',originalStyles.get('C76')||'0');
          writeDate(mapCol(start),r,entry?.date||'','mm/dd/yy');write(mapCol(titleStart),r,entry?`${entry.column}: ${entry.title}`:'');write(mapCol(topicStart),r,entry?.topic||'');
        }
        const maxLines=Math.max(1,...['ww','pt','qa'].map(k=>{const e=register[k][i];return e?Math.max(Math.ceil((e.title.length+5)/26),e.topic.split('\n').reduce((n,x)=>n+Math.max(1,Math.ceil(x.length/30)),0)):1;}));
        ensureRow(r).setAttribute('ht',Math.max(15,14*maxLines+3)); ensureRow(r).setAttribute('customHeight','1');
        for(const c of [4,10,17,23,27,33].map(mapCol)){const node=cell(c,r); node.setAttribute('s',originalStyles.get('E76')||'0');wrapCell(c,r);}
      }
      W('Z',73,'C. Assessments');W('Z',75,'Date');W('AB',75,'Activities');W('AH',75,'Topics');W('AG',75,'');W('AI',75,'');
    }
    merges.replaceChildren(...mergeRefs.map(ref=>el(doc,'mergeCell',{ref})));merges.setAttribute('count',mergeRefs.length);
    // Clone native widths for added columns, preserving existing widths exactly.
    const cols=sheet.getElementsByTagNameNS(NS,'cols')[0],newCols=[];
    for(const node of [...cols.children]){
      const min=Number(node.getAttribute('min'))-1,max=Math.min(34,Number(node.getAttribute('max'))-1);
      for(let c=min;c<=max;c++){const clone=node.cloneNode(true);clone.setAttribute('min',mapCol(c)+1);clone.setAttribute('max',mapCol(c)+1);newCols.push(clone);}
    }
    for(const [kind,threshold,source] of [['ww',12,10],['pt',22,21],['qa',27,26]]){
      const style=newCols.find(n=>Number(n.getAttribute('min'))===mapCol(source)+1);
      for(let i=0;i<added[kind];i++){const clone=style.cloneNode(true),c=mapCol(threshold)-added[kind]+i+1;clone.setAttribute('min',c);clone.setAttribute('max',c);newCols.push(clone);}
    }
    cols.replaceChildren(...newCols.sort((a,b)=>Number(a.getAttribute('min'))-Number(b.getAttribute('min'))));
    // Grade colors remain live after edits and extend through every learner.
    // Blank grades must not be treated as numeric zero by the failure rule.
    for(const formatting of [...sheet.getElementsByTagNameNS(NS,'conditionalFormatting')]){
      const start=formatting.getAttribute('sqref').split(':')[0];
      const gradeStart=`${col(mapCol(33))}19`,descriptorStart=`${col(mapCol(34))}19`;
      if(start===gradeStart){
        formatting.setAttribute('sqref',`${gradeStart}:${col(mapCol(33))}${lastLearnerRow}`);
        for(const rule of [...formatting.getElementsByTagNameNS(NS,'cfRule')]){
          rule.setAttribute('type','expression');rule.removeAttribute('operator');
          const formula=rule.getElementsByTagNameNS(NS,'formula')[0];formula.textContent=`AND(ISNUMBER(${gradeStart}),${gradeStart}<75)`;
        }
      }else if(start===descriptorStart){
        formatting.setAttribute('sqref',`${descriptorStart}:${col(mapCol(34))}${lastLearnerRow}`);
        for(const formula of [...formatting.getElementsByTagNameNS(NS,'formula')])formula.textContent=mapRef(formula.textContent);
      }
    }
    for(const node of [...sheet.getElementsByTagNameNS(NS,'dataValidations')])node.remove();
    const validations=el(doc,'dataValidations');
    for(const kind of ['ww','pt','qa'])for(const c of rawColumns[kind]){
      const x=`${col(c)}19`,h=`${col(c)}$18`,validation=el(doc,'dataValidation',{type:'custom',allowBlank:1,showErrorMessage:1,errorTitle:'Check score and HPS',error:'Enter a score from 0 to HPS, or A, M, E, L.',sqref:`${col(c)}19:${col(c)}${lastLearnerRow}`});
      const formula=el(doc,'formula1');formula.textContent=`OR(${x}="",AND(ISNUMBER(${h}),${h}>0,OR(AND(ISNUMBER(${x}),${x}>=0,${x}<=${h}),UPPER(${x})="A",UPPER(${x})="M",UPPER(${x})="E",UPPER(${x})="L")))`;validation.appendChild(formula);validations.appendChild(validation);
    }
    for(const [c,value] of fixedWeights){
      const ref=`${col(mapCol(colIndex(c)))}18`,v=el(doc,'dataValidation',{type:'custom',allowBlank:0,showErrorMessage:1,errorTitle:'Subject-specific weight',error:`Keep the selected subject's required WW/PT/EX and exam split weights. Change the class category in the website and export again to use a different scheme.`,sqref:ref});
      const f=el(doc,'formula1');f.textContent=`${ref}=${value}`;v.appendChild(f);validations.appendChild(v);
    }
    validations.setAttribute('count',validations.children.length);
    const before=[...sheet.children].find(n=>['hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','drawing'].includes(n.localName));sheet.insertBefore(validations,before||null);
    // Native page scale (54%) is preserved. Fit width only; never shrink a large
    // roster and its activity summary onto a single unreadable page.
    const pageSetup=sheet.getElementsByTagNameNS(NS,'pageSetup')[0];
    if(pageSetup){const expanded=Object.values(added).some(n=>n>0);pageSetup.setAttribute('orientation','landscape');pageSetup.setAttribute('fitToWidth',expanded?'0':'1');pageSetup.setAttribute('fitToHeight','0');const fit=sheet.getElementsByTagNameNS(NS,'pageSetUpPr')[0];if(fit)fit.setAttribute('fitToPage',expanded?'0':'1');}
    const dimension=sheet.getElementsByTagNameNS(NS,'dimension')[0];dimension.setAttribute('ref',`A1:${col(lastCol)}${endRow}`);
    for(const view of [...sheet.getElementsByTagNameNS(NS,'sheetView')]){view.setAttribute('topLeftCell','A1');for(const selection of [...view.getElementsByTagNameNS(NS,'selection')])selection.remove();view.appendChild(el(doc,'selection',{activeCell:'B19',sqref:'B19'}));}
    for(const row of rows.values()){
      const sorted=[...row.children].sort((a,b)=>address(a.getAttribute('r')).c-address(b.getAttribute('r')).c);row.replaceChildren(...sorted);
    }
    sheetData.replaceChildren(...[...rows.entries()].sort((a,b)=>a[0]-b[0]).map(([,row])=>row));
    cellXfs.setAttribute('count',cellXfs.children.length);zip.file('xl/styles.xml',serialize(stylesDoc));
    zip.file('xl/worksheets/sheet1.xml',serialize(doc));
    const wb=parse(await zip.file('xl/workbook.xml').async('string'));
    const safeSheet=String(section.subject||'Class Record').replace(/[\\/?*\[\]:()]/g,' ').replace(/\s+/g,' ').trim().slice(0,31).trim()||'Class Record';
    wb.getElementsByTagNameNS(NS,'sheet')[0].setAttribute('name',safeSheet);
    let names=wb.getElementsByTagNameNS(NS,'definedNames')[0];if(!names){names=el(wb,'definedNames');wb.documentElement.appendChild(names);}
    [...names.children].filter(n=>['_xlnm.Print_Area','_xlnm.Print_Titles'].includes(n.getAttribute('name'))).forEach(n=>n.remove());
    const escaped=`'${safeSheet.replace(/'/g,"''")}'`;
    for(const [name,value] of [['_xlnm.Print_Area',`${escaped}!$A$1:$${col(lastCol)}$${endRow}`],['_xlnm.Print_Titles',`${escaped}!$1:$18,${escaped}!$A:$B`]]){const n=el(wb,'definedName',{name,localSheetId:0});n.textContent=value;names.appendChild(n);}
    let calc=wb.getElementsByTagNameNS(NS,'calcPr')[0];if(!calc){calc=el(wb,'calcPr');wb.documentElement.appendChild(calc);}calc.setAttribute('calcMode','auto');calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');
    zip.file('xl/workbook.xml',serialize(wb));
    // The original calc chain has stale references after layout/formula edits.
    zip.remove('xl/calcChain.xml');
    for(const path of ['xl/_rels/workbook.xml.rels','[Content_Types].xml']){
      const part=parse(await zip.file(path).async('string'));
      for(const node of [...part.documentElement.children])if((node.getAttribute('Type')||'').includes('calcChain')||node.getAttribute('PartName')==='/xl/calcChain.xml')node.remove();
      zip.file(path,serialize(part));
    }
    const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
    return {bytes,sheetName:safeSheet,range:`A1:${col(lastCol)}${endRow}`,resultCells};
  }
  async function download(payload) {
    const result=await build(payload),blob=new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=[payload.section.level,payload.section.subject,payload.section.section,payload.period.name].filter(Boolean).join('-').replace(/[^a-z0-9]+/gi,'-')+'.xlsx';
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return result;
  }
  root.CSTRSchoolExcel={build,download,validate};
})(typeof window==='object'?window:globalThis);
