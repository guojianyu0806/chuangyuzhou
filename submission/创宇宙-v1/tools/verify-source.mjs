import {readFileSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {assertOrdinaryPath} from '../yuzhou/runtime.mjs';
import {isCliEntry} from '../yuzhou/backend/is-cli.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function verifySource(){
  const manifest=JSON.parse(readFileSync(assertOrdinaryPath(join(ROOT,'SOURCE-MANIFEST.json'),ROOT),'utf8'));
  if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('源码清单无效。');
  const seen=new Set();
  for(const row of manifest.files){
    if(typeof row.path!=='string'||seen.has(row.path))throw Error('源码清单存在重复或非法路径。');seen.add(row.path);
    const path=assertOrdinaryPath(resolve(ROOT,row.path),ROOT);
    if(!statSync(path).isFile())throw Error('源码文件无效：'+row.path);
    const data=readFileSync(path);
    if(data.length!==row.bytes||createHash('sha256').update(data).digest('hex')!==row.sha256)throw Error('源码校验失败：'+row.path);
  }
  return {files:manifest.files.length,sourceCommit:manifest.sourceCommit};
}
if(isCliEntry(import.meta.url))try{console.log(JSON.stringify({ok:true,...verifySource()}));}catch(error){console.error(error.message);process.exitCode=1;}
