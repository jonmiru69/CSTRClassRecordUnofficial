/* Spreadsheet clipboard and selection behavior for the activity register.
   Teacher records and validation remain owned by app.js. */
(function(root){
  'use strict';
  function parse(text){
    const rows=[],row=[];let field='',quoted=false;
    const source=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    for(let i=0;i<source.length;i++){
      const ch=source[i];
      if(ch==='"'&&(quoted||field==='')){
        if(quoted&&source[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
      }else if(!quoted&&(ch==='\t'||ch==='\n')){
        row.push(field);field='';if(ch==='\n'){rows.push(row.splice(0));}
      }else field+=ch;
    }
    if(quoted)throw new Error('The pasted table has an unfinished quoted cell.');
    if(field!==''||row.length||!rows.length){row.push(field);rows.push(row);}
    const width=Math.max(...rows.map(r=>r.length));
    return rows.map(r=>Array.from({length:width},(_,i)=>r[i]??''));
  }
  const stringify=rows=>rows.map(row=>row.map(value=>{
    const text=String(value??'');return /[\t\n\r"]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
  }).join('\t')).join('\n');
  const sizeLabel=(rows,cols)=>`${rows} ${rows===1?'row':'rows'} × ${cols} ${cols===1?'column':'columns'}`;
  function mount(host,api){
    const doc=host.ownerDocument;
    let anchor=null,end=null,key=null,shape='',drag=false,moved=false,editing=false,extend=false,bulk=false,scrollTimer=null,point=null;
    const table=()=>host.querySelector('.activity-register table');
    const cells=()=>[...(table()?.querySelectorAll('[data-register-cell]')||[])];
    const coordinate=node=>node?{row:Number(node.dataset.registerRow),col:Number(node.dataset.registerCol)}:null;
    const cellAt=(r,c)=>table()?.querySelector(`[data-register-row="${r}"][data-register-col="${c}"]`);
    const control=node=>node?.querySelector('textarea,input');
    const dimensions=()=>({rows:table()?.querySelectorAll('tbody tr').length||0,cols:4});
    const bounds=()=>anchor&&end?{top:Math.min(anchor.row,end.row),bottom:Math.max(anchor.row,end.row),left:Math.min(anchor.col,end.col),right:Math.max(anchor.col,end.col)}:null;
    const multi=()=>{const b=bounds();return b&&(b.top!==b.bottom||b.left!==b.right);};
    const inside=target=>target?.closest?.('.activity-register');
    function paint(){
      const b=bulk?bounds():null,d=dimensions();
      for(const node of cells()){
        const p=coordinate(node),selected=!!b&&p.row>=b.top&&p.row<=b.bottom&&p.col>=b.left&&p.col<=b.right;
        node.classList.toggle('register-cell-selected',selected);node.setAttribute('aria-selected',String(selected));
        node.classList.toggle('register-cell-anchor',selected&&p.row===anchor.row&&p.col===anchor.col);
      }
      host.querySelectorAll('[data-register-column]').forEach(button=>button.setAttribute('aria-pressed',String(!!b&&b.top===0&&b.bottom===d.rows-1&&Number(button.dataset.registerColumn)>=b.left&&Number(button.dataset.registerColumn)<=b.right)));
      host.querySelectorAll('[data-register-select-row]').forEach(button=>button.setAttribute('aria-pressed',String(!!b&&b.left===0&&b.right===d.cols-1&&Number(button.dataset.registerSelectRow)>=b.top&&Number(button.dataset.registerSelectRow)<=b.bottom)));
      const status=host.querySelector('[data-register-selection]');
      if(status)status.textContent=b?`${sizeLabel(b.bottom-b.top+1,b.right-b.left+1)} selected`:'Select cells, rows or columns';
      const toggle=host.querySelector('[data-register-extend]');if(toggle)toggle.setAttribute('aria-pressed',String(extend));
    }
    function stopDrag(){drag=false;if(scrollTimer!==null){root.clearInterval(scrollTimer);scrollTimer=null;}}
    function clear(){anchor=end=null;stopDrag();moved=editing=bulk=false;extend=false;paint();}
    function refresh(){
      const context=api.context(),d=dimensions(),nextShape=d.rows+':'+d.cols;
      if(!table()||context.key!==key||shape!==nextShape){clear();key=context.key;shape=nextShape;}
      paint();
    }
    function focus(p=anchor){const input=p&&control(cellAt(p.row,p.col));if(input&&!input.disabled)input.focus({preventScroll:true});else if(p)cellAt(p.row,p.col)?.focus({preventScroll:true});}
    function select(a,b=a,shouldFocus=false,explicit=true){
      refresh();api.activate();anchor=a;end=b;bulk=explicit;editing=!explicit;paint();if(shouldFocus)focus();
    }
    function header(target,shift){
      const row=target.closest('[data-register-select-row]'),column=target.closest('[data-register-column]'),all=target.closest('[data-register-select-all]'),d=dimensions();
      if(!d.rows)return false;
      if(row){const r=Number(row.dataset.registerSelectRow);select({row:shift&&anchor?anchor.row:r,col:0},{row:r,col:d.cols-1},true);return true;}
      if(column){const c=Number(column.dataset.registerColumn);select({row:0,col:shift&&anchor?anchor.col:c},{row:d.rows-1,col:c},true);return true;}
      if(all){select({row:0,col:0},{row:d.rows-1,col:d.cols-1},true);return true;}
      return false;
    }
    function read(){
      const b=bounds();if(!b)return '';
      return stringify(Array.from({length:b.bottom-b.top+1},(_,r)=>Array.from({length:b.right-b.left+1},(_,c)=>api.read(b.top+r,b.left+c))));
    }
    function apply(matrix){
      refresh();const b=bounds(),d=dimensions();if(!b)return false;
      if(api.context().locked)throw new Error('Unlock this grading period before editing the activity register.');
      if(matrix.length*matrix[0].length>20000)throw new Error('Paste a smaller block (up to 20,000 cells).');
      const height=b.bottom-b.top+1,width=b.right-b.left+1;
      const tile=height%matrix.length===0&&width%matrix[0].length===0;
      const rows=tile?height:matrix.length,cols=tile?width:matrix[0].length;
      if(b.top+rows>d.rows||b.left+cols>d.cols)throw new Error('This block extends beyond the activity register. Add activities in Manage columns or choose a smaller block first.');
      const changes=[];
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)changes.push({row:b.top+r,col:b.left+c,value:matrix[r%matrix.length][c%matrix[0].length]});
      api.apply(changes);end={row:b.top+rows-1,col:b.left+cols-1};bulk=rows>1||cols>1;editing=!bulk;refresh();focus();
      api.status(`Updated ${sizeLabel(rows,cols)} in the activity register.`);return true;
    }
    function attempt(callback){try{return callback();}catch(error){api.status(error.message,'error');return false;}}
    function nativeText(target){return !multi()&&target?.matches?.('textarea,input:not([type="date"])')&&target.selectionStart!==target.selectionEnd;}
    // Scope all clipboard commands to this register, never another sheet/dialog.
    for(const type of ['copy','cut','paste'])host.addEventListener(type,event=>{
      if(!inside(event.target))return;
      refresh();const node=event.target.closest('[data-register-cell]');
      if(!node&&!event.target.closest('[data-register-command],[data-register-select-row],[data-register-column],[data-register-select-all]'))return;
      if(!anchor&&node)select(coordinate(node),coordinate(node),false,false);
      if(!bulk&&event.target.matches('textarea,input:not([type="date"])')&&(type!=='paste'||!/[\t\r\n]/.test(event.clipboardData.getData('text/plain'))))return;
      const nativeClipboard=nativeText(event.target)&&(type!=='paste'||!/[\t\r\n]/.test(event.clipboardData.getData('text/plain')));
      if(!bounds()||nativeClipboard)return;
      event.stopImmediatePropagation();event.preventDefault();
      attempt(()=>{
        if(type==='paste')return apply(parse(event.clipboardData.getData('text/plain')));
        if(type==='cut'&&api.context().locked)throw new Error('This grading period is locked. Copy is available; cut is disabled.');
        event.clipboardData.setData('text/plain',read());
        if(type==='cut')apply([['']]);else api.status('Copied the selected activity register cells.');
      });
    },true);
    host.addEventListener('mousedown',event=>{
      if(!inside(event.target))return;
      if(event.button!==0)return;
      stopDrag();
      if(event.target.closest('[data-register-command],[data-register-extend]')){event.preventDefault();return;}
      if(header(event.target,event.shiftKey)){event.preventDefault();event.stopPropagation();return;}
      const node=event.target.closest('[data-register-cell]');if(!node){clear();return;}
      const p=coordinate(node),explicit=event.shiftKey||extend;
      select(explicit&&anchor?anchor:p,p,explicit,explicit);
      drag=true;moved=false;point={x:event.clientX,y:event.clientY};
      scrollTimer=root.setInterval(()=>{
        if(!drag||!point||!bulk)return;
        const wrap=host.querySelector('.activity-register-scroll');if(!wrap)return;
        const rect=wrap.getBoundingClientRect();
        const dx=point.x>rect.right-24?16:point.x<rect.left+24?-16:0;
        const dy=point.y>root.innerHeight-32?18:point.y<32?-18:0;
        if(dx)wrap.scrollLeft+=dx;
        if(dy)root.scrollBy(0,dy);
        if(!dx&&!dy)return;
        const node=doc.elementFromPoint(point.x,point.y)?.closest('[data-register-cell]');
        if(node&&inside(node)){end=coordinate(node);moved=true;bulk=true;editing=false;paint();}
      },40);
      if(event.shiftKey||extend){event.preventDefault();event.stopPropagation();}
    },true);
    doc.addEventListener('mousemove',event=>{
      if(!drag)return;
      if(event.buttons!==1){stopDrag();return;}
      point={x:event.clientX,y:event.clientY};
      const node=doc.elementFromPoint(event.clientX,event.clientY)?.closest('[data-register-cell]');
      if(!node||!inside(node))return;
      const p=coordinate(node);if(p.row!==end.row||p.col!==end.col){end=p;moved=true;bulk=true;editing=false;paint();doc.getSelection()?.removeAllRanges();}
      if(moved){event.preventDefault();node.scrollIntoView({block:'nearest',inline:'nearest'});}
    });
    doc.addEventListener('mouseup',stopDrag);
    root.addEventListener('blur',stopDrag);
    host.addEventListener('dragstart',event=>{if(bulk&&drag&&event.target.closest('[data-register-cell]'))event.preventDefault();});
    doc.addEventListener('mousedown',event=>{if(!inside(event.target)&&!event.target.closest('.register-paste-dialog'))clear();},true);
    host.addEventListener('dblclick',event=>{const node=event.target.closest('[data-register-cell]');if(node)select(coordinate(node),coordinate(node),false,false);},true);
    host.addEventListener('input',event=>{const node=event.target.closest('[data-register-cell]');if(node){anchor=end=coordinate(node);bulk=false;editing=true;paint();}},true);
    host.addEventListener('focusin',event=>{const node=event.target.closest('[data-register-cell]');if(event.target.matches('select[data-activity-field="role"]')){clear();return;}if(node&&!drag){const p=coordinate(node),b=bounds();if(!b||p.row<b.top||p.row>b.bottom||p.col<b.left||p.col>b.right)select(p,p,false,false);}},true);
    host.addEventListener('keydown',event=>{
      if(!inside(event.target)||event.isComposing||event.defaultPrevented)return;
      refresh();const node=event.target.closest('[data-register-cell]');if(!node)return;
      if(!anchor)select(coordinate(node),coordinate(node),false,false);
      const command=event.ctrlKey||event.metaKey,keyName=event.key.toLowerCase(),d=dimensions();
      if(command&&['c','x','v'].includes(keyName)){event.stopImmediatePropagation();return;}
      if(command&&keyName==='a'){if(!bulk)return;event.preventDefault();event.stopImmediatePropagation();select({row:0,col:0},{row:d.rows-1,col:d.cols-1});return;}
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();select(coordinate(node),coordinate(node),false,false);extend=false;paint();return;}
      if(event.key==='F2'){event.preventDefault();select(coordinate(node),coordinate(node),false,false);return;}
      if(['Delete','Backspace'].includes(event.key)&&(!editing||multi())){event.preventDefault();event.stopImmediatePropagation();attempt(()=>apply([['']]));return;}
      const delta={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],Enter:[event.shiftKey?-1:1,0],Tab:[0,event.shiftKey?-1:1]}[event.key];
      if(!delta||event.altKey||command||(!bulk&&editing&&(event.key.startsWith('Arrow')||event.key==='Enter')))return;
      const from=event.shiftKey&&event.key.startsWith('Arrow')?end:coordinate(node);
      let row=from.row+delta[0],col=from.col+delta[1];
      if(event.key==='Tab'){if(col>=d.cols){col=0;row++;}if(col<0){col=d.cols-1;row--;}}
      if(event.key==='Tab'&&(row<0||row>=d.rows))return;
      event.preventDefault();event.stopImmediatePropagation();
      const p={row:Math.max(0,Math.min(d.rows-1,row)),col:Math.max(0,Math.min(d.cols-1,col))};
      if(event.shiftKey&&event.key.startsWith('Arrow')){end=p;bulk=true;editing=false;paint();}else select(p,p,true,bulk);
      cellAt(p.row,p.col)?.scrollIntoView({block:'nearest',inline:'nearest'});
    },true);
    function pasteDialog(){
      const context=api.context().key,dialog=doc.createElement('dialog');dialog.className='register-paste-dialog';
      dialog.innerHTML='<form><h3>Paste into the activity register</h3><p>Paste your copied cells below. Dates: YYYY-MM-DD or MM/DD/YYYY.</p><textarea rows="8" aria-label="Copied activity cells" required></textarea><p role="alert"></p><div><button type="button" data-cancel>Cancel</button><button type="submit">Apply paste</button></div></form>';
      dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
      for(const type of ['copy','cut','paste','keydown'])dialog.addEventListener(type,event=>event.stopPropagation());
      dialog.querySelector('form').onsubmit=event=>{event.preventDefault();try{if(context!==api.context().key)throw new Error('The class or period changed. Reopen Paste in the intended register.');if(apply(parse(dialog.querySelector('textarea').value)))dialog.close();}catch(error){dialog.querySelector('[role="alert"]').textContent=error.message;}};
      dialog.addEventListener('close',()=>{dialog.remove();focus();});doc.body.appendChild(dialog);dialog.showModal();dialog.querySelector('textarea').focus();
    }
    host.addEventListener('click',async event=>{
      if(!inside(event.target))return;
      if(event.detail===0&&header(event.target,event.shiftKey)){event.preventDefault();return;}
      if(event.target.closest('[data-register-column],[data-register-select-row],[data-register-select-all]')){event.preventDefault();event.stopImmediatePropagation();return;}
      if(event.target.closest('[data-register-extend]')){extend=!extend;paint();return;}
      const command=event.target.closest('[data-register-command]')?.dataset.registerCommand;
      if(!command){if((moved||multi())&&event.target.closest('[data-register-cell]')){event.preventDefault();event.stopImmediatePropagation();moved=false;}return;}
      event.preventDefault();event.stopImmediatePropagation();
      if(!bounds()){api.status('Select activity register cells first.','error');return;}
      if(command==='clear'){attempt(()=>apply([['']]));return;}
      const context=api.context().key,selection=JSON.stringify(bounds());
      if(command==='copy'){
        try{await root.navigator.clipboard.writeText(read());api.status('Copied the selected activity register cells.');}catch(_){api.status('Use Ctrl+C or Command+C to copy the selected cells.','info');focus();}
      }else if(command==='paste'){
        if(api.context().locked){api.status('Unlock this grading period before pasting.','error');return;}
        let text;try{text=await root.navigator.clipboard.readText();}catch(_){
          if(context!==api.context().key||selection!==JSON.stringify(bounds())){api.status('The destination changed. Select the destination and paste again.','error');return;}
          pasteDialog();return;
        }
        if(context!==api.context().key||selection!==JSON.stringify(bounds())){api.status('The destination changed. Select the destination and paste again.','error');return;}
        attempt(()=>apply(parse(text)));
      }
    },true);
    return {refresh,clear};
  }
  root.CSTRActivityGrid={parse,stringify,mount};
})(typeof window==='object'?window:globalThis);
