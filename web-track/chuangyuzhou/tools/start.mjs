// Only this entry's explicit deployment and model settings may reach the app.
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {assertOrdinaryPath} from '../yuzhou/runtime.mjs';
import {isCliEntry} from '../yuzhou/backend/is-cli.mjs';
import {MODEL_ENVIRONMENT_KEYS,readModelEnvironment} from '../yuzhou/backend/model-environment.mjs';
import {WEB_ENVIRONMENT_KEYS,resolveWebAccess} from '../yuzhou/web-access.mjs';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function parseConfigurationFields(text='') {
  const result={CZB_YUZHOU_HOST:'127.0.0.1',CZB_YUZHOU_PORT:'4396',CZB_YUZHOU_MODE:'local',CZB_YUZHOU_PUBLIC_ORIGIN:'',DEEPSEEK_API_KEY:'',DEEPSEEK_MODEL:'deepseek-flash'},seen=new Set();
  for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const line=raw.trimStart(); if(!line.trim()||line.startsWith('#'))continue;
    const match=/^(CZB_YUZHOU_HOST|CZB_YUZHOU_PORT|CZB_YUZHOU_MODE|CZB_YUZHOU_PUBLIC_ORIGIN|DEEPSEEK_API_KEY|DEEPSEEK_MODEL)=([^\s#"']*)$/.exec(line);
    if(!match||seen.has(match[1]))throw Error('配置仅接受模板中的六个不重复字段；不支持引号、表达式、其他变量或路径。');
    seen.add(match[1]);result[match[1]]=match[2];
  }
  if(result.CZB_YUZHOU_HOST!=='127.0.0.1'||result.CZB_YUZHOU_PORT!=='4396')throw Error('仅支持本机127.0.0.1及Web赛道专用4396端口。');
  return result;
}
export function parseConfiguration(text='') {
  const config=parseConfigurationFields(text);readModelEnvironment(config);resolveWebAccess(config.CZB_YUZHOU_MODE,config.CZB_YUZHOU_PUBLIC_ORIGIN);return config;
}
export function resolveConfiguration(text='',source={}) {
  const config=parseConfigurationFields(text);
  // Explicit terminal values override this directory's .env, including an empty key.
  for(const key of [...WEB_ENVIRONMENT_KEYS,...MODEL_ENVIRONMENT_KEYS])if(Object.hasOwn(source,key)&&source[key]!==undefined)config[key]=source[key];
  readModelEnvironment(config);
  resolveWebAccess(config.CZB_YUZHOU_MODE,config.CZB_YUZHOU_PUBLIC_ORIGIN);
  return config;
}
export function cleanEnvironment(config,temp,source=process.env) {
  readModelEnvironment(config);
  resolveWebAccess(config.CZB_YUZHOU_MODE,config.CZB_YUZHOU_PUBLIC_ORIGIN);
  const env={};
  for(const key of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT'])if(source[key])env[key]=source[key];
  for(const key of ['CZB_YUZHOU_HOST','CZB_YUZHOU_PORT',...WEB_ENVIRONMENT_KEYS,...MODEL_ENVIRONMENT_KEYS])if(Object.hasOwn(config,key))env[key]=config[key];
  return {...env,TEMP:temp,TMP:temp,TMPDIR:temp,PYTHONDONTWRITEBYTECODE:'1'};
}
export async function main() {
  if(process.argv.some(a=>a.startsWith('--')&&a!=='--check'))throw Error('用法：node tools/start.mjs [--check]');
  assertOrdinaryPath(ROOT,ROOT);
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<13))throw Error('需要Node.js 22.13或以上；请从Node.js官网下载后重试。');
  await import('node:sqlite');
  const path=assertOrdinaryPath(join(ROOT,'.env'),ROOT);
  const config=resolveConfiguration(existsSync(path)?readFileSync(path,'utf8'):'',process.env);
  const {verifySource}=await import('./verify-source.mjs');
  const integrity=verifySource();
  const access=resolveWebAccess(config.CZB_YUZHOU_MODE,config.CZB_YUZHOU_PUBLIC_ORIGIN);
  console.log(JSON.stringify({check:'passed',node:process.versions.node,sourceFiles:integrity.files,mode:access.mode,origin:access.publicOrigin,listener:`http://${config.CZB_YUZHOU_HOST}:${config.CZB_YUZHOU_PORT}`,secureCookie:access.secureCookie,configuration:existsSync(path)?'.env and terminal':'defaults and terminal',environmentModelConfigured:Boolean(readModelEnvironment(config)),modelRequest:false}));
  if(process.argv.includes('--check'))return;
  const temp=assertOrdinaryPath(join(ROOT,'yuzhou/.cu-runtime/temp'));mkdirSync(temp,{recursive:true});
  const child=spawn(process.execPath,[join(ROOT,'yuzhou/start.mjs')],{cwd:join(ROOT,'yuzhou'),env:cleanEnvironment(config,temp),windowsHide:true,stdio:'inherit'});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  child.once('error',()=>{console.error('启动失败，请检查Node程序和目录权限。');process.exitCode=1;});
  child.once('exit',(code)=>{process.exitCode=code??1;});
}
if(isCliEntry(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
