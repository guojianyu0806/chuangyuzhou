// Adapted as an independent physical source file from the AIC campus project's
// 02_竞赛源码/backend/deepseek-provider.mjs (2026-09-30). No old runtime import.
// Source SHA256: d5831254ca44a38740d8911fa66ad727d1fc225a33cfc177068c9cca1834d2ae
// Official protocol checked 2026-09-30:
// https://api-docs.deepseek.com/api/create-chat-completion/
// https://api-docs.deepseek.com/guides/json_mode/
import {performance} from 'node:perf_hooks';

export const SUPPORTED_MODELS=Object.freeze(['deepseek-flash','deepseek-v4-pro']);
export const PROVIDER_VERSION='cu-deepseek-1.0.0';
export class ModelError extends Error {
  constructor(code,message,status=502){super(message);this.name='ModelError';this.code=code;this.status=status;}
}
const MAX_RESPONSE_BYTES=1024*1024;
export function sanitizeUsage(raw){
  const usage={};
  for(const key of ['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']){
    const value=raw?.[key];if(Number.isSafeInteger(value)&&value>=0)usage[key]=value;
  }
  const reasoning=raw?.completion_tokens_details?.reasoning_tokens;
  if(Number.isSafeInteger(reasoning)&&reasoning>=0)usage.reasoning_tokens=reasoning;
  return Object.keys(usage).length?usage:null;
}
export function createDeepSeekRunner({apiKey,model='deepseek-flash',timeoutMs=90000,fetchImpl=globalThis.fetch}={}){
  if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>2048||/[\r\n\0]/.test(apiKey))throw new ModelError('model_not_configured','请先在创宇宙设置中配置独立模型密钥。',503);
  if(!SUPPORTED_MODELS.includes(model))throw new ModelError('model_not_supported','请选择支持的 DeepSeek 模型。',400);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>180000||typeof fetchImpl!=='function')throw new ModelError('model_invalid_options','模型请求配置无效。',400);
  const key=apiKey.trim();
  return async function runModel({system,user}={}){
    if(typeof system!=='string'||typeof user!=='string'||!system.trim()||!user.trim()||system.length+user.length>250000)throw new ModelError('model_invalid_input','请求内容无效或过大，请缩小操作范围。',400);
    const controller=new AbortController(),started=performance.now();let timer;
    const operation=(async()=>{
      const response=await fetchImpl('https://api.deepseek.com/chat/completions',{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
        body:JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:user}],stream:false,
          thinking:{type:'disabled'},max_tokens:10000,response_format:{type:'json_object'}})
      });
      if(!response?.ok){
        try{await response?.body?.cancel?.();}catch{}
        const messages={401:'创宇宙模型密钥无效，请在设置中更新。',402:'模型账户余额不足。',429:'模型请求过于频繁，请稍后重试。'};
        const status=Number.isInteger(response?.status)?response.status:502;
        throw new ModelError('model_http_'+status,messages[status]||'模型服务暂时不可用，请稍后重试。');
      }
      const chunks=[];let size=0;
      if(response.body?.getReader){
        const reader=response.body.getReader();
        for(;;){
          const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
          if(size>MAX_RESPONSE_BYTES){try{await reader.cancel();}catch{}throw new ModelError('model_response_limit','模型回复过长，请拆分请求。');}
          chunks.push(Buffer.from(value));
        }
      }else{
        const bytes=Buffer.from(await response.text());if(bytes.length>MAX_RESPONSE_BYTES)throw new ModelError('model_response_limit','模型回复过长，请拆分请求。');chunks.push(bytes);
      }
      let payload;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ModelError('model_invalid_transport','模型服务返回了无法识别的响应。');}
      const choice=payload?.choices?.[0];
      if(choice?.finish_reason==='content_filter'||choice?.message?.refusal)throw new ModelError('model_refused','模型没有生成本次方案，请调整请求。');
      if(choice?.finish_reason!=='stop')throw new ModelError('model_incomplete','模型回复未完整结束，本轮没有生成可执行方案。');
      if(choice.message?.tool_calls?.length)throw new ModelError('model_unexpected_tool','模型返回了不支持的操作格式。');
      const text=choice.message?.content;
      if(typeof text!=='string'||!text.trim()||text.length>150000)throw new ModelError('model_empty','模型没有返回完整方案，请重试。');
      return {text,usage:sanitizeUsage(payload.usage),model:SUPPORTED_MODELS.includes(payload.model)?payload.model:model,
        latencyMs:Math.round(performance.now()-started),providerVersion:PROVIDER_VERSION};
    })();
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ModelError('model_timeout','模型响应超时，本轮未执行任何操作。'));},timeoutMs);});
    try{return await Promise.race([operation,timeout]);}
    catch(error){
      if(error instanceof ModelError)throw error;
      throw new ModelError(controller.signal.aborted?'model_timeout':'model_network',controller.signal.aborted?'模型响应超时，本轮未执行任何操作。':'无法连接模型服务，请检查网络后重试。');
    }finally{clearTimeout(timer);}
  };
}
