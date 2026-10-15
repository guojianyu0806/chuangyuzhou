// Explicitly authorized DEV-026 probe. No credentials or business data on disk.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createDeepSeekRunner} from '../yuzhou/backend/deepseek.mjs';

const reportPath=resolve(fileURLToPath(new URL('../evidence/engineering/DEV-026-live-2026-10-15.json',import.meta.url)));
const model='deepseek-v4-pro', endpoint='https://api.deepseek.com/chat/completions';

export function createProbeSession(apiKey,{resumeLocalValidationFailure=false}={}){
  if(typeof apiKey!=='string'||!apiKey.trim())throw Error('A caller-provided key is required.');
  const report=existsSync(reportPath)?JSON.parse(readFileSync(reportPath,'utf8')):
    {scope:'synthetic short prompts through production transport; no formal workspace reads',model,maxCalls:3,maxTokens:10000,calls:[]};
  const last=report.calls.at(-1);
  // One explicit continuation after the local REPL validator failed. Existing
  // calls and usage stay counted; transport/provider errors cannot be resumed.
  const resumable=resumeLocalValidationFailure&&report.calls.length===2&&report.calls[0].ok===true&&
    last.transportOk===true&&last.httpStatus===200&&last.finishReason==='stop'&&
    last.checks?.validStructuredResult===false&&!last.errorCode;
  let stopped=report.calls.some(call=>call.ok!==true)&&!resumable,busy=false;
  if(resumable)report.localValidationContinuation=true;
  const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  const reserved=()=>report.calls.reduce((sum,call)=>sum+call.reservedTokenUpperBound,0);
  const usageTotal=()=>report.calls.reduce((sum,call)=>sum+(call.usage?.total_tokens||0),0);
  return {
    async run({label,system,user,maxOutputTokens=512,validate}){
      if(stopped||busy)throw Error('Probe is stopped or already running.');
      if(report.calls.length>=3)throw Error('Authorized request limit reached.');
      if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>512)throw Error('Invalid output cap.');
      if(typeof system!=='string'||typeof user!=='string'||typeof validate!=='function')throw Error('Invalid probe case.');
      const promptBytes=Buffer.byteLength(system,'utf8')+Buffer.byteLength(user,'utf8');
      // Short text-only requests: byte count bounds content tokens conservatively;
      // reserve another 1024 tokens for protocol framing, plus maximum output.
      const reservedTokenUpperBound=promptBytes+1024+maxOutputTokens;
      if(reserved()+reservedTokenUpperBound>10000)throw Error('Authorized token budget would be exceeded.');
      const call={label,startedAt:new Date().toISOString(),promptBytes,maxOutputTokens,reservedTokenUpperBound,
        promptHash:createHash('sha256').update(system+'\n'+user).digest('hex'),ok:false};
      report.calls.push(call);save();busy=true;
      let sent=false;
      const runner=createDeepSeekRunner({timeoutMs:45000,fetch:async(url,options)=>{
        if(sent||url!==endpoint||options.redirect!=='error')throw Error('Unexpected transport call.');
        sent=true;
        const body=JSON.parse(options.body);
        if(body.model!==model||body.messages.length!==2||body.messages[0].content!==system||body.messages[1].content!==user)throw Error('Unexpected request body.');
        body.max_tokens=maxOutputTokens;
        const response=await fetch(url,{...options,body:JSON.stringify(body)});
        call.httpStatus=response.status;
        if(response.ok){
          const data=await response.clone().json();
          call.returnedModel=typeof data.model==='string'&&/^deepseek-[a-z0-9.-]{1,60}$/.test(data.model)?data.model:'unexpected-or-missing';
          const finish=data.choices?.[0]?.finish_reason;
          call.finishReason=['stop','length','content_filter','tool_calls','insufficient_system_resource','aborted'].includes(finish)?finish:'unexpected-or-missing';
          const usage=data.usage||{};
          call.usage=Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'].filter(k=>Number.isFinite(usage[k])).map(k=>[k,usage[k]]));
        }
        return response;
      }});
      const started=Date.now();
      try{
        const result=await runner({system,user,settings:{provider:'deepseek',model,apiKey}});
        call.transportOk=result.ok;
        if(!result.ok){call.errorCode=result.code;stopped=true;}
        else{
          try{
            const checks=validate(JSON.parse(result.output));
            if(!checks||Array.isArray(checks)||!Object.keys(checks).length||Object.entries(checks).some(([key,value])=>!/^\w{1,80}$/.test(key)||typeof value!=='boolean'))throw Error('Invalid validation metadata.');
            call.checks=Object.fromEntries(Object.entries(checks));call.ok=Object.values(call.checks).every(value=>value===true);
          }
          catch{call.checks={validStructuredResult:false};}
          if(!call.ok)stopped=true;
        }
      }catch{call.errorCode='LOCAL_PROBE_FAILED';stopped=true;}
      finally{call.elapsedMs=Date.now()-started;call.completedAt=new Date().toISOString();report.actualTokensReported=usageTotal();report.reservedTokenUpperBound=reserved();save();busy=false;}
      return structuredClone(call);
    },
    summary(){return structuredClone(report);},
    close(){apiKey='';stopped=true;return {reportPath,calls:report.calls.length,actualTokensReported:usageTotal()};},
  };
}
