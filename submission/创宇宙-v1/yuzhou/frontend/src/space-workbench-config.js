import {WORKBENCH_MODULES} from './workbench-model.js';

export const SPACE_SECTIONS=Object.freeze([
  {id:'notes',title:'空间笔记',description:'只属于本空间的笔记和修订。',icon:'book',color:'#AE88FF'},
  {id:'files',title:'空间资料',description:'本空间的原件、预览与正文提取。',icon:'folder',color:'#9DC5FF'},
  {id:'tasks',title:'空间待办',description:'本空间行动，同时关联全局待办和日历。',icon:'check-circle',color:'#D8F649'},
  {id:'assistant',title:'空间 AI 伙伴',description:'带着当前空间的目标讨论和整理。',icon:'sparkles',color:'#FF9CCE'},
  {id:'fitness',title:'空间运动',description:'本空间的运动记录与统计。',icon:'chart',color:'#63E6DC'}
]);
const sections=new Set(SPACE_SECTIONS.map(item=>item.id)),modules=new Set(WORKBENCH_MODULES.filter(item=>item.id!=='ai').map(item=>item.id));
export function validateSpaceWorkbench(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||Object.keys(value).some(key=>!['version','sections','modules'].includes(key)))throw Error('子空间搭建配置无效。');
  for(const [key,allowed] of [['sections',sections],['modules',modules]])if(!Array.isArray(value[key])||value[key].length>allowed.size||new Set(value[key]).size!==value[key].length||value[key].some(id=>!allowed.has(id)))throw Error('子空间方块目录无效。');
  if(!value.sections.includes('assistant'))throw Error('子空间需要保留 AI 伙伴入口。');
  return {version:1,sections:[...value.sections],modules:[...value.modules]};
}
export function getSpaceWorkbench(space){return space.workbench?validateSpaceWorkbench(space.workbench):{version:1,sections:['notes','files','tasks','assistant',...(space.fitnessEnabled||space.type==='fitness'?['fitness']:[])],modules:[]};}
export function validateSpaceStructure(state){
  const spaces=new Map((state.spaces||[]).map(item=>[item.id,item]));
  for(const space of spaces.values()){
    if(space.workbench!==undefined)validateSpaceWorkbench(space.workbench);
    if(space.parentId!==undefined&&(typeof space.parentId!=='string'||!spaces.has(space.parentId)||space.parentId===space.id))throw Error('上级空间已不存在或关联无效。');
    let current=space;const seen=new Set();while(current?.parentId){if(seen.has(current.id))throw Error('空间不能形成循环层级。');seen.add(current.id);current=spaces.get(current.parentId);}
  }
  for(const block of state.customBlocks?.items||[])if(block.spaceId!==undefined&&!spaces.has(block.spaceId))throw Error('方块所属空间已不存在。');
  return true;
}
