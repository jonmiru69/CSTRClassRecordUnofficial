export function h(tag,props={},...children){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(props)){
    if(value==null||value===false)continue;
    if(key==='class')node.className=value;
    else if(key.startsWith('on'))node.addEventListener(key.slice(2),value);
    else node.setAttribute(key,value===true?'':String(value));
  }
  for(const child of children.flat(Infinity))if(child!=null&&child!==false)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
export const p=(text,className)=>h('p',{class:className},text);
export const btn=(label,onclick,className='secondary',props={})=>h('button',{type:'button',class:className,onclick,...props},label);
export const link=(label,href,className)=>h('a',{href,class:className},label);
let nextField=0;
export function field(label,input){
  const labelId='field-label-'+ ++nextField;
  if(!input.hasAttribute('aria-label'))input.setAttribute('aria-labelledby',labelId);
  return h('label',{},h('span',{id:labelId},label),input);
}
export const status=()=>h('p',{class:'status',role:'status','aria-live':'polite'});
export function say(node,text,bad=false){node.toggleAttribute('data-error',bad);node.textContent=text;}
export function option(value,label=value){return h('option',{value},label);}
