// View-only placement: no stored card coordinates or capture data are changed.
const EDGE=22,FOOTER=75,GAP=36,MIN_WIDTH=200,ASPECT=176/300;

export function placeDreamThought({width,height,occupied=[],random=Math.random}={}) {
  width=Number(width);height=Number(height);
  if(!Number.isFinite(width)||!Number.isFinite(height))return null;
  const maxWidth=Math.min(width-48,width<600?260:310);
  if(maxWidth<MIN_WIDTH||height<EDGE+FOOTER+MIN_WIDTH*ASPECT)return null;
  const obstacles=(Array.isArray(occupied)?occupied:[]).filter(rect=>rect&&
    [rect.x,rect.y,rect.w,rect.h].every(Number.isFinite)&&rect.w>0&&rect.h>0);
  const unit=()=>{
    const n=Number(typeof random==='function'?random():0.5);
    return Number.isFinite(n)?Math.max(0,Math.min(1-Number.EPSILON,n)):0.5;
  };
  function candidate(w,x,y){
    const h=w*ASPECT;
    if(x<EDGE||y<EDGE||x+w>width-EDGE||y+h>height-FOOTER)return null;
    if(obstacles.some(rect=>x<rect.x+rect.w+GAP&&x+w+GAP>rect.x&&
      y<rect.y+rect.h+GAP&&y+h+GAP>rect.y))return null;
    return {x,y,w,h};
  }
  // Random positions lead; the fallback exists for crowded or adversarial draws.
  for(let attempt=0;attempt<64;attempt++){
    const w=MIN_WIDTH+(maxWidth-MIN_WIDTH)*(0.25+unit()*0.75);
    const h=w*ASPECT;
    if(h>height-EDGE-FOOTER)continue;
    const placed=candidate(w,EDGE+unit()*(width-EDGE*2-w),EDGE+unit()*(height-EDGE-FOOTER-h));
    if(placed)return placed;
  }
  const w=MIN_WIDTH,h=w*ASPECT,maxX=width-EDGE-w,maxY=height-FOOTER-h;
  // Obstacle boundaries catch thin usable gaps that a coarse scan could miss.
  const xs=[EDGE,maxX],ys=[EDGE,maxY];
  for(const rect of obstacles.slice(0,32)){
    xs.push(rect.x+rect.w+GAP,rect.x-w-GAP);
    ys.push(rect.y+rect.h+GAP,rect.y-h-GAP);
  }
  for(const y of ys)for(const x of xs){
    const placed=candidate(w,x,y);if(placed)return placed;
  }
  // Bounded scan is jittered so recurring fallback positions are not a fixed grid.
  const columns=Math.min(48,Math.max(2,Math.ceil((maxX-EDGE)/20)+1));
  const rows=Math.min(32,Math.max(2,Math.ceil((maxY-EDGE)/20)+1));
  const offsetX=unit(),offsetY=unit();
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const x=EDGE+((column+offsetX)/columns)*(maxX-EDGE);
    const y=EDGE+((row+offsetY)/rows)*(maxY-EDGE);
    const placed=candidate(w,x,y);if(placed)return placed;
  }
  return null;
}
