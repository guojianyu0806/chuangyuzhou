import {escapeHTML as esc} from './services.js';

// Read-only excerpts: never execute a miniapp or fetch/open an attachment here.
const text=(value,limit=600)=>{const s=String(value??'');return esc(s.length>limit?s.slice(0,limit)+'…':s);};
const wrap=(body,kind='')=>`<div class="cv-content-preview ${kind}">${body}</div>`;
export function blockCardPreview(block,{today=new Date()}={}){
  const c=block.config||{};
  if(block.kind==='note'){
    const content=String(c.text||'');
    return wrap(`<p class="cv-preview-prose"${content.trim()?' data-fit-note':''}>${text(content||'还没有正文，打开方块开始记录。',1200)}</p>`,'cv-preview-note');
  }
  if(block.kind==='checklist'||block.kind==='links'){
    const items=c.items||[];
    return wrap(items.length?`<ul class="cv-preview-list">${items.slice(0,5).map(item=>`<li${item.done?' class="is-done"':''}><span aria-hidden="true">${block.kind==='links'?'↗':item.done?'✓':'○'}</span><span>${text(item.label,140)}</span></li>`).join('')}</ul>${items.length>5?`<small>另有 ${items.length-5} 项，打开查看</small>`:''}`:'<p>还没有内容，打开方块添加。</p>');
  }
  if(block.kind==='table'){
    const cols=(c.columns||[]).slice(0,3),rows=(c.rows||[]).slice(0,4);
    return wrap(cols.length?`<table aria-label="表格内容预览"><thead><tr>${cols.map(col=>`<th scope="col"><span>${text(col.label,70)}</span></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${cols.map((_,i)=>`<td><span>${text(row.cells?.[i],140)}</span></td>`).join('')}</tr>`).join('')}</tbody></table>${!rows.length?'<p>还没有数据行</p>':''}${(c.columns?.length>3||c.rows?.length>4)?'<small>部分内容 · 打开查看完整表格</small>':''}`:'<p>打开方块设置表格列。</p>','cv-preview-table');
  }
  if(block.kind==='progress'){
    const ratio=Math.max(0,Math.min(100,(Number(c.value)||0)/(Number(c.target)||1)*100));
    return wrap(`<strong class="cv-preview-number">${Math.round(ratio)}<small>%</small></strong><progress aria-label="目标完成进度" value="${ratio}" max="100"></progress><p>${text(c.value??0)} / ${text(c.target??1)} ${text(c.unit||'')}</p>`,'cv-preview-metric');
  }
  if(block.kind==='countdown'){
    const start=Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()),target=Date.parse(`${c.date}T00:00:00Z`),days=Math.round((target-start)/86400000);
    return wrap(Number.isFinite(days)?`<span>${days<0?'已过去':days===0?'就是今天':'距离目标'}</span><strong class="cv-preview-number">${Math.abs(days)}<small>天</small></strong><p>${text(c.date)}</p>`:'<p>打开方块设置日期。</p>','cv-preview-metric');
  }
  return wrap(`<span class="cv-preview-app-mark" aria-hidden="true">↗</span><p class="cv-preview-prose">${text(block.description||'打开后运行，继续使用你的小工具。',400)}</p><small>手动启动 · 数据独立保存</small>`,'cv-preview-app');
}

export function spaceCardPreview(space,tasks=[]){
  const note=(space.notes||[]).find(n=>!n.archived),pending=tasks.filter(t=>t.spaceId===space.id&&!t.done&&!t.archived).slice(0,2);
  if(note)return wrap(`<span class="cv-preview-label">空间笔记</span><strong>${text(note.title,100)}</strong><p class="cv-preview-prose">${text(note.content,400)}</p>`,'cv-preview-space');
  if(pending.length)return wrap(`<span class="cv-preview-label">接下来</span><ul class="cv-preview-list">${pending.map(t=>`<li><span aria-hidden="true">○</span><span>${text(t.title,140)}</span></li>`).join('')}</ul>`,'cv-preview-space');
  const files=(space.files||[]).filter(f=>!f.archived).slice(0,3);
  if(files.length)return wrap(`<span class="cv-preview-label">空间资料</span><ul class="cv-preview-list">${files.map(f=>`<li>${text(f.name,140)}</li>`).join('')}</ul>`,'cv-preview-space');
  return '';
}

function fitNoteFont(paragraph,availableHeight,baseFont){
  paragraph.style.removeProperty('--cv-note-font-size');
  if(availableHeight<=0||!Number.isFinite(baseFont))return;
  // Measure natural wrapping before restoring the preview's line clamp.
  paragraph.style.setProperty('-webkit-line-clamp','none');
  let best=baseFont;
  try{
    const fits=()=>paragraph.scrollHeight<=availableHeight&&paragraph.scrollWidth<=paragraph.clientWidth;
    if(!fits())return;
    let min=Math.ceil(baseFont),max=56;
    while(min<=max){
      const size=Math.floor((min+max)/2);
      paragraph.style.setProperty('--cv-note-font-size',`${size}px`);
      if(fits()){best=size;min=size+1;}
      else max=size-1;
    }
  }finally{
    paragraph.style.removeProperty('-webkit-line-clamp');
    if(best>baseFont)paragraph.style.setProperty('--cv-note-font-size',`${best}px`);
    else paragraph.style.removeProperty('--cv-note-font-size');
  }
}

// Work in the card's CSS pixels: camera transforms must not change line count.
export function mountCardPreviewFit(root){
  let active=true;
  const previews=[...root.querySelectorAll('.cv-content-preview')];
  const noteSizes=new WeakMap();
  const fit=preview=>{
    if(!active||!preview.isConnected)return;
    const bounds=preview.getBoundingClientRect();
    if(!bounds.height||!preview.offsetHeight)return;
    const style=getComputedStyle(preview);
    const scale=bounds.height/preview.offsetHeight,padding=parseFloat(style.paddingBottom)||0;
    const paragraph=preview.querySelector('.cv-preview-prose');
    if(paragraph){
      const fitNote=preview.matches?.('.cv-home .cv-viewport:not(.is-list):not(.is-stack) .cv-preview-note')&&paragraph.hasAttribute('data-fit-note');
      if(fitNote){
        const size=[preview.clientWidth,preview.clientHeight,style.fontSize].join(':');
        if(noteSizes.get(preview)!==size){
          const availableHeight=preview.clientHeight-(parseFloat(style.paddingTop)||0)-padding-1;
          fitNoteFont(paragraph,availableHeight,parseFloat(style.fontSize));
          noteSizes.set(preview,size);
        }
      }else noteSizes.delete(preview);
      const lineHeight=parseFloat(getComputedStyle(paragraph).lineHeight)||22;
      const available=(bounds.bottom-paragraph.getBoundingClientRect().top)/scale-padding;
      paragraph.style.setProperty('--cv-preview-lines',String(Math.max(1,Math.floor(available/lineHeight))));
    }
    const rows=[...preview.querySelectorAll('tbody tr')];
    rows.forEach(row=>row.hidden=false);
    const bottom=bounds.bottom-padding*scale;
    const fits=rows.map(row=>row.getBoundingClientRect().bottom<=bottom+1);
    rows.forEach((row,index)=>row.hidden=!fits[index]);
  };
  previews.forEach(fit);
  const observer=new ResizeObserver(entries=>{if(active)entries.forEach(entry=>fit(entry.target));});
  previews.forEach(preview=>observer.observe(preview));
  return ()=>{active=false;observer.disconnect();};
}
