/* Native dialog supplies modal focus containment and Escape behavior.
   Delegation survives class-record re-renders without observing every input. */
(() => {
 'use strict';
 const dialog=document.getElementById('policy-dialog');
 if(!dialog) return;
 let opener=null, previousOverflow='';
 // Isolate spreadsheet shortcuts while reading policies. Otherwise a retained
 // multi-cell selection could receive Delete, Cut, Copy or Escape behind it.
 for(const type of ['keydown','copy','cut','paste']){
   dialog.addEventListener(type,event=>event.stopPropagation());
 }
 document.addEventListener('click',event=>{
   const trigger=event.target.closest('[data-open-policies]');
   if(trigger){
     opener=trigger;
     if(typeof dialog.showModal!=='function'){window.open('policies.html','_blank','noopener');return;}
     if(!dialog.open){previousOverflow=document.body.style.overflow;dialog.showModal();document.body.style.overflow='hidden';dialog.scrollTop=0;dialog.querySelector('[data-close-policies]').focus();}
   }
   if(event.target.closest('[data-close-policies]')) dialog.close();
 });
 dialog.addEventListener('close',()=>{document.body.style.overflow=previousOverflow;if(opener?.isConnected)opener.focus();});
 dialog.addEventListener('click',event=>{
   const link=event.target.closest('.policy-navigation a');
   if(!link)return;
   const section=document.getElementById(link.hash.slice(1));
   if(section){event.preventDefault();section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});section.tabIndex=-1;section.focus({preventScroll:true});}
 });
})();
