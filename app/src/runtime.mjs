import {existsSync,lstatSync,realpathSync,mkdirSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const RUNTIME_ROOT=resolve(PROJECT_ROOT,'.cu-runtime');
export const COOKIE_NAME='cu_original_workbench_session';
const canonical=p=>process.platform==='win32'?p.toLowerCase():p;
function below(root,path,allowRoot=false){
  const rel=relative(root,path);
  return (allowRoot||!!rel)&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);
}
export function projectPath(path){
  const absolute=resolve(path);
  if(!below(PROJECT_ROOT,absolute))throw new Error('路径必须位于创宇宙独立项目内。');
  if(canonical(realpathSync(PROJECT_ROOT))!==canonical(PROJECT_ROOT))throw new Error('创宇宙根目录不能通过链接共享。');
  let cursor=absolute;
  while(cursor!==PROJECT_ROOT){
    if(existsSync(cursor)){
      const stat=lstatSync(cursor);
      if(stat.isSymbolicLink()||(stat.isFile()&&stat.nlink>1))throw new Error('创宇宙不使用链接共享文件。');
    }
    cursor=dirname(cursor);
  }
  return absolute;
}
export function runtimePath(path){
  const absolute=projectPath(path);
  if(!below(RUNTIME_ROOT,absolute))throw new Error('运行数据只能写入创宇宙的 .cu-runtime 子目录。');
  return absolute;
}
export function createRuntime({port=4391,dataDir}={}){
  if(!Number.isInteger(port)||port<4380||port>4399)throw new Error('创宇宙本地端口限4380至4399。');
  const directory=runtimePath(dataDir||resolve(RUNTIME_ROOT,'data'));
  mkdirSync(directory,{recursive:true});
  runtimePath(directory);
  return {host:'127.0.0.1',port,origin:'http://127.0.0.1:'+port,
    dataDir:directory,frontendDir:projectPath(resolve(PROJECT_ROOT,'frontend')),cookieName:COOKIE_NAME};
}
