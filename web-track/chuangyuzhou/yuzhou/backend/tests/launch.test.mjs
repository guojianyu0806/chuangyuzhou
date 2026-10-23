import test from 'node:test';
import assert from 'node:assert/strict';
import {launchWorkbench,probeInstance} from '../../launch.mjs';

test('launcher only recognizes this application and this physical copy',async()=>{
 const reply=body=>async()=>new Response(JSON.stringify(body));
 assert.equal(await probeInstance('http://127.0.0.1:4397','expected',reply({application:'czb-yuzhou',instanceId:'expected'})),true);
 assert.equal(await probeInstance('http://127.0.0.1:4396','expected',reply({application:'czb-yuzhou',instanceId:'expected',accessMode:'web'})),false);
 for(const body of [{application:'old-workbench',instanceId:'expected'},{application:'czb-yuzhou',instanceId:'other'},{}])
  assert.equal(await probeInstance('http://127.0.0.1:4397','expected',reply(body)),false);
 assert.equal(await probeInstance('http://127.0.0.1:4397','expected',async()=>{throw Error('offline');}),false);
 let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4097));},cancel(){cancelled=true;}});
 assert.equal(await probeInstance('http://127.0.0.1:4397','expected',async()=>new Response(stream)),false);
 assert.equal(cancelled,true);
});

test('repeat launch reuses verified instance without a second server or data initialization',async()=>{
 const opened=[];
 const result=await launchWorkbench({env:{},probe:async()=>true,open:url=>opened.push(url),isFree:async()=>{throw Error('unneeded');},start:async()=>{throw Error('unneeded');}});
  assert.equal(result.reused,true);assert.deepEqual(opened,['http://127.0.0.1:4396']);
});

test('occupied port belonging to another service is neither opened nor stopped',async()=>{
 await assert.rejects(launchWorkbench({env:{},probe:async()=>false,isFree:async()=>false,open:()=>assert.fail('must not open'),start:()=>assert.fail('must not start')}),/占用/);
});

test('new instance is verified before opening and failed verification closes only the new instance',async()=>{
 let calls=0,closed=0,opened=0;
 const app={close:async()=>closed++};
 const result=await launchWorkbench({env:{},probe:async()=>++calls>1,isFree:async()=>true,start:async()=>app,open:()=>opened++});
 assert.equal(result.app,app);assert.equal(opened,1);assert.equal(closed,0);
 await assert.rejects(launchWorkbench({env:{},probe:async()=>false,isFree:async()=>true,start:async()=>app,open:()=>assert.fail('must not open')}),/身份验证/);
 assert.equal(closed,1);
});
