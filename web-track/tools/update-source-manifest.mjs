// Refresh integrity metadata after real edits in this Web working directory.
import {existsSync,lstatSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const trackRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=join(trackRoot,'chuangyuzhou');
const baseline=JSON.parse(readFileSync(join(trackRoot,'evidence/WEB-001/baseline-files.json'),'utf8'));
const byPath=new Map(baseline.files.map(row=>[row.path,row]));
const hash=data=>createHash('sha256').update(data).digest('hex');
const ignored=new Set(['.cu-runtime','.runtime','.private-cloud','node_modules','__pycache__','.env']);
function files(directory){
  const result=[];
  for(const name of readdirSync(directory).sort()){
    if(ignored.has(name)||(name.startsWith('.env.')&&name!=='.env.example'))continue;
    const path=join(directory,name),info=lstatSync(path);
    if(info.isSymbolicLink()||(info.isFile()&&info.nlink>1))throw Error('Linked file rejected.');
    if(info.isDirectory())result.push(...files(path));
    else if(info.isFile()){
      const rel=relative(root,path).replaceAll('\\','/');
      if(rel==='SOURCE-MANIFEST.json'||rel.startsWith('evidence/engineering/')&&rel.endsWith('.tap'))continue;
      const data=readFileSync(path);result.push({path:rel,bytes:data.length,sha256:hash(data)});
    }
  }
  return result;
}
const changes=files(root).filter(row=>row.path!=='RELEASE-CHANGES.json'&&byPath.get(row.path)?.sha256!==row.sha256).map(row=>({...row,baselineSha256:byPath.get(row.path)?.sha256??null}));
const releaseChanges={recordId:'WEB-001',product:'创宇宙',trackId:10037,release:'2026-10-23-web-dev-001',sourceCommit:baseline.repositoryCommit,selectedRelease:baseline.selectedRelease,changes};
writeFileSync(join(root,'RELEASE-CHANGES.json'),JSON.stringify(releaseChanges,null,2)+'\n');
const rows=files(root);
const manifest={schemaVersion:1,product:'创宇宙',trackId:10037,release:'2026-10-23-web-dev-001',sourceCommit:baseline.repositoryCommit,defaultPort:4396,privateRuntimeIncluded:false,baselineRecord:'../evidence/WEB-001/baseline-files.json',files:rows};
writeFileSync(join(root,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sourceFiles:rows.length,changedFromSelectedVersion:changes.length,manifest:join(root,'SOURCE-MANIFEST.json')}));
