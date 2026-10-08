import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {PROJECT_ROOT,RUNTIME_ROOT,COOKIE_NAME,createRuntime,runtimePath} from '../src/runtime.mjs';
import {createApp} from '../src/server.mjs';

function scratch(prefix='copy-isolation-'){
  mkdirSync(RUNTIME_ROOT,{recursive:true});
  return mkdtempSync(resolve(RUNTIME_ROOT,prefix));
}
function childEnvironment(root){
  const env={};
  for(const key of ['PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT'])if(process.env[key])env[key]=process.env[key];
  return {...env,HOST:'0.0.0.0',PORT:'4173',DATA_DIR:resolve(root,'forbidden-legacy-data'),
    FRONTEND_DIR:resolve(root,'forbidden-legacy-frontend'),SETUP_TOKEN:'synthetic-legacy-token',
    SETUP_TOKEN_FILE:resolve(root,'must-not-read-setup-token'),PUBLIC_ORIGIN:'https://private.invalid',
    SHIGUANG_HERMES_DIR:resolve(root,'must-not-run-hermes'),TEMP:root,TMP:root,TMPDIR:root};
}
function below(root,path){
  const value=relative(root,path);
  return value!==''&&value!=='..'&&!value.startsWith('..'+sep);
}

test('original-style copy has its own default origin, cookie and physical runtime',()=>{
  const runtime=createRuntime();
  assert.equal(runtime.port,4395);
  assert.equal(runtime.origin,'http://127.0.0.1:4395');
  assert.equal(runtime.cookieName,'czb_workbench_session');
  assert.equal(COOKIE_NAME,'czb_workbench_session');
  assert.equal(runtime.host,'127.0.0.1');
  assert.equal(runtime.dataDir,resolve(PROJECT_ROOT,'.cu-runtime','data'));
  assert.ok(below(PROJECT_ROOT,RUNTIME_ROOT));
  assert.throws(()=>runtimePath(resolve(PROJECT_ROOT,'..','..','.cu-runtime','data')));
});

test('archived personal backend CLI refuses before any private data or token access',async()=>{
  const root=scratch(),env=childEnvironment(root);
  for(const entry of ['backend/server.mjs','backend/is-cli.mjs']){
    const result=spawnSync(process.execPath,[resolve(PROJECT_ROOT,entry)],{
      cwd:PROJECT_ROOT,env,windowsHide:true,encoding:'utf8',timeout:5000
    });
    assert.equal(result.error,undefined);
    assert.equal(result.status,1);
    assert.match(result.stderr,/来源|辅助模块/);
    assert.match(result.stderr,/node start\.mjs/);
    assert.doesNotMatch(result.stderr,/ENOENT|SQLITE|listening/);
  }
  assert.equal(existsSync(env.DATA_DIR),false);
  assert.equal(existsSync(env.SHIGUANG_HERMES_DIR),false);
  assert.equal(existsSync(resolve(PROJECT_ROOT,'.private-cloud')),false);
  const archived=await import('../backend/server.mjs');
  assert.throws(()=>archived.createWorkbenchServer(),/禁止在创宇宙副本启动/);
  assert.doesNotMatch(readFileSync(resolve(PROJECT_ROOT,'backend/server.mjs'),'utf8'),/store\.mjs|hermes\.mjs|process\.env/);
});

test('copied frontend entries reject personal ports and delegate to the isolated root',()=>{
  const root=scratch(),env=childEnvironment(root);
  for(const entry of ['frontend/server.mjs','frontend/launch.mjs']){
    const source=readFileSync(resolve(PROJECT_ROOT,entry),'utf8');
    assert.match(source,/new URL\('\.\.\/start\.mjs', import\.meta\.url\)/);
    const result=spawnSync(process.execPath,[resolve(PROJECT_ROOT,entry),'--port','4173'],{
      cwd:PROJECT_ROOT,env,windowsHide:true,encoding:'utf8',timeout:5000
    });
    assert.equal(result.error,undefined);
    assert.equal(result.status,1);
    assert.match(result.stderr,/4380至4399/);
    assert.equal(existsSync(env.DATA_DIR),false);
  }
  const cmd=readFileSync(resolve(PROJECT_ROOT,'frontend/start.cmd'),'utf8');
  assert.match(cmd,/cd \/d "%~dp0\.\."/);
  assert.match(cmd,/node start\.mjs %\*/);
});

