import {getWorkbench,getVisibleModules,validateWorkbench,validateNavigation,isNavigationId,MAX_NAVIGATION_ITEMS} from './workbench-model.js';

export {validateNavigation};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const fail=label=>{throw new Error(`${label}无效。`);};

function availableItems(state,workbench) {
  const items=[
    {id:'home',title:workbench.title,icon:'orbit',href:'#/home',kind:'core'},
    {id:'builder',title:'搭建台',icon:'layers',href:'#/builder',kind:'core'},
    ...getVisibleModules({workbench}).map(module=>({id:module.id,title:module.title,icon:module.icon,color:module.color,href:`#/${module.id}`,kind:'module',moduleId:module.id})),
  ];
  const spaces=state?.spaces??[];
  if(!Array.isArray(spaces))fail('导航工作区');
  for(const space of spaces){
    if(space.archived)continue;
    const id=`space:${space.id}`;
    if(typeof space.id!=='string'||!isNavigationId(id))fail('导航工作区编号');
    items.push({id,title:String(space.title||'未命名工作区'),icon:typeof space.icon==='string'?space.icon:'folder',color:/^#[a-f\d]{6}$/i.test(space.color||'')?space.color:'#AE88FF',href:`#/space/${encodeURIComponent(space.id)}`,kind:'space',spaceId:space.id});
  }
  if(items.length>MAX_NAVIGATION_ITEMS||new Set(items.map(item=>item.id)).size!==items.length)fail('导航列表');
  return items;
}

/** Read-only view. Disabled modules and archived/missing spaces keep stored preferences. */
export function getNavigationItems(state) {
  const workbench=getWorkbench(state),available=availableItems(state,workbench);
  const byId=new Map(available.map(item=>[item.id,item])),result=[];
  for(const preference of workbench.navigation?.items||[]){
    const item=byId.get(preference.id);
    if(item){result.push({...item,placement:preference.placement});byId.delete(item.id);}
  }
  for(const item of available)if(byId.has(item.id))result.push({...item,placement:'primary'});
  return result;
}

/** Position is a zero-based index in getNavigationItems, including hidden items. */
export function configureNavigation(state,patch) {
  if(!plain(state))fail('工作区');
  if(!plain(patch)||Object.keys(patch).some(key=>!['id','placement','position'].includes(key)))fail('导航修改');
  const hasPlacement=Object.hasOwn(patch,'placement'),hasPosition=Object.hasOwn(patch,'position');
  if(!hasPlacement&&!hasPosition)fail('导航修改');
  const items=getNavigationItems(state),index=items.findIndex(item=>item.id===patch.id);
  if(index<0)fail('待修改导航');
  const item=items[index];
  if(hasPlacement){
    if(!['primary','more','hidden'].includes(patch.placement))fail('导航显示位置');
    if(item.kind==='core'&&patch.placement!=='primary')fail('固定导航入口');
    item.placement=patch.placement;
  }
  if(hasPosition){
    if(!Number.isInteger(patch.position)||patch.position<0||patch.position>=items.length)fail('导航位置');
    items.splice(index,1);items.splice(patch.position,0,item);
  }
  const next=getWorkbench(state),availableIds=new Set(items.map(row=>row.id));
  const stored=next.navigation?.items||[],storedIds=new Set(stored.map(row=>row.id));
  const merged=[...stored,...items.filter(row=>!storedIds.has(row.id))];
  let cursor=0;
  // Preserve unavailable slots while reordering only currently editable entries.
  next.navigation={version:1,items:merged.map(row=>{
    const entry=availableIds.has(row.id)?items[cursor++]:row;
    return {id:entry.id,placement:entry.placement};
  })};
  next.onboardingComplete=true;
  state.workbench=validateWorkbench(next);
  return state.workbench.navigation;
}

/** Restore the original module/space order without touching modules, canvas or records. */
export function resetNavigation(state) {
  if(!plain(state))fail('工作区');
  const next=getWorkbench(state);
  delete next.navigation;
  state.workbench=validateWorkbench(next);
  return getNavigationItems(state);
}
