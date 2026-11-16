import {hasIcon} from './icons.js';
import {getVisibleModules} from './workbench-model.js';

export const SPACE_ICON_OPTIONS=Object.freeze([
  ['folder','文件夹'],['book','书本'],['bookmark','书签'],['library','书架'],['graduation','毕业帽'],
  ['flag','旗帜'],['code','代码'],['briefcase','公文包'],['users','团队'],['puzzle','拼图'],
  ['megaphone','扩音器'],['trophy','奖杯'],['target','靶心'],['clipboard','记录板'],['rocket','火箭'],
  ['coffee','咖啡'],['leaf','叶子'],['mountain','山峰'],['compass','指南针'],['map','地图'],['globe','地球'],
  ['star','星标'],['bulb','灯泡'],['palette','调色板'],['camera','相机'],['music','音符'],['heart','爱心'],['dumbbell','哑铃'],
]);

const iconKeys=SPACE_ICON_OPTIONS.map(([key])=>key);
const intentIcons=[
  [/阅读|读书|书单|图书/u,['bookmark','library']],
  [/导览|路线|地图|旅行/u,['map','compass']],
  [/周末|散步|徒步|户外|露营/u,['mountain','leaf']],
  [/创作展|展览|布展|活动|志愿/u,['megaphone','flag']],
  [/复习|考试|课程|学习|作业/u,['library','graduation','book']],
  [/小组|团队|会议|协作/u,['users','briefcase']],
  [/设计|绘画|画画|摄影|音乐/u,['palette','camera','music']],
];
const templateIcons=new Map([
  ['course',['book','library']],['affairs',['flag','megaphone']],['project',['code','briefcase']],['fitness',['dumbbell','target']],
]);
const coreIcons=state=>['orbit','layers',...getVisibleModules(state).map(module=>module.icon)];

function preferredIcons(space){
  return [...(intentIcons.find(([pattern])=>pattern.test(space?.title||''))?.[1]||[]),
    ...(templateIcons.get(space?.type)||[]),...iconKeys];
}

/** The first owner keeps each stored icon. Fill collisions after reserving all owners. */
export function getSpaceIconMap(state){
  const spaces=Array.isArray(state?.spaces)?state.spaces.filter(space=>space&&!space.archived):[];
  const used=new Set(coreIcons(state));
  const icons=new Map();
  for(const space of spaces){
    if(hasIcon(space.icon)&&!used.has(space.icon)){icons.set(space.id,space.icon);used.add(space.icon);}
  }
  for(const space of spaces){
    if(icons.has(space.id))continue;
    const icon=preferredIcons(space).find(key=>!used.has(key))||(hasIcon(space.icon)?space.icon:'folder');
    icons.set(space.id,icon);used.add(icon);
  }
  return icons;
}

export function spaceIconPicker(state,space){
  const icons=getSpaceIconMap(state);
  const used=new Set(coreIcons(state));
  for(const [id,icon] of icons)if(id!==space?.id)used.add(icon);
  const current=space?(icons.get(space.id)||(hasIcon(space.icon)?space.icon:'folder')):null;
  const suggest=hints=>preferredIcons(hints).find(key=>!used.has(key))||'folder';
  const selected=current||suggest();
  const options=SPACE_ICON_OPTIONS.map(([key,label])=>({key,label,taken:used.has(key)&&key!==selected}));
  if(current&&!iconKeys.includes(current))options.unshift({key:current,label:'当前图标',taken:false});
  return {options,current:selected,suggest};
}
