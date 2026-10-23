import test from 'node:test';
import assert from 'node:assert/strict';
import {supportsFileText,requestFileText,fileTextResultHTML,mountFileText} from '../src/file-text.js';

const file={name:'合成资料.DOCX',blobId:'synthetic/id'};
function fixture(result={units:[{label:'第 1 段',text:'合成资料正文'}],warnings:[]}) {
  const calls=[];
  const ctx={state:{mode:'personal'},cloud:{enabled:true,flush:async()=>calls.push('flush'),request:async path=>{calls.push(path);return result;}}};
  return {ctx,calls,result};
}

test('supported formats are independent from preview support and model configuration',()=>{
  for(const extension of ['TXT','md','csv','docx','pptx','pdf'])assert.equal(supportsFileText({name:`合成.${extension}`}),true);
  for(const extension of ['ppt','png','exe','zip'])assert.equal(supportsFileText({name:`合成.${extension}`}),false);
});

test('extraction waits for existing attachment sync and uses the encoded blob ID without model requests',async()=>{
  const {ctx,calls,result}=fixture();
  assert.deepEqual(await requestFileText(ctx,file),result);
  assert.deepEqual(calls,['flush','/api/files/synthetic%2Fid/text']);
});

test('example mode and unsupported files are rejected without uploading or calling APIs',async()=>{
  const {ctx,calls}=fixture();ctx.state.mode='demo';
  await assert.rejects(requestFileText(ctx,file),/请先登录后操作/);
  ctx.state.mode='personal';
  await assert.rejects(requestFileText(ctx,{...file,name:'旧课件.ppt'}),/暂不支持/);
  assert.deepEqual(calls,[]);
});

test('a failed sync prevents extraction and keeps the original file metadata unchanged',async()=>{
  const {ctx,calls}=fixture(),before=structuredClone(file);
  ctx.cloud.flush=async()=>{throw new Error('合成同步冲突');};
  await assert.rejects(requestFileText(ctx,file),/合成同步冲突/);
  assert.deepEqual(calls,[]);
  assert.deepEqual(file,before);
});

test('untrusted extracted labels, text and warnings are rendered as text, including empty scan feedback',()=>{
  const html=fileTextResultHTML({units:[{label:'<img src=x onerror=alert(1)>',text:'<script>alert(1)</script> & body'}],warnings:['<iframe src=evil>']});
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<iframe'));
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/&amp; body/);
  assert.match(fileTextResultHTML({units:[],warnings:['无文字']}),/没有提取到可读正文/);
});

test('malformed extraction output fails clearly instead of rendering an invalid response',async()=>{
  const {ctx}=fixture({units:[{label:'段落',text:{html:'bad'}}],warnings:[]});
  await assert.rejects(requestFileText(ctx,file),/结果格式异常/);
});

test('leaving the preview during extraction does not update the detached result',async t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;});
  const button={disabled:false,textContent:''},resultHost={textContent:'',innerHTML:''};
  const panel={isConnected:true,querySelector:selector=>selector==='[data-file-text]'?button:resultHost};
  globalThis.document={createElement:()=>panel};
  let resolveResult;
  const {ctx}=fixture();ctx.cloud.request=async()=>await new Promise(resolve=>{resolveResult=resolve;});
  mountFileText(ctx,{isConnected:true,append(){}},file);
  const pending=button.onclick();
  await Promise.resolve();await Promise.resolve();
  panel.isConnected=false;
  resolveResult({units:[{label:'正文',text:'已离开的预览不应收到结果'}],warnings:[]});
  await pending;
  assert.equal(resultHost.innerHTML,'');
});
