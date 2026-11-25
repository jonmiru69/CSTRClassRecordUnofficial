(function(root,factory){root.CSTROfficialGradesheet=factory(root);})(typeof window!=="undefined"?window:globalThis,function(root){
"use strict";
  // Measurements from REFERENCE E-GRADESHEET.xlsx, verified with native Excel.
  // Folio 8.5 x 13 in; 6 mm side margins and 9 mm top/bottom margins.
  const PAGE_WIDTH = 612, PAGE_HEIGHT = 936;
  const MARGIN_X = 72 * 6 / 25.4, MARGIN_Y = 72 * 9 / 25.4;
  const ROW_HEIGHT = 15.75, MINIMUM_OFFICIAL_ROWS = 40;
  const HEADING_HEIGHTS = [14.5, 18.5, 34, 15.5, 14.5, 23.5, 14.5, 18.5, 18.75];
  const FONT_FAMILIES = ['Calibri, Carlito, sans-serif', 'Calibri, Carlito, sans-serif', 'Times New Roman, Times, serif', 'Times New Roman, Times, serif', 'Times New Roman, Times, serif', 'Calibri, Carlito, sans-serif', 'Merriweather, Georgia, serif'];
  const gradeAndSection = p => [p.level.replace(/^grade\s+/i, ''), p.section].filter(Boolean).join('- ');
  const item = (col, span, text = '', style = {}) => ({ col, span, text: String(text), size: 12, font: 0, align: 'center', valign: 'top', ...style });
  const row = (height, cells) => ({ height, cells });

  function layout(rawPayload) {
    const payload = normalizePayload(rawPayload || {});
    const widths = [118.5, /filipino/i.test(payload.subject) ? 69 : 50, 77, 85.5, 96.5, 61, 80];
    const scale = Math.min(1, (PAGE_WIDTH - 2 * MARGIN_X) / widths.reduce((a,b) => a+b,0));
    const bottom = (PAGE_HEIGHT - 2 * MARGIN_Y) / scale - 3;
    const heading = [
      row(HEADING_HEIGHTS[0], [item(0,7,'CST-R FORM 1',{size:10,align:'left',valign:'center'})]),
      row(HEADING_HEIGHTS[1], []),
      row(HEADING_HEIGHTS[2], [item(0,7,'COLEGIO DE STO.TOMAS-RECOLETOS, INC.',{size:24,font:6})]),
      row(HEADING_HEIGHTS[3], [item(0,7,'Azcona St., San Carlos City, Negros Occidental',{size:12})]),
      row(HEADING_HEIGHTS[4], []),
      row(HEADING_HEIGHTS[5], [item(0,7,`${payload.provisional ? 'PROVISIONAL — ' : ''}REPORT ON RATINGS S.Y. ${payload.schoolYear}${payload.semester ? ` · SEMESTER ${payload.semester}` : ''}`,{size:18})]),
      row(HEADING_HEIGHTS[6], []),
      row(HEADING_HEIGHTS[7], [item(0,7,`YEAR & SECTION:    ${gradeAndSection(payload)}                         SUBJECT: ${payload.subject}`,{size:14,font:1})]),
      row(HEADING_HEIGHTS[8], []),
      row(30,[
        item(0,1,'NAMES',{size:10,align:'left',valign:'center',border:true}),
        item(1,1,payload.calendarMode==='trimester'?'TERM':'PERIOD',{size:10,font:1,border:true}),
        item(2,1,`Written Works (${payload.weights[0]}%)`,{size:11,font:3,border:true,wrap:true}),
        item(3,1,`Performance Task (${payload.weights[1]}%)`,{size:11,font:3,border:true,wrap:true,valign:'center'}),
        item(4,1,`${payload.calendarMode==='trimester'?'Term':'Quarterly'} Asses.\n (${payload.weights[2]}%)`,{size:11,font:3,border:true,wrap:true}),
        item(5,1,'Initial\n Grade',{size:11,font:1,border:true}),
        item(6,1,`${payload.calendarMode==='trimester'?'Term':'Periodical'}\n Grade`,{size:11,font:3,border:true})
      ])
    ];
    const ordinal = n => ['1st','2nd','3rd','4th'][n-1] || String(n);
    const stamp = index => index<payload.periodCount ? ordinal(payload.periodNumbers[index] || index+1)+' '+'_'.repeat((payload.periodNumbers[index] || index+1)===1?17:(payload.periodNumbers[index] || index+1)===2?16:18) : '';
    const footer = [
      row(ROW_HEIGHT, []),
      row(ROW_HEIGHT,[item(0,7,'SUBMITTED TO / CHECKED BY:',{size:11,font:1,align:'left',valign:'center'})]),
      row(ROW_HEIGHT,[]),
      row(ROW_HEIGHT,[item(0,4,payload.principalName,{font:1,align:'left',valign:'center'}),item(4,3,payload.teacherName,{font:1,valign:'center'})]),
      row(ROW_HEIGHT,[item(0,4,'School Principal',{size:11,font:5,align:'left',valign:'center'}),item(4,3,"    ( Subject Teacher's Signature Over Printed Name)",{size:11,font:1})]),
      row(ROW_HEIGHT,[]),
      row(ROW_HEIGHT,[item(0,1,stamp(0),{size:11,align:'left'}),item(1,3,stamp(2),{size:11,align:'left'}),item(4,1,stamp(0),{size:11}),item(5,2,stamp(2),{size:11,align:'left'})]),
      row(ROW_HEIGHT,[item(0,1,stamp(1),{size:11,align:'left'}),item(1,3,stamp(3),{size:11,align:'left'}),item(4,1,stamp(1),{size:11}),item(5,2,stamp(3),{size:11,align:'left'})])
    ];
    const flat = flattenRows(payload), pages=[];
    let offset=0;
    while(offset<flat.length) {
      const first=offset===0, prefix=first?heading:[], prefixHeight=prefix.reduce((n,r)=>n+r.height,0);
      const room=Math.floor((bottom-prefixHeight)/ROW_HEIGHT);
      const final=flat.length-offset<=Math.floor((bottom-prefixHeight-footer.length*ROW_HEIGHT)/ROW_HEIGHT);
      const count=final?flat.length-offset:Math.min(room,flat.length-offset-1);
      const rows=flat.slice(offset,offset+count).map((r,i,part)=> {
        const begins=i===0 || r.rowInStudent===0;
        const end=part.findIndex((next,j)=>j>i&&next.studentIndex!==r.studentIndex);
        const span=end<0?part.length-i:end-i;
        const name=begins ? `${r.student.name ? r.studentIndex+1+'. ' : ''}${r.student.name}` : '';
        const cells=[item(0,1,name,{font:2,size:11,align:'left',valign:'center',wrap:true,border:true,rowSpan:begins?span:0}),
          item(1,1,r.periodLabel,{font:3,size:r.finalRow?14:12,border:true}),
          ...[r.ww,r.pt,r.qa,r.initial,r.periodical].map((v,j)=>item(j+2,1,v,{font:r.finalRow&&j===4?1:0,size:r.finalRow&&j===4?14:12,border:true}))];
        return row(ROW_HEIGHT,cells);
      });
      pages.push({rows:[...prefix,...rows,...(final?footer:[])],first,final});
      offset+=count;
    }
    return {payload,widths,scale,pages};
  }

  function flattenRows(payload) {
    const students = payload.students.map(s=>normalizeStudent(s,payload.periodCount));
    while(students.length<payload.minimumRows)students.push(normalizeStudent({},payload.periodCount));
    return students.flatMap((student,studentIndex)=>Array.from({length:payload.periodCount+(payload.includeFinal?1:0)},(_,i)=>{
      const finalRow=i===payload.periodCount,p=student.periods[i]||{};
      // Formatting changes display precision only; supplied grades are not recomputed.
      return {student,studentIndex,rowInStudent:i,finalRow,periodLabel:finalRow?'F':String(payload.periodNumbers[i] || i+1),
        ww:finalRow?'':p.ww===null?'':String(p.ww),pt:finalRow?'':fixedOrBlank(p.pt,2),qa:finalRow?'':fixedOrBlank(p.qa,2),
        initial:finalRow?'':fixedOrBlank(p.initial,2),periodical:integerOrBlank(finalRow?student.finalGrade:p.periodical)};
    }));
  }

  function textLines(cell,width) {
    const lines=[], measure=getTextMeasure(cell);
    const fits=text=>(measure?measure.measureText(text).width:text.length*cell.size*(cell.font===2?.46:.48))<=width-4;
    for(const explicit of cell.text.split('\n')) {
      if(!cell.wrap){lines.push(explicit);continue;}
      let line='';
      for(const word of explicit.split(/\s+/u)) {
        if(line && !fits(line+' '+word)){lines.push(line);line='';}
        if(line && fits(line+' '+word)){line+=' '+word;continue;}
        for(const ch of word){
          if(line&&!fits(line+ch)){lines.push(line);line='';}
          line+=ch;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  let textMeasure;
  function getTextMeasure(cell) {
    const measure = textMeasure ||= typeof document !== 'undefined' && document.createElement ? document.createElement('canvas').getContext('2d') : null;
    if (measure) measure.font = `${[1,3].includes(cell.font)?'bold ':''}${cell.size}px "${cell.font>=2&&cell.font<=4?'Times New Roman':'Calibri'}"`;
    return measure;
  }
  function fittedSize(cell, lines, width) {
    if (cell.font === 6) return cell.size;
    const measure = getTextMeasure(cell);
    const longest = Math.max(1,...lines.map(line => measure ? measure.measureText(line).width : line.length * cell.size * .55));
    return Math.min(cell.size, cell.size * Math.max(1,width-5) / longest);
  }

  function renderPages(rawPayload) {
    const {widths,scale,pages}=layout(rawPayload);
    const xs=[MARGIN_X];widths.forEach(w=>xs.push(xs.at(-1)+w*scale));
    return pages.map(page=>{
      const parts=[`<rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#ffffff"/>`];
      let y=MARGIN_Y;
      page.rows.forEach((r,index)=>{
        for(const c of r.cells) {
          if(c.rowSpan===0)continue;
          const x=xs[c.col],width=xs[c.col+c.span]-x;
          const height=(c.rowSpan?page.rows.slice(index,index+c.rowSpan).reduce((n,v)=>n+v.height,0):r.height)*scale;
          if(c.border)parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#000000" stroke-width="${.5*scale}"/>`);
          const lines=textLines(c,width/scale),leading=c.size*1.1*scale;
          const size=Math.min(fittedSize(c,lines,width/scale)*scale,(height-1)/Math.max(1,lines.length)/1.02);
          const lineHeight=Math.min(leading,(height-1)/Math.max(1,lines.length));
          const baseline=y+(c.valign==='center'?(height-lines.length*lineHeight)/2:0)+size*.85;
          lines.forEach((line,i)=>parts.push(`<text x="${c.align==='left'?x+2*scale:x+width/2}" y="${baseline+i*lineHeight}" font-family="${xmlEscape(FONT_FAMILIES[c.font])}" font-size="${size}" font-weight="${[1,3].includes(c.font)?700:400}" font-style="${[4,5].includes(c.font)?'italic':'normal'}" text-anchor="${c.align==='left'?'start':'middle'}" fill="#000000" data-font="${c.font}" data-width="${width-4*scale}">${xmlEscape(line)}</text>`));
        }
        y+=r.height*scale;
      });
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">${parts.join('')}</svg>`;
    });
  }

  async function createWord(rawPayload) {
    if(!root.docx?.Document||!root.docx?.Packer)throw new Error('The Word export library is unavailable.');
    const {payload,widths,scale,pages}=layout(rawPayload),d=root.docx;
    const twips=value=>Math.round(value*20);
    const scaledWidths=widths.map(w=>twips(w*scale));
    const none={style:d.BorderStyle.NONE,size:0,color:'FFFFFF'};
    const thin={style:d.BorderStyle.SINGLE,size:4,color:'000000'};
    const tableRows=page=>page.rows.map(r=>{
      const occupied=new Set(),cells=[];
      for(const c of r.cells){for(let i=c.col;i<c.col+c.span;i++)occupied.add(i);}
      const all=[...r.cells,...widths.flatMap((_,col)=>occupied.has(col)?[]:[item(col,1)])].sort((a,b)=>a.col-b.col);
      for(const c of all) {
        const lines=textLines(c,widths.slice(c.col,c.col+c.span).reduce((a,b)=>a+b,0));
        const size=Math.min(fittedSize(c,lines,widths.slice(c.col,c.col+c.span).reduce((a,b)=>a+b,0)),(r.height*(c.rowSpan||1)-1)/Math.max(1,lines.length)/1.02);
        const leading=Math.min(size*1.1,(r.height*(c.rowSpan||1)-1)/Math.max(1,lines.length));
        const font=['Calibri','Calibri','Times New Roman','Times New Roman','Times New Roman','Calibri','Merriweather'][c.font];
        cells.push(new d.TableCell({
          columnSpan:c.span,width:{size:scaledWidths.slice(c.col,c.col+c.span).reduce((a,b)=>a+b,0),type:d.WidthType.DXA},
          ...(c.rowSpan!==undefined?{verticalMerge:c.rowSpan===0?d.VerticalMergeType.CONTINUE:d.VerticalMergeType.RESTART}:{}),
          verticalAlign:c.valign==='center'?d.VerticalAlign.CENTER:d.VerticalAlign.TOP,
          margins:{top:0,bottom:0,left:twips(2*scale),right:twips(2*scale)},
          borders:Object.fromEntries(['top','bottom','left','right'].map(side=>[side,c.border?thin:none])),
          children:[new d.Paragraph({alignment:c.align==='left'?d.AlignmentType.LEFT:d.AlignmentType.CENTER,
            spacing:{before:0,after:0,line:twips(leading*scale),lineRule:d.LineRuleType.EXACT},
            children:lines.map((text,i)=>new d.TextRun({text,...(i?{break:1}:{}),font,size:Math.floor(size*scale*2),bold:[1,3].includes(c.font),italics:[4,5].includes(c.font)}))})]
        }));
      }
      return new d.TableRow({cantSplit:true,height:{value:twips(r.height*scale),rule:d.HeightRule.EXACT},children:cells});
    });
    const sections=pages.map(page=>({properties:{type:d.SectionType.NEXT_PAGE,page:{size:{width:twips(PAGE_WIDTH),height:twips(PAGE_HEIGHT)},margin:{top:twips(MARGIN_Y),bottom:twips(MARGIN_Y),left:twips(MARGIN_X),right:twips(MARGIN_X),header:0,footer:0}}},children:[new d.Table({width:{size:scaledWidths.reduce((a,b)=>a+b,0),type:d.WidthType.DXA},columnWidths:scaledWidths,layout:d.TableLayoutType.FIXED,borders:{top:none,bottom:none,left:none,right:none,insideHorizontal:none,insideVertical:none},rows:tableRows(page)}),new d.Paragraph({spacing:{before:0,after:0,line:20,lineRule:d.LineRuleType.EXACT},children:[]})]}));
    const file=new d.Document({creator:payload.teacherName||'CSTR Class Record',title:`Official E-Gradesheet - ${payload.subject}`,styles:{default:{document:{run:{font:'Calibri',size:24},paragraph:{spacing:{before:0,after:0}}}}},sections});
    const blob=await d.Packer.toBlob(file);
    return {filename:officialFilename(payload,'docx'),pages:pages.length,blob};
  }

  function xmlEscape(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;"
    })[character]);
  }

  function cleanText(value) {
    return String(value === null || value === undefined ? "" : value).replace(/\s+/g, " ").trim();
  }

  function finiteNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function fixedOrBlank(value, decimals) {
    const number = finiteNumber(value);
    return number === null ? "" : number.toFixed(decimals);
  }

  function integerOrBlank(value) {
    const number = finiteNumber(value);
    return number === null ? "" : String(Math.round(number));
  }

  function safeFilePart(value) {
    return cleanText(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70);
  }

  function officialFilename(payload, extension) {
    const parts = [
      "Official-E-Gradesheet",
      payload.level,
      payload.subject,
      payload.section,
      payload.schoolYear,
      payload.semester ? `Semester-${payload.semester}` : ""
    ].map(safeFilePart).filter(Boolean);
    return `${parts.join("-") || "Official-E-Gradesheet"}.${extension}`;
  }

  function normalizeStudent(student, periodCount) {
    const sourcePeriods = Array.isArray(student && student.periods) ? student.periods : [];
    const periods = Array.from({ length: periodCount }, (_, index) => {
      const period = sourcePeriods[index] || {};
      return {
        ww: finiteNumber(period.ww),
        pt: finiteNumber(period.pt),
        qa: finiteNumber(period.qa),
        initial: finiteNumber(period.initial),
        periodical: finiteNumber(period.periodical)
      };
    });
    return {
      name: cleanText(student && student.name),
      periods,
      finalGrade: finiteNumber(student && student.finalGrade)
    };
  }

  function normalizePayload(payload) {
    const weights = Array.isArray(payload && payload.weights) ? payload.weights.map(Number) : [20, 50, 30];
    return {
      periodCount: [1, 2, 3, 4].includes(payload?.periodCount) ? payload.periodCount : 4,
      calendarMode: payload?.calendarMode || (payload?.periodCount === 3 ? 'trimester' : 'legacy'),
      includeFinal: payload?.includeFinal !== false,
      minimumRows: payload?.minimumRows === 0 ? 0 : MINIMUM_OFFICIAL_ROWS,
      periodNumbers: Array.isArray(payload?.periodNumbers) ? payload.periodNumbers.slice(0,4) : [1,2,3,4],
      semester: [1, 2].includes(payload?.semester) ? payload.semester : null,
      provisional: payload?.provisional === true,
      schoolYear: cleanText(payload && payload.schoolYear),
      level: cleanText(payload && payload.level),
      section: cleanText(payload && payload.section),
      subject: cleanText(payload && payload.subject),
      teacherName: root.CSTRExportNames ? root.CSTRExportNames.format(payload?.teacherName, payload?.teacherTitle) : cleanText(payload?.teacherName),
      principalName: root.CSTRExportNames ? root.CSTRExportNames.format(payload?.principalName, payload?.principalTitle) : cleanText(payload?.principalName),
      weights: [
        Number.isFinite(weights[0]) ? weights[0] : 20,
        Number.isFinite(weights[1]) ? weights[1] : 50,
        Number.isFinite(weights[2]) ? weights[2] : 30
      ],
      students: Array.isArray(payload && payload.students) ? payload.students : []
    };
  }

  function downloadBlob(blob, filename) {
    if (root.CSTRFiles) return root.CSTRFiles.deliver(blob, filename);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { filename, delivery: "browser-download-requested" };
  }

  async function createPdf(rawPayload) {
    if (!root.PDFLib?.PDFDocument) throw new Error("The PDF export library is unavailable.");
    const payload = normalizePayload(rawPayload || {});
    const api = root.PDFLib;
    const pdf = await api.PDFDocument.create();
    if (!root.fontkit) throw new Error("The PDF font library is unavailable. Refresh and retry.");
    // Nimbus fonts use CFF outlines inside OpenType containers. Preserve the
    // complete font: this fontkit version's CFF subsets are not reader-safe.
    pdf.registerFontkit({ create(bytes) {
      const font = root.fontkit.create(bytes);
      if (font.directory?.tables?.['CFF ']) font.cff = font['CFF '];
      return font;
    } });
    const fonts = await Promise.all(['Carlito-Regular.ttf', 'Carlito-Bold.ttf', 'NimbusRoman-Regular.otf', 'NimbusRoman-Bold.otf', 'NimbusRoman-Italic.otf', 'Carlito-Italic.ttf', 'Merriweather.ttf'].map(async name => {
      const response = await fetch(new URL(`ASSETS/fonts/${name}`, document.baseURI));
      if (!response.ok) throw new Error(`Could not load PDF font ${name}.`);
      // Keep complete fonts. This bundled fontkit/pdf-lib combination can emit
      // subset glyph IDs that render as missing characters in PDF readers.
      return pdf.embedFont(await response.arrayBuffer(), { subset: false });
    }));
    const color = hex => { const value = hex.replace('#', ''); return api.rgb(parseInt(value.slice(0,2),16)/255, parseInt(value.slice(2,4),16)/255, parseInt(value.slice(4,6),16)/255); };
    const pages = renderPages(payload);
    pdf.setTitle(`Official E-Gradesheet - ${payload.subject}`);
    pdf.setAuthor(payload.teacherName || "CSTR Class Record");
    for (const svg of pages) {
      const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      const documentSvg = new DOMParser().parseFromString(svg, 'image/svg+xml');
      for (const node of documentSvg.documentElement.children) {
        const get = (key, fallback = 0) => Number(node.getAttribute(key) || fallback);
        if (node.tagName === 'rect') {
          const fill = node.getAttribute('fill'), stroke = node.getAttribute('stroke');
          page.drawRectangle({ x: get('x'), y: PAGE_HEIGHT-get('y')-get('height'), width: get('width'), height: get('height'),
            ...(fill && fill !== 'none' ? { color: color(fill) } : { opacity: 0 }),
            ...(stroke && stroke !== 'none' ? { borderColor: color(stroke), borderWidth: get('stroke-width', .55), borderOpacity: 1 } : { borderWidth: 0 }) });
        } else if (node.tagName === 'line') {
          page.drawLine({ start: { x: get('x1'), y: PAGE_HEIGHT-get('y1') }, end: { x: get('x2'), y: PAGE_HEIGHT-get('y2') }, thickness: get('stroke-width', .55), color: color(node.getAttribute('stroke') || '#000000') });
        } else if (node.tagName === 'text') {
          const serif = (node.getAttribute('font-family') || '').includes('Times');
          const bold = get('font-weight', 400) >= 600, italic = node.getAttribute('font-style') === 'italic';
          const font = fonts[Number(node.getAttribute('data-font') || (serif ? italic ? 4 : bold ? 3 : 2 : italic ? 5 : bold ? 1 : 0))];
          const text = node.textContent;
          let size = get('font-size', 9), x = get('x');
          const anchor = node.getAttribute('text-anchor');
          // Fit metadata into its actual allotted space; retain selectable text.
          const maxWidth = Number(node.getAttribute('data-width')) || PAGE_WIDTH - MARGIN_X * 2;
          const measured = font.widthOfTextAtSize(text, size);
          if (measured > maxWidth) size *= maxWidth / measured;
          const width = font.widthOfTextAtSize(text, size);
          if (anchor === 'middle') x -= width / 2;
          else if (anchor === 'end') x -= width;
          page.drawText(text, { x, y: PAGE_HEIGHT-get('y'), font, size, color: color(node.getAttribute('fill') || '#000000') });
        }
      }
    }
    // pdf-lib labels CFF streams as raw CIDFontType0C, but these complete font
    // bytes include an OpenType header. PDF 1.7 requires the OpenType subtype.
    await pdf.flush();
    for (const font of fonts) {
      const dict = pdf.context.lookup(font.ref, api.PDFDict);
      const descendant = dict.lookup(api.PDFName.of('DescendantFonts'), api.PDFArray).lookup(0, api.PDFDict);
      const descriptor = descendant.lookup(api.PDFName.of('FontDescriptor'), api.PDFDict);
      if (!descriptor.has(api.PDFName.of('FontFile3'))) continue;
      const stream = descriptor.lookup(api.PDFName.of('FontFile3'), api.PDFRawStream);
      stream.dict.set(api.PDFName.of('Subtype'), api.PDFName.of('OpenType'));
    }
    const bytes = await pdf.save({ useObjectStreams: false });
    return { filename: officialFilename(payload, 'pdf'), pages: pages.length, bytes, blob: new Blob([bytes], { type: 'application/pdf' }) };
  }

  async function exportPdf(rawPayload) {
    const artifact = await createPdf(rawPayload);
    const delivered = await downloadBlob(artifact.blob, artifact.filename);
    return { ...artifact, delivery: delivered.delivery };
  }

  async function exportWord(rawPayload) {
    const artifact = await createWord(rawPayload);
    const delivered = await downloadBlob(artifact.blob, artifact.filename);
    return { ...artifact, delivery: delivered.delivery };
  }

  return {
    layout,
    normalizePayload,
    buildRows: (payload) => flattenRows(normalizePayload(payload || {})),
    renderPages,
    createPdf,
    createWord,
    exportPdf,
    exportWord,
    downloadBlob,
    officialFilename
  };
});
