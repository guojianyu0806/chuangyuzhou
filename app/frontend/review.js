const own=(value,key)=>value!==null&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const labels={id:'系统 ID',name:'名称',title:'标题',workspaceId:'所属空间',pageId:'所在页面',type:'类型',layout:'布局',x:'横向位置',y:'纵向位置',w:'宽度',h:'高度',props:'显示设置',binding:'数据绑定',collectionId:'记录组',statusFieldId:'分组字段',dateFieldId:'日期字段',content:'笔记内容',assetIds:'关联资料',visibleFieldIds:'显示字段',filter:'筛选',fieldId:'字段',operator:'条件',value:'筛选值',sort:'排序',direction:'顺序',collapsed:'折叠',color:'模块颜色',archived:'已归档',preferences:'空间偏好',density:'内容密度',theme:'主题',accent:'强调色',favoriteComponents:'常用模块',priorityText:'优先展示内容',timezone:'时区',pages:'页面',fields:'字段',options:'选项',label:'显示标签',targetCollectionId:'关联记录组',semanticBindings:'字段含义',status:'状态',dueDate:'截止日期',start:'开始',end:'结束',doneOptions:'完成状态',values:'记录内容',sourceRefs:'原文依据',assetId:'来源资料',hash:'来源版本',quote:'原文引句',linkUrl:'网页链接',text:'文字内容',schemaVersion:'结构版本',productId:'产品标识',revision:'版本'};
const enums={text:'文字',number:'数字',date:'日期',select:'单选',relation:'关联',list:'记录列表',board:'看板',calendar:'日历',resources:'资料链接',comfortable:'舒展',compact:'紧凑',light:'浅色',dark:'深色',asc:'升序',desc:'降序',eq:'等于',contains:'包含',before:'早于 / 小于',after:'晚于 / 大于'};

