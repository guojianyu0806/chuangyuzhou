// Portable release entry; forwards no inherited application credentials or paths.
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {assertOrdinaryPath} from '../yuzhou/runtime.mjs';
import {isCliEntry} from '../yuzhou/backend/is-cli.mjs';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function parseConfiguration(text='') {
  const result={CZB_YUZHOU_HOST:'127.0.0.1',CZB_YUZHOU_PORT:'4396'},seen=new Set();
  for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const line=raw.trim(); if(!line||line.startsWith('#'))continue;
    const match=/^(CZB_YUZHOU_HOST|CZB_YUZHOU_PORT)=([^\s#"']+)$/.exec(line);
    if(!match||seen.has(match[1]))throw Error('配置仅接受不重复的 CZB_YUZHOU_HOST 和 CZB_YUZHOU_PORT；不要加入密钥或其他路径。');
    seen.add(match[1]);result[match[1]]=match[2];
  }
  if(result.CZB_YUZHOU_HOST!=='127.0.0.1'||result.CZB_YUZHOU_PORT!=='4396')throw Error('仅支持本机127.0.0.1及Web赛道专用4396端口。');
  return result;
}
export function cleanEnvironment(config,temp,source=process.env) {
  const env={};
  for(const key of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT'])if(source[key])env[key]=source[key];
  return {...env,...config,TEMP:temp,TMP:temp,TMPDIR:temp,PYTHONDONTWRITEBYTECODE:'1'};
}
export async function main() {
  if(process.argv.some(a=>a.startsWith('--')&&a!=='--check'))throw Error('用法：node tools/start.mjs [--check]');
  assertOrdinaryPath(ROOT,ROOT);
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<13))throw Error('需要Node.js 22.13或以上；请从Node.js官网下载后重试。');
  await import('node:sqlite');
  const path=assertOrdinaryPath(join(ROOT,'.env'),ROOT);
  const config=parseConfiguration(existsSync(path)?readFileSync(path,'utf8'):'');
  const {verifySource}=await import('./verify-source.mjs');
  const integrity=verifySource();
  console.log(JSON.stringify({check:'passed',node:process.versions.node,sourceFiles:integrity.files,origin:`http://${config.CZB_YUZHOU_HOST}:${config.CZB_YUZHOU_PORT}`,configuration:existsSync(path)?'.env':'safe defaults',modelRequest:false}));
  if(process.argv.includes('--check'))return;
  const temp=assertOrdinaryPath(join(ROOT,'yuzhou/.cu-runtime/temp'));mkdirSync(temp,{recursive:true});
  const child=spawn(process.execPath,[join(ROOT,'yuzhou/start.mjs')],{cwd:join(ROOT,'yuzhou'),env:cleanEnvironment(config,temp),windowsHide:true,stdio:'inherit'});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  child.once('error',()=>{console.error('启动失败，请检查Node程序和目录权限。');process.exitCode=1;});
  child.once('exit',(code)=>{process.exitCode=code??1;});
}
if(isCliEntry(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
