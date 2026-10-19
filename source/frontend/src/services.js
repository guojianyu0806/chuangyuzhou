// Cloud adapter boundary. No model credentials belong in this browser application.
export const VERSION = '0.14.0';
export const cloud = {
  connected: false,
  async organizeCourse() { throw new Error('请在服务器部署后连接大模型。当前资料已保存到本机。'); },
  async sync() { throw new Error('云端尚未连接，当前数据仅保存在这个浏览器。'); }
};
const databases = new Map();
let fileScope = '', remoteFile = null;
export function configureFileStore(scope = '', fetchFile = null) { fileScope = scope; remoteFile = fetchFile; }
function database(scope=fileScope) {
  const name = scope ? `lumi-files-${scope}` : 'lumi-files';
  if (!databases.has(name)) databases.set(name,new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{databases.delete(name);reject(new Error('无法打开本地文件存储，请检查浏览器存储权限。'));};
  }));
  return databases.get(name);
}
export async function putFile(file, key=crypto.randomUUID()) {
  if (file.size>40*1024*1024) throw new Error('单文件上限为 40 MB，请先选择较小文件。');
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('files','readwrite');
    tx.objectStore('files').put(file,key);
    tx.oncomplete=()=>resolve(key);
    tx.onerror=()=>reject(new Error('文件保存失败，可能是本地存储空间不足。'));
    tx.onabort=()=>reject(new Error('文件保存中断，请重试。'));
  });
}
export async function getFile(key) {
  const fetchRemote=remoteFile;
  const local=await getLocalFile(key);
  if(local || !fetchRemote)return local;
  return fetchRemote(key);
}
export async function getLocalFile(key,scope=fileScope) {
  const db=await database(scope);
  return new Promise((resolve,reject)=>{
    const request=db.transaction('files').objectStore('files').get(key);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export function download(blob,name) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function escapeHTML(value='') {
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
