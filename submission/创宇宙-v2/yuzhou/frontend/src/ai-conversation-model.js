import {validateOrganizedProposal} from './ai-organizer.js';

export function validateConversation(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.messages) || value.messages.length > 80) throw new Error('对话记录格式不正确，或已超过 40 轮，请新开对话。');
  const ids=new Set();
  const messages=value.messages.map(m=>{
    if(!m||typeof m.id!=='string'||!m.id||m.id.length>128||ids.has(m.id)||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>30000||typeof m.createdAt!=='string')throw new Error('对话消息格式不正确。');
    ids.add(m.id);
    return {id:m.id,role:m.role,text:m.text,createdAt:m.createdAt,...(typeof m.jobId==='string'?{jobId:m.jobId}:{}),...(m.proposal?{proposal:validateOrganizedProposal(m.proposal)}:{})};
  });
  if(messages.reduce((n,m)=>n+m.text.length,0)>100000)throw new Error('这段对话已超过 100,000 字符，请另开对话。');
  if(JSON.stringify(messages).length>500000)throw new Error('这段对话资料较多，请另开对话继续。');
  const result={version:1,messages};
  if(value.proposal!=null)result.proposal=validateOrganizedProposal(value.proposal);
  for(const key of ['pendingJobId','confirmedJobId','parentRequestId'])if(value[key]!==undefined){if(typeof value[key]!=='string'||value[key].length>128)throw new Error('对话关联编号无效。');result[key]=value[key];}
  return result;
}

export function ensureConversation(request, uid) {
  if(!request.conversation)request.conversation={version:1,messages:[{id:uid(),role:'user',text:request.text||'请帮我看看附件。',createdAt:request.createdAt||new Date().toISOString()}]};
  return request.conversation;
}

// Bind a result to the exact conversation and attachments it saw. Pending
// proposals and completion metadata intentionally do not affect this snapshot.
export function conversationSnapshot(request) {
  return JSON.stringify({text:request.text||'',targetId:request.targetId||'auto',files:(request.files||[]).map(f=>({id:f.id,blobId:f.blobId,name:f.name})),messages:request.conversation?.messages||[]});
}
