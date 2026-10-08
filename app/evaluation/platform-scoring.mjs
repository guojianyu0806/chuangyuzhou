import {createHash} from 'node:crypto';

const TABLES=['workspaces','components','collections','records','assets'];
const META=new Set(['revision','createdAt','updatedAt']);
const own=(o,k)=>Object.hasOwn(o??{},k);
const canonical=value=>value===undefined?'undefined':Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const equal=(a,b)=>canonical(a)===canonical(b);
const rows=(state,table)=>Array.isArray(state?.[table])?state[table]:[];
const find=(state,table,id)=>rows(state,table).find(item=>item.id===id);
const pathValue=(object,path=[])=>path.reduce((value,key)=>Array.isArray(value)?value.find(item=>item?.id===key):value?.[key],object);
const matches=(object,where={})=>object&&Object.entries(where).every(([key,value])=>equal(pathValue(object,key.split('.')),value));
const field=(state,collectionId,id)=>find(state,'collections',collectionId)?.fields?.find(f=>f.id===id);
const fieldNamed=(state,collectionId,name)=>find(state,'collections',collectionId)?.fields?.filter(f=>f.name===name)??[];
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const idArray=value=>Array.isArray(value)&&value.every(item=>isObject(item)&&typeof item.id==='string');
function clean(value,atEntity=false){
  if(Array.isArray(value))return value.map(item=>clean(item,Boolean(item?.id)));
  if(!isObject(value))return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!atEntity||!META.has(key)).map(([key,item])=>[key,clean(item,Boolean(item?.id))]));
}
const stateBusiness=state=>Object.fromEntries(Object.entries(state??{}).filter(([key])=>!META.has(key)).map(([key,value])=>[key,clean(value)]));
const newRows=(before,after,table)=>{const ids=new Set(rows(before,table).map(row=>row.id));return rows(after,table).filter(row=>!ids.has(row.id));};
const newFields=(before,after,collectionId)=>{const old=new Set(find(before,'collections',collectionId)?.fields?.map(f=>f.id)??[]);return (find(after,'collections',collectionId)?.fields??[]).filter(f=>!old.has(f.id));};
const fieldMatches=(actual,expected)=>Boolean(actual)&&['name','type','targetCollectionId'].every(k=>!own(expected,k)||equal(actual[k],expected[k]));
const valueSubset=(values,expected)=>Object.entries(expected??{}).every(([id,value])=>equal(values?.[id],value));
const titleOf=(state,record)=>{const col=find(state,'collections',record.collectionId);return record.values?.[col?.semanticBindings?.title];};
const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;

