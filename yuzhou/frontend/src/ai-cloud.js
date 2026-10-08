import {ensureConversation} from './ai-conversation-model.js';
const byState = new WeakMap();
const entry = state => { if (!byState.has(state)) byState.set(state, {jobs:new Map(), listeners:new Set()}); return byState.get(state); };
const emit = state => entry(state).listeners.forEach(fn => fn());
export const jobFor = (state, requestId) => entry(state).jobs.get(requestId);
export const cloudAIEnabled = ctx => !!ctx.cloud?.enabled && ctx.state.mode === 'personal';
export const jobWorking = job => !!job && ['queued','running'].includes(job.status);

export async function startAIJob(ctx, request) {
  if (!cloudAIEnabled(ctx)) throw new Error(ctx.cloud?.enabled ? '请先进入“我的工作台”，再提交真实资料。' : '请在云端工作台连接大模型后使用自动整理。');
  const cache = entry(ctx.state);
  if (jobWorking(cache.jobs.get(request.id))) return;
  cache.jobs.set(request.id, {requestId:request.id,status:'queued',starting:true}); emit(ctx.state);
  try {
    const status = await ctx.cloud.request('/api/model/status'); ctx.cloud.modelStatus = status;
    if (!status.configured) throw new Error('请先在“偏好与连接”中保存 DeepSeek API Key。原文已收好。');
    if (!status.hermesAvailable) throw new Error('Hermes 服务尚未就绪，原文和附件已保留。');
    ensureConversation(request,ctx.uid);ctx.save(ctx.state);
    await ctx.cloud.flush();
    const {job} = await ctx.cloud.request('/api/ai/jobs', {method:'POST',body:{requestId:request.id,text:request.text,
      fileIds:[...new Set((request.files||[]).map(f=>f.blobId))],destinationId:request.targetId,kind:'conversation',autoFile:false,turnId:request.conversation.messages.at(-1)?.id}});
    cache.jobs.set(request.id, job); emit(ctx.state);
    return job;
  } catch (error) {
    cache.jobs.set(request.id, {requestId:request.id,status:'failed',error:{message:error.message}}); emit(ctx.state); throw error;
  }
}

// Job progress is transient: saving polling updates into the workspace would
// race the server's atomic archive and needlessly cause revision conflicts.
export function watchAIJobs(ctx, onChange) {
  if (!cloudAIEnabled(ctx)) return () => {};
  const cache = entry(ctx.state); cache.listeners.add(onChange);
  let active = true, fetching = false;
  const update = job => { if (active && ctx.state.aiRequests.some(r=>r.id===job.requestId)) cache.jobs.set(job.requestId,job); };
  const complete = async job => {
    if (job.status === 'succeeded' && (job.autoFiled||job.replySaved)) await ctx.cloud.poll();
  };
  const poll = async () => {
    if (!active || fetching || !ctx.cloud.authenticated) return;
    fetching = true;
    let changed=false;
    try {
      for (const job of [...cache.jobs.values()].filter(j=>j.id&&jobWorking(j))) {
        const result = await ctx.cloud.request(`/api/ai/jobs/${encodeURIComponent(job.id)}`);
        if (!active) break;
        if(JSON.stringify(job)!==JSON.stringify(result.job)){update(result.job);changed=true;}
        await complete(result.job);
      }
      if (active&&changed) onChange();
    } catch (error) { if (active && error.status===401) onChange(); }
    finally { fetching=false; }
  };
  (async () => {
    try {
      const [result, status] = await Promise.all([ctx.cloud.request('/api/ai/jobs'),ctx.cloud.request('/api/model/status')]);
      if (!active) return;
      ctx.cloud.modelStatus=status;
      for (const job of result.jobs || []) {
        if (!cache.jobs.has(job.requestId)) update(job);
      }
      if((result.jobs||[]).some(job=>job.replySaved))await ctx.cloud.poll();
      const incomplete = [...cache.jobs.values()].filter(j=>j.status==='succeeded'&&!j.proposal&&ctx.state.aiRequests.some(r=>r.id===j.requestId&&r.status==='waiting_model')).slice(0,5);
      for (const job of incomplete) {const result=await ctx.cloud.request(`/api/ai/jobs/${encodeURIComponent(job.id)}`);update(result.job);await complete(result.job);}
      if (active) onChange();
      await poll();
    } catch { /* Saved inputs stay usable; the connection indicator reports outages. */ }
  })();
  const timer=setInterval(poll,2500);
  return () => {active=false;clearInterval(timer);cache.listeners.delete(onChange);};
}