test('safe frontend compatibility entry starts only the competition backend with clean data',async t=>{
  const root=scratch(),dataDir=resolve(root,'data'),env=childEnvironment(root);
  const child=spawn(process.execPath,[resolve(PROJECT_ROOT,'frontend/server.mjs'),'--port','4394','--data-dir',dataDir],{
    cwd:PROJECT_ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  let output='',errors='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
  t.after(async()=>{
    if(child.exitCode===null){child.kill();await new Promise(resolveExit=>child.once('exit',resolveExit));}
  });
  await new Promise((resolveReady,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('独立入口未就绪')),5000);
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',()=>{clearTimeout(timeout);reject(new Error('独立入口提前退出'));});
    child.stdout.on('data',()=>{
      if(output.includes('http://127.0.0.1:4394')){clearTimeout(timeout);resolveReady();}
    });
  });
  const health=await fetch('http://127.0.0.1:4394/api/health').then(response=>response.json());
  assert.deepEqual(health,{productId:'chuang-universe',version:JSON.parse(readFileSync(resolve(PROJECT_ROOT,'package.json'),'utf8')).version,mode:'local-independent'});
  const auth=await fetch('http://127.0.0.1:4394/api/auth').then(response=>response.json());
  assert.equal(auth.setupRequired,true);
  assert.equal(auth.authenticated,false);
  assert.equal(existsSync(env.DATA_DIR),false);
  assert.equal(existsSync(env.SETUP_TOKEN_FILE),false);
  assert.ok(below(RUNTIME_ROOT,dataDir));
  assert.doesNotMatch(output+errors,/Yuzhou|listening on|4173/);
});

test('new API ignores both former cookies and serves the copied web manifest',async t=>{
  const app=createApp({port:4393,dataDir:scratch('copy-cookie-'),setupCode:'synthetic-copy-only-code'});
  await app.listen();t.after(()=>app.close());
  const setup=await fetch(app.runtime.origin+'/api/setup',{
    method:'POST',headers:{Origin:app.runtime.origin,'Content-Type':'application/json'},
    body:JSON.stringify({setupCode:'synthetic-copy-only-code',password:'synthetic-copy-only-password'})
  });
  assert.equal(setup.status,200);
  const cookie=setup.headers.get('set-cookie').split(';')[0];
  assert.ok(cookie.startsWith(COOKIE_NAME+'='));
  const token=cookie.slice(COOKIE_NAME.length+1);
  for(const name of ['cu_original_workbench_session','cu_workbench_session','shiguang_session']){
    const auth=await fetch(app.runtime.origin+'/api/auth',{headers:{Cookie:name+'='+token}}).then(response=>response.json());
    assert.equal(auth.authenticated,false);
  }
  const own=await fetch(app.runtime.origin+'/api/auth',{headers:{Cookie:cookie}}).then(response=>response.json());
  assert.equal(own.authenticated,true);
  const manifest=await fetch(app.runtime.origin+'/manifest.webmanifest');
  assert.equal(manifest.status,200);
  assert.match(manifest.headers.get('content-type'),/^application\/manifest\+json/);
  assert.equal(typeof (await manifest.json()).name,'string');
});

test('active competition modules never import the archived personal backend or cloud client',()=>{
  const files=[resolve(PROJECT_ROOT,'start.mjs'),...readdirSync(resolve(PROJECT_ROOT,'src')).filter(name=>name.endsWith('.mjs')).map(name=>resolve(PROJECT_ROOT,'src',name))];
  for(const file of files){
    const source=readFileSync(file,'utf8');
    const imports=[...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(match=>match[1]);
    assert.ok(imports.every(value=>!/(?:^|\/)backend\//.test(value)&&!/(?:^|\/)cloud\.js$/.test(value)),relative(PROJECT_ROOT,file));
    assert.doesNotMatch(source,/\.private-cloud|process\.env\.(?:DATA_DIR|FRONTEND_DIR|SETUP_TOKEN(?:_FILE)?|SHIGUANG_HERMES_DIR)/);
  }
});
