/** Route before a synchronous save can replace the clicked navigation node. */
export function createSidebarNavigation({navigate,togglePinned,isMobile=()=>false,now=()=>performance.now()}) {
  let previous={href:'',time:0};
  return event=>{
    const link=event.target?.closest?.('.sidebar a[href^="#/"]');
    if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    if(link.hasAttribute('download')||(link.target&&link.target!=='_self'))return;
    const href=link.getAttribute('href');
    if(!href?.startsWith('#/'))return;
    const time=now(),toggle=!isMobile()&&event.detail>0&&(event.detail===2||(previous.href===href&&time-previous.time<500));
    previous=toggle?{href:'',time:0}:{href,time};
    event.preventDefault();
    navigate(href);
    if(toggle)togglePinned();
  };
}
