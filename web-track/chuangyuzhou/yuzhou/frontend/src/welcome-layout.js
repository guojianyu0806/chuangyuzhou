const geometryKeys=['x','y','w','h','angle'];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const copy=rect=>Object.fromEntries(geometryKeys.map(key=>[key,rect[key]]));
const rect=(x,y,w,h,angle=0)=>({x,y,w,h,angle});
const radians=angle=>angle*Math.PI/180;

function bounds(item){
  const a=radians(item.angle),w=Math.abs(Math.cos(a))*item.w+Math.abs(Math.sin(a))*item.h;
  const h=Math.abs(Math.sin(a))*item.w+Math.abs(Math.cos(a))*item.h;
  return {x:item.x+(item.w-w)/2,y:item.y+(item.h-h)/2,w,h};
}
const separate=(a,b,gap=8)=>a.x+a.w+gap<=b.x||b.x+b.w+gap<=a.x||a.y+a.h+gap<=b.y||b.y+b.h+gap<=a.y;
function contained(item,width,height,padding=16){
  const b=bounds(item);
  return {...item,x:item.x+clamp(b.x,padding,width-padding-b.w)-b.x,y:item.y+clamp(b.y,padding,height-padding-b.h)-b.y};
}
function inputValue(value,name,min,max=100000){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new RangeError(`${name} is outside the supported layout range`);
  return value;
}

function gridLayout(width,height,count,centerHeight,columns){
  const padding=width<700?20:28,gap=columns===6?22:20,rows=columns===6?4:6;
  const cardW=(width-padding*2-gap*(columns-1))/columns;
  const cardH=Math.max(148,(centerHeight-gap)/2,(height-padding*2-gap*(rows-1))/rows);
  const centerColumn=columns===6?2:1,stepX=cardW+gap,stepY=cardH+gap,cards=[];
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    if((row===1||row===2)&&(column===centerColumn||column===centerColumn+1))continue;
    if(cards.length<count)cards.push(rect(padding+column*stepX,padding+row*stepY,cardW,cardH));
  }
  return {height:padding*2+rows*cardH+(rows-1)*gap,cards,center:rect(padding+centerColumn*stepX,padding+stepY,cardW*2+gap,cardH*2+gap)};
}

// Hand-composed bands deliberately have different heights and spacing. They are
// not the grid with a small random offset, and never depend on Math.random().
const desktopAnchors=[
  [.083,.145,1.00,-9],[.247,.090,.88,7],[.419,.175,1.02,-5],[.588,.092,.84,11],[.754,.173,.96,-8],[.920,.110,.85,6],
  [.091,.392,.91,7],[.235,.347,.79,-10],[.769,.360,.80,8],[.919,.401,.89,-7],
  [.087,.666,.83,-8],[.231,.625,.85,6],[.773,.632,.87,-7],[.921,.676,.80,10],
  [.082,.884,.88,8],[.251,.832,1.02,-6],[.416,.921,.86,9],[.589,.845,1.00,-8],[.757,.916,.91,6],[.922,.852,.87,-9],
];
const mediumAnchors=[
  [.120,.083,.96,-8],[.365,.111,.88,7],[.628,.075,1.03,-6],[.884,.104,.91,9],
  [.124,.274,.91,7],[.876,.284,.97,-8],[.107,.466,.86,-7],[.894,.479,.89,8],
  [.122,.624,.92,7],[.359,.582,1.01,-9],[.625,.629,.88,8],[.886,.593,.95,-7],
  [.111,.795,.86,-8],[.367,.752,.96,6],[.628,.809,1.02,-5],[.886,.753,.85,9],
  [.124,.925,.97,5],[.371,.907,.89,-8],[.621,.945,.88,8],[.884,.926,.97,-6],
];

function scatterLayout(width,height,count,centerHeight,columns){
  const desktop=columns===6,anchors=desktop?desktopAnchors:mediumAnchors;
  const centerW=desktop?clamp(width*.32,340,530):(width-60)/2;
  const center=rect((width-centerW)/2,height*(desktop?.49:.36)-centerHeight/2,centerW,centerHeight,-1.2);
  const obstacle=bounds(center),placed=[],cards=[];
  const baseW=desktop?clamp(width/7.2,148,215):(width-112)/4;
  const offsets=[[0,0]];
  for(const distance of [16,32,48,64,88])for(const [x,y]of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,1],[-1,1],[1,-1]])offsets.push([x*distance,y*distance]);
  for(let index=0;index<count;index++){
    const [ax,ay,scale,angle]=anchors[index];
    const w=baseW*scale,h=(desktop?146:150)*[1.03,.88,1.12,.96][index%4];
    let selected;
    for(const factor of [1,.96,.91,.86]){
      for(const [dx,dy]of offsets){
        const item=contained(rect(ax*width-w*factor/2+dx,ay*height-h*factor/2+dy,w*factor,h*factor,angle),width,height);
        const box=bounds(item);
        if(separate(box,obstacle,16)&&placed.every(previous=>separate(box,previous,7))){selected=item;break;}
      }
      if(selected)break;
    }
    if(!selected)return null;
    cards.push(selected);placed.push(bounds(selected));
  }
  return {cards,center};
}

