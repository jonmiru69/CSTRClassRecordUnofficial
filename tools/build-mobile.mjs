import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import path from 'node:path';
import {stampAssets} from './asset-versions.mjs';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'www');
// Only this known generated directory is replaced. Never copy repository/runtime secrets.
await rm(out, {recursive:true, force:true});
await mkdir(out, {recursive:true});
for (const name of ['index.html', 'policies.html', 'ASSETS', 'downloads']) await cp(path.join(root,name),path.join(out,name),{recursive:true,filter:source=>!source.endsWith('.apk')});
await build({entryPoints:[path.join(root,'mobile/native-entry.js')],outfile:path.join(out,'ASSETS/native-bridge.js'),bundle:true,format:'iife',target:'es2022',minify:true,legalComments:'eof'});
let html = await readFile(path.join(out,'index.html'),'utf8');
html = html.replace('<script src="ASSETS/theme.js', '<script src="ASSETS/native-bridge.js"></script>\n    <script src="ASSETS/theme.js');
await writeFile(path.join(out,'index.html'),await stampAssets(html,out));
console.log('Bundled Android web assets in www. No remote server URL or development navigation allowlist.');
