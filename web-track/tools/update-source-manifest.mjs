// Refresh integrity metadata after real edits in this Web working directory.
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const trackRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repositoryRoot=resolve(trackRoot,'..');
const root=join(trackRoot,'chuangyuzhou');
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--record'||!/^WEB-\d{3}$/.test(args[1])||args[2]!=='--date'||!/^\d{4}-\d{2}-\d{2}$/.test(args[3]))throw Error('Use --record WEB-002 --date YYYY-MM-DD for the current real stage.');
const recordId=args[1],date=args[3],release=`${date}-web-dev-${recordId.slice(4)}`;
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim();
const previousManifest=JSON.parse(execFileSync('git',['show',`${sourceCommit}:web-track/chuangyuzhou/SOURCE-MANIFEST.json`],{cwd:repositoryRoot,encoding:'utf8'}));
const evidence=join(trackRoot,'evidence',recordId),baselinePath=join(evidence,'source-baseline.json');
mkdirSync(evidence,{recursive:true});
if(existsSync(baselinePath)){
  const recorded=JSON.parse(readFileSync(baselinePath,'utf8'));
  if(recorded.sourceCommit!==sourceCommit)throw Error('This stage already has a different source baseline; use a new record.');
}else writeFileSync(baselinePath,JSON.stringify({recordId,sourceCommit,previousManifest},null,2)+'\n',{flag:'wx'});
const byPath=new Map(previousManifest.files.map(row=>[row.path,row]));
const hash=data=>createHash('sha256').update(data).digest('hex');
const ignored=new Set(['.cu-runtime','.runtime','.private-cloud','node_modules','__pycache__','.env']);
function files(directory){
  const result=[];
  for(const name of readdirSync(directory).sort()){
    if(ignored.has(name)||(name.startsWith('.env.')&&name!=='.env.example'))continue;
    const path=join(directory,name),info=lstatSync(path);
    if(info.isSymbolicLink()||(info.isFile()&&info.nlink>1))throw Error('Linked file rejected.');
    if(info.isFile()&&(name==='model-config.json'||name==='setup-code.txt'||/\.(?:sqlite(?:-wal|-shm)?|db|keystore|jks)$/i.test(name)))throw Error('Private runtime file cannot enter a source manifest.');
    if(info.isDirectory())result.push(...files(path));
    else if(info.isFile()){
      const rel=relative(root,path).replaceAll('\\','/');
      if(rel==='SOURCE-MANIFEST.json'||rel.startsWith('evidence/engineering/')&&rel.endsWith('.tap'))continue;
      const data=readFileSync(path);result.push({path:rel,bytes:data.length,sha256:hash(data)});
    }
  }
  return result;
}
const currentFiles=files(root),paths=new Set(currentFiles.map(row=>row.path));
const changes=currentFiles.filter(row=>row.path!=='RELEASE-CHANGES.json'&&byPath.get(row.path)?.sha256!==row.sha256).map(row=>({...row,baselineSha256:byPath.get(row.path)?.sha256??null}));
for(const row of previousManifest.files)if(row.path!=='RELEASE-CHANGES.json'&&!paths.has(row.path))changes.push({path:row.path,deleted:true,baselineSha256:row.sha256});
const releaseChanges={recordId,product:'创宇宙',trackId:10037,release,sourceCommit,selectedRelease:previousManifest.release,changes};
writeFileSync(join(root,'RELEASE-CHANGES.json'),JSON.stringify(releaseChanges,null,2)+'\n');
const rows=files(root);
const manifest={schemaVersion:1,product:'创宇宙',trackId:10037,release,sourceCommit,defaultPort:4396,privateRuntimeIncluded:false,baselineRecord:`../evidence/${recordId}/source-baseline.json`,files:rows};
writeFileSync(join(root,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sourceFiles:rows.length,changedFromSelectedVersion:changes.length,manifest:join(root,'SOURCE-MANIFEST.json')}));
