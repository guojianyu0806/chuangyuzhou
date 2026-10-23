import assert from 'node:assert/strict';
import {existsSync,lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseConfiguration} from '../chuangyuzhou/tools/start.mjs';
import {COOKIE_NAME,DEFAULT_PORT,FRONTEND_ROOT,PROJECT_ROOT,RUNTIME_ROOT,resolveCompetitionOptions} from '../chuangyuzhou/yuzhou/runtime.mjs';
import {verifySource} from '../chuangyuzhou/tools/verify-source.mjs';

const trackRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repositoryRoot=resolve(trackRoot,'..');
const applicationRoot=join(trackRoot,'chuangyuzhou');
const source=join(repositoryRoot,'submission','创宇宙-v2');
const baseline=JSON.parse(readFileSync(join(trackRoot,'evidence/WEB-001/baseline-files.json'),'utf8'));
const hash=data=>createHash('sha256').update(data).digest('hex');
const canonical=p=>process.platform==='win32'?p.toLowerCase():p;
function ordinary(path){const info=lstatSync(path);assert.equal(info.isSymbolicLink(),false,path);if(info.isFile())assert.equal(info.nlink,1,path);assert.equal(canonical(realpathSync(path)),canonical(resolve(path)),path);}
for(const directory of [repositoryRoot,trackRoot,applicationRoot,PROJECT_ROOT,FRONTEND_ROOT])ordinary(directory);
for(const row of baseline.files){const path=join(source,row.path);ordinary(path);const data=readFileSync(path);assert.equal(data.length,row.bytes,row.path);assert.equal(hash(data),row.sha256,row.path);}
assert.equal(existsSync(join(applicationRoot,'.git')),false);
assert.equal(existsSync(join(trackRoot,'.git')),false);
assert.equal(PROJECT_ROOT,join(applicationRoot,'yuzhou'));
assert.equal(RUNTIME_ROOT,join(PROJECT_ROOT,'.cu-runtime'));
assert.equal(DEFAULT_PORT,4396);assert.equal(COOKIE_NAME,'czb_web_yuzhou_session');
const config=parseConfiguration(readFileSync(join(applicationRoot,'.env.example'),'utf8'));
assert.equal(config.CZB_YUZHOU_PORT,'4396');
for(const port of [4397,4398,4399])assert.throws(()=>resolveCompetitionOptions({},{PORT:String(port)}));
const current=verifySource();
const manifest=JSON.parse(readFileSync(join(applicationRoot,'SOURCE-MANIFEST.json'),'utf8'));
for(const row of manifest.files)ordinary(join(applicationRoot,row.path));
const report={recordId:'WEB-001',checkedAt:new Date().toISOString(),oldSourceFilesUnchanged:baseline.files.length,currentSourceFilesVerified:current.files,physicalFilesOnly:true,nestedGit:false,sharedRepository:true,origin:'http://127.0.0.1:4396',cookie:COOKIE_NAME,runtimeDirectory:relative(repositoryRoot,RUNTIME_ROOT).replaceAll('\\','/'),priorPortsRejected:[4397,4398,4399],modelRequest:false};
writeFileSync(join(trackRoot,'evidence/WEB-001/isolation-check.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
