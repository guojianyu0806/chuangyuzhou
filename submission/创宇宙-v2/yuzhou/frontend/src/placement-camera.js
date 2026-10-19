export const PLACEMENT_MIN_SCALE=0.001;
export const PLACEMENT_MAX_SCALE=1.6;

function finite(value,label){
  if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${label} must be a finite number`);
}
function validateView(view){
  if(!view||typeof view!=='object')throw new TypeError('Placement view is required');
  for(const key of ['x','y','scale','left','top'])finite(view[key],`view.${key}`);
  if(view.scale<=0)throw new TypeError('view.scale must be positive');
}
function result(view,x,y,scale){
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new RangeError('Placement view exceeds finite coordinates');
  return {...view,x,y,scale};
}

/** A camera-only change: preserve the world point beneath a stage-local anchor. */
export function zoomPlacementView(view,requestedScale,anchor){
  validateView(view);finite(requestedScale,'requestedScale');
  if(!anchor||typeof anchor!=='object')throw new TypeError('Zoom anchor is required');
  finite(anchor.x,'anchor.x');finite(anchor.y,'anchor.y');
  const scale=Math.min(PLACEMENT_MAX_SCALE,Math.max(PLACEMENT_MIN_SCALE,requestedScale));
  if(scale===view.scale)return {...view};
  const factor=1/view.scale-1/scale;
  return result(view,view.x+(anchor.x-view.left)*factor,view.y+(anchor.y-view.top)*factor,scale);
}

/** Pointer displacement is measured in screen pixels, regardless of zoom. */
export function panPlacementView(view,dx,dy){
  validateView(view);finite(dx,'dx');finite(dy,'dy');
  return result(view,view.x-dx/view.scale,view.y-dy/view.scale,view.scale);
}