// Keep IDs in diff paths for entity arrays. Numeric positions would misidentify
// a field rename whenever another field was independently inserted before it.
function leafDiff(before,after,path=[]){
  if(equal(before,after))return [];
  if(idArray(before)&&idArray(after)){
    const a=new Map(before.map(row=>[row.id,row])),b=new Map(after.map(row=>[row.id,row]));
    const changes=[];
    for(const id of new Set([...a.keys(),...b.keys()]))changes.push(...leafDiff(a.get(id),b.get(id),[...path,id]));
    const oldCommon=before.filter(row=>b.has(row.id)).map(row=>row.id),newCommon=after.filter(row=>a.has(row.id)).map(row=>row.id);
    if(!equal(oldCommon,newCommon))changes.push([...path,'$order']);
    return changes;
  }
  if(isObject(before)&&isObject(after)){
    const changes=[];
    for(const key of new Set([...Object.keys(before),...Object.keys(after)]))changes.push(...leafDiff(before[key],after[key],[...path,key]));
    return changes;
  }
  return [path];
}
function allowedNewFieldIds(task,before,after,collectionId){
  const expectations=task.expected.all.filter(c=>c.check==='new_field'&&c.collectionId===collectionId);
  const added=newFields(before,after,collectionId);
  return new Set(expectations.flatMap(expected=>{const matching=added.filter(f=>fieldMatches(f,expected));return matching.length===expected.count?matching.map(f=>f.id):[];}));
}
function newEntityAllowed(task,before,after,table,row,exceptions){
  const token={records:'<new-record>',components:'<new-component>',collections:'<new-collection>',workspaces:'<new-workspace>',assets:'<new-asset>'}[table];
  if(!exceptions.includes(token))return false;
  const applicable=task.expected.all.filter(check=>check.table===table&&check.check==='matching_count');
  if(table==='records'){
    const constraints=task.expected.all.filter(check=>check.check==='new_record_values');
    return constraints.some(check=>{const matching=newRows(before,after,table).filter(r=>r.collectionId===check.collectionId&&valueSubset(r.values,check.values));return matching.length===check.count&&matching.some(r=>r.id===row.id);});
  }
  return applicable.some(check=>rows(after,table).filter(r=>matches(r,check.where)).length===check.count&&matches(row,check.where));
}
function permittedPath(task,before,after,table,id,path,pattern){
  const parts=pattern.split('.'),actual=[id,...path];
  if(parts.length>actual.length)return false;
  return parts.every((part,index)=>{
    if(part==='*')return true;
    if(part==='<new-field>')return table==='collections'&&index===2&&actual[1]==='fields'&&allowedNewFieldIds(task,before,after,id).has(actual[index]);
    if(part==='<new-field-id>'){
      const record=find(after,'records',id);
      return table==='records'&&index===2&&actual[1]==='values'&&record&&allowedNewFieldIds(task,before,after,record.collectionId).has(actual[index]);
    }
    return part===actual[index];
  });
}
function preservation(task,before,after){
  const unexpected=[];
  for(const rule of task.expected.preserve??[]){
    const table=rule.table,exceptions=rule.except??[];
    if(!TABLES.includes(table)){unexpected.push({table:String(table),id:'*',path:'$unknown-preserve-table'});continue;}
    const old=new Map(rows(before,table).map(row=>[row.id,row])),latest=new Map(rows(after,table).map(row=>[row.id,row]));
    for(const id of new Set([...old.keys(),...latest.keys()])){
      if(!old.has(id)){
        if(!newEntityAllowed(task,before,after,table,latest.get(id),exceptions))unexpected.push({table,id,path:'$add'});
      }else if(!latest.has(id))unexpected.push({table,id,path:'$remove'});
      else for(const path of leafDiff(clean(old.get(id),true),clean(latest.get(id),true))){
        if(!exceptions.some(pattern=>permittedPath(task,before,after,table,id,path,pattern)))unexpected.push({table,id,path:path.join('.')||'$replace'});
      }
    }
  }
  return [...new Map(unexpected.map(change=>[canonical(change),change])).values()];
}

