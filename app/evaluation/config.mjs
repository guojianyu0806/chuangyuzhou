// Explicit live-evaluation configuration only. Importing this module reads no key.
import {readFileSync,lstatSync} from 'node:fs';
import {runtimePath} from '../src/runtime.mjs';
import {SUPPORTED_MODELS} from '../src/deepseek-provider.mjs';

export function readEvaluationConfig(filename){
  try{
    if(typeof filename!=='string'||!filename)throw new Error();
    const path=runtimePath(filename),stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1||stat.size>65536)throw new Error();
    const config=JSON.parse(readFileSync(path,'utf8'));
    if(!config||Array.isArray(config)||config.provider!=='deepseek'||!SUPPORTED_MODELS.includes(config.model)||typeof config.apiKey!=='string'||!config.apiKey.trim()||config.apiKey.length>2048||/[\r\n\0]/.test(config.apiKey))throw new Error();
    return {provider:'deepseek',model:config.model,apiKey:config.apiKey.trim()};
  }catch{
    const error=new Error('评测配置须为创宇宙 .cu-runtime 内有效的普通配置文件；未读取其他项目配置。');error.code='evaluation_config_invalid';throw error;
  }
}
