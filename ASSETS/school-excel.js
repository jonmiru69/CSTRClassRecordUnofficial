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
    const issue = root.CSTRGrading.gradingIssue(section); if(issue)throw new Error(issue);
    const kinds = ['ww', 'pt', 'qa'];
    if (period.roster.some(learner => !present(learner.name) && kinds.some(kind => learner[kind]?.some(present)))) {
      throw new Error('Name the learner on every scored row.');
    }
    for (const [componentIndex, kind] of kinds.entries()) {
      const hps = period[kind + 'Hps'], dates = period[kind + 'Dates'];
      if (!Array.isArray(hps) || !Array.isArray(dates) || hps.length !== dates.length) throw new Error('Assessment columns are inconsistent.');
      if (hps.length > 1000) throw new Error('Too many assessment columns.');
      for (const learner of period.roster) {
        if (!Array.isArray(learner[kind]) || learner[kind].length !== hps.length) throw new Error('Learner scores and assessment columns do not align.');
      }
      if (section.weights[componentIndex] === 0) continue;
      const options = root.CSTRGrading.componentOptions(section, period, kind);
      hps.forEach((value, index) => {
        if (present(value) && (root.CSTRGrading.numberOrNull(value) === null || Number(value) <= 0)) throw new Error(`${kind.toUpperCase()} ${index + 1}: enter a positive HPS.`);
        if (present(value) && options.groups && !options.groups.some(g => g.id === options.roles[index])) throw new Error(`${kind.toUpperCase()} ${index + 1}: select its assessment group or domain in the activity register.`);
      });
      for (const learner of period.roster) {
        if (root.CSTRRecordTools?.getRowCategory(learner)) continue;
        learner[kind].forEach((value, index) => {
          if (!present(value)) return;
          const label = `${kind.toUpperCase()} ${index + 1}`;
          const problem = root.CSTRGrading.scoreIssue(value, hps[index]);
          if (problem === 'missingHps') throw new Error(`${label}: a score has no positive HPS.`);
          if (problem) throw new Error(`${label}: enter a score from zero to HPS or A, M, E, L.`);
        });
      }
    }
    if (period.roster.length > 10000) throw new Error('Too many learner rows.');
  }
  const sumNumbers = list => list.reduce((total, value) => total + value, 0);

  // One contiguous range per component, with a hidden row for assessment roles.
  // Formula length is independent of how often the roles alternate.
  function groupTerms(columns, row, roleRow, role) {
    const first = col(columns[0]), last = col(columns[columns.length - 1]);
    const scores = `${first}${row}:${last}${row}`, hps = `${first}$18:${last}$18`;
    const roles = `${first}$${roleRow}:${last}$${roleRow}`;
    const mask = role ? `--(${roles}="${role}"),` : '';
    return {
      configured: `SUMPRODUCT(${mask}${hps})`,
      denominator: `SUMPRODUCT(${mask}--(${scores}<>"E"),--(${scores}<>"L"),${hps})`,
      numerator: `SUMPRODUCT(${mask}${scores})`,
      pending: `SUMPRODUCT(--(${hps}>0),--(${scores}=""))`,
      unassigned: `SUMPRODUCT(--(${roles}=""),--(((${hps}<>"")+(${scores}<>""))>0))`,
      invalid: `COLUMNS(${scores})-COUNT(${scores})-COUNTBLANK(${scores})-COUNTIF(${scores},"A")-COUNTIF(${scores},"M")-COUNTIF(${scores},"E")-COUNTIF(${scores},"L")+COLUMNS(${hps})-COUNT(${hps})-COUNTBLANK(${hps})+SUMPRODUCT(--ISNUMBER(${hps}),--(${hps}<=0))+SUMPRODUCT(--ISNUMBER(${scores}),--(${scores}<0))+SUMPRODUCT(--ISNUMBER(${scores}),--(${scores}>${hps}))+SUMPRODUCT(--(${scores}<>""),--(${hps}=""))`
    };
  }

  async function addActivitySummary(zip, workbook, styles, payload, metadata, headerRows) {
    const { section, period } = payload;
    const doc = parse(`<worksheet xmlns="${NS}"/>`), sheet = doc.documentElement;
    const fonts=styles.querySelector('fonts'), fills=styles.querySelector('fills'), xfs=styles.querySelector('cellXfs');
    const styleCache=new Map();
    function style(size, bold=false, horizontal='left', fill='') {
      const key=[size,bold,horizontal,fill].join('|');
      if(styleCache.has(key))return styleCache.get(key);
      const font=el(styles,'font');
      font.append(el(styles,'sz',{val:size}),el(styles,'name',{val:'Arial'}),el(styles,'color',{rgb:'FF000000'}));
      if(bold)font.appendChild(el(styles,'b'));
      const fontId=fonts.children.length;fonts.appendChild(font);
      let fillId=0;
      if(fill){const node=el(styles,'fill'),pattern=el(styles,'patternFill',{patternType:'solid'});pattern.append(el(styles,'fgColor',{rgb:fill}),el(styles,'bgColor',{indexed:64}));node.appendChild(pattern);fillId=fills.children.length;fills.appendChild(node);}
      const xf=el(styles,'xf',{numFmtId:0,fontId,fillId,borderId:0,xfId:0,applyFont:1,applyFill:1,applyAlignment:1});
      xf.appendChild(el(styles,'alignment',{horizontal,vertical:'center',wrapText:1,shrinkToFit:0,indent:horizontal==='left'?1:0}));
      const id=xfs.children.length;xfs.appendChild(xf);styleCache.set(key,id);return id;
    }
    const body=style(16),center=style(16,false,'center'),title=style(26,true),school=style(19,true,'center'),small=style(12,false,'center');
    const heading=style(17,true,'left','FFE3E8EC'),label=style(14,true,'left','FFF0F2F4');
    const widths=[8,19,48,65,10],data=el(doc,'sheetData'),merges=[];
    const measure=document.createElement('canvas').getContext('2d');
    let fontScale=1;
    function height(text,width,size=16,bold=false){
      measure.font=`${bold?'bold ':''}${size}pt Arial`;
      let lines=0;
      for(const paragraph of String(text??'').split('\n')){
        let line='';lines++;
        for(const word of paragraph.split(/\s+/u)){
          if(measure.measureText(line?line+' '+word:word).width*.75<=width-16*fontScale){line=line?line+' '+word:word;continue;}
          if(line){lines++;line='';}
          for(const ch of word){if(line&&measure.measureText(line+ch).width*.75>width-16*fontScale){lines++;line='';}line+=ch;}
        }
      }
      return Math.max(20*fontScale*fontScale,lines*size*(lines>1?1.4:1.15)+6*fontScale*fontScale);
    }
    let rowNumber=0;
    const rowSpecs=[];
    function row(values, styleIds, minHeight=28, spans=[]) {
      rowSpecs.push({values,styleIds,minHeight,spans});rowNumber++;
    }
    const full=[[0,4]],two=[[0,2],[3,4]];
    const headerText=r=>[...(headerRows.get(r)?.querySelectorAll('is')||[])].map(n=>n.textContent).filter(present).join(' ');
    row([headerText(1)],school,30,full);
    row([headerText(2)+'  •  '+headerText(3)],small,22,full);
    row([headerText(4)+'  •  '+headerText(5)],small,22,full);
    row(['Summary of Activities and Topics'],title,44,full);
    row([`Subject: ${section.subject||'—'}`],style(17,true),30,full);
    row([`Grade & section: ${[section.level,section.section].filter(present).join(' — ')||'—'}`,'','',`Period: ${period.name||'—'}`],body,28,two);
    row([`Teacher: ${metadata.teacherName||'—'}`,'','',`School year: ${metadata.schoolYear||'—'}`],body,28,two);
    row(['No.','Date','Activity','Topic','HPS'],label,30);
    const headerEnd=rowNumber;
    const roleNames={st1:'Long Quiz / Unit Test / Chapter Test',st2:'Monthly Exam',te:payload.calendarMode==='trimester'?'Term Exam':'Quarterly Exam',cognitive:'Cognitive',affective:'Affective',behavioral:'Behavioral'};
    for(const [kind,name] of [['ww','Written Works'],['pt','Performance Tasks'],['qa',payload.calendarMode==='trimester'?'Term Assessments':'Quarterly Assessments']]){
      const entries=period[kind+'Hps'].flatMap((hps,index)=>{
        const meta=period.activityMeta?.[kind]?.[index]||{},date=period[kind+'Dates'][index]||'';
        const scored=period.roster.some(learner=>present(learner[kind]?.[index]));
        if(!present(hps)&&!present(date)&&!scored&&!['title','topic'].some(k=>present(meta[k])))return [];
        const role=meta.role||root.CSTRGrading.defaultRole(kind,index,section.gradingCategory||section.subject);
        let dateText=date;
        if(/^\d{4}-\d{2}-\d{2}$/.test(date)){
          const d=new Date(date+'T00:00:00Z');
          if(!Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date)dateText=d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
        }
        return [{number:index+1,date:dateText,title:present(meta.title)?meta.title:roleNames[role]||`Activity ${index+1}`,topic:meta.topic||'',hps}];
      });
      row([`${name}  ·  ${entries.length} ${entries.length===1?'activity':'activities'}`],heading,30,full);
      if(!entries.length)row(['No activities recorded.'],body,28,full);
      for(const entry of entries){
        row([entry.number,entry.date,entry.title,entry.topic,entry.hps],[center,center,body,body,center]);
      }
    }
    const styleAt=(spec,c)=>Array.isArray(spec.styleIds)?spec.styleIds[c]:spec.styleIds;
    // Use a conservative width allowance for Excel's font/indent metrics.
    // Underestimating wrapping would clip long notes inside a fixed-height row.
    const widthAt=(spec,c)=>widths.slice(c,(spec.spans.find(([a])=>a===c)?.[1]??c)+1).reduce((a,b)=>a+b,0)*5;
    function textHeight(spec,c,value){
      const font=fonts.children[Number(xfs.children[styleAt(spec,c)].getAttribute('fontId'))];
      return height(value,widthAt(spec,c),Number(font.querySelector('sz').getAttribute('val'))*fontScale,!!font.querySelector('b'));
    }
    const rowHeight=spec=>Math.max(spec.minHeight*fontScale*fontScale,...spec.values.map((value,c)=>present(value)?textHeight(spec,c,value):0));
    // Re-wrap at each candidate size: smaller type fits more words per line,
    // so reducing row heights alone would waste space or clip saved content.
    // Pick the largest size that fits, retaining the report's type hierarchy.
    for(let size=16;size>=8;size-=.5){
      fontScale=size/16;
      if(rowSpecs.reduce((total,spec)=>total+rowHeight(spec),0)<=540)break;
    }
    fontScale=Math.max(.5,fontScale);
    const fittedStyles=new Map();
    function fittedStyle(base){
      if(fontScale===1)return base;
      if(!fittedStyles.has(base)){
        const xf=xfs.children[base].cloneNode(true),font=fonts.children[Number(xf.getAttribute('fontId'))].cloneNode(true);
        font.querySelector('sz').setAttribute('val',Number(font.querySelector('sz').getAttribute('val'))*fontScale);
        xf.setAttribute('fontId',fonts.children.length);fonts.appendChild(font);
        fittedStyles.set(base,xfs.children.length);xfs.appendChild(xf);
      }
      return fittedStyles.get(base);
    }
    rowNumber=0;
    for(const spec of rowSpecs){
      // Keep all text even when a single note exceeds Excel's 409pt row limit.
      // These are adjacent rows on the same page, never additional pages.
      const chunks=spec.values.map((value,c)=>{
        let remaining=String(value??''),parts=[];
        while(remaining){
          let end=remaining.length;while(end>1&&textHeight(spec,c,remaining.slice(0,end))>390)end=Math.floor(end*.8);
          if(end<remaining.length){const boundary=remaining.slice(0,end).search(/\s+\S*$/u);if(boundary>0)end=boundary+1;if(/[\uD800-\uDBFF]/.test(remaining[end-1]))end--;}
          parts.push(remaining.slice(0,end));remaining=remaining.slice(end);
        }
        return parts.length?parts:[''];
      });
      for(let part=0;part<Math.max(...chunks.map(p=>p.length));part++){
        const values=chunks.map(p=>p[part]||''),r=++rowNumber,node=el(doc,'row',{r,customHeight:1,ht:Math.min(409,rowHeight({...spec,values}))});
        for(let c=0;c<widths.length;c++){
          const cell=el(doc,'c',{r:`${col(c)}${r}`,s:fittedStyle(styleAt(spec,c)),t:'inlineStr'}),inline=el(doc,'is'),text=el(doc,'t');
          text.setAttribute('xml:space','preserve');text.textContent=String(values[c]??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');inline.appendChild(text);cell.appendChild(inline);node.appendChild(cell);
        }
        data.appendChild(node);for(const [a,b] of spec.spans)merges.push(`${col(a)}${r}:${col(b)}${r}`);
      }
    }
    sheet.appendChild(el(doc,'sheetPr'));sheet.firstChild.appendChild(el(doc,'pageSetUpPr',{fitToPage:1,autoPageBreaks:0}));
    sheet.appendChild(el(doc,'dimension',{ref:`A1:E${rowNumber}`}));
    const views=el(doc,'sheetViews'),view=el(doc,'sheetView',{workbookViewId:0,showGridLines:0,showRowColHeaders:0,zoomScale:100});
    view.appendChild(el(doc,'pane',{ySplit:headerEnd,topLeftCell:`A${headerEnd+1}`,activePane:'bottomLeft',state:'frozen'}));views.appendChild(view);sheet.appendChild(views);
    sheet.appendChild(el(doc,'sheetFormatPr',{defaultRowHeight:28}));
    const cols=el(doc,'cols');widths.forEach((width,i)=>cols.appendChild(el(doc,'col',{min:i+1,max:i+1,width,customWidth:1})));sheet.append(cols,data);
    const mergeCells=el(doc,'mergeCells',{count:merges.length});merges.forEach(ref=>mergeCells.appendChild(el(doc,'mergeCell',{ref})));sheet.appendChild(mergeCells);
    sheet.appendChild(el(doc,'printOptions',{horizontalCentered:1,gridLines:0,headings:0}));
    sheet.appendChild(el(doc,'pageMargins',{left:.25,right:.25,top:.25,bottom:.25,header:.1,footer:.1}));
    // Always one summary page. Excel can scale exceptionally dense registers
    // further after measured font/spacing adaptation, without omitting content.
    sheet.appendChild(el(doc,'pageSetup',{paperSize:14,orientation:'landscape',fitToWidth:1,fitToHeight:1}));
    const footer=el(doc,'headerFooter'),odd=el(doc,'oddFooter');odd.textContent='&RSummary · Page &P';footer.appendChild(odd);sheet.appendChild(footer);
    // Reuse the school's actual logo without inheriting the score-grid anchor.
    const drawing=parse(await zip.file('xl/drawings/drawing1.xml').async('string'));
    const dns='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
    for(const anchor of drawing.documentElement.children){const from=anchor.getElementsByTagNameNS(dns,'from')[0];if(from){from.getElementsByTagNameNS(dns,'col')[0].textContent='0';from.getElementsByTagNameNS(dns,'colOff')[0].textContent='0';}}
    for(const extent of drawing.getElementsByTagNameNS(dns,'ext'))for(const key of ['cx','cy'])extent.setAttribute(key,Math.round(Number(extent.getAttribute(key))*fontScale));
    zip.file('xl/drawings/drawing2.xml',serialize(drawing));
    zip.file('xl/drawings/_rels/drawing2.xml.rels',await zip.file('xl/drawings/_rels/drawing1.xml.rels').async('string'));
    const relationships='http://schemas.openxmlformats.org/package/2006/relationships',officeRels='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const sheetRels=parse(`<Relationships xmlns="${relationships}"/>`),drawingRel=sheetRels.createElementNS(relationships,'Relationship');
    drawingRel.setAttribute('Id','rId1');drawingRel.setAttribute('Type',officeRels+'/drawing');drawingRel.setAttribute('Target','../drawings/drawing2.xml');sheetRels.documentElement.appendChild(drawingRel);
    zip.file('xl/worksheets/_rels/sheet2.xml.rels',serialize(sheetRels));
    const drawingNode=el(doc,'drawing');drawingNode.setAttributeNS(officeRels,'r:id','rId1');sheet.appendChild(drawingNode);
    zip.file('xl/worksheets/sheet2.xml',serialize(doc));
    const name='Activities and Topics',sheets=workbook.querySelector('sheets'),node=el(workbook,'sheet',{name,sheetId:2});
    const rels=parse(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
    let id=1;while([...rels.documentElement.children].some(n=>n.getAttribute('Id')===`rId${id}`))id++;
    node.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','r:id',`rId${id}`);sheets.appendChild(node);
    const rel=rels.createElementNS(rels.documentElement.namespaceURI,'Relationship');
    Object.entries({Id:`rId${id}`,Type:'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',Target:'worksheets/sheet2.xml'}).forEach(([k,v])=>rel.setAttribute(k,v));rels.documentElement.appendChild(rel);zip.file('xl/_rels/workbook.xml.rels',serialize(rels));
    const types=parse(await zip.file('[Content_Types].xml').async('string')),override=types.createElementNS(types.documentElement.namespaceURI,'Override');
    override.setAttribute('PartName','/xl/worksheets/sheet2.xml');override.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');types.documentElement.appendChild(override);zip.file('[Content_Types].xml',serialize(types));
    const drawingType=types.createElementNS(types.documentElement.namespaceURI,'Override');drawingType.setAttribute('PartName','/xl/drawings/drawing2.xml');drawingType.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.drawing+xml');types.documentElement.appendChild(drawingType);zip.file('[Content_Types].xml',serialize(types));
    const names=workbook.querySelector('definedNames');
    const printNames=[['_xlnm.Print_Area',`'${name}'!$A$1:$E$${rowNumber}`]];
    // No repeating titles: they unnecessarily reserve space on a one-page report.
    for(const [key,value] of printNames){const n=el(workbook,'definedName',{name:key,localSheetId:1});n.textContent=value;names.appendChild(n);}
    for(const container of [fonts,fills,xfs])container.setAttribute('count',container.children.length);
  }

  async function build(payload, options = {}) {
    if (!root.JSZip || !root.CSTRGrading) throw new Error('School Excel export tools are unavailable.');
    validate(payload);
    const { section, period } = payload, metadata = { ...payload.metadata };
    for (const key of ['teacher', 'checker', 'reviewer', 'principal']) {
      if (root.CSTRExportNames) metadata[key + 'Name'] = root.CSTRExportNames.format(metadata[key + 'Name'], metadata[key + 'Title']);
    }
    const input = options.templateBytes || await (async () => {
      const response = await fetch(new URL('ASSETS/templates/cstr-class-record.xlsx?v=20261025', document.baseURI));
      if (!response.ok) throw new Error('The school Excel template could not be loaded. Refresh and retry.');
      return response.arrayBuffer();
    })();
    const zip = await root.JSZip.loadAsync(input);
    const doc = parse(await zip.file('xl/worksheets/sheet1.xml').async('string'));
    const sheet = doc.documentElement, sheetData = sheet.getElementsByTagNameNS(NS, 'sheetData')[0];
    const original = options.preserveInputs === true;
    const signatures = [
      ['B', 'I', 'B', 'Submitted by:', metadata.teacherName, 'Subject Teacher'],
      ['K', 'S', 'C', 'Checked by:', metadata.checkerName, 'Subject Area Coordinator'],
      ['U', 'AB', 'O', 'Reviewed by:', metadata.reviewerName, section.group === 'SHS' ? 'SHS Coordinator' : 'JHS Coordinator'],
      ['AD', 'AI', 'Y', 'Noted by:', metadata.principalName, 'Principal']
    ];
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
    // Keep the calculation ranges intact. Blank template slots are presentation
    // columns only: hiding them cannot shift formulas, roles or subject weights.
    const hiddenColumns = new Set();
    if (!original) for (const [kind, columns] of Object.entries(rawColumns)) {
      columns.forEach((c, index) => {
        const meta = period.activityMeta?.[kind]?.[index] || {};
        const used = present(period[kind + 'Hps'][index]) || present(period[kind + 'Dates'][index]) ||
          ['title', 'topic', 'competency'].some(key => present(meta[key])) ||
          period.roster.some(learner => present(learner[kind]?.[index]));
        if (!used) hiddenColumns.add(c);
      });
    }
    const roleRow = mapRow(76) + Math.max(7, ...Object.values(lengths));
    ensureRow(roleRow).setAttribute('hidden', '1');
    const componentRules = Object.fromEntries(Object.keys(rawColumns).map(kind => [kind, root.CSTRGrading.componentOptions(section, period, kind)]));
    for (const [kind, columns] of Object.entries(rawColumns)) {
      const { groups, roles } = componentRules[kind];
      if (!groups) continue;
      columns.forEach((c, index) => write(c, roleRow, groups.some(group => group.id === roles[index]) ? roles[index] : ''));
    }
    // New score columns inherit the corresponding native raw-score style.
    for (const [kind, columns] of Object.entries(rawColumns)) {
      const sourceCol = { ww: 'K', pt: 'V', qa: 'AA' }[kind];
      for (let r = 14; r <= lastLearnerRow; r++) {
        const sourceR = Math.min(r, 57);
        for (const c of columns) cell(c, r, originalStyles.get(`${sourceCol}${sourceR}`) || originalStyles.get(`${sourceCol}19`));
      }
    }
    const stylesDoc=parse(await zip.file('xl/styles.xml').async('string'));
    const fonts = stylesDoc.getElementsByTagNameNS(NS, 'fonts')[0];
    // The template shares its score fonts across populated, blank and inserted cells.
    for (const font of fonts.children) {
      const color = font.getElementsByTagNameNS(NS, 'color')[0];
      const black = el(stylesDoc, 'color', { rgb: 'FF000000' });
      if (color) color.replaceWith(black);
      else font.appendChild(black);
    }
    const cellXfs=stylesDoc.getElementsByTagNameNS(NS,'cellXfs')[0],numberStyles=new Map();
    let numFmts=stylesDoc.getElementsByTagNameNS(NS,'numFmts')[0];
    if(!numFmts){numFmts=el(stylesDoc,'numFmts',{count:0});stylesDoc.documentElement.insertBefore(numFmts,stylesDoc.documentElement.firstChild);}
    function formatNumber(node, format) {
      const base = Number(node.getAttribute('s') || 0), key = base + '|' + format;
      if (!numberStyles.has(key)) {
        let numFmtId = 0; // General keeps the raw score's decimals visible.
        if (format !== 'General') {
          let numFmt = [...numFmts.children].find(n => n.getAttribute('formatCode') === format);
          if (!numFmt) {
            const nextId = Math.max(163, ...[...numFmts.children].map(n => Number(n.getAttribute('numFmtId')))) + 1;
            numFmt = el(stylesDoc, 'numFmt', { numFmtId: nextId, formatCode: format });
            numFmts.appendChild(numFmt);
            numFmts.setAttribute('count', numFmts.children.length);
          }
          numFmtId = numFmt.getAttribute('numFmtId');
        }
        const clone = cellXfs.children[base].cloneNode(true);
        clone.setAttribute('numFmtId', numFmtId);
        clone.setAttribute('applyNumberFormat', '1');
        numberStyles.set(key, cellXfs.children.length);
        cellXfs.appendChild(clone);
      }
      node.setAttribute('s', numberStyles.get(key));
    }
    function writeDate(c,r,value,format){
      const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
      if(!match){write(c,r,value);return;}
      const time=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]));
      if(new Date(time).toISOString().slice(0,10)!==value){write(c,r,value);return;}
      write(c,r,(time-Date.UTC(1899,11,30))/86400000);
      formatNumber(cell(c,r), format);
    }
    const rowHasData = learner => present(learner?.name) || ['ww','pt','qa'].some(k => (learner?.[k] || []).some(present));
    const lastUsedIndex = period.roster.reduce((last, learner, index) => rowHasData(learner) ? index : last, -1);
    const learnerStyleColumns = new Map(Array.from({ length: 35 }, (_, c) => [mapCol(c), col(c)]));
    for (const [kind, source] of [['ww', 'K'], ['pt', 'U'], ['qa', 'AA']]) {
      for (const c of rawColumns[kind]) if (!learnerStyleColumns.has(c)) learnerStyleColumns.set(c, source);
    }
    for (let r = 19; r <= lastLearnerRow; r++) {
      const row = ensureRow(r);
      if (r - 19 <= lastUsedIndex) row.removeAttribute('hidden');
      else if (!original) row.setAttribute('hidden', '1');
      if (!original) {
        row.setAttribute('ht', '15');
        row.setAttribute('customHeight', '1');
        // Use the same native body style through the roster, including added rows.
        for (const [c, source] of learnerStyleColumns) {
          write(c, r, '');
          const node = cell(c, r);
          node.setAttribute('s', originalStyles.get(`${source}20`) || '0');
        }
        rawColumns.qa.forEach(c => formatNumber(cell(c, r), 'General'));
        formatNumber(cell(mapCol(29), r), '0.00'); // Match the other exam WS columns.
        formatNumber(cell(mapCol(30), r), '0.000');
        formatNumber(cell(mapCol(32), r), '0.000');
      }
    }
    if (!original) {
      W('AG', 11, metadata.schoolYear || '');
      W('A', 13, period.name || ''); W('H', 13, `${section.level || ''}${section.section ? ' - ' + section.section : ''}`);
      W('O', 13, metadata.teacherName || ''); W('AG', 13, section.subject || '');
      let number = 0;
      period.roster.forEach((learner, index) => {
        const r = 19 + index, category = root.CSTRRecordTools?.getRowCategory(learner);
        write(0, r, present(learner.name) && !category ? ++number : ''); write(1, r, learner.name || '');
        if (category) return;
        for (const kind of ['ww','pt','qa']) learner[kind].forEach((value, i) => write(rawColumns[kind][i], r, root.CSTRGrading.isAttendanceCode(value) ? String(value).trim().toUpperCase() : root.CSTRGrading.numberOrNull(value) ?? (present(value) ? value : '')));
      });
    }
    const weights = section.weights;
    const examRoles = ['st1', 'st2', 'te'];
    const examShares = examRoles.map(role => weights[2] === 0 ? 0 : componentRules.qa.groups.find(group => group.id === role)?.share || 0);
    const examTitle = payload.calendarMode === 'trimester' ? 'TERM ASSESSMENT' : 'QUARTERLY ASSESSMENT';
    const weightCells = ['N', 'X', 'AF'];
    const percentText = ref => `ROUND(${ref}*100,12)&"%"`;
    const componentHeaders = [
      ['ww', 'C', 'WRITTEN WORKS', 'Activities/Exercises'],
      ['pt', 'O', 'PERFORMANCE TASK', 'Performance Check/Performance Tasks'],
      ['qa', 'Y', examTitle]
    ];
    componentHeaders.forEach(([kind, c, title, subtitle], i) => {
      const ref = `${col(mapCol(colIndex(weightCells[i])))}$18`;
      W(c, 14, `${title} (${weights[i]}%)`, `"${title} ("&${percentText(ref)}&")"`);
      if (subtitle) {
        const groups = weights[i] > 0 ? componentRules[kind].groups : null;
        const groupText = groups ? `Grade shares (${groups.map(({id, share}) => `${roleLabel(id)} ${weights[i] * share}%`).join(' / ')})` : '';
        W(c, 15, [subtitle, `${weights[i]}%`, groupText].filter(Boolean).join('\n'),
          `"${subtitle}"&CHAR(10)&${percentText(ref)}${groupText ? `&CHAR(10)&"${groupText}"` : ''}`);
      }
      W(weightCells[i], 18, weights[i] / 100);
      if (!Number.isInteger(weights[i])) {
        const [coefficient, exponent = '0'] = String(weights[i]).split('e');
        const decimals = Math.min(12, (coefficient.split('.')[1]?.length || 0) - Number(exponent));
        formatNumber(cell(mapCol(colIndex(weightCells[i])), 18), `0.${'0'.repeat(decimals)}%`);
      }
    });
    W('AH', 14, section.gradingMode === 'zero-based' ? 'REPORTED GRADE' : 'TRANSMUTED GRADE');
    const examWeightCells = ['AB', 'AC', 'AD'];
    examWeightCells.forEach((c, i) => {
      W(c, 18, examShares[i]);
      W(c, 15, `WS ${roleLabel(examRoles[i])}\n(${examShares[i] * 100}%)`);
    });
    W('AE', 18, weights[2] === 0 ? '' : 100);
    for (const kind of ['ww','pt','qa']) {
      rawColumns[kind].forEach((c, index) => {
        const value = period[kind + 'Hps'][index];
        if (!original) write(c,18,root.CSTRGrading.numberOrNull(value) ?? '');
        if (kind !== 'qa') { if (!original) writeDate(c,17,period[kind + 'Dates'][index] || '', 'm/d'); }
        else {
          const role = componentRules.qa.roles[index];
          const labels = {st1:'Long Quiz / Unit Test / Chapter Test',st2:'Monthly Exam',te:payload.calendarMode==='trimester'?'Term Exam':'Quarterly Exam'};
          write(c,15,[weights[2] ? roleLabel(role) || `EX ${index+1}` : 'Not counted', period.qaDates[index] || '', weights[2] && labels[role]].filter(Boolean).join('\n'));
        }
      });
    }
    const totalCols = { ww: mapCol(12), pt: mapCol(22) }, wsCols = { ww: mapCol(13), pt: mapCol(23), qa: mapCol(31) };
    for (const kind of ['ww','pt']) {
      const columns = rawColumns[kind], hpsTotal = `SUM(${col(columns[0])}18:${col(columns.at(-1))}18)`;
      write(totalCols[kind],18, sumNumbers(period[kind+'Hps'].map(x => root.CSTRGrading.numberOrNull(x)||0)),hpsTotal);
    }
    const preset=root.CSTRGrading.SUBJECT_PRESETS.find(item=>item.name===(section.gradingCategory||section.subject));
    const fixedWeights = preset ? weightCells.map((c, i) => [c, preset.weights[i] / 100]) : [];
    fixedWeights.push(...examWeightCells.map((c, i) => [c, examShares[i]]));
    const subjectWeightGuard=fixedWeights.map(([c,value])=>`ABS(${col(mapCol(colIndex(c)))}$18-${value})>0.0000000001`);
    const comparisonGrade = ref => `ROUND(${ref},${root.CSTRGrading.GRADE_COMPARISON_DECIMALS})`;
    const tierFormula = ref => root.CSTRGrading.TRANSMUTATION_TABLE.slice(0,-1).reduceRight((tail,tier) => `IF(${comparisonGrade(ref)}>=${tier.min},${tier.grade},${tail})`,'60');
    const resultCells = [];
    let learnerNumber = 0;
    for (let r = 19; r <= lastLearnerRow; r++) {
      const learner = period.roster[r-19] || { name:'', ww:[],pt:[],qa:[] };
      const category = root.CSTRRecordTools?.getRowCategory(learner);
      if (category) continue;
      const result = root.CSTRGrading.calculateLearner(learner,period,section), named = present(learner.name);
      const setFormula = (c,f,v) => { if(f.length>8192)throw new Error('Excel formula length exceeded. Keep activities from the same assessment group adjacent, or reduce the number of columns.'); write(c,r,named ? v : '',f); resultCells.push(`${col(c)}${r}`); };
      const terms = Object.fromEntries(Object.entries(rawColumns).map(([kind, columns]) => [kind, groupTerms(columns, r, roleRow)]));
      if(!original){
        if (named) learnerNumber++;
        const numbering = r === 19 ? '1' : `COUNT($A$19:$A${r - 1})+1`;
        setFormula(0,`IF($B${r}="","",${numbering})`,learnerNumber);
      }
      for (const kind of ['ww','pt']) {
        const columns = rawColumns[kind], t = terms[kind], component = result[kind];
        const ws = `${col(wsCols[kind])}$18`, total = `${col(totalCols[kind])}${r}`;
        setFormula(totalCols[kind], `IF($B${r}="","",IF(${ws}=0,0,${t.numerator}))`, component.rawTotal);
        const { groups } = componentRules[kind];
        let weighted = `IF(${t.denominator}=0,"",${total}/${t.denominator}*100*${ws})`;
        if (groups) {
          const grouped = groups.map(g => ({ ...g, ...groupTerms(columns, r, roleRow, g.id) }));
          const activeShare = sum(grouped.map(g => `IF(${g.denominator}>0,${g.share},0)`));
          const ready = grouped.map(g => `${g.configured}>0`).join(',');
          const percentages = sum(grouped.map(g => `IF(${g.denominator}>0,${g.numerator}/${g.denominator}*100*${g.share},0)`));
          weighted = `IF(AND(${ready},${activeShare}>0),${percentages}/${activeShare}*${ws},"")`;
        }
        const invalid = groups ? `(${t.invalid})+${t.unassigned}` : t.invalid;
        setFormula(wsCols[kind],`IF($B${r}="","",IF(${ws}=0,0,IF(${invalid}>0,NA(),${weighted})))`,component.weighted);
      }
      const qaGroups=componentRules.qa.groups.map(({id: role})=>({role,...groupTerms(rawColumns.qa,r,roleRow,role)}));
      const qaCellRefs=[];
      for(const [i,role] of examRoles.entries()) {
        const c=mapCol(27+i),g=qaGroups.find(g=>g.role===role),weight=`${col(c)}$18`,ref=`${col(c)}${r}`;
        qaCellRefs.push(ref);
        let cache='';
        if(g&&weights[2]>0){const item=result.qa.groups?.find(g=>g.id===role);if(item?.percentage!=null)cache=item.percentage*examShares[i];}
        setFormula(c,`IF($B${r}="","",IF(${col(wsCols.qa)}$18=0,"",${g?`IF(${g.denominator}=0,"",${g.numerator}/${g.denominator}*100*${weight})`:'""'}))`,cache);
      }
      const activeShare=sum(qaCellRefs.map((ref,i)=>`IF(ISNUMBER(${ref}),${col(mapCol(27+i))}$18,0)`));
      const qaReady=qaGroups.map(g=>`${g.configured}>0`).join(',');
      const qaPS=`IF(AND(${qaReady||'FALSE'}),IF(${activeShare}=0,"",SUM(${qaCellRefs.join(',')})/${activeShare}),"")`;
      setFormula(mapCol(30),`IF($B${r}="","",IF(${col(wsCols.qa)}$18=0,"",IF((${terms.qa.invalid})+${terms.qa.unassigned}>0,NA(),${qaPS})))`,result.qa.percentage);
      const examPS = `${col(mapCol(30))}${r}`;
      setFormula(wsCols.qa,`IF($B${r}="","",IF(${col(wsCols.qa)}$18=0,0,IF(${examPS}="","",${examPS}*${col(wsCols.qa)}$18)))`,result.qa.weighted);
      const wsRefs=Object.values(wsCols).map(c=>`${col(c)}${r}`), ig=`${col(mapCol(32))}${r}`, grade=`${col(mapCol(33))}${r}`;
      const weightRefs = Object.values(wsCols).map(c => `${col(c)}$18`).join(',');
      const invalidWeights = [`COUNT(${weightRefs})<>3`, `MIN(${weightRefs})<0`, `MAX(${weightRefs})>1`, `ABS(SUM(${weightRefs})-1)>0.0000000001`, ...subjectWeightGuard];
      setFormula(mapCol(32),`IF($B${r}="","",IF(OR(${invalidWeights.join(',')},${wsRefs.map(ref => `ISERROR(${ref})`).join(',')}),NA(),IF(COUNT(${wsRefs.join(',')})=3,SUM(${wsRefs.join(',')}),"")))`,result.initial.precise);
      setFormula(mapCol(33),`IF(ISNUMBER(${ig}),${section.gradingMode==='zero-based'?`MAX(${root.CSTRGrading.MINIMUM_REPORTED_GRADE},ROUND(${comparisonGrade(ig)},0))`:tierFormula(ig)},"")`,result.initial.transmuted);
      const pending = sum(Object.keys(terms).map(kind => `IF(${col(wsCols[kind])}$18=0,0,${terms[kind].pending})`));
      const hasPending = ['ww','pt','qa'].some(kind => result[kind].missing > 0);
      const descriptor = `IF(${grade}>=90,"Advancing",IF(${grade}>=80,"Benchmarking",IF(${grade}>=75,"Connecting",IF(${grade}>=65,"Developing","Emerging"))))`;
      setFormula(mapCol(34),`IF($B${r}="","",IF(ISERROR(${ig}),"Check inputs",IF(ISNUMBER(${grade}),${descriptor}&IF(${pending}>0," (pending)",""),"Incomplete")))`,result.initial.transmuted === null ? 'Incomplete' : result.initial.descriptor + (hasPending ? ' (pending)' : ''));
    }
    // Append alignment variants without changing the template's style IDs.
    const alignmentStyles=new Map();
    function fitCell(c,r,wrap = true) {
      const node=cell(c,r),baseStyle=Number(node.getAttribute('s')||0),key=`${baseStyle}:${wrap}`;
      if(!alignmentStyles.has(key)){
        const clone=cellXfs.children[baseStyle].cloneNode(true);let alignment=clone.getElementsByTagNameNS(NS,'alignment')[0];
        if(!alignment){alignment=el(stylesDoc,'alignment');clone.insertBefore(alignment,clone.firstChild);}
        alignment.setAttribute('wrapText',wrap ? '1' : '0');
        alignment.setAttribute('shrinkToFit',wrap ? '0' : '1');
        clone.setAttribute('applyAlignment','1');
        alignmentStyles.set(key,cellXfs.children.length);cellXfs.appendChild(clone);
      }
      node.setAttribute('s',alignmentStyles.get(key));
    }
    weightCells.forEach(c => fitCell(mapCol(colIndex(c)), 18, false));
    if(!original){
      for(let r=19;r<=lastLearnerRow;r++){
        const learner=period.roster[r-19];if(!learner)continue;
        fitCell(1,r);
        const lines=String(learner.name||'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/29)),0);
        if(lines>1){ensureRow(r).setAttribute('ht',Math.max(16.2,lines*14));ensureRow(r).setAttribute('customHeight','1');}
      }
      for(const c of ['H','O','AG'].map(c=>mapCol(colIndex(c))))fitCell(c,13);
      const headerLines=Math.max(1,Math.ceil(String(section.subject||'').length/38),Math.ceil(String(metadata.teacherName||'').length/50),Math.ceil(String(section.level+' '+section.section).length/25));
      if(headerLines>1){ensureRow(13).setAttribute('ht',Math.max(28.5,headerLines*14+3));ensureRow(13).setAttribute('customHeight','1');}
    }
    // Keep the school layout, reserving a continuous single-line lane for each signatory.
    const merges=sheet.getElementsByTagNameNS(NS,'mergeCells')[0];
    const signatureRows = [66, 68, 69];
    const mergeRefs=oldMerges.filter(ref => original || !signatureRows.includes(address(ref.split(':')[0]).r)).map(mapRef);
    if (!original) {
      for (const c of ['C', 'O', 'Y']) for (const r of signatureRows) W(c, r, '');
      for (const [start, end, source, caption, name, role] of signatures) {
        [caption, String(name || '').replace(/\s+/gu, ' ').trim(), role].forEach((value, i) => {
          const oldRow = signatureRows[i], r = mapRow(oldRow), c = mapCol(colIndex(start));
          write(c, r, value);
          cell(c, r).setAttribute('s', originalStyles.get(`${source}${oldRow}`) || '0');
          fitCell(c, r, false);
          mergeRefs.push(mapRef(`${start}${oldRow}:${end}${oldRow}`));
        });
      }
      for (const oldRow of [64, 65, 70, 72, 74]) {
        const spacer = ensureRow(mapRow(oldRow));
        spacer.setAttribute('ht', '6');
        spacer.setAttribute('customHeight', '1');
      }
    }
    for(let i=3;i<rawColumns.qa.length;i++)mergeRefs.push(`${col(rawColumns.qa[i])}15:${col(rawColumns.qa[i])}17`);
    // A report needs its own widths: score columns can be hidden or expanded.
    // Keep the hidden assessment-role row used by formulas on the grade sheet.
    const endRow=original ? mapRow(82) : mapRow(69);
    if(!original){
      for(const [r,row] of rows)if(r>=mapRow(70)&&r!==roleRow){row.remove();rows.delete(r);}
      for(let i=mergeRefs.length-1;i>=0;i--)if(address(mergeRefs[i].split(':')[0]).r>=mapRow(70))mergeRefs.splice(i,1);
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
    for (const node of cols.children) {
      if (hiddenColumns.has(Number(node.getAttribute('min')) - 1)) node.setAttribute('hidden', '1');
      else node.removeAttribute('hidden');
    }
    if (hiddenColumns.size) {
      // Header metadata, signatures and the register share the worksheet columns.
      // Reflow these lanes onto visible columns so their text cannot disappear
      // with an unused raw-score column. The grade table and every formula stay
      // at their original addresses.
      const visible = Array.from({length:lastCol + 1}, (_, c) => c).filter(c => !hiddenColumns.has(c));
      for (const [r, rowNode] of rows) {
        if (r >= 14 && r <= lastLearnerRow || r > endRow) continue;
        const existingMerges = mergeRefs.filter(ref => address(ref.split(':')[0]).r === r);
        const covered = new Set();
        for (const ref of existingMerges) {
          const [a,b] = ref.split(':').map(address);
          if (a.r !== b.r) continue;
          for (let c = a.c + 1; c <= b.c; c++) covered.add(c);
        }
        const content = [...rowNode.children].filter(node => {
          const c = address(node.getAttribute('r')).c;
          return !covered.has(c) && [...node.children].some(n => ['f','v','is'].includes(n.localName) && present(n.textContent));
        }).sort((a,b) => address(a.getAttribute('r')).c - address(b.getAttribute('r')).c);
        if (!content.length) continue;
        const snapshots = content.map(node => ({ c:address(node.getAttribute('r')).c, node:node.cloneNode(true) }));
        for (const node of rowNode.children) { node.replaceChildren(); node.removeAttribute('t'); node.setAttribute('s','0'); }
        for (let i = mergeRefs.length - 1; i >= 0; i--) if (existingMerges.includes(mergeRefs[i])) mergeRefs.splice(i,1);
        let start = 0;
        snapshots.forEach(({c,node}, index) => {
          const remaining = snapshots.length - index - 1;
          const minimumSpan = r <= 13 ? 2 : 1;
          const desired = snapshots.length === 1 ? 0 : Math.floor(c / (lastCol + 1) * visible.length);
          start = Math.max(start, Math.min(desired, visible.length - remaining * minimumSpan - minimumSpan));
          const next = snapshots[index + 1];
          const end = Math.max(start + minimumSpan - 1, Math.min(visible.length - remaining * minimumSpan - 1,
            next ? Math.floor(next.c / (lastCol + 1) * visible.length) - 1 : visible.length - 1));
          const target = cell(visible[start],r);
          target.setAttribute('s',node.getAttribute('s') || '0');
          if (node.hasAttribute('t')) target.setAttribute('t',node.getAttribute('t'));
          target.replaceChildren(...[...node.children].map(n => n.cloneNode(true)));
          if (visible[end] > visible[start]) mergeRefs.push(`${col(visible[start])}${r}:${col(visible[end])}${r}`);
          start = end + 1;
        });
      }
      // Move merged grade captions off a hidden first slot (sparse registers).
      for (let i = 0; i < mergeRefs.length; i++) {
        const [a,b] = mergeRefs[i].split(':').map(address);
        if (a.r < 14 || a.r > 17 || !hiddenColumns.has(a.c)) continue;
        const first = visible.find(c => c >= a.c && c <= b.c);
        if (first === undefined) continue;
        const source = cell(a.c,a.r), target = cell(first,a.r);
        target.setAttribute('s',source.getAttribute('s') || '0');
        if (source.hasAttribute('t')) target.setAttribute('t',source.getAttribute('t'));
        target.replaceChildren(...[...source.children].map(n => n.cloneNode(true)));
        source.replaceChildren(); source.removeAttribute('t');
        mergeRefs[i] = `${col(first)}${a.r}:${col(b.c)}${b.r}`;
      }
      merges.replaceChildren(...mergeRefs.map(ref => el(doc,'mergeCell',{ref})));
      merges.setAttribute('count',mergeRefs.length);
    }
    // Keep the failing-grade fill, with the same black number as every other grade.
    for(const formatting of [...sheet.getElementsByTagNameNS(NS,'conditionalFormatting')]){
      const start=formatting.getAttribute('sqref').split(':')[0];
      const gradeStart=`${col(mapCol(33))}19`,descriptorStart=`${col(mapCol(34))}19`;
      if(start===gradeStart){
        formatting.setAttribute('sqref',`${gradeStart}:${col(mapCol(33))}${lastLearnerRow}`);
        for(const rule of [...formatting.getElementsByTagNameNS(NS,'cfRule')]){
          const dxf = stylesDoc.getElementsByTagNameNS(NS, 'dxfs')[0]?.children[Number(rule.getAttribute('dxfId'))];
          dxf?.getElementsByTagNameNS(NS, 'font')[0]?.remove();
          rule.setAttribute('type','expression');rule.removeAttribute('operator');
          const formula=rule.getElementsByTagNameNS(NS,'formula')[0];formula.textContent=`AND(ISNUMBER(${gradeStart}),${gradeStart}<75)`;
        }
      }else if(start===descriptorStart) formatting.remove(); // The native descriptor rule only changed text to red.
    }
    for(const node of [...sheet.getElementsByTagNameNS(NS,'dataValidations')])node.remove();
    const validations=el(doc,'dataValidations');
    for(const kind of ['ww','pt','qa'])for(const c of rawColumns[kind]){
      const x=`${col(c)}19`,h=`${col(c)}$18`,validation=el(doc,'dataValidation',{type:'custom',allowBlank:1,showErrorMessage:1,errorTitle:'Check score and HPS',error:'Enter a score from 0 to HPS, or A, M, E, L.',sqref:`${col(c)}19:${col(c)}${lastLearnerRow}`});
      const options = componentRules[kind];
      const assigned = options.groups ? `,${col(c)}$${roleRow}<>""` : '';
      const formula=el(doc,'formula1');formula.textContent=`OR(${x}="",AND($B19<>"",ISNUMBER(${h}),${h}>0${assigned},OR(AND(ISNUMBER(${x}),${x}>=0,${x}<=${h}),UPPER(${x})="A",UPPER(${x})="M",UPPER(${x})="E",UPPER(${x})="L")))`;validation.appendChild(formula);validations.appendChild(validation);
      const maxValidation=el(doc,'dataValidation',{type:'custom',allowBlank:0,showErrorMessage:1,errorTitle:'Check HPS',error:'Enter a positive maximum in an assigned assessment column, or clear the column.',sqref:`${col(c)}18`});
      const maxFormula=el(doc,'formula1');maxFormula.textContent=`OR(${h}="",AND(ISNUMBER(${h}),${h}>0${assigned}))`;maxValidation.appendChild(maxFormula);validations.appendChild(maxValidation);
    }
    for(const [c,value] of fixedWeights){
      const ref=`${col(mapCol(colIndex(c)))}18`,v=el(doc,'dataValidation',{type:'custom',allowBlank:0,showErrorMessage:1,errorTitle:'Subject-specific weight',error:`Keep the selected subject's required WW/PT/EX and exam split weights. Change the class category in the website and export again to use a different scheme.`,sqref:ref});
      const f=el(doc,'formula1');f.textContent=`${ref}=${value}`;v.appendChild(f);validations.appendChild(v);
    }
    validations.setAttribute('count',validations.children.length);
    const before=[...sheet.children].find(n=>['hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','drawing'].includes(n.localName));sheet.insertBefore(validations,before||null);
    // Keep every native cell, label, merge and formula. Only size and style the
    // existing layout; separate print areas put its existing register on page 2.
    const sharedDoc=zip.file('xl/sharedStrings.xml')?parse(await zip.file('xl/sharedStrings.xml').async('string')):null;
    const shared=[...(sharedDoc?.getElementsByTagNameNS(NS,'si')||[])].map(n=>n.textContent);
    const canvas=document.createElement('canvas'),measure=canvas.getContext('2d');
    const fontVariants=new Map(),printStyles=new Map(),borderVariants=new Map();
    const borders=stylesDoc.getElementsByTagNameNS(NS,'borders')[0];
    const columnNodes=[...cols.children],columnWidths=new Map();
    // Arial-11 remains the workbook's Normal style; clones change cell fonts only.
    // Points per column-width unit include Excel's printer-metric allowance.
    const pointsPerWidth=5.55,sidePadding=4,lineLeading=1.08;
    const uniformDateWidth=Math.max(7.5,...[...rawColumns.ww,...rawColumns.pt].map(c=>{
      const node=columnNodes.find(n=>Number(n.getAttribute('min'))===c+1);
      return Number(node.getAttribute('width'))+1;
    }));
    for(const node of columnNodes){
      const c=Number(node.getAttribute('min'))-1;
      let width=rawColumns.ww.includes(c)||rawColumns.pt.includes(c)?uniformDateWidth:Number(node.getAttribute('width'))+1;
      if([13,23,31].map(mapCol).includes(c))width=Math.max(width,12); // Teacher label and precise component weights.
      if(rawColumns.qa.includes(c))width=Math.max(width,13); // Keep exam words intact.
      node.setAttribute('width',width);node.setAttribute('customWidth','1');columnWidths.set(c,hiddenColumns.has(c) ? 0 : width);
    }
    function printStyle(node,r,c){
      const base=Number(node.getAttribute('s')||0),grid=r>=14&&r<=lastLearnerRow;
      const size=r>=19&&r<=lastLearnerRow||r===mapRow(68)?15:14;
      const source=cellXfs.children[base],sourceFont=Number(source.getAttribute('fontId')||0);
      const font=fonts.children[sourceFont],nativeSize=Number(font.getElementsByTagNameNS(NS,'sz')[0]?.getAttribute('val')||11);
      const finalSize=nativeSize>=15?15:size,date=r===17&&([...rawColumns.ww,...rawColumns.pt].includes(c));
      const noWrap=date||r===10||r===11||[mapRow(71),mapRow(73),mapRow(75)].includes(r)||r===13&&c===mapCol(13);
      const key=[base,finalSize,grid,noWrap].join('|');
      if(!printStyles.has(key)){
        const clone=source.cloneNode(true),fontKey=[sourceFont,finalSize].join('|');
        if(!fontVariants.has(fontKey)){
          const f=font.cloneNode(true);f.getElementsByTagNameNS(NS,'sz')[0].setAttribute('val',finalSize);
          fontVariants.set(fontKey,fonts.children.length);fonts.appendChild(f);
        }
        clone.setAttribute('fontId',fontVariants.get(fontKey));clone.setAttribute('applyFont','1');
        let alignment=clone.getElementsByTagNameNS(NS,'alignment')[0];
        if(!alignment){alignment=el(stylesDoc,'alignment');clone.appendChild(alignment);}
        alignment.setAttribute('wrapText',noWrap?'0':'1');alignment.setAttribute('shrinkToFit','0');alignment.setAttribute('vertical','center');
        clone.setAttribute('applyAlignment','1');
        if(grid){
          const oldBorder=Number(source.getAttribute('borderId')||0);
          if(!borderVariants.has(oldBorder)){
            const border=borders.children[oldBorder].cloneNode(true);
            for(const side of ['left','right','top','bottom']){
              let edge=border.getElementsByTagNameNS(NS,side)[0];
              if(!edge){edge=el(stylesDoc,side);const order=['left','right','top','bottom','diagonal'];border.insertBefore(edge,[...border.children].find(n=>order.indexOf(n.localName)>order.indexOf(side))||null);}
              if(!edge.getAttribute('style')){edge.setAttribute('style','thin');edge.replaceChildren(el(stylesDoc,'color',{rgb:'FF000000'}));}
            }
            borderVariants.set(oldBorder,borders.children.length);borders.appendChild(border);
          }
          clone.setAttribute('borderId',borderVariants.get(oldBorder));clone.setAttribute('applyBorder','1');
        }
        printStyles.set(key,cellXfs.children.length);cellXfs.appendChild(clone);
      }
      node.setAttribute('s',printStyles.get(key));
    }
    for(let r=14;r<=lastLearnerRow;r++)for(let c=0;c<=lastCol;c++)cell(c,r);
    for(const [r,row] of rows)if(r<=endRow)for(const node of row.children)printStyle(node,r,address(node.getAttribute('r')).c);
    function setHeight(r,height){const row=ensureRow(r);row.setAttribute('ht',Math.min(409,height));row.setAttribute('customHeight','1');row.removeAttribute('thickBot');}
    for(const r of [6,9,12])setHeight(r,4);
    for(let r=19;r<=lastLearnerRow;r++)setHeight(r,20.5);
    for(const r of [64,65])setHeight(mapRow(r),6);
    const mergeStarts=new Map(),covered=new Set();
    for(const ref of mergeRefs){
      const [first,last]=ref.split(':').map(address);mergeStarts.set(ref.split(':')[0],{first,last});
      for(let r=first.r;r<=last.r;r++)for(let c=first.c;c<=last.c;c++)if(r!==first.r||c!==first.c)covered.add(`${col(c)}${r}`);
    }
    function shown(node){
      const t=node.getAttribute('t'),v=node.getElementsByTagNameNS(NS,'v')[0]?.textContent||'';
      if(t==='s')return shared[Number(v)]||'';
      if(t==='inlineStr')return node.getElementsByTagNameNS(NS,'is')[0]?.textContent||'';
      if(t==='str'||!v)return v;
      const xf=cellXfs.children[Number(node.getAttribute('s')||0)],id=Number(xf.getAttribute('numFmtId')||0);
      const format=[...numFmts.children].find(n=>Number(n.getAttribute('numFmtId'))===id)?.getAttribute('formatCode')||({1:'0',2:'0.00',9:'0%',10:'0.00%',14:'mm/dd/yy'}[id]||'General');
      if(/[md]/i.test(format)&&/d/i.test(format)){
        const d=new Date(Date.UTC(1899,11,30)+Number(v)*86400000);
        return format==='m/d'?`${d.getUTCMonth()+1}/${d.getUTCDate()}`:`${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCFullYear()).slice(-2)}`;
      }
      const decimals=/0\.(0+)/.exec(format)?.[1].length||0;
      return format.includes('%')?(Number(v)*100).toFixed(decimals)+'%':format==='General'?v:Number(v).toFixed(decimals);
    }
    function linesFor(text,width){
      let count=0;
      for(const paragraph of String(text).split('\n')){
        let line='';count++;
        for(const word of paragraph.split(/\s+/u)){
          const candidate=line?line+' '+word:word;
          if(measure.measureText(candidate).width*.75<=width){line=candidate;continue;}
          if(line){count++;line='';}
          for(const ch of word){if(line&&measure.measureText(line+ch).width*.75>width){count++;line='';}line+=ch;}
        }
      }
      return count;
    }
    for(const [r,row] of rows){
      if(r>endRow||row.getAttribute('hidden')==='1')continue;
      for(const node of row.children){
        const ref=node.getAttribute('r');if(covered.has(ref)||hiddenColumns.has(address(ref).c))continue;
        const text=shown(node);if(!present(text))continue;
        const pos=address(ref),merge=mergeStarts.get(ref)||{first:pos,last:pos};
        let width=0,height=0;for(let c=merge.first.c;c<=merge.last.c;c++)width+=columnWidths.get(c)*pointsPerWidth;
        for(let rr=merge.first.r;rr<=merge.last.r;rr++)height+=Number(rows.get(rr)?.getAttribute('ht')||15);
        const xf=cellXfs.children[Number(node.getAttribute('s')||0)],font=fonts.children[Number(xf.getAttribute('fontId')||0)];
        const size=Number(font.getElementsByTagNameNS(NS,'sz')[0].getAttribute('val')),name=font.getElementsByTagNameNS(NS,'name')[0]?.getAttribute('val')||'Arial';
        measure.font=`${font.getElementsByTagNameNS(NS,'b').length?'bold ':''}${size}pt "${name}"`;
        const wraps=xf.getElementsByTagNameNS(NS,'alignment')[0]?.getAttribute('wrapText')==='1';
        const required=(wraps?linesFor(text,Math.max(6,width-sidePadding)):1)*size*lineLeading+sidePadding;
        if(required>height){const target=Math.floor((merge.first.r+merge.last.r)/2);setHeight(target,Number(rows.get(target)?.getAttribute('ht')||15)+required-height);}
      }
    }
    const mainEnd=mapRow(69),margin=.25,printWidth=(13-2*margin)*72,printHeight=(8.5-2*margin)*72;
    const visibleLearners=[...rows.keys()].filter(r=>r>=19&&r<=lastLearnerRow&&rows.get(r).getAttribute('hidden')!=='1');
    const signatureGap=mapRow(67),mainRows=[...rows.keys()].filter(r=>r<=mainEnd&&r!==signatureGap&&rows.get(r).getAttribute('hidden')!=='1');
    const otherHeight=sumNumbers(mainRows.map(r=>Number(rows.get(r).getAttribute('ht')||15)));
    const nativeWidth=sumNumbers([...columnWidths.values()])*pointsPerWidth;
    const signingSpace=28/printHeight,targetHeight=Math.max(otherHeight/(1-signingSpace),nativeWidth*printHeight/printWidth);
    setHeight(signatureGap,targetHeight*signingSpace);
    let spare=Math.max(0,targetHeight-otherHeight-targetHeight*signingSpace);
    const extra=visibleLearners.length?Math.min(8,spare/visibleLearners.length):0;
    for(const r of visibleLearners)setHeight(r,Number(rows.get(r).getAttribute('ht'))+extra);
    spare-=extra*visibleLearners.length;
    for(const r of [mapRow(64),mapRow(65),6,9,12]){
      const old=Number(rows.get(r).getAttribute('ht')||15),add=Math.min(spare,409-old);setHeight(r,old+add);spare-=add;
    }
    const widthFactor=targetHeight*printWidth/printHeight/nativeWidth;
    for(const node of columnNodes)node.setAttribute('width',Math.min(255,Number(node.getAttribute('width'))*widthFactor).toFixed(5));
    // Native two-cell anchors stretch the logo when row/column sizes change.
    // Retain its original position, picture data and native physical dimensions.
    const drawing=parse(await zip.file('xl/drawings/drawing1.xml').async('string'));
    const dns='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',ans='http://schemas.openxmlformats.org/drawingml/2006/main';
    for(const anchor of [...drawing.documentElement.children]){
      if(anchor.localName!=='twoCellAnchor')continue;
      const picture=anchor.getElementsByTagNameNS(dns,'pic')[0],from=anchor.getElementsByTagNameNS(dns,'from')[0];
      const native=picture?.getElementsByTagNameNS(ans,'xfrm')[0]?.getElementsByTagNameNS(ans,'ext')[0];
      if(!picture||!from||!native)continue;
      const fixed=drawing.createElementNS(dns,'xdr:oneCellAnchor'),extent=drawing.createElementNS(dns,'xdr:ext');
      extent.setAttribute('cx',native.getAttribute('cx'));extent.setAttribute('cy',native.getAttribute('cy'));
      fixed.append(from,extent,picture,anchor.getElementsByTagNameNS(dns,'clientData')[0]||drawing.createElementNS(dns,'xdr:clientData'));anchor.replaceWith(fixed);
    }
    zip.file('xl/drawings/drawing1.xml',serialize(drawing));
    // Reflow changes merged ranges. Rebuild their perimeter on every physical
    // cell, including the final visible column, so Excel never clips a box.
    // Keep borderless headings and signature underlines in their native form.
    const perimeterStyles=new Map();
    for(const ref of mergeRefs){
      const [a,b]=ref.split(':').map(address),anchor=cell(a.c,a.r);
      const baseBorder=borders.children[Number(cellXfs.children[Number(anchor.getAttribute('s')||0)].getAttribute('borderId')||0)];
      const edges=['left','right','top','bottom'].map(side=>baseBorder.getElementsByTagNameNS(NS,side)[0]);
      const styled=edges.filter(edge=>edge?.getAttribute('style'));
      if(styled.length<2)continue;
      const fallback=styled[0];
      for(let r=a.r;r<=b.r;r++)for(let c=a.c;c<=b.c;c++){
        const node=cell(c,r),base=Number(node.getAttribute('s')||0);
        const mask=[c===a.c,c===b.c,r===a.r,r===b.r];
        const key=[base,...edges.map(e=>e?.getAttribute('style')||fallback.getAttribute('style')),...mask].join('|');
        if(!perimeterStyles.has(key)){
          const xf=cellXfs.children[base].cloneNode(true),border=el(stylesDoc,'border');
          ['left','right','top','bottom'].forEach((side,i)=>{
            const edge=mask[i]?(edges[i]?.getAttribute('style')?edges[i]:fallback).cloneNode(true):el(stylesDoc,side);
            // A fallback edge must use the destination side's element name.
            const destination=el(stylesDoc,side);
            for(const attr of edge.attributes)destination.setAttribute(attr.name,attr.value);
            destination.append(...[...edge.children].map(n=>n.cloneNode(true)));border.appendChild(destination);
          });
          border.appendChild(el(stylesDoc,'diagonal'));
          xf.setAttribute('borderId',borders.children.length);xf.setAttribute('applyBorder','1');borders.appendChild(border);
          perimeterStyles.set(key,cellXfs.children.length);cellXfs.appendChild(xf);
        }
        node.setAttribute('s',perimeterStyles.get(key));
      }
    }
    cellXfs.setAttribute('count',cellXfs.children.length);
    fonts.setAttribute('count',fonts.children.length);borders.setAttribute('count',borders.children.length);
    const pageSetup=sheet.getElementsByTagNameNS(NS,'pageSetup')[0];
    const pageMargins=sheet.getElementsByTagNameNS(NS,'pageMargins')[0];
    const printOptions=el(doc,'printOptions',{horizontalCentered:1,verticalCentered:1});
    sheet.insertBefore(printOptions,pageMargins);
    for (const [key, value] of Object.entries({left:.25,right:.25,top:.25,bottom:.25,header:.1,footer:.1})) pageMargins.setAttribute(key,value);
    // Excel's Folio code is 8.5 x 13 inches. Fit the full print area in landscape.
    pageSetup.removeAttribute('scale');
    for (const [key,value] of Object.entries({paperSize:14,orientation:'landscape',fitToWidth:1,fitToHeight:1})) pageSetup.setAttribute(key,value);
    sheet.getElementsByTagNameNS(NS,'pageSetUpPr')[0].setAttribute('fitToPage','1');
    for (const node of sheet.querySelectorAll('rowBreaks,colBreaks')) node.remove();
    const dimension=sheet.getElementsByTagNameNS(NS,'dimension')[0];dimension.setAttribute('ref',`A1:${col(lastCol)}${roleRow}`);
    for(const view of [...sheet.getElementsByTagNameNS(NS,'sheetView')]){view.setAttribute('topLeftCell','A1');view.setAttribute('zoomScale','100');view.setAttribute('zoomScaleNormal','100');for(const selection of [...view.getElementsByTagNameNS(NS,'selection')])selection.remove();view.appendChild(el(doc,'selection',{activeCell:'B19',sqref:'B19'}));}
    for(const row of rows.values()){
      const sorted=[...row.children].sort((a,b)=>address(a.getAttribute('r')).c-address(b.getAttribute('r')).c);row.replaceChildren(...sorted);
    }
    sheetData.replaceChildren(...[...rows.entries()].sort((a,b)=>a[0]-b[0]).map(([,row])=>row));
    cellXfs.setAttribute('count',cellXfs.children.length);zip.file('xl/styles.xml',serialize(stylesDoc));
    zip.file('xl/worksheets/sheet1.xml',serialize(doc));
    const wb=parse(await zip.file('xl/workbook.xml').async('string'));
    const subjectSheet=String(section.subject||'').replace(/[\\/?*\[\]:()\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,31).replace(/^[\s']+|[\s']+$/g,'');
    const safeSheet = !subjectSheet || /^(history|activities and topics)$/i.test(subjectSheet) ? 'Class Record' : subjectSheet;
    wb.getElementsByTagNameNS(NS,'sheet')[0].setAttribute('name',safeSheet);
    let names=wb.getElementsByTagNameNS(NS,'definedNames')[0];if(!names){names=el(wb,'definedNames');wb.documentElement.appendChild(names);}
    [...names.children].filter(n=>['_xlnm.Print_Area','_xlnm.Print_Titles'].includes(n.getAttribute('name'))).forEach(n=>n.remove());
    const escaped=`'${safeSheet.replace(/'/g,"''")}'`;
    const printArea=el(wb,'definedName',{name:'_xlnm.Print_Area',localSheetId:0});
    printArea.textContent=`${escaped}!$A$1:$${col(lastCol)}$${mainEnd}${original?`,${escaped}!$A$${mapRow(71)}:$${col(lastCol)}$${endRow}`:''}`;names.appendChild(printArea);
    if(!original){
      await addActivitySummary(zip,wb,stylesDoc,payload,metadata,baseRows);
      zip.file('xl/styles.xml',serialize(stylesDoc));
    }
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
    if(root.CSTRFiles){await root.CSTRFiles.deliver(blob,[payload.section.level,payload.section.subject,payload.section.section,payload.period.name].filter(Boolean).join('-').replace(/[^a-z0-9]+/gi,'-')+'.xlsx');return result;}
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=[payload.section.level,payload.section.subject,payload.section.section,payload.period.name].filter(Boolean).join('-').replace(/[^a-z0-9]+/gi,'-')+'.xlsx';
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return result;
  }
  root.CSTRSchoolExcel={build,download,validate};
})(typeof window==='object'?window:globalThis);
