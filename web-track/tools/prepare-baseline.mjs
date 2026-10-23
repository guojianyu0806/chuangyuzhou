// One-time physical checkout of the selected, public source version.
import {copyFileSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const trackRoot=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot=resolve(trackRoot, '..');
const source=join(repositoryRoot, 'submission', '创宇宙-v2');
const destination=join(trackRoot, 'chuangyuzhou');
const evidence=join(trackRoot, 'evidence', 'WEB-001');
const canonical=p=>process.platform==='win32'?p.toLowerCase():p;
const digest=data=>createHash('sha256').update(data).digest('hex');
function ordinary(path) {
  const info=lstatSync(path);
  if(info.isSymbolicLink() || (info.isFile() && info.nlink>1) || canonical(realpathSync(path))!==canonical(resolve(path)))throw Error('Linked source rejected: '+path);
  return info;
}
for(const path of [repositoryRoot,trackRoot,source])ordinary(path);
const inside=relative(repositoryRoot,destination);
if(isAbsolute(inside)||inside.startsWith('..'))throw Error('Destination must stay inside this repository.');
if(existsSync(destination)||existsSync(join(evidence,'baseline-files.json')))throw Error('Web baseline already exists; no files have been overwritten.');
const deniedNames=new Set(['.git','.cu-runtime','.runtime','.private-cloud','node_modules','__pycache__','.env','model-config.json','setup-code.txt']);
const rows=[];
function walk(directory) {
  for(const entry of readdirSync(directory).sort()) {
    const path=join(directory,entry),info=ordinary(path);
    if(deniedNames.has(entry)||(/\.env\./.test(entry)&&entry!=='.env.example')||/\.(?:sqlite(?:-wal|-shm)?|db|pyc|keystore|jks)$/i.test(entry))throw Error('Unexpected private or generated file in public baseline: '+entry);
    if(info.isDirectory())walk(path);
    else if(info.isFile()){const data=readFileSync(path);rows.push({path:relative(source,path).replaceAll('\\','/'),bytes:data.length,sha256:digest(data)});}
    else throw Error('Special file rejected: '+path);
  }
}
walk(source);
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim();
const sourceStatus=execFileSync('git',['-c','core.quotePath=false','status','--porcelain','--','submission/创宇宙-v2'],{cwd:repositoryRoot,encoding:'utf8'}).trim();
if(sourceStatus)throw Error('Selected source has uncommitted changes.');
const manifest=JSON.parse(readFileSync(join(source,'SOURCE-MANIFEST.json'),'utf8'));
for(const row of manifest.files){const data=readFileSync(join(source,row.path));if(data.length!==row.bytes||digest(data)!==row.sha256)throw Error('Baseline manifest mismatch: '+row.path);}
mkdirSync(destination,{recursive:false});
for(const row of rows){const target=join(destination,row.path);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(source,row.path),target,constants.COPYFILE_EXCL);if(digest(readFileSync(target))!==row.sha256)throw Error('Physical copy mismatch: '+row.path);}
mkdirSync(evidence,{recursive:true});
const record={recordId:'WEB-001',createdAt:new Date().toISOString(),product:'创宇宙',trackId:10037,repository:'https://github.com/guojianyu0806/chuangyuzhou',repositoryCommit:sourceHead,sourceDirectory:'submission/创宇宙-v2',destinationDirectory:'web-track/chuangyuzhou',selectedRelease:manifest.release,selectedReleaseSourceCommit:manifest.sourceCommit,physicalCopyVerified:true,privateRuntimeIncluded:false,fileCount:rows.length,bytes:rows.reduce((sum,row)=>sum+row.bytes,0),files:rows};
writeFileSync(join(evidence,'baseline-files.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({copiedFiles:rows.length,verifiedFiles:rows.length,privateRuntimeIncluded:false,destination,repositoryCommit:sourceHead}));
