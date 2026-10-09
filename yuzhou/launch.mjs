// A manual desktop entry: reuses only this exact copy, never an unrelated service.
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {resolveCompetitionOptions, assertOrdinaryPath} from './runtime.mjs';
import {digest} from './backend/store.mjs';
import {isCliEntry} from './backend/is-cli.mjs';

export async function probeInstance(url, expectedId, fetchImpl=fetch) {
  try {
    const response=await fetchImpl(url+'/api/instance',{redirect:'error',signal:AbortSignal.timeout(1500)});
    if(!response.ok||Number(response.headers.get('content-length'))>4096){await response.body?.cancel();return false;}
    if(!response.body)return false;
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try {
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        bytes+=value.byteLength;
        if(bytes>4096){await reader.cancel();return false;}
        chunks.push(value);
      }
    } finally {reader.releaseLock();}
    const info=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
    return info.application==='czb-yuzhou'&&info.instanceId===expectedId;
  } catch {return false;}
}

export async function portFree(port) {
  const probe=createServer();
  return new Promise(done=>{probe.once('error',()=>done(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>done(true)));});
}

function openPage(url) {
  const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  const child=spawn(command,args,{windowsHide:true,detached:true,stdio:'ignore'});
  child.on('error',()=>console.log('浏览器未能自动打开，请使用上方本机地址。'));child.unref();
}

export async function launchWorkbench({env=process.env,open=openPage,probe=probeInstance,isFree=portFree,start}={}) {
  if(process.argv[1])assertOrdinaryPath(process.argv[1]);
  const runtime=resolveCompetitionOptions({},env);
  const url=`http://${runtime.host}:${runtime.port}`;
  const expectedId=digest(`${runtime.frontendDir}\n${runtime.dataDir}`);
  if(await probe(url,expectedId)){console.log(`本比赛完整副本已运行：${url}`);open(url);return {reused:true};}
  if(!await isFree(runtime.port))throw new Error('本副本端口被其他程序占用。未连接或停止该程序，请检查端口后重试。');
  const startServer=start??(await import('./start.mjs')).startCompetitionWorkbench;
  const app=await startServer({},env);
  if(!await probe(url,expectedId)){await app.close();throw new Error('新实例身份验证未通过，没有自动打开页面。');}
  console.log(`完整宇宙：${url}`);open(url);return {reused:false,app};
}

if(isCliEntry(import.meta.url)) {
  try {await launchWorkbench();}
  catch(error){console.error(error.message);process.exitCode=1;}
}