function schemaEquivalent(actual,expected){
  if(!actual||actual.fields?.length!==expected.fields.length)return false;
  return expected.fields.every(wanted=>{
    const fields=actual.fields.filter(f=>fieldMatches(f,wanted));
    return fields.length===1&&(!wanted.options||equal(fields[0].options?.map(o=>o.label).sort(),[...wanted.options].sort()));
  });
}
function layoutValid(components,columns,noOverlap){
  for(const c of components){
    const l=c.layout,min=['board','calendar'].includes(c.type)?4:2;
    if(!l||!['x','y','w','h'].every(k=>Number.isInteger(l[k]))||l.x<0||l.y<0||l.y>500||l.w<min||l.h<min||l.h>24||l.w>columns||l.x+l.w>columns||l.y+l.h>524)return false;
  }
  const active=components.filter(c=>!c.archived);
  if(noOverlap)for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++)if(active[i].pageId===active[j].pageId&&overlaps(active[i].layout,active[j].layout))return false;
  return true;
}
function nestedIds(value,result=new Set()){
  if(Array.isArray(value))for(const item of value)nestedIds(item,result);
  else if(isObject(value)){if(typeof value.id==='string')result.add(value.id);for(const item of Object.values(value))nestedIds(item,result);}
  return result;
}
function remapCollection(collection,map){
  const c=structuredClone(clean(collection,true));delete c.id;c.workspaceId=map.get(c.workspaceId);
  for(const f of c.fields){f.id=map.get(f.id);if(f.targetCollectionId)f.targetCollectionId=map.get(f.targetCollectionId);for(const option of f.options??[])option.id=map.get(option.id);}
  for(const [key,value]of Object.entries(c.semanticBindings??{}))c.semanticBindings[key]=key==='doneOptions'?value.map(id=>map.get(id)):map.get(value);
  return c;
}
function remapComponent(component,map,collections){
  const filterField=component.props?.filter?collections.find(col=>col.id===component.binding?.collectionId)?.fields.find(f=>f.id===component.props.filter.fieldId):undefined;
  const c=structuredClone(clean(component,true));delete c.id;c.workspaceId=map.get(c.workspaceId);c.pageId=map.get(c.pageId);
  for(const key of Object.keys(c.binding??{}))c.binding[key]=map.get(c.binding[key]);
  if(c.props?.visibleFieldIds)c.props.visibleFieldIds=c.props.visibleFieldIds.map(id=>map.get(id));
  if(c.props?.sort)c.props.sort.fieldId=map.get(c.props.sort.fieldId);
  if(c.props?.filter){c.props.filter.fieldId=map.get(c.props.filter.fieldId);if(filterField?.type==='select'&&c.props.filter.value!==null)c.props.filter.value=map.get(c.props.filter.value);if(filterField?.type==='relation'&&Array.isArray(c.props.filter.value))c.props.filter.value=c.props.filter.value.map(id=>map.get(id)??id);}
  return c;
}
const withoutId=value=>{const out=structuredClone(clean(value,true));delete out.id;return out;};
function templateEquivalent(task,before,after,check){
  const template=task.attachments?.find(a=>a.id===check.attachmentId&&a.kind==='template')?.content;
  if(!template||template.format!=='chuang-universe-template')return false;
  const spaces=newRows(before,after,'workspaces');if(spaces.length!==1)return false;
  const actual=spaces[0],expected=template.workspace,map=new Map([[expected.id,actual.id]]);
  if(!equal(clean(actual.preferences),clean(expected.preferences))||actual.timezone!==expected.timezone||actual.archived!==expected.archived||actual.pages.length!==expected.pages.length)return false;
  for(let i=0;i<expected.pages.length;i++){if(actual.pages[i].name!==expected.pages[i].name)return false;map.set(expected.pages[i].id,actual.pages[i].id);}
  const collections=rows(after,'collections').filter(c=>c.workspaceId===actual.id),components=rows(after,'components').filter(c=>c.workspaceId===actual.id);
  if(collections.length!==template.collections.length||components.length!==template.components.length)return false;
  if(check.remapInternalIds){const original=nestedIds([expected,template.collections,template.components]);if([...nestedIds([actual,collections,components])].some(id=>original.has(id)))return false;}
  // Match collection definitions first, then verify all graph edges using the
  // complete ID map. This supports relation cycles and identical collection labels.
  const used=new Set();let attempts=0;
  function search(index,current){
    if(++attempts>10000)return null;
    if(index===template.collections.length){
      for(const col of template.collections){const target=collections.find(c=>c.id===current.get(col.id));if(!equal(remapCollection(col,current),withoutId(target)))return false;}
      const wanted=template.components.map(c=>canonical(remapComponent(c,current,template.collections))).sort(),got=components.map(c=>canonical(withoutId(c))).sort();return equal(wanted,got);
    }
    const source=template.collections[index];
    for(const candidate of collections){
      if(used.has(candidate.id)||candidate.name!==source.name||candidate.fields.length!==source.fields.length)continue;
      const next=new Map(current);next.set(source.id,candidate.id);let compatible=true;
      for(let i=0;i<source.fields.length;i++){
        const sf=source.fields[i],af=candidate.fields[i];
        if(sf.name!==af.name||sf.type!==af.type||(sf.options?.length??0)!==(af.options?.length??0)){compatible=false;break;}
        next.set(sf.id,af.id);
        for(let j=0;j<(sf.options?.length??0);j++){if(sf.options[j].label!==af.options[j].label){compatible=false;break;}next.set(sf.options[j].id,af.options[j].id);}
      }
      if(!compatible)continue;used.add(candidate.id);const result=search(index+1,next);used.delete(candidate.id);if(result===true)return true;if(result===null)return null;
    }
    return false;
  }
  return search(0,map);
}

