// Continuation identifiers come from the server. Browser chat text is display only.
export function conversationFrom(source){
 if(!source?.contextId)return null;
 return {id:source.contextId,workspaceId:source.contextWorkspaceId||'',baseRevision:source.contextBaseRevision,expiresAt:source.contextExpiresAt};
}

export function continuationProblem(context,{baseRevision,workspaceId='',now=Date.now()}={}){
 if(!context)return '';
 if(context.error)return context.error;
 if(context.workspaceId!==(workspaceId||''))return '已切换空间。请返回原空间继续，或开启新话题。';
 if(context.baseRevision!==baseRevision)return '空间内容已变化，请开启新话题，按当前内容重新生成方案。';
 const expiry=Date.parse(context.expiresAt);
 if(!Number.isFinite(expiry)||expiry<=now)return '当前话题已过期，请开启新话题。';
 return '';
}

export function proposalCanConfirm(proposal,{baseRevision,message='',busy=false}={}){
 return !!proposal&&(!proposal.status||proposal.status==='pending')&&proposal.baseRevision===baseRevision&&!busy&&(proposal.origin==='manual'||!message.trim());
}

export function savedSelectionId(state,selectedComponentId,workspaceId=''){
 const component=state.components.find(item=>item.id===selectedComponentId&&!item.archived&&item.workspaceId===(workspaceId||''));
 return component?.id||'';
}

export function buildPlanRequest({message,baseRevision,workspaceId='',selectedComponentId='',context=null,now}){
 const problem=continuationProblem(context,{baseRevision,workspaceId,now});
 if(problem)throw Error(problem);
 return {baseRevision,message:message.trim(),...(workspaceId?{workspaceId}:{}),...(selectedComponentId?{selectedComponentId}:{}),...(context?{contextId:context.id}:{})};
}

// No cancellation or local-state mutation occurs before the request succeeds.
export async function requestPlan(input,request){
 const result=await request('/api/ai/plan',{method:'POST',body:buildPlanRequest(input)});
 return {...result,conversation:conversationFrom(result),proposal:result.proposal||null};
}
