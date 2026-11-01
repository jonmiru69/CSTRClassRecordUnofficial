import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function stampAssets(html,directory){
  const matches=[...html.matchAll(/((?:src|href)=")(ASSETS\/[^"?#]+)(?:\?[^"#]*)?("[\s>])/g)];
  for(const match of matches){
    const target=path.resolve(directory,match[2]);
    if(!target.startsWith(path.join(directory,'ASSETS')+path.sep))throw new Error('Asset path escaped the public asset directory.');
    const digest=createHash('sha256').update(await readFile(target)).digest('hex').slice(0,16);
    html=html.replace(match[0],`${match[1]}${match[2]}?v=${digest}${match[3]}`);
  }
  return html;
}