export function diffFields(before,after,path=[]){
 if(same(before,after))return [];
 if(object(before)||object(after)){
  const keys=[...new Set([...Object.keys(object(before)?before:{}),...Object.keys(object(after)?after:{})])];
  if(keys.length)return keys.flatMap(key=>diffFields(own(before,key)?before[key]:undefined,own(after,key)?after[key]:undefined,[...path,key]));
 }
 return [{path,before,after}];
}
export function reviewContexts(state,changes){
 const build=side=>{const result=structuredClone(state);for(const change of changes){if(!Array.isArray(result[change.entity]))result[change.entity]=[];result[change.entity]=result[change.entity].filter(row=>row.id!==change.id);if(change[side])result[change.entity].push(structuredClone(change[side]));}return result;};
 return {before:build('before'),after:build('after')};
}
export function createReviewRenderer({esc,icon,state}){
 function names(s,actions=[]){
  const result=new Map();
  for(const w of s.workspaces||[]){result.set(w.id,w.name);for(const p of w.pages||[])result.set(p.id,p.name);}
  for(const c of s.components||[])result.set(c.id,c.title);
  for(const c of s.collections||[]){result.set(c.id,c.name);for(const f of c.fields||[]){result.set(f.id,f.name);for(const o of f.options||[])result.set(o.id,o.label);}}
  for(const r of s.records||[]){const c=(s.collections||[]).find(c=>c.id===r.collectionId);result.set(r.id,String(r.values?.[c?.semanticBindings?.title]||'记录'));}
  for(const a of s.assets||[])result.set(a.id,a.title);
  const walk=value=>{if(!object(value))return;if(value.ref)result.set('$'+value.ref,value.title||value.name||value.label||value.ref);for(const v of Object.values(value))if(object(v))walk(v);};
  walk(actions);return result;
 }
 function pathLabel(path,map){return path.map(key=>labels[key]||map.get(key)||(/^\d+$/.test(key)?'第 '+(Number(key)+1)+' 项':key)).join(' › ')||'对象';}
 function valueText(value,map,path){
  if(value===undefined)return '未设置';if(value===null)return '未填写';if(value===true)return '是';if(value===false)return '否';
  if(typeof value==='string'){if(map.has(value))return map.get(value)+'（'+value+'）';if(['type','density','theme','operator','direction'].includes(path.at(-1))&&enums[value])return enums[value];}
  return object(value)?JSON.stringify(value,null,2):String(value);
 }
 function changes(review){
  const diffs=review.diff||review.changes||[],contexts=reviewContexts(state(),diffs),beforeNames=names(contexts.before,review.actions),afterNames=names(review.previewState||contexts.after,review.actions);
  return diffs.map(d=>{const fields=diffFields(d.before,d.after),name=afterNames.get(d.id)||beforeNames.get(d.id),description=name?(d.description||'内容变化').replaceAll(d.id,name):(d.description||'内容变化');return `<details class="diff-item" data-review-entity="${esc(d.entity)}"><summary>${icon(d.entity==='components'?'template':'file')}<span>${esc(description)}</span><small>${fields.length} 个字段</small></summary><div class="field-differences">${fields.map(f=>`<div class="field-difference" data-diff-path="${esc(f.path.join('.'))}"><h4>${esc(pathLabel(f.path,afterNames))}</h4><div class="diff-pair"><div><strong>修改前</strong><pre>${esc(valueText(f.before,beforeNames,f.path))}</pre></div><div><strong>修改后</strong><pre>${esc(valueText(f.after,afterNames,f.path))}</pre></div></div></div>`).join('')}</div><details class="raw-difference"><summary>完整原始数据</summary><pre>${esc(JSON.stringify({before:d.before,after:d.after},null,2))}</pre></details></details>`;}).join('');
 }
 function evidence(review){
  const diffs=review.diff||review.changes||[],contexts=reviewContexts(state(),diffs),after=review.previewState||contexts.after,lookup=names(after,review.actions);
  const refs=[...(review.evidence||[]).map(e=>({...e,side:'方案引用'}))];
  for(const d of diffs.filter(d=>d.entity==='records')){
   for(const side of ['before','after'])for(const ref of d[side]?.sourceRefs||[])refs.push({...ref,side:side==='before'?'修改前的引用':'修改后的引用',recordId:d.id});
  }
  const seen=new Set(),unique=refs.filter(r=>{const key=JSON.stringify([r.kind,r.messageId,r.assetId,r.fieldId,r.quote,r.actionIndex,r.recordId,r.side]);if(seen.has(key))return false;seen.add(key);return true;});
  if(!unique.length)return '';
  return `<section class="review-evidence"><h3>原文与来源核对</h3><p class="evidence-limit">系统仅校验引文逐字存在及来源版本；引文是否支持这项修改，仍需你核对语义。</p>${unique.map(r=>{
   const asset=(after.assets||[]).find(a=>a.id===r.assetId)||(contexts.before.assets||[]).find(a=>a.id===r.assetId);
   const refAction=(review.actions||[]).find(a=>r.assetId==='$'+a.ref&&a.op==='asset.create');
   const title=r.kind==='user_message'?'用户原始输入':asset?.title||refAction?.title||lookup.get(r.assetId)||'资料引用';
   const messageId=r.kind==='user_message'&&typeof r.messageId==='string'?r.messageId:'';
   const messageLabel=messageId?' · 输入标识 '+messageId.slice(0,8)+(messageId.length>8?'…':''):'';
   const recordLabel=r.recordId?' · '+(lookup.get(r.recordId)||r.recordId):'';
   return `<article class="evidence-item"${messageId?` data-message-id="${esc(messageId)}"`:''}><header><strong>${esc(title)}</strong><span>${esc(lookup.get(r.fieldId)||r.fieldId||'记录整体')}</span></header><blockquote>${esc(r.quote||'未提供引句')}</blockquote><small>${esc(r.side+recordLabel+messageLabel)}${Number.isInteger(r.actionIndex)?' · 第 '+(r.actionIndex+1)+' 个动作':''}</small>${messageId?`<details><summary>查看完整输入标识</summary><pre>${esc(messageId)}</pre></details>`:''}${asset?.text||refAction?.text?`<details><summary>查看保存的全文</summary><pre>${esc(asset?.text||refAction.text)}</pre></details>`:''}</article>`;
  }).join('')}</section>`;
 }
 function recordEvidence(record,s){
  return evidence({changes:[{entity:'records',id:record.id,before:null,after:record}],previewState:s});
 }
 function preferences(review){
  if(!review.preferenceContext)return '';
  const map=names(state()),items=diffFields(undefined,review.preferenceContext);
  return `<details class="provided-preferences"><summary>本轮提供给模型的偏好</summary><p>这里只列出请求时提供的偏好，不表示模型已实际采用。</p><dl>${items.map(item=>`<div><dt>${esc(pathLabel(item.path,map))}</dt><dd>${esc(valueText(item.after,map,item.path))}</dd></div>`).join('')}</dl></details>`;
 }
 return {changes,evidence,recordEvidence,preferences};
}
