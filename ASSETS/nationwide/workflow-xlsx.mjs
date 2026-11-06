import {CUTOFFS,descriptor,SLOTS,TERM_KEYS} from './policy.mjs';

const banner='SYNTHETIC PRACTICE ONLY · Supplementary class record';
const sheetNames=['TERM 1','TERM 2','TERM 3'];
const scoreColumns=['F','G','H','I','J','N','O','P','T','U','V'];
const formula=(f,value='')=>({f,t:typeof value==='number'?'n':'str',v:value});
const lookup=(address)=>`IF(ISNUMBER(${address}),LOOKUP(${address},HELPER!$D$2:$D$6,HELPER!$E$2:$E$6),"")`;

export function workflowWorkbook(XLSX,record,rows){
  const book=XLSX.utils.book_new();
  book.Props={Title:`Grade ${record.grade} ${record.subject} three-term practice`,Author:'Class Record'};
  const sheet=()=>XLSX.utils.aoa_to_sheet([[banner]]);
  const put=(ws,address,value)=>XLSX.utils.sheet_add_aoa(ws,[[value]],{origin:address});
  const putAll=(ws,entries)=>{for(const [address,value] of Object.entries(entries))put(ws,address,value);};
  const input=sheet();
  putAll(input,{C14:'School',E14:record.schoolName,C15:'School year',E15:record.schoolYear,C23:'Subject teacher',E23:'Practice teacher',
    C24:'Subject',E24:record.subject,C25:'Grade level',E25:record.grade,I10:'Practice learners',
    C28:'Layout reference: SY 2026–2027 three-term ECR for Science, Math, English, Filipino and AP.',
    C29:'Required scores stay pending. Exact transmutation cutoffs follow DepEd Order 015, s. 2026.',
    C30:'Generated for practice and review. Use the school-approved original for official submission.'});
  rows.forEach((row,index)=>put(input,'I'+(11+index),row.name));
  input['!cols']=[{wch:12},{wch:6},{wch:23},{wch:6},{wch:20},{wch:8},{wch:8},{wch:8},{wch:28}];
  XLSX.utils.book_append_sheet(book,input,'INPUT DATA');

  for(const [index,term] of TERM_KEYS.entries()){
    const ws=sheet(),period=record.periods?.[term]??{},hps=period.hps??{};
    putAll(ws,{B8:record.schoolName,B10:sheetNames[index],F10:'Grade '+record.grade,N10:'Practice teacher',Y10:record.subject,
      F12:'Written work (20%)',N12:'Performance tasks (50%)',T12:'Examinations (30%)',AB12:'Initial grade',AC12:'Term grade',AD12:'Descriptor',
      K14:'Total',L14:'PS',M14:'WS',Q14:'Total',R14:'PS',S14:'WS',W14:'PS ST1',X14:'PS ST2',Y14:'PS TE',Z14:'PS',AA14:'WS',
      B15:'Highest possible score',B16:'Learners'});
    for(const [index,[slot,label]] of SLOTS.entries()){
      const col=scoreColumns[index];put(ws,col+'14',label);
      if(hps[slot]!==undefined)put(ws,col+'15',hps[slot]);
    }
    rows.forEach((row,i)=>{
      const r=i+18,scores=period.scores?.[row.id]??{},actual=row.terms[index];
      put(ws,'B'+r,row.name);
      for(const [i,[slot]] of SLOTS.entries())if(scores[slot]!==undefined)put(ws,scoreColumns[i]+r,scores[slot]);
      const invalid=col=>{
        const h=col+'$15',s=col+r;
        return `IF(${h}="",${s}<>"",IF(AND(ISNUMBER(${h}),ISNUMBER(${s})),OR(${h}<0.001,${h}>10000,${h}<>ROUND(${h},3),${s}<>ROUND(${s},3),${s}<0,${s}>${h}),TRUE))`;
      };
      const component=(start,end,total,percent,weight,share,cols,actualPercent)=>{
        const max=`${start}$15:${end}$15`;
        const bad=[`SUM(${max})<=0`,...cols.map(invalid)].join(',');
        const raw=actualPercent===undefined?'':cols.reduce((sum,col)=>sum+Number(scores[SLOTS[scoreColumns.indexOf(col)][0]]??0),0);
        ws[total+r]=formula(`IF(OR(${bad}),"",SUM(${start}${r}:${end}${r}))`,raw);
        ws[percent+r]=formula(`IF(ISNUMBER(${total}${r}),100*${total}${r}/SUM(${max}),"")`,actualPercent);
        ws[weight+r]=formula(`IF(ISNUMBER(${percent}${r}),${share}*${percent}${r},"")`,actualPercent===undefined?'':actualPercent*share);
      };
      component('F','J','K','L','M',.2,scoreColumns.slice(0,5),actual.written);
      component('N','P','Q','R','S',.5,scoreColumns.slice(5,8),actual.performance);
      const exams=scoreColumns.slice(8);
      exams.forEach((col,j)=>{
        const part=actual.exams===undefined?'':100*[.3,.3,.4][j]*scores[SLOTS[j+8][0]]/hps[SLOTS[j+8][0]];
        ws['WXY'[j]+r]=formula(`IF(OR(COUNT(T$15:V$15)<>3,${exams.map(invalid).join(',')}),"",${[30,30,40][j]}*${col}${r}/${col}$15)`,part);
      });
      ws['Z'+r]=formula(`IF(COUNT(W${r}:Y${r})=3,SUM(W${r}:Y${r}),"")`,actual.exams);
      ws['AA'+r]=formula(`IF(ISNUMBER(Z${r}),0.3*Z${r},"")`,actual.exams===undefined?'':actual.exams*.3);
      ws['AB'+r]=formula(`IF(COUNT(M${r},S${r},AA${r})=3,SUM(M${r},S${r},AA${r}),"")`,actual.ig);
      ws['AC'+r]=formula(`IF(ISNUMBER(AB${r}),59+MATCH(ROUND(AB${r},12),HELPER!$A$2:$A$42,1),"")`,actual.tg);
      ws['AD'+r]=formula(lookup('AC'+r),actual.descriptor);
    });
    ws['!ref']=`A1:AD${Math.max(17,17+rows.length)}`;
    ws['!cols']=Array.from({length:30},(_,col)=>({wch:col===1?27:col===29?18:col<5?8:12}));
    XLSX.utils.book_append_sheet(book,ws,sheetNames[index]);
  }
  const final=sheet();
  putAll(final,{B8:record.schoolName,B9:'Grade '+record.grade,H9:record.subject,B10:record.schoolYear,B11:'Learner',
    F12:'Term 1',G12:'Term 2',H12:'Term 3',I11:'Final grade',J11:'Descriptor',K11:'Remarks'});
  rows.forEach((row,i)=>{
    const r=i+14;
    put(final,'B'+r,row.name);
    sheetNames.forEach((name,index)=>{
      const termGrade=`'${name}'!AC${i+18}`;
      final['FGH'[index]+r]=formula(`IF(ISNUMBER(${termGrade}),${termGrade},"")`,row.terms[index].tg);
    });
    final['I'+r]=formula(`IF(COUNT(F${r}:H${r})=3,ROUND(AVERAGE(F${r}:H${r}),0),"")`,row.final??'');
    final['J'+r]=formula(lookup('I'+r),row.final==null?'':descriptor(row.final));
    final['K'+r]=formula(`IF(ISNUMBER(I${r}),IF(I${r}>=75,"Passed","Below passing grade"),"")`,
      row.final==null?'':row.final>=75?'Passed':'Below passing grade');
  });
  final['!ref']=`A1:K${Math.max(13,13+rows.length)}`;
  final['!cols']=Array.from({length:11},(_,i)=>({wch:i===1?29:i===10?24:14}));
  XLSX.utils.book_append_sheet(book,final,'FINAL GRADES');
  const helper=XLSX.utils.aoa_to_sheet([['Inclusive initial grade','Term grade','', 'Minimum grade','Descriptor'],
    ...CUTOFFS.map((cut,i)=>[cut,60+i,null,[60,65,75,80,90][i],['Emerging','Developing','Connecting','Benchmarking','Advancing'][i]])]);
  XLSX.utils.book_append_sheet(book,helper,'HELPER');
  return book;
}
