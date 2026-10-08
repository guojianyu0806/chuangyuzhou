import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../yuzhou');
const [major,minor]=process.versions.node.split('.').map(Number);
const checks=[{name:'Node >=22.13',ok:major>22||(major===22&&minor>=13),actual:process.versions.node}];
for(const file of ['start.mjs','runtime.mjs','backend/server.mjs','backend/store.mjs','frontend/index.html','frontend/src/app.js']){
 const p=resolve(root,file);checks.push({name:file,ok:existsSync(p)&&lstatSync(p).isFile()&&!lstatSync(p).isSymbolicLink()&&realpathSync(p).toLowerCase()===p.toLowerCase()});
}
try{await import('node:sqlite');checks.push({name:'SQLite',ok:true});}catch{checks.push({name:'SQLite',ok:false});}
const probe=createServer();const available=await new Promise(done=>{probe.once('error',()=>done(false));probe.listen(4397,'127.0.0.1',()=>probe.close(()=>done(true)));});
checks.push({name:'port 4397 free',ok:available});
console.log(JSON.stringify({checkedAtUtc:new Date().toISOString(),sourceVersion:JSON.parse(readFileSync(resolve(root,'frontend/package.json'),'utf8')).version,checks,modelTested:false,originalProjectsAccessed:false,note:'Only copied source and port availability checked. No runtime data or credentials read.'},null,2));
if(checks.some(item=>!item.ok))process.exitCode=1;
