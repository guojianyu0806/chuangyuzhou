// Import public source as real files; never execute or modify the source project.
import {constants,copyFileSync,createReadStream,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,extname,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=String.raw`C:\Users\g2806\Desktop\工作台`;
const target=resolve(root,'yuzhou');
const report=resolve(root,'evidence/provenance/yuzhou-0.15.0-import.json');
const canonical=p=>process.platform==='win32'?p.toLowerCase():p;
const within=(base,p)=>{const r=relative(base,p);return !!r&&r!=='..'&&!r.startsWith('..'+sep)&&!resolve(p).startsWith('\\\\');};
function physical(p){const s=lstatSync(p);if(s.isSymbolicLink()||(s.isFile()&&s.nlink>1)||canonical(realpathSync(p))!==canonical(resolve(p)))throw Error('Linked source or target rejected: '+p);return s;}
async function hash(p){const h=createHash('sha256');for await(const chunk of createReadStream(p))h.update(chunk);return h.digest('hex');}
physical(root);physical(source);
if(existsSync(target)||existsSync(report))throw Error('Import refuses to overwrite an existing copy or report.');
const selected=[];
const extensions=new Set(['.js','.mjs','.py','.json','.css','.html','.svg','.webmanifest','.md','.cmd','.java','.xml','.service','.caddy','.png','.woff','.woff2','.ttf']);
function add(name){const p=resolve(source,name);if(!within(source,p)||!physical(p).isFile())throw Error('Invalid source: '+name);selected.push(name.replaceAll('\\','/'));}
function walk(name,{screenshots=false}={}){
 const p=resolve(source,name);physical(p);
 for(const entry of readdirSync(p,{withFileTypes:true})){
  if(entry.name.startsWith('.')||['__pycache__','node_modules','releases','build','dist'].includes(entry.name))continue;
  const rel=name+'/'+entry.name,stat=physical(resolve(source,rel));
  if(stat.isDirectory())walk(rel,{screenshots});
  else if(extensions.has(extname(entry.name))&&!(screenshots&&extname(entry.name)==='.png'))add(rel);
 }
}
for(const tree of ['frontend/src','frontend/tests','backend/tests','mobile/android','mobile/tests','mobile/download-page'])walk(tree,{screenshots:tree.includes('tests')});
for(const name of ['frontend/index.html','frontend/icon.svg','frontend/manifest.webmanifest','frontend/server.mjs','frontend/launch.mjs','frontend/start.cmd','frontend/package.json','frontend/README.md','frontend/.gitignore',
 'backend/server.mjs','backend/store.mjs','backend/hermes.mjs','backend/hermes_runner.py','backend/extract.py','backend/workspace-queries.mjs','backend/backup.mjs','backend/is-cli.mjs','backend/package.json','backend/README.md','mobile/build-android.mjs','mobile/README.md'])add(name);
walk('deployment');
selected.sort();
if(new Set(selected).size!==selected.length)throw Error('Duplicate source selection.');
const version=JSON.parse(readFileSync(resolve(source,'frontend/package.json'),'utf8')).version;
if(version!=='0.15.0'||JSON.parse(readFileSync(resolve(source,'backend/package.json'),'utf8')).version!==version)throw Error('Source version changed; inspect it before importing.');
const files=[];
for(const name of selected)files.push({path:name,sha256:await hash(resolve(source,name))});
mkdirSync(target);physical(target);
for(const file of files){
 const destination=resolve(target,file.path);if(!within(target,destination))throw Error('Destination escaped copy.');
 mkdirSync(dirname(destination),{recursive:true});physical(dirname(destination));
 copyFileSync(resolve(source,file.path),destination,constants.COPYFILE_EXCL);physical(destination);
 if(await hash(destination)!==file.sha256||await hash(resolve(source,file.path))!==file.sha256)throw Error('Source changed or copy mismatched: '+file.path);
}
mkdirSync(dirname(report),{recursive:true});
writeFileSync(report,JSON.stringify({importedAtUtc:new Date().toISOString(),sourceRoot:source,targetRoot:target,sourceVersion:version,files,
 excluded:['.workbench','frontend/.runtime','mobile/releases','__pycache__','credentials, private databases, attachments, signing material, browser data'],
 note:'Exact public-source baseline before competition isolation changes. Existing projects and app/ are preserved. Source hashes verified before and after copying; no original scripts executed.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({sourceVersion:version,copiedFiles:files.length,target,report}));
