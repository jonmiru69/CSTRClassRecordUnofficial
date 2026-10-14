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
 const pages=ctx.CSTROfficialGradesheet.renderPages({subject:'Synthetic',teacherName:'Synthetic teacher',principalName:'Synthetic principal',schoolYear:'2026-2027',weights:[30,40,30],students:[]});assert(pages.length>0&&pages.every(p=>p.startsWith('<svg')));console.log('PASS Official SVG page generation. PDF binary generation and visual export layout still require browser acceptance.');
})().catch(e=>{console.error(e);process.exitCode=1;});

