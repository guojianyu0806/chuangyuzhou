import {WORKBENCH_MODULES} from './workbench-model.js';
const pages=new Set(['home','builder','welcome','settings','space','block',...WORKBENCH_MODULES.map(item=>item.id)]);
export function parseWorkspaceRoute(hash){
  if(typeof hash!=='string'||!hash.startsWith('#/'))return null;
  const parts=hash.slice(2).split('/');if(parts.length>4||!pages.has(parts[0]))return null;
  try{const [page,id='',detail='',item='']=parts.map(value=>decodeURIComponent(value));if([id,detail,item].some(value=>/[\u0000-\u001f]/.test(value)))return null;return {page,id,detail,item,hash};}catch{return null;}
}
export function workspaceRoute(page,id='',detail='',item=''){return '#/'+[page,...(id||detail||item?[id]:[]),...(detail||item?[detail]:[]),...(item?[item]:[])].map(value=>encodeURIComponent(value)).join('/');}
export function routeAvailable(state,hash){
  const route=parseWorkspaceRoute(hash);if(!route)return false;
  if(route.page==='space'||route.page==='builder'&&route.id)return !!state.spaces?.some(space=>space.id===route.id&&(route.page!=='builder'||!space.archived));
  if(route.page==='block')return !!state.customBlocks?.items?.some(block=>block.id===route.id);
  if(route.page==='courses'&&route.id)return !!state.courses?.some(course=>course.id===route.id);
  return true;
}
export function routeLabel(state,hash){
  const route=parseWorkspaceRoute(hash);if(!route)return '工作台';
  if(route.page==='builder')return route.id?`${state.spaces?.find(space=>space.id===route.id)?.title||'空间'}搭建台`:'搭建台';
  if(route.page==='space')return `${state.spaces?.find(space=>space.id===route.id)?.title||'空间'}${route.detail?` · ${{notes:'笔记',files:'资料',tasks:'待办',fitness:'运动',overview:'内容总览'}[route.detail]||'工作台'}`:''}`;
  if(route.page==='block')return state.customBlocks?.items?.find(block=>block.id===route.id)?.title||'方块';
  return {home:'我的工作台',welcome:'工作区入口',settings:'偏好与连接'}[route.page]||WORKBENCH_MODULES.find(item=>item.id===route.page)?.title||'工作台';
}
export function parentWorkspaceRoute(state,hash){
  const route=parseWorkspaceRoute(hash);if(!route)return '#/home';
  if(route.page==='builder'&&route.id)return workspaceRoute('space',route.id);
  if(route.page==='space'){
    if(route.detail)return workspaceRoute('space',route.id);
    const space=state.spaces?.find(space=>space.id===route.id);return space?.parentId&&state.spaces.some(item=>item.id===space.parentId)?workspaceRoute('space',space.parentId):'#/home';
  }
  if(route.page==='block'){const block=state.customBlocks?.items?.find(block=>block.id===route.id);if(block?.spaceId&&state.spaces?.some(space=>space.id===block.spaceId))return workspaceRoute('space',block.spaceId);}
  return '#/home';
}
export function createReturnNavigation({storage,key='czb-yuzhou-return-navigation-v1'}={}){
  let trail=[],returning=null;
  try{const cached=JSON.parse(storage?.getItem(key)||'null');if(Array.isArray(cached))trail=cached.filter(hash=>parseWorkspaceRoute(hash)).slice(-30);}catch{}
  const persist=()=>{try{storage?.setItem(key,JSON.stringify(trail));}catch{/* Navigation must not prevent business rendering. */}};
  return {
    visit(hash){if(!parseWorkspaceRoute(hash))return;if(returning===hash){returning=null;persist();return;}returning=null;const existing=trail.lastIndexOf(hash);if(existing>=0)trail=trail.slice(0,existing+1);else trail=[...trail,hash].slice(-30);persist();},
    target(state,current){const index=trail.lastIndexOf(current);for(let n=index-1;n>=0;n--)if(trail[n]!==current&&routeAvailable(state,trail[n]))return trail[n];return parentWorkspaceRoute(state,current);},
    back(state,current){const target=this.target(state,current),index=trail.lastIndexOf(target);trail=index>=0?trail.slice(0,index+1):[target];returning=target;persist();return target;}
  };
}