function mobileLayouts(width,height,count,centerHeight){
  const padding=16,gap=20,cardW=(width-padding*2-gap)/2,cardH=154;
  const hasTopRow=count>0,gridCenterY=padding+(hasTopRow?cardH+gap:0);
  const grid={cards:[],center:rect(padding,gridCenterY,width-padding*2,centerHeight)};
  for(let index=0;index<count;index++){
    const row=Math.floor(index/2),y=row===0?padding:gridCenterY+centerHeight+gap+(row-1)*(cardH+gap);
    grid.cards.push(rect(padding+(index%2)*(cardW+gap),y,cardW,cardH));
  }
  const scatter={cards:[],center:null};
  let nextY=padding;
  function pair(start){
    const group=[];
    for(let index=start;index<Math.min(count,start+2);index++){
      const variant=index%4,w=cardW*[.91,.98,.88,.95][variant],h=[157,143,169,151][variant];
      const angle=[-5,4,6,-4][variant],x=index%2===0?padding+3:width-padding-3-w;
      const item=rect(x,nextY+(index%2?23:0),w,h,angle),box=bounds(item);
      // Keep the rotated outline inside the stage, including small phones.
      item.x+=index%2===0?Math.max(0,padding-box.x):Math.min(0,width-padding-box.x-box.w);
      item.y+=Math.max(0,padding-box.y);group.push(item);
    }
    scatter.cards.push(...group);
    nextY=Math.max(...group.map(item=>{const box=bounds(item);return box.y+box.h;}))+34+(start%6===0?8:0);
  }
  if(hasTopRow)pair(0);
  const centerW=width-padding*2-8;
  scatter.center=rect((width-centerW)/2,nextY,centerW,centerHeight,-.7);
  const centerBox=bounds(scatter.center);nextY=centerBox.y+centerBox.h+36;
  for(let start=2;start<count;start+=2)pair(start);
  const bottom=layout=>Math.max(...[layout.center,...layout.cards].map(item=>{const box=bounds(item);return box.y+box.h;}))+padding;
  return {height:Math.max(height,bottom(grid),bottom(scatter)),grid,scatter};
}

/** Pure, deterministic geometry. All coordinates are stage-local top-left pixels. */
export function getWelcomeLayouts({width,height,count,centerHeight=300}={}){
  inputValue(width,'width',240);inputValue(height,'height',1);inputValue(centerHeight,'centerHeight',1,10000);
  if(!Number.isInteger(count)||count<0||count>20)throw new RangeError('count must be an integer from 0 to 20');
  if(width<=600)return mobileLayouts(width,height,count,centerHeight);
  const columns=width>=1100?6:4;
  let stageHeight=Math.max(height,columns===6?760:1150,centerHeight+(columns===6?460:850));
  for(let attempt=0;attempt<7;attempt++){
    const grid=gridLayout(width,stageHeight,count,centerHeight,columns);stageHeight=grid.height;
    const scatter=scatterLayout(width,stageHeight,count,centerHeight,columns);
    if(scatter)return {height:stageHeight,scatter,grid:{cards:grid.cards,center:grid.center}};
    stageHeight*=1.15;
  }
  throw new RangeError('stage cannot safely fit the requested welcome geometry');
}

/** t=0 is the scattered endpoint, t=1 is the compact grid. No easing is applied. */
export function interpolateWelcomeLayout(layouts,t){
  if(typeof t!=='number'||!Number.isFinite(t))throw new TypeError('layout mix must be a finite number');
  if(!layouts||!Number.isFinite(layouts.height)||layouts.height<=0)throw new TypeError('invalid welcome layouts');
  const {scatter,grid}=layouts;
  if(!Array.isArray(scatter?.cards)||!Array.isArray(grid?.cards)||scatter.cards.length!==grid.cards.length)throw new TypeError('layout endpoints must have matching card counts');
  for(const layout of [scatter,grid])for(const item of [layout.center,...layout.cards]){
    if(!item||geometryKeys.some(key=>!Number.isFinite(item[key]))||item.w<=0||item.h<=0)throw new TypeError('invalid layout rectangle');
  }
  const mix=clamp(t,0,1),lerp=(first,second)=>mix===0?copy(first):mix===1?copy(second):Object.fromEntries(geometryKeys.map(key=>[key,first[key]+(second[key]-first[key])*mix]));
  return {height:layouts.height,cards:scatter.cards.map((item,index)=>lerp(item,grid.cards[index])),center:lerp(scatter.center,grid.center)};
}
