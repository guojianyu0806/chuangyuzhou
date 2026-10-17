import {validateTimetable,formatWeeks} from './timetable-model.js';
import {escapeHTML as esc} from './services.js';

const normalized=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase();
const base=value=>normalized(value).replace(/\[\d+\]$/,'');
export const linkedTimetableCourse=(state,entry)=>entry?.courseId?(state.courses||[]).find(course=>course.id===entry.courseId&&!course.archived):undefined;
export function courseTimetableEntries(state,id){return (state.timetable?.terms||[]).flatMap(term=>term.entries.filter(entry=>entry.courseId===id&&!entry.archived).map(entry=>({term,entry})));}

/** A read-only preview. Ambiguous existing courses require explicit selection. */
export function planTimetableCourses(state,termId){
  const term=state.timetable?.terms?.find(item=>item.id===termId);if(!term)throw Error('这个学期已不存在。');
  const courses=(state.courses||[]).filter(item=>!item.archived),groups=new Map();
  for(const entry of term.entries.filter(item=>!item.archived)){
    const key=normalized(entry.title);if(!groups.has(key))groups.set(key,{title:entry.title,entries:[]});groups.get(key).entries.push(entry);
  }
  const items=[...groups.values()].map(group=>{
    const explicit=[...new Set(group.entries.map(item=>item.courseId).filter(Boolean))];
    if(explicit.length>1)throw Error(`「${group.title}」关联了不同课程，请先在上课安排中核对。`);
    if(explicit.length&&!courses.some(item=>item.id===explicit[0]))throw Error(`「${group.title}」的关联已失效，请先重新选择课程空间。`);
    const exact=courses.filter(item=>normalized(item.title)===normalized(group.title)),matches=exact.length?exact:courses.filter(item=>base(item.title)===base(group.title));
    if(!explicit.length&&matches.length>1)throw Error(`有多门「${group.title}」可选，请先在上课安排中明确关联。`);
    return {title:group.title,entryIds:group.entries.map(item=>item.id),courseId:explicit[0]||matches[0]?.id||''};
  });
  return {termId,items,createCount:items.filter(item=>!item.courseId).length,reuseCount:items.filter(item=>item.courseId).length,linkCount:items.reduce((sum,item)=>sum+item.entryIds.length,0),snapshot:JSON.stringify({term,courses:courses.map(({id,title})=>({id,title}))})};
}

function arrangementNote(term,entries){
  const days=['周一','周二','周三','周四','周五','周六','周日'];
  return `# 课程安排\n${term.title}\n\n${entries.map(entry=>`- ${days[entry.weekday-1]} ${entry.startPeriod}–${entry.endPeriod}节，${term.periods.find(p=>p.id===entry.startPeriod)?.start}–${term.periods.find(p=>p.id===entry.endPeriod)?.end}；${entry.location||'地点待补充'}；${entry.teacher||'教师待补充'}；${formatWeeks(entry.weeks)}。`).join('\n')}\n\n## 资料与笔记\n课程资料页收纳课件、教材索引和作业文件。学习笔记页记录课堂要点、练习过程和待解决的问题。这里记录的是上课安排，课堂内容可以继续补充。`;
}

export async function applyTimetableCourses(ctx,plan){
  if(ctx.isCurrent?.()===false)throw Error('工作台已切换，请重新预览。');
  const current=planTimetableCourses(ctx.state,plan.termId);if(current.snapshot!==plan.snapshot)throw Error('课程或课表已更新，请重新预览后再建立关联。');
  const state=ctx.state,before={courses:structuredClone(state.courses),timetable:structuredClone(state.timetable),updatedAt:state.updatedAt},now=new Date().toISOString();
  try{
    const term=state.timetable.terms.find(item=>item.id===plan.termId),used=new Set(state.courses.map(item=>item.id));
    for(const item of current.items){
      const entries=term.entries.filter(entry=>item.entryIds.includes(entry.id));let courseId=item.courseId;
      if(!courseId){courseId=ctx.uid();if(used.has(courseId))throw Error('课程编号重复，请重试。');used.add(courseId);state.courses.push({id:courseId,title:item.title,subtitle:term.title,color:entries[0].color,icon:'book',example:false,prompt:'请依据本课程上传的资料与我的笔记整理内容。明确区分原文、我的记录和补充解释；没有资料依据时说明，不编造课堂经历、页码或验证结果。',files:[],notes:[{id:ctx.uid(),title:'课程安排与学习记录',chapter:'课程安排',source:'根据本人已确认的课表整理。',content:arrangementNote(term,entries),updatedAt:now,revisions:[],example:false}],updatedAt:now});}
      for(const entry of entries)entry.courseId=courseId;
    }
    state.timetable=validateTimetable(state.timetable);await ctx.save();return {created:current.createCount,reused:current.reuseCount,linked:current.linkCount};
  }catch(error){state.courses=before.courses;state.timetable=before.timetable;if(before.updatedAt===undefined)delete state.updatedAt;else state.updatedAt=before.updatedAt;throw error;}
}

export function courseTimetableHTML(state,id){const links=courseTimetableEntries(state,id);if(!links.length)return '';return `<details class="course-timetable-links"><summary>关联课表 · ${links.length} 个上课安排</summary><ul>${links.map(({term,entry})=>`<li><strong>${esc(term.title)} · ${['周一','周二','周三','周四','周五','周六','周日'][entry.weekday-1]} ${entry.startPeriod}–${entry.endPeriod}节</strong><span>${esc(entry.teacher)} · ${esc(entry.location)} · ${esc(formatWeeks(entry.weeks))}</span></li>`).join('')}</ul><button class="btn" type="button" data-course-action="timetable">打开学期课表</button></details>`;}
