// Synthetic account and empty data for browser checks; not the user's instance.
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {createWorkbenchServer} from '../yuzhou/backend/server.mjs';
import {hashPassword} from '../yuzhou/backend/store.mjs';
import {RUNTIME_ROOT,assertRuntimePath} from '../yuzhou/runtime.mjs';
if(process.argv[2]!=='--offline-only')throw Error('Use --offline-only for the synthetic browser test only.');
assertRuntimePath(resolve(RUNTIME_ROOT,'browser-test'));mkdirSync(RUNTIME_ROOT,{recursive:true});
const dataDir=mkdtempSync(resolve(RUNTIME_ROOT,'browser-test-'));
const app=await createWorkbenchServer({dataDir,secureCookie:false,publicOrigin:'http://127.0.0.1:4398',setupToken:'synthetic-only-unused-setup'});
app.store.createAccount('browser-test',await hashPassword('synthetic-browser-password'));
await new Promise((done,reject)=>{app.server.once('error',reject);app.server.listen(4398,'127.0.0.1',done);});
console.log('SYNTHETIC OFFLINE BROWSER CHECK http://127.0.0.1:4398');
console.log('Test data: '+dataDir);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
