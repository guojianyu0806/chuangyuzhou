import {getWorkbench,getVisibleModules} from './workbench-model.js';

export function companionButton(){
  return '<button class="assistant-fab companion-launcher" data-action="assistant" aria-label="打开小宇 AI伙伴"><span class="companion-orb" aria-hidden="true"><i></i><i></i></span><span class="companion-caption"><strong>小宇 · AI伙伴</strong><small>搭建、排列、帮你办事</small></span></button>';
}

export function openCompanion(ctx,{pageLabel='我的工作台'}={}){
  const {state,esc,modal,closeModal,go}=ctx;
  const title=getWorkbench(state).title;
  modal({title:'小宇 · 你的搭建伙伴',submitLabel:'带到 AI 对话',body:`
    <div class="companion-intro"><span class="companion-orb" aria-hidden="true"><i></i><i></i></span><p>从一个想法开始，我来帮你搭建工作台、创建自定义方块或交互小工具。<small>当前在「${esc(title)}」的${esc(pageLabel)}，已启用 ${getVisibleModules(state).length} 个模块。</small></p></div>
    <div class="companion-ideas" aria-label="搭建建议"><button type="button" data-companion-idea="build">帮我搭建工作台<span>按目标挑选模块、创建空间</span></button><button type="button" data-companion-idea="arrange">帮我重新排列<span>调整卡片位置与模块顺序</span></button><button type="button" data-companion-idea="organize">帮我整理资料与任务<span>跨空间整理，先给出操作方案</span></button><button type="button" data-companion-idea="create">创建方块或小工具<span>按你的用途设计内容与交互</span></button></div>
    <label class="field">你想怎样调整？<textarea name="intent" rows="3" maxlength="3000" required placeholder="例如：我在准备毕业论文，帮我搭建一个管理资料、实验和每周进度的工作台。"></textarea></label>
    <p class="small muted">这一步只准备对话草稿。发送后由 AI 提出方案，确认后才执行。</p>
    <div class="companion-links"><button type="button" class="text-btn" data-companion-chat>继续已有对话</button><button type="button" class="text-btn" data-companion-builder>自己动手搭建</button></div>`,async onSubmit(form){
      const text=String(form.get('intent')||'').trim();if(!text)return false;
      if(await ctx.askAssistant(text)!==true)return false;
      closeModal();return true;
    }});
  const host=document.querySelector('#modal');
  const prompts={build:'我希望按自己的实际需要搭建工作台。请先了解我的目标，再建议合适的模块和自建空间，给我可审核的搭建方案。',arrange:`请查看「${title}」当前的模块和画布。帮我把常用内容安排得更清楚；如果还不知道我的使用习惯，先向我确认，再给出排列方案。`,organize:'我想整理工作台里的资料和待办。请先了解我想整理的范围，核对已有内容，再给出可审核的跨空间操作方案。',create:'我想创建一个适合自己的方块或交互小工具。请先了解用途、需要填写的输入、希望得到的输出，以及需要记住的数据。请先给出可审核的方案，等我确认后再创建。'};
  host.querySelectorAll('[data-companion-idea]').forEach(button=>button.onclick=()=>{const input=host.querySelector('[name=intent]');input.value=prompts[button.dataset.companionIdea];input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});
  host.querySelector('[data-companion-chat]').onclick=()=>{closeModal();go('ai');};
  host.querySelector('[data-companion-builder]').onclick=()=>{closeModal();go('builder');};
}
