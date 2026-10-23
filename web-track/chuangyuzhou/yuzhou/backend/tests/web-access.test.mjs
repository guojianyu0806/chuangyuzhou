import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {resolveWebAccess} from '../../web-access.mjs';
import {resolveCompetitionOptions} from '../../runtime.mjs';
import {launchWorkbench} from '../../launch.mjs';
import {ROOT,parseConfiguration,resolveConfiguration,cleanEnvironment} from '../../../tools/start.mjs';

test('Web access remains local unless an explicit mode and HTTPS origin are supplied',()=>{
  assert.deepEqual(resolveWebAccess(),{mode:'local',publicOrigin:'http://127.0.0.1:4396',secureCookie:false});
  for(const origin of ['https://workbench.example.test','https://workbench.example.test/','https://workbench.example.test:443/'])assert.deepEqual(resolveWebAccess('web',origin),{mode:'web',publicOrigin:'https://workbench.example.test',secureCookie:true});
  assert.equal(resolveWebAccess('web','https://workbench.example.test:8443').publicOrigin,'https://workbench.example.test:8443');
  assert.throws(()=>resolveWebAccess('local','https://workbench.example.test'));
  for(const origin of ['https://@example.test','https://:@example.test'])assert.throws(()=>resolveWebAccess('web',origin));
  for(const mode of ['',null,[],{},'Web','production'])assert.throws(()=>resolveWebAccess(mode));
});

test('Web origin validation rejects repaired URLs, credentials and path deployments without echoing values',()=>{
  const marker='synthetic-origin-marker';
  for(const value of ['',null,{},12,'http://workbench.example.test','https://0.0.0.0','https://[::]',`https://${marker}@example.test`,`https://${marker}:password@example.test`,'https://workbench.example.test/path','https://workbench.example.test//','https://workbench.example.test/.','https://workbench.example.test?','https://workbench.example.test#','https://workbench.example.test/?x=1','https://workbench.example.test/#part','https://workbench.example.test\n',' https://workbench.example.test','https://workbench.example.test\\','https://workbench.\texample.test','https://workbench.example.test:65536'])assert.throws(()=>resolveWebAccess('web',value),error=>{
    assert.match(error.message,/CZB_YUZHOU_PUBLIC_ORIGIN/);assert.equal(error.message.includes(marker),false);return true;
  });
});

test('Web configuration keeps public origin independent of loopback listener and private paths',()=>{
  const env={CZB_YUZHOU_MODE:'web',CZB_YUZHOU_PUBLIC_ORIGIN:'https://workbench.example.test:443/'};
  const local=resolveCompetitionOptions(),web=resolveCompetitionOptions({},env);
  assert.equal(web.host,'127.0.0.1');assert.equal(web.port,4396);assert.equal(web.publicOrigin,'https://workbench.example.test');assert.equal(web.secureCookie,true);
  for(const key of ['dataDir','frontendDir','setupTokenFile'])assert.equal(web[key],local[key]);
  for(const extra of [{CZB_YUZHOU_HOST:'0.0.0.0'},{CZB_YUZHOU_PORT:'4397'},{DATA_DIR:'C:/another-project'},{SETUP_TOKEN:'must-not-be-used'}])assert.throws(()=>resolveCompetitionOptions({},{...env,...extra}),/competition_/);
  // Do not turn forwarded headers, legacy PUBLIC_ORIGIN or unrecognised keys into trust.
  assert.equal(resolveCompetitionOptions({},{PUBLIC_ORIGIN:'https://attacker.invalid',FORWARDED:'proto=https'}).mode,'local');
});

test('Web deployment fields use explicit terminal overrides and never leak unrelated environment',()=>{
  const template=readFileSync(join(ROOT,'web-deployment/environment.example'),'utf8');
  const file='CZB_YUZHOU_MODE=web\nCZB_YUZHOU_PUBLIC_ORIGIN=https://file.example.test';
  const env={CZB_YUZHOU_MODE:'web',CZB_YUZHOU_PUBLIC_ORIGIN:'https://terminal.example.test',NODE_OPTIONS:'--inspect',PUBLIC_ORIGIN:'https://ignored.invalid',DATA_DIR:'C:/old'};
  assert.equal(parseConfiguration(template).CZB_YUZHOU_MODE,'web');
  const resolved=resolveConfiguration(file,env),clean=cleanEnvironment(resolved,'synthetic-temp',env);
  assert.equal(clean.CZB_YUZHOU_PUBLIC_ORIGIN,'https://terminal.example.test');assert.equal(clean.CZB_YUZHOU_MODE,'web');
  for(const key of ['NODE_OPTIONS','PUBLIC_ORIGIN','DATA_DIR'])assert.equal(Object.hasOwn(clean,key),false);
  assert.equal(resolveConfiguration(file,{CZB_YUZHOU_MODE:'local',CZB_YUZHOU_PUBLIC_ORIGIN:''}).CZB_YUZHOU_MODE,'local');
  assert.throws(()=>resolveConfiguration(file,{CZB_YUZHOU_MODE:'local'}));
  assert.throws(()=>resolveConfiguration(file,{CZB_YUZHOU_PUBLIC_ORIGIN:''}));
  assert.equal(resolveConfiguration('',Object.create(env)).CZB_YUZHOU_MODE,'local');
});

test('desktop convenience launcher never opens the internal HTTP endpoint in Web mode',async()=>{
  await assert.rejects(launchWorkbench({env:{CZB_YUZHOU_MODE:'web',CZB_YUZHOU_PUBLIC_ORIGIN:'https://workbench.example.test'},probe:()=>assert.fail('must not probe'),open:()=>assert.fail('must not open')}),/HTTPS/);
});
