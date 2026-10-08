import {createDeepSeekRunner,ModelError,sanitizeUsage} from './deepseek-provider.mjs';

// A connection check sends no workspace content and never creates a proposal.
export async function checkModelConnection({config,provider}={}){
  const startedAt=new Date().toISOString(),start=performance.now();
  const run=provider||createDeepSeekRunner({apiKey:config?.apiKey,model:config?.model,timeoutMs:15000});
  const measurement={executionMode:provider?'offline_fixture':'live',modelCalled:!provider,startedAt,model:config?.model||null,usage:null,cost:null,latencyMs:null,purpose:'connection_check'};
  try{
    const result=await run({system:'Return exactly one json object: {"ok":true}. This is a connection check.',user:'Return the json connection check response.'});
    measurement.usage=sanitizeUsage(result?.usage);measurement.latencyMs=Math.round(performance.now()-start);
    let parsed;try{parsed=JSON.parse(result?.text);}catch{throw new ModelError('model_check_format','模型已响应，但没有返回连接测试要求的JSON。');}
    if(parsed?.ok!==true||Object.keys(parsed).length!==1)throw new ModelError('model_check_format','模型已响应，但连接测试响应不符合要求。');
    return {status:'passed',checkedAt:new Date().toISOString(),model:config.model,measurement};
  }catch(error){
    measurement.latencyMs=Math.round(performance.now()-start);
    const safe=error instanceof ModelError?error:new ModelError('model_check_failed','模型连接测试失败，请检查配置后重试。');
    safe.measurement=measurement;throw safe;
  }
}
