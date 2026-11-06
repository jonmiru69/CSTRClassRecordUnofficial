import {assertScope,CUTOFFS,evaluate,finalGrade,TERM_KEYS,SLOTS,descriptor,finite} from './policy.mjs';

const scripts=new Map();
function load(asset){
  if(!scripts.has(asset))scripts.set(asset,new Promise((resolve,reject)=>{
    const node=document.createElement('script');node.src='/ASSETS/vendor/'+asset;
    node.onload=resolve;node.onerror=()=>{scripts.delete(asset);node.remove();reject(new Error('Export tools did not load. Reconnect and retry.'));};
    document.head.append(node);
  }));
  return scripts.get(asset);
}
const cell=(f,v)=>({t:typeof v==='string'?'str':'n',f,...(v===undefined?{}:{v})});
const COLS='BCDEFGHIJKL'.split('');
const termNames=['Term 1','Term 2','Term 3'];
export const reportRows=(record)=>{
  const kind=assertScope(record),learners=Object.entries(record.roster??{}).sort(([a],[b])=>a.localeCompare(b));
  if(learners.length>60)throw new Error('This layout can hold up to 60 learners. No names or scores were omitted.');
  return {kind,rows:learners.map(([id,name])=>{
    const terms=TERM_KEYS.map(t=>evaluate(record.periods?.[t]?.hps,record.periods?.[t]?.scores?.[id]));
    return {id,name,terms,final:finalGrade(terms.map(t=>t.tg))};
  })};
};
export function xlsxBook(XLSX,record) {
  const {kind,rows}=reportRows(record),practice=kind==='practice';
  const title=practice?'SYNTHETIC PRACTICE ONLY — not an official ECR':'SUPPLEMENTARY CLASS RECORD — not a DepEd form';
  const book=XLSX.utils.book_new();
  book.Props={Title:practice?'Grade 6 Science synthetic practice':'Supplementary class record',Author:'Class Record'};
  const info=XLSX.utils.aoa_to_sheet([
    [title],['School',record.schoolName],['School year',record.schoolYear],['Curriculum',record.curriculum],
    ['Grade',record.grade],['Subject',record.subject],['Policy',record.policy??record.id],
    ['Rule','Blank required scores stay pending. Numeric zero is evidence.'],
    ['Source','DepEd Order 015, s. 2026, Annex D (pilot reference)']
  ]);
  XLSX.utils.book_append_sheet(book,info,'Read me');
  for(let i=0;i<TERM_KEYS.length;i++){
    const period=record.periods?.[TERM_KEYS[i]]??{},hps=period.hps??{};
    const ws=XLSX.utils.aoa_to_sheet([
      [title],[record.schoolName,record.schoolYear,record.curriculum],['Grade',record.grade,'Subject',record.subject],
      [termNames[i]],['Written work: 20%','Performance tasks: 50%','Examinations: 30%'],['Learner',...SLOTS.map(([,l])=>l),'Initial grade','Term grade','Descriptor'],
      ['Highest possible score',...SLOTS.map(([k])=>finite(hps[k])?hps[k]:null)],
      ...rows.map(({id,name})=>[String(name),...SLOTS.map(([k])=>period.scores?.[id]?.[k]??null),null,null,null])
    ]);
    for(let j=0;j<rows.length;j++){
      const r=8+j,actual=rows[j].terms[i],bad=COLS.map(c=>{
        const h=c+'$7',s=c+r;
        return `IF(${h}="",${s}<>"",IF(AND(ISNUMBER(${h}),ISNUMBER(${s})),OR(${h}<0.001,${h}>10000,${h}<>ROUND(${h},3),${s}<>ROUND(${s},3),${s}<0,${s}>${h}),TRUE))`;
      });
      const h='SUM(B$7:F$7)<=0,SUM(G$7:I$7)<=0,COUNT(J$7:L$7)<>3';
      const formula=`IF(OR(${h},${bad.join(',')}),"",IFERROR(20*SUM(B${r}:F${r})/SUM(B$7:F$7)+50*SUM(G${r}:I${r})/SUM(G$7:I$7)+30*(0.3*J${r}/J$7+0.3*K${r}/K$7+0.4*L${r}/L$7),""))`;
      ws['M'+r]=cell(formula,actual.ig??'');
      ws['N'+r]=cell(`IF(ISNUMBER(M${r}),59+MATCH(ROUND(M${r},12),'Cutoffs'!$A$2:$A$42,1),"")`,actual.tg??'');
      ws['O'+r]=cell(`IF(NOT(ISNUMBER(N${r})),"",IF(N${r}>=90,"Advancing",IF(N${r}>=80,"Benchmarking",IF(N${r}>=75,"Connecting",IF(N${r}>=65,"Developing","Emerging")))))`,actual.descriptor??'');
    }
    ws['!ref']=`A1:O${Math.max(7,7+rows.length)}`;
    ws['!cols']=[{wch:27},...COLS.map(()=>({wch:11})),{wch:15},{wch:14},{wch:18}];
    XLSX.utils.book_append_sheet(book,ws,termNames[i]);
  }
  const summary=XLSX.utils.aoa_to_sheet([[title],[record.schoolName,record.schoolYear],['Learner','Term 1','Term 2','Term 3','Final','Descriptor'],...rows.map(r=>[String(r.name),null,null,null,null,null])]);
  rows.forEach((row,i)=>{
    const r=i+4;
    termNames.forEach((t,j)=>{const address=`'${t}'!N${i+8}`;summary['BCD'[j]+r]=cell(`IF(ISNUMBER(${address}),${address},"")`,row.terms[j].tg??'');});
    summary['E'+r]=cell(`IF(COUNT(B${r}:D${r})=3,ROUND(AVERAGE(B${r}:D${r}),0),"")`,row.final??'');
    summary['F'+r]=cell(`IF(NOT(ISNUMBER(E${r})),"",IF(E${r}>=90,"Advancing",IF(E${r}>=80,"Benchmarking",IF(E${r}>=75,"Connecting",IF(E${r}>=65,"Developing","Emerging")))))`,row.final==null?'':descriptor(row.final));
  });
  summary['!ref']=`A1:F${Math.max(3,3+rows.length)}`;
  summary['!cols']=[{wch:27},{wch:12},{wch:12},{wch:12},{wch:12},{wch:18}];
  XLSX.utils.book_append_sheet(book,summary,'Final grades');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Inclusive initial grade','Term grade'],...CUTOFFS.map((cut,i)=>[cut,i+60])]),'Cutoffs');
  return book;
}
function download(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
export async function downloadXlsx(record){
  await load('xlsx.min.js');
  const mode=assertScope(record),book=xlsxBook(window.XLSX,record);
  const bytes=window.XLSX.write(book,{type:'array',bookType:'xlsx'});
  download(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),mode==='practice'?'Grade-6-Science-SYNTHETIC-PRACTICE.xlsx':'Supplementary-class-record.xlsx');
}
function el(tag,text){const node=document.createElement(tag);if(text!=null)node.textContent=String(text);return node;}
export function reportView(record){
  const {kind,rows}=reportRows(record),out=el('article');out.className='report-paper';
  out.append(el('h2','Supplementary gradesheet'),el('p',kind==='practice'?'Synthetic practice • no real learner data':'Supplementary report • not SF9 or a DepEd submission form'),
    el('h3',record.schoolName),el('p',`Grade ${record.grade} ${record.subject} · ${record.schoolYear}`));
  const table=el('table'),head=el('thead'),h=el('tr');['Learner','Term 1','Term 2','Term 3','Final'].forEach(v=>{const th=el('th',v);th.scope='col';h.append(th);});head.append(h);table.append(head);
  const body=el('tbody');
  rows.forEach(row=>{const tr=el('tr'),name=el('th',row.name);name.scope='row';tr.append(name);[...row.terms.map(x=>x.tg),row.final].forEach(v=>tr.append(el('td',v??'Pending')));body.append(tr);});
  table.append(body);out.append(table);
  return out;
}
export async function downloadWord(record) {
  const {kind,rows}=reportRows(record);
  await load('docx.iife.js');
  const {Document,Paragraph,HeadingLevel,Table,TableRow,TableCell,Packer,WidthType}=window.docx;
  const p=(text,extra={})=>new Paragraph({text:String(text),...extra});
  const tr=(values)=>new TableRow({children:values.map(v=>new TableCell({children:[p(v)]}))});
  const doc=new Document({title:'Supplementary gradesheet',creator:'Class Record',sections:[{children:[
    p('Supplementary gradesheet',{heading:HeadingLevel.HEADING_1}),
    p(kind==='practice'?'Synthetic practice only':'Supplementary report. Not SF9 or a DepEd submission form.'),
    p(record.schoolName,{heading:HeadingLevel.HEADING_2}),p(`Grade ${record.grade} ${record.subject} · ${record.schoolYear}`),
    new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[tr(['Learner','Term 1','Term 2','Term 3','Final']),...rows.map(r=>tr([r.name,...r.terms.map(t=>t.tg??'Pending'),r.final??'Pending']))]})
  ]}]});
  download(await Packer.toBlob(doc),kind==='practice'?'Supplementary-gradesheet-SYNTHETIC.docx':'Supplementary-gradesheet.docx');
}
