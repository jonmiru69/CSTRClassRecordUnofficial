/* Read-only discovery of school-account-accessible spreadsheets. Never writes spreadsheet cells. */
(function(root,factory){const api=factory();if(typeof module!=='undefined')module.exports=api;root.CSTROfficialDrive=api;})(typeof window!=='undefined'?window:globalThis,()=>{
  'use strict';
  async function discover(api,alive){
    const files=new Map(),unsupported=[];let pageToken='',pages=0;
    do{
      if(!alive())throw Error('Discovery stopped because the account or window changed.');
      if(++pages>20)throw Error('The account listing exceeded the scan limit. Use an individual official sheet link for unresolved classes.');
      const params=new URLSearchParams({q:"trashed = false and (mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')",spaces:'drive',corpora:'user',fields:'nextPageToken,incompleteSearch,files(id,name,mimeType)',pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
      if(pageToken)params.set('pageToken',pageToken);
      const page=await api(`files?${params}`,{},true);
      if(page.incompleteSearch)throw Error('Google returned an incomplete account listing. No new matches were applied. Retry or use an individual official sheet link.');
      for(const file of page.files||[]){
        if(file.mimeType==='application/vnd.google-apps.spreadsheet')files.set(file.id,file);
        else unsupported.push(file.name);
      }
      if(files.size>200)throw Error('More than 200 Google Sheets are accessible. Saved mappings are retained; use individual official sheet links for unresolved classes.');
      pageToken=page.nextPageToken||'';
    }while(pageToken);
    return {files:[...files.values()],unsupported};
  }
  async function align(sources,files,{metadata,read,engine,alive,progress}){
    const matches=sources.map(()=>[]),suggestions=sources.map(()=>[]);let totalTabs=0;
    for(let i=0;i<files.length;i++){
      if(!alive())throw Error('Discovery stopped because the account or window changed.');
      progress(i+1,files.length,files[i].name);
      const book=await metadata(files[i].id),tabs=book.sheets.filter(s=>s.properties.sheetType==='GRID');
      if((totalTabs+=tabs.length)>300 || tabs.length>100)throw Error('The scan exceeds 300 tabs, or one workbook exceeds 100 tabs. No matches were applied. Use individual official sheet links.');
      for(const tab of tabs){
        if(!alive())throw Error('Discovery stopped because the account or window changed.');
        if(tab.properties.gridProperties?.rowCount>3000)continue;
        const data=await read(files[i].id,tab.properties.sheetId);
        sources.forEach((source,index)=>{
          try{
            const inspection=engine.inspect(source,data,tab.properties.sheetId);
            const ack=inspection.mismatches.length?`${inspection.officialSection}|${inspection.officialSubject}`:null;
            const plan=engine.plan(source,data,tab.properties.sheetId,ack);
            if(plan.allRows.length)(inspection.mismatches.length?suggestions[index]:matches[index]).push({book,tab,inspection,matchedRows:plan.allRows.length});
          }catch(_){/* Invalid headers, roster, weights or permissions cannot auto-match. */}
        });
      }
    }
    const counts=new Map();
    for(const options of matches)for(const option of options){const key=`${option.book.spreadsheetId}:${option.tab.properties.sheetId}`;counts.set(key,(counts.get(key)||0)+1);}
    return matches.map((options,index)=>({options:options.length?options:suggestions[index],match:options.length===1&&counts.get(`${options[0].book.spreadsheetId}:${options[0].tab.properties.sheetId}`)===1?options[0]:null}));
  }
  return {discover,align};
});
