import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const web=path.resolve(import.meta.dirname,'../site-dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.otf':'font/otf'};
export function serve(port=0){
  return new Promise((resolve,reject)=>{
    const server=http.createServer(async(req,res)=>{
      try{
        const route=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
        let file=path.resolve(web,'.'+route);
        if(file!==web&&!file.startsWith(web+path.sep)){res.writeHead(403).end();return;}
        if((await stat(file)).isDirectory())file=path.join(file,'index.html');
        const bytes=await readFile(file);
        res.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-store'}).end(bytes);
      }catch{res.writeHead(404).end('Page not found');}
    });
    server.on('error',reject);
    server.listen(port,'127.0.0.1',()=>resolve({server,origin:'http://127.0.0.1:'+server.address().port}));
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {origin}=await serve(Number(process.argv[2]??8765));console.log('Class Record preview '+origin);
}
