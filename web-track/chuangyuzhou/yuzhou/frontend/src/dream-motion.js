// Transient view motion only: original captures and saved canvas coordinates stay untouched.
// Match the placement margins, including the readable note at the foot of the stage.
const EDGE=22,FOOTER=75,GAP=12;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const intersects=(a,b)=>a.x<b.x+b.w+GAP&&a.x+a.w+GAP>b.x&&
  a.y<b.y+b.h+GAP&&a.y+a.h+GAP>b.y;

export function createDreamMotion({position,width,height,occupied=[],random=Math.random}={}) {
  if(!position)return null;
  const {x,y,w,h}=position;
  if(![width,height,x,y,w,h].every(Number.isFinite)||w<=0||h<=0)return null;
  const limits={x:[EDGE-x,width-EDGE-w-x],y:[EDGE-y,height-FOOTER-h-y]};
  if(limits.x[0]>0||limits.x[1]<0||limits.y[0]>0||limits.y[1]<0)return null;
  const obstacles=(Array.isArray(occupied)?occupied:[]).filter(rect=>rect&&
    [rect.x,rect.y,rect.w,rect.h].every(Number.isFinite)&&rect.w>0&&rect.h>0);
  if(obstacles.some(rect=>intersects(position,rect)))return null;
  const unit=()=>{
    const value=Number(typeof random==='function'?random():.5);
    return Number.isFinite(value)?clamp(value,0,1):.5;
  };
  const room=axis=>Math.max(-limits[axis][0],limits[axis][1]);
  // Flow sideways when there is room; narrow stages use their vertical length.
  const axis=room('x')>=80||room('x')>=room('y')?'x':'y';
  const cross=axis==='x'?'y':'x',range=limits[axis];
  let direction=unit()<.5?-1:1;
  const available=sign=>sign<0?-range[0]:range[1];
  if(available(direction)<Math.min(140,room(axis)))direction=-direction;
  const desired=140+unit()*110,crossFactor=(unit()-.5)*.28,bendFactor=(unit()-.5)*2;
  const duration=(18000+unit()*10000)/1.2;
  function candidate(mainAxis,sign,fraction,bendScale){
    const crossAxis=mainAxis==='x'?'y':'x',mainRange=limits[mainAxis],crossRange=limits[crossAxis];
    const distance=Math.min(sign<0?-mainRange[0]:mainRange[1],desired)*fraction*sign;
    const crossEnd=clamp(crossFactor*Math.abs(distance)*bendScale,...crossRange);
    const bend=bendFactor*Math.min(54,Math.abs(distance)*.25)*bendScale;
    const control1=clamp(crossEnd/3+bend,...crossRange);
    const control2=clamp(crossEnd*2/3+bend,...crossRange);
    const points=[0,.25,.5,.75,1].map(offset=>{
      const inverse=1-offset;
      // A bowed cubic sampled into non-stopping translation segments. Its control
      // points remain inside a convex safe rectangle, as do interpolated frames.
      const main=distance*offset;
      const perpendicular=3*inverse*inverse*offset*control1+
        3*inverse*offset*offset*control2+offset*offset*offset*crossEnd;
      return {offset,dx:mainAxis==='x'?main:perpendicular,dy:mainAxis==='y'?main:perpendicular};
    });
    const left=Math.min(...points.map(point=>point.dx)),top=Math.min(...points.map(point=>point.dy));
    const area={x:x+left,y:y+top,w:w+Math.max(...points.map(point=>point.dx))-left,
      h:h+Math.max(...points.map(point=>point.dy))-top};
    if(obstacles.some(rect=>intersects(area,rect)))return null;
    const keyframes=points.map(({offset,dx,dy})=>({offset,transform:`translate(${dx||0}px, ${dy||0}px)`}));
    return {duration,keyframes,area};
  }
  // Reserve the entire path, not merely its endpoint. This intentionally favors
  // separated readable currents over weaving text through another moving cloud.
  const routes=[[axis,direction],[axis,-direction],[cross,direction],[cross,-direction]];
  let best=null,bestTravel=-1;
  for(const fraction of [1,.75,.5,.25,.1])for(const [mainAxis,sign] of routes){
    const free=sign<0?-limits[mainAxis][0]:limits[mainAxis][1];
    if(free<=0)continue;
    for(const bendScale of [1,-1,0]){
      const plan=candidate(mainAxis,sign,fraction,bendScale);
      if(!plan)continue;
      const travel=Math.min(free,desired)*fraction;
      if(travel>=80)return plan;
      if(travel>bestTravel){best=plan;bestTravel=travel;}
    }
  }
  // An exact fit or a fully surrounded, otherwise valid start remains readable.
  return best||candidate(axis,direction,0,0);
}
