/* Read-only registrar folder discovery. Never writes spreadsheet cells. */
(function(root,factory){const api=factory();if(typeof module!=='undefined')module.exports=api;root.CSTROfficialDrive=api;})(typeof window!=='undefined'?window:globalThis,()=>{
  'use strict';
  function folderLink(value){
    let url;try{url=new URL(value);}catch(_){throw Error('Paste the registrar Google Drive folder link.');}
    const match=url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/);
    if(url.protocol!=='https:'||url.hostname!=='drive.google.com'||url.port||url.username||url.password||!match)throw Error('Use a Google Drive folder link containing /folders/. Drive Home and individual file links cannot be scanned as a folder.');
    return {id:match[1],resourceKey:url.searchParams.get('resourcekey')};
  }
  async function discover(link,api,alive){
    const root=folderLink(link),headers=root.resourceKey?{'X-Goog-Drive-Resource-Keys':`${root.id}/${root.resourceKey}`}:{},
      folder=await api(`files/${root.id}?supportsAllDrives=true&fields=id,name,mimeType,driveId`,{headers},true);
    if(folder.mimeType!=='application/vnd.google-apps.folder')throw Error('Choose the registrar folder containing the official gradesheets.');
    const queue=[root.id],visited=new Set(),files=new Map(),unsupported=[];
    while(queue.length){
      if(!alive())throw Error('Folder scan stopped because the account or window changed.');
      const id=queue.shift();if(visited.has(id))continue;visited.add(id);
      if(visited.size>100)throw Error('Choose a smaller folder (up to 100 subfolders). No matches were applied.');
      let pageToken='',pages=0;
      do{
        if(++pages>20)throw Error('Folder listing exceeded the scan limit. Choose a smaller folder.');
        const params=new URLSearchParams({q:`'${id}' in parents and trashed = false`,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType)',pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
        if(folder.driveId){params.set('corpora','drive');params.set('driveId',folder.driveId);}
        if(pageToken)params.set('pageToken',pageToken);
        const page=await api(`files?${params}`,{headers},true);
        if(page.incompleteSearch)throw Error('Google returned an incomplete folder listing. No matches were applied. Choose a smaller folder.');
        for(const file of page.files||[]){
          if(file.mimeType==='application/vnd.google-apps.folder')queue.push(file.id);
          else if(file.mimeType==='application/vnd.google-apps.spreadsheet')files.set(file.id,file);
          else unsupported.push(file.name);
        }
        if(files.size>150||unsupported.length>1000||queue.length>1000)throw Error('Choose a smaller folder (up to 150 Google Sheets). No matches were applied.');
        pageToken=page.nextPageToken||'';
      }while(pageToken);
    }
    return {folder,files:[...files.values()],unsupported};
  }
  async function align(sources,files,{metadata,read,engine,alive,progress}){
    const matches=sources.map(()=>[]);let totalTabs=0;
    for(let i=0;i<files.length;i++){
      if(!alive())throw Error('Folder scan stopped because the account or window changed.');
      progress(i+1,files.length,files[i].name);
      const book=await metadata(files[i].id),tabs=book.sheets.filter(s=>s.properties.sheetType==='GRID');
      if((totalTabs+=tabs.length)>300 || tabs.length>100)throw Error('The scan exceeds 300 tabs, or one workbook exceeds 100 tabs. No matches were applied. Choose a smaller folder.');
      for(const tab of tabs){
        if(!alive())throw Error('Folder scan stopped because the account or window changed.');
        const data=await read(files[i].id,tab.properties.sheetId);
        sources.forEach((source,index)=>{
          try{
            const inspection=engine.inspect(source,data,tab.properties.sheetId);
            if(inspection.mismatches.length)return;
            if(engine.plan(source,data,tab.properties.sheetId).allRows.length)matches[index].push({book,tab,inspection});
          }catch(_){/* Invalid headers, roster, weights or permissions cannot auto-match. */}
        });
      }
    }
    const counts=new Map();
    for(const options of matches)for(const option of options){const key=`${option.book.spreadsheetId}:${option.tab.properties.sheetId}`;counts.set(key,(counts.get(key)||0)+1);}
    return matches.map(options=>({options,match:options.length===1&&counts.get(`${options[0].book.spreadsheetId}:${options[0].tab.properties.sheetId}`)===1?options[0]:null}));
  }
  return {folderLink,discover,align};
});
