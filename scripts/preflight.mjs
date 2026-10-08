import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const app=resolve(root,'app');
const version=process.versions.node.split('.').map(Number);
const checks=[];
checks.push({name:'Node.js >=22.13',ok:version[0]>22||(version[0]===22&&version[1]>=13),actual:process.versions.node});
for(const file of ['package.json','start.mjs','src/server.mjs','src/runtime.mjs','frontend/index.html']){
  const path=resolve(app,file);checks.push({name:file,ok:existsSync(path)&&lstatSync(path).isFile()});
}
try{await import('node:sqlite');checks.push({name:'SQLite runtime',ok:true});}catch{checks.push({name:'SQLite runtime',ok:false});}
const probe=createServer();
const available=await new Promise(resolveResult=>{
  probe.once('error',()=>resolveResult(false));
  probe.listen(4395,'127.0.0.1',()=>probe.close(()=>resolveResult(true)));
});
checks.push({name:'Default port 4395 is free',ok:available});
const result={checkedAt:new Date().toISOString(),appVersion:existsSync(resolve(app,'package.json'))?JSON.parse(readFileSync(resolve(app,'package.json'),'utf8')).version:null,checks,
  modelChecked:false,note:'No credentials read, no model calls, no runtime data created. Port occupation is reported without stopping any process.'};
console.log(JSON.stringify(result,null,2));
if(checks.some(item=>!item.ok))process.exitCode=1;
