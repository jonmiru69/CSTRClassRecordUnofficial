((root) => {
  'use strict';
  const MAX_INPUT = 4 * 1024 * 1024, MAX_PIXELS = 12000000, MAX_EDGE = 8192;
  function dimensions(input) {
    const b=new Uint8Array(input),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
    if(b.length>=33 && [137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x) && v.getUint32(8)===13 && v.getUint32(12)===0x49484452)
      return {type:'image/png',width:v.getUint32(16),height:v.getUint32(20)};
    if(b[0]===255 && b[1]===216) for(let p=2;p+3<b.length;){
      if(b[p++]!==255)break;
      while(b[p]===255)p++;
      const m=b[p++];
      if(m===218||m===217||p+2>b.length)break;
      const n=v.getUint16(p);
      if(n<2||p+n>b.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(m)&&n>=8)
        return {type:'image/jpeg',height:v.getUint16(p+3),width:v.getUint16(p+5)};
      p+=n;
    }
    throw new Error('Choose a valid PNG or JPEG image.');
  }
  const safeDataUrl=(s,max=2000000)=>typeof s==='string'&&s.length<=max&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(s);
  async function encode(file,{maxEdge=500,maxOutput=450000}={}){
    if(!file||!Number.isSafeInteger(file.size)||file.size<=0||file.size>MAX_INPUT)throw new Error('Choose a PNG or JPEG smaller than 4 MB.');
    const bytes=await file.arrayBuffer(),size=dimensions(bytes);
    if(file.type!==size.type||(size.type==='image/png'?!/\.png$/i.test(file.name):!/\.jpe?g$/i.test(file.name)))throw new Error('The file type does not match the image.');
    if(!size.width||!size.height||size.width>MAX_EDGE||size.height>MAX_EDGE||size.width*size.height>MAX_PIXELS)throw new Error('Resize the image before uploading.');
    const image=await createImageBitmap(new Blob([bytes],{type:size.type})).catch(()=>{throw new Error('The image could not be opened.');});
    try {
      if(!image.width||!image.height||image.width*image.height>MAX_PIXELS)throw new Error('Resize the image before uploading.');
      const canvas=document.createElement('canvas'),ratio=Math.min(1,maxEdge/Math.max(image.width,image.height));
      canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
      const ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('Image processing is unavailable on this device.');
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      let result=canvas.toDataURL(size.type,.85);
      if(!safeDataUrl(result,maxOutput)){
        ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        result=canvas.toDataURL('image/jpeg',.78);
      }
      if(!safeDataUrl(result,maxOutput))throw new Error('The resized image is too large. Choose a smaller image.');
      return result;
    } finally {image.close();}
  }
  const api={dimensions,encode,safeDataUrl};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CSTRSafeRaster=api;
})(typeof window==='undefined'?globalThis:window);
