import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimetableDisplay, normalizeTimetableScale, TIMETABLE_DISPLAY_KEY} from '../src/timetable-display.js';

function memoryStorage() {
  const data = new Map();
  return {getItem:key=>data.get(key) ?? null, setItem:(key,value)=>data.set(key,value), data};
}

test('timetable size persists on the current device without mutating or copying workspace data', () => {
  const phone = memoryStorage(), tablet = memoryStorage();
  phone.setItem('czb-yuzhou-workspace-v1-personal', JSON.stringify({timetable:{terms:[]},ui:{theme:'light'}}));
  const workspaceBefore = phone.getItem('czb-yuzhou-workspace-v1-personal');
  const onPhone = createTimetableDisplay(()=>phone), onTablet = createTimetableDisplay(()=>tablet);
  assert.equal(onPhone.read(),100); assert.equal(onTablet.read(),100);
  assert.deepEqual(onPhone.write(65), {scale:65,saved:true});
  assert.equal(createTimetableDisplay(()=>phone).read(),65);
  assert.equal(onTablet.read(),100);
  assert.equal(phone.getItem('czb-yuzhou-workspace-v1-personal'),workspaceBefore);
  assert.deepEqual(JSON.parse(phone.getItem(TIMETABLE_DISPLAY_KEY)),{version:1,scale:65});
  assert.equal(tablet.data.size,0);
  assert.equal(onPhone.write(100).scale,100); assert.equal(createTimetableDisplay(()=>phone).read(),100);
});

test('unsupported or corrupt preferences cannot create invalid layout dimensions', () => {
  for (const [value,expected] of [[0,30],[10000,180],[67,65],[Infinity,100],[NaN,100],['75',100],[null,100]]) assert.equal(normalizeTimetableScale(value),expected);
  const storage=memoryStorage();
  for(const raw of ['broken','null','{}','{"version":2,"scale":50}','{"version":1,"scale":"75"}']) {
    storage.setItem(TIMETABLE_DISPLAY_KEY,raw);assert.equal(createTimetableDisplay(()=>storage).read(),100);
  }
  storage.setItem(TIMETABLE_DISPLAY_KEY,'{"version":1,"scale":999}');
  assert.equal(createTimetableDisplay(()=>storage).read(),180);
});

test('storage failures preserve a usable session and explicitly report that persistence failed', () => {
  const display=createTimetableDisplay(()=>{throw new Error('Storage disabled');});
  assert.equal(display.read(),100);
  assert.deepEqual(display.write(80),{scale:80,saved:false});
  assert.equal(display.read(),80);
  assert.deepEqual(display.write(100),{scale:100,saved:false});
  assert.equal(display.read(),100);
});