export function scorePlatformTask({task,before,after,planned,engineering={}}){
  const checks=[];let unsupported=false;
  const result=(check,passed,detail)=>checks.push({check,status:passed?'pass':'fail',...(detail?{detail}:{})});
  const pending=(check,detail)=>checks.push({check,status:'pending',detail});
  const validShape=Boolean(before&&after&&TABLES.every(table=>Array.isArray(before[table])&&Array.isArray(after[table])));
  result('state_shape',validShape,'评分只读取明确的 before/after 状态；不推断提交成功。');
  const components=rows(after,'components').filter(c=>!task.workspaceId||c.workspaceId===task.workspaceId);
  for(const expected of task.expected?.all??[]){
    const name=expected.check;let passed;
    try{
      if(expected.table&&!TABLES.includes(expected.table)){unsupported=true;pending(name,'未知评分表：'+expected.table);continue;}
      switch(name){
        case 'table_count_delta':passed=rows(after,expected.table).length-rows(before,expected.table).length===expected.delta;break;
        case 'matching_count':passed=rows(after,expected.table).filter(row=>matches(row,expected.where)).length===expected.count;break;
        case 'matching_field':{const selected=rows(after,expected.table).filter(row=>matches(row,expected.where));passed=selected.length===1&&equal(pathValue(selected[0],expected.path),expected.value);break;}
        case 'field_equals':{const row=find(after,expected.table,expected.id);passed=Boolean(row)&&equal(pathValue(row,expected.path),expected.value);break;}
        case 'field_compare':{
          const value=pathValue(find(after,expected.table,expected.id),expected.path),target=expected.value;
          const operators={'>=':(a,b)=>a>=b,'>':(a,b)=>a>b,'<=':(a,b)=>a<=b,'<':(a,b)=>a<b,'===':equal,'==':equal,'!=':(a,b)=>!equal(a,b)};
          if(!own(operators,expected.operator)){unsupported=true;pending(name,'未支持的比较运算符：'+expected.operator);continue;}
          passed=typeof value==='number'&&Number.isFinite(value)&&typeof target==='number'&&operators[expected.operator](value,target);break;
        }
        case 'component_types':{const actual=components.filter(c=>!c.archived).map(c=>c.type);passed=expected.exact?equal([...actual].sort(),[...expected.types].sort()):expected.types.every(type=>actual.includes(type));break;}
        case 'shared_binding':{
          const selected=components.filter(c=>expected.types.includes(c.type)&&!c.archived);
          const ids=selected.map(c=>c.binding?.collectionId);
          passed=expected.types.every(type=>selected.some(c=>c.type===type))&&ids.every((id,index)=>typeof id==='string'&&find(after,'collections',id)?.workspaceId===selected[index].workspaceId)&&(!expected.sameCollection||new Set(ids).size===1);break;
        }
        case 'collection_schema':{const selected=rows(after,'collections').filter(c=>c.name===expected.name);passed=selected.length===1&&schemaEquivalent(selected[0],expected);break;}
        case 'new_page':{const old=new Set(find(before,'workspaces',expected.workspaceId)?.pages?.map(p=>p.id)??[]);passed=(find(after,'workspaces',expected.workspaceId)?.pages??[]).filter(p=>!old.has(p.id)&&p.name===expected.name).length===expected.count;break;}
        case 'same_page':{const selected=expected.componentIds.map(id=>find(after,'components',id));const first=selected[0];passed=selected.length>0&&selected.every(c=>c&&c.pageId===first?.pageId&&c.workspaceId===first?.workspaceId)&&find(after,'workspaces',first?.workspaceId)?.pages?.some(p=>p.id===first.pageId&&p.name===expected.pageName);break;}
        case 'stable_ids':passed=expected.ids.every(id=>Boolean(find(before,expected.table,id)&&find(after,expected.table,id)))&&(expected.nestedIds??[]).every(id=>expected.ids.some(parent=>nestedIds(find(before,expected.table,parent)).has(id)&&nestedIds(find(after,expected.table,parent)).has(id)));break;
        case 'layout_valid':passed=layoutValid(components,expected.gridColumns??12,expected.noOverlap);break;
        case 'spatial_relation':{const left=find(after,'components',expected.leftId),right=find(after,'components',expected.rightId);if(expected.relation!=='same_row_before'){unsupported=true;pending(name,'未支持的空间关系');continue;}passed=Boolean(left&&right&&left.pageId===right.pageId&&left.layout.y===right.layout.y&&left.layout.x+left.layout.w<=right.layout.x);break;}
        case 'new_field':passed=newFields(before,after,expected.collectionId).filter(f=>fieldMatches(f,expected)).length===expected.count;break;
        case 'value_by_field_name':{const r=find(after,'records',expected.recordId),fields=fieldNamed(after,r?.collectionId,expected.fieldName);passed=Boolean(r)&&fields.length===1&&equal(r.values?.[fields[0].id],expected.value);break;}
        case 'other_records_field_empty':{const fields=fieldNamed(after,expected.collectionId,expected.fieldName);passed=fields.length===1&&rows(after,'records').filter(r=>r.collectionId===expected.collectionId&&!expected.exceptRecordIds.includes(r.id)).every(r=>r.values?.[fields[0].id]==null);break;}
        case 'field_definition_equals':{const f=field(after,expected.collectionId,expected.fieldId);passed=Boolean(f)&&equal(f[expected.property],expected.value);break;}
        case 'option_label':passed=field(after,expected.collectionId,expected.fieldId)?.options?.find(o=>o.id===expected.optionId)?.label===expected.label;break;
        case 'new_record_values':passed=newRows(before,after,'records').filter(r=>!r.archived&&r.collectionId===expected.collectionId&&valueSubset(r.values,expected.values)).length===expected.count;break;
        case 'source_refs':{
          const records=newRows(before,after,'records').filter(r=>titleOf(after,r)===expected.newRecordTitle),asset=find(after,'assets',expected.assetId);
          const hash=asset?createHash('sha256').update(JSON.stringify({text:asset.text??'',linkUrl:asset.linkUrl??''})).digest('hex'):null;
          passed=records.length===1&&Boolean(asset)&&(expected.fieldIds??[]).every(id=>(records[0].sourceRefs??[]).some(ref=>ref.fieldId===id&&ref.assetId===expected.assetId&&(!expected.currentHash||ref.hash===asset.hash&&asset.hash===hash)&&(!expected.quoteExists||typeof ref.quote==='string'&&ref.quote.trim().length>0&&asset.text.includes(ref.quote))));
          result(name,passed,'仅检查字段引用、当前哈希及精确引文存在性。');pending('source_semantics','引文是否支持记录事实和日期仍需人工复核。');continue;
        }
        case 'all_text_content_empty':passed=components.filter(c=>c.type==='text').every(c=>c.props?.content===undefined||c.props.content==='');break;
        case 'template_structure_equivalent':{const equivalent=templateEquivalent(task,before,after,expected);if(equivalent===null){unsupported=true;pending(name,'同名结构匹配超过资源上限，需要人工核对。');continue;}passed=equivalent;break;}
        case 'no_state_write':passed=equal(stateBusiness(before),stateBusiness(after));break;
        case 'clarification':{
          const text=planned?.clarification??planned?.message;
          result('clarification_response',Array.isArray(planned?.actions)&&planned.actions.length===0&&typeof text==='string'&&text.trim().length>0,'只检查零动作与非空回复，不以关键词替代澄清质量。');
          pending(name,'待人工判断是否问清：'+(expected.requiredTopics??[]).join('；'));continue;
        }
        case 'stale_proposal_rejected':passed=engineering.staleRejected===true;break;
        case 'undo_dependency_rejected':passed=engineering.undoDependencyRejected===true;break;
        default:unsupported=true;pending(name??'unknown_check','未实现的声明式约束，不能计为机械通过。');continue;
      }
      result(name,Boolean(passed));
    }catch{result(name,false,'约束无法在给定状态中完成检查。');}
  }
  const unexpectedChanges=preservation(task,before,after);
  for(const rule of task.expected?.preserve??[])result('preserve:'+rule.table,!unexpectedChanges.some(change=>change.table===rule.table),rule.except?.length?'仅允许：'+rule.except.join('、'):'整个表及其现有对象保持不变');
  for(const [index,detail]of (task.expected?.humanReview??[]).entries())pending('human_review_'+(index+1),String(detail));
  if(!Array.isArray(task.expected?.all)||task.expected.all.length===0){unsupported=true;pending('missing_constraints','没有可评分约束。');}
  return {checks,scoringComplete:!unsupported,mechanicalPassed:validShape&&!unsupported&&!checks.some(c=>c.status==='fail')&&unexpectedChanges.length===0,pendingHuman:checks.filter(c=>c.status==='pending').length,unexpectedChanges,extraWriteCount:unexpectedChanges.length};
}
