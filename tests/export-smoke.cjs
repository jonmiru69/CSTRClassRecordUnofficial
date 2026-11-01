'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');const base=path.resolve(__dirname,'../ASSETS');
(async()=>{
 const xc={console,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,atob,btoa};xc.window=xc;vm.runInNewContext(fs.readFileSync(path.join(base,'vendor/xlsx.min.js'),'utf8'),xc);const XLSX=xc.XLSX;
 const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Learner','Score'],['Synthetic learner',0],['=not-a-formula',10]]),'Sample');
 const bytes=XLSX.write(workbook,{type:'array',bookType:'xlsx'});const reopened=XLSX.read(bytes,{type:'array'});assert.equal(reopened.Sheets.Sample.B2.v,0);assert.equal(reopened.Sheets.Sample.A3.f,undefined);assert.equal(reopened.Sheets.Sample.A3.v,'=not-a-formula');
 console.log('PASS Excel vendor serialization preserves numeric zero and treats text beginning with = as text.');
 const ctx={console,Blob,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Buffer,setTimeout,clearTimeout,atob,btoa};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(base,'vendor/docx.iife.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(base,'official-egradesheet.js'),'utf8'),ctx);
 const result=await ctx.CSTROfficialGradesheet.createWord({subject:'Synthetic',teacherName:'Synthetic teacher',principalName:'Synthetic principal',schoolYear:'2026-2027',weights:[30,40,30],periodCount:4,students:[]});assert(result.blob.size>1000);
 const zip=require(path.join(base,'vendor/jszip.min.js'));const archive=await zip.loadAsync(await result.blob.arrayBuffer());const doc=await archive.file('word/document.xml').async('string');assert(doc.includes('Synthetic teacher'));assert(doc.includes('2026-2027'));
 console.log('PASS Official Word exporter generates a valid ZIP containing document.xml and supplied metadata.');
 const pages=ctx.CSTROfficialGradesheet.renderPages({subject:'Synthetic',teacherName:'Synthetic teacher',principalName:'Synthetic principal',schoolYear:'2026-2027',weights:[30,40,30],students:[]});assert(pages.length>0&&pages.every(p=>p.startsWith('<svg')));console.log('PASS Official SVG page generation.');
 // Exercise the real PDF exporter and all five fonts. This tiny DOM adapter
 // supplies text nodes only; browser/Poppler acceptance covers complete layout.
 vm.runInContext(fs.readFileSync(path.join(base,'vendor/pdf-lib.min.js'),'utf8'),ctx);const pdfApi=ctx.PDFLib;
 ctx.PDFLib=pdfApi;ctx.fontkit=require(path.join(base,'vendor/fontkit.umd.min.js'));ctx.URL=URL;ctx.document={baseURI:'https://example.test/'};
 ctx.fetch=async url=>({ok:true,arrayBuffer:async()=>{const bytes=fs.readFileSync(path.join(base,'fonts',path.basename(new URL(url).pathname)));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}});
 ctx.DOMParser=class {parseFromString(svg){return {documentElement:{children:[...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map(([,attributes,text])=>({tagName:'text',textContent:text.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"),getAttribute:name=>new RegExp('(?:^|\\s)'+name+'="([^"]*)"').exec(attributes)?.[1]??null}))}};}};
 const pdfResult=await ctx.CSTROfficialGradesheet.createPdf({subject:'Synthetic Science',teacherName:'Synthetic teacher',principalName:'Synthetic principal',schoolYear:'2026-2027',weights:[20,50,30],students:[{name:'Synthetic learner'}]});
 const pdf=await pdfApi.PDFDocument.load(pdfResult.bytes);assert.equal(pdf.getPageCount(),pages.length);
 let fontCount=0;
 for(const [,object] of pdf.context.enumerateIndirectObjects()){
   if(!(object instanceof pdfApi.PDFDict)||object.get(pdfApi.PDFName.of('Type'))?.toString()!=='/FontDescriptor')continue;
   const stream=object.lookup(pdfApi.PDFName.of('FontFile3'),pdfApi.PDFRawStream);
   assert.equal(stream.dict.get(pdfApi.PDFName.of('Subtype')).toString(),'/OpenType');
   assert.equal(Buffer.from(pdfApi.decodePDFRawStream(stream).decode()).subarray(0,4).toString(),'OTTO');fontCount++;
 }
 assert.equal(fontCount,5);console.log('PASS PDF binary reload, five embedded OpenType/CFF fonts, and matching font stream declarations.');
})().catch(e=>{console.error(e);process.exitCode=1;});

