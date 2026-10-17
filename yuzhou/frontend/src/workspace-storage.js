// Account-scoped business snapshots only. Authentication and attachment stores
// stay outside this database. A completed IDB transaction is the durable boundary.
const DATABASE='czb-yuzhou-workspace-cache-v1';
const STORE='snapshots';
const message='本机数据暂未保存成功，请保留此页面，导出改动或重试本机保存。';

export async function openSnapshotBackend(factory=globalThis.indexedDB){
  if(!factory)throw new Error('无法使用本地数据存储，请检查浏览器权限；原缓存仍保留。');
  const db=await new Promise((resolve,reject)=>{
    const request=factory.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onerror=()=>reject(new Error('无法打开本地数据存储，原缓存仍保留。'));
    request.onblocked=()=>reject(new Error('本地数据存储正在等待其他窗口，请关闭旧页面后重试；原缓存仍保留。'));
    request.onsuccess=()=>resolve(request.result);
  });
  db.onversionchange=()=>db.close();
  return {
    async entries(prefix){
      return new Promise((resolve,reject)=>{
        const result=[],tx=db.transaction(STORE),request=tx.objectStore(STORE).openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
        request.onsuccess=()=>{const cursor=request.result;if(cursor){result.push([cursor.key,cursor.value]);cursor.continue();}};
        tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error(message));
      });
    },
    async write(entries){
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
        for(const [key,value] of entries)value===null?store.delete(key):store.put(value,key);
        tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error(message));
      });
    }
  };
}

export async function createWorkspaceStorage(account,{legacy=globalThis.localStorage,backend}={}){
  backend||=await openSnapshotBackend();
  const prefix=`czb-yuzhou-cloud-v1-${account}-`,recovery=`czb-yuzhou-cloud-recovery-${account}-`;
  const allowed=key=>typeof key==='string'&&(key.startsWith(prefix)||key.startsWith(recovery));
  const values=new Map([...(await backend.entries(prefix)),...(await backend.entries(recovery))]);
  const old=[];
  for(const key of Object.keys(legacy))if(allowed(key)){const value=legacy.getItem(key);if(value!==null)old.push([key,value]);}
  const migration=[];
  for(const [key,value] of old){
    if(values.has(key)&&values.get(key)!==value){
      // An older loaded document may still have written its legacy cache. Keep
      // both complete versions rather than deciding which edit is authoritative.
      const recoveryKey=`${recovery}migration-${crypto.randomUUID()}`;
      const preserved=JSON.stringify({cacheRecovery:1,sourceKey:key,raw:values.get(key)});
      migration.push([recoveryKey,preserved]);values.set(recoveryKey,preserved);
    }
    migration.push([key,value]);values.set(key,value);
  }
  if(migration.length){
    await backend.write(migration);
    const verified=new Map([...(await backend.entries(prefix)),...(await backend.entries(recovery))]);
    for(const [key,value] of migration)if(verified.get(key)!==value)throw new Error('旧缓存转存核对失败，原缓存仍保留，请保留页面并重试。');
    for(const [key,value] of old){
      // Do not remove a value that an old tab edited during the transaction.
      if(legacy.getItem(key)===value)try{legacy.removeItem(key);}catch{/* Already durable; leave the old copy too. */}
    }
  }
  const dirty=new Map();let writing=null,error=null;
  const storage={
    onError:null,
    get dirty(){return dirty.size>0||!!writing;},
    get error(){return error;},
    keys:()=>[...values.keys()],
    getItem:key=>values.get(key)??null,
    setItem(key,value){
      if(!allowed(key))throw new Error('拒绝写入本账号范围以外的缓存。');
      value=String(value);if(values.get(key)===value)return;
      values.set(key,value);dirty.set(key,value);schedule();
    },
    removeItem(key){
      if(!allowed(key))throw new Error('拒绝移除本账号范围以外的缓存。');
      values.delete(key);dirty.set(key,null);schedule();
    },
    async settled(){
      while(writing||dirty.size){if(error)throw error;await (writing||start());}
      if(error)throw error;
    },
    async retry(){error=null;await storage.settled();}
  };
  function schedule(){if(!writing&&!error)queueMicrotask(()=>{if(!writing&&dirty.size&&!error)start().catch(()=>{});});}
  function start(){
    const batch=[...dirty];
    writing=backend.write(batch).then(()=>{
      for(const [key,value] of batch)if(dirty.get(key)===value)dirty.delete(key);
    }).catch(cause=>{
      error=new Error(message,{cause});error.name='WorkspaceStorageError';storage.onError?.(error);throw error;
    }).finally(()=>{writing=null;schedule();});
    return writing;
  }
  return storage;
}

export function sameWorkspaceContent(a,b){
  const normalize=(value,root=false)=>Array.isArray(value)?value.map(item=>normalize(item)):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>!root||key!=='updatedAt').map(key=>[key,normalize(value[key])])):value;
  return JSON.stringify(normalize(a,true))===JSON.stringify(normalize(b,true));
}
