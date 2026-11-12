import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutCanvasTopicBoxes,setCanvasTopicBoxMembers,validateCanvasTopicBoxes} from '../src/canvas-topic-boxes.js';

const box=(index,cardIds,collapsed=false)=>({
  id:`00000000-0000-4000-8000-00000000000${index}`,title:'课程复习',x:580+index*400,y:180,collapsed,cardIds
});
const card=(id,x)=>({id,x,y:12,w:270,h:240,color:'#AE88FF'});

test('a box projects only its chosen cards and folding keeps loose cards at their own coordinates',()=>{
  const cards=[card('ai',20),card('notes',310),card('checklist',600)];
  const before=structuredClone(cards);
  const open=box(1,['notes','hidden']);
  const layout=layoutCanvasTopicBoxes(cards,[open]);
  assert.equal(layout.cards.length,3);
  assert.deepEqual(layout.positions.get('notes'),{x:open.x+16,y:open.y+72});
  assert.equal(layout.regions[0].count,1);
  assert.equal(layout.positions.has('checklist'),false);
  assert.equal(layout.positions.has('ai'),false);
  const folded=layoutCanvasTopicBoxes(cards,[{...open,collapsed:true}]);
  assert.deepEqual(folded.cards,[cards[0],cards[2]]);
  assert.equal(folded.memberships.get('notes'),open.id);
  assert.deepEqual(cards,before);
});

test('moving one chosen member leaves hidden members in place and rejects duplicate or AI membership',()=>{
  const first=box(1,['hidden','notes']),second=box(2,['other']);
  const next=setCanvasTopicBoxMembers([first,second],second.id,['other','notes']);
  assert.deepEqual(next.map(item=>item.cardIds),[['hidden'],['other','notes']]);
  assert.deepEqual(first.cardIds,['hidden','notes']);
  assert.deepEqual(validateCanvasTopicBoxes(next),next);
  assert.throws(()=>validateCanvasTopicBoxes([first,{...second,cardIds:['notes']}]));
  assert.throws(()=>validateCanvasTopicBoxes([{...first,cardIds:['ai']}]));
  assert.deepEqual(validateCanvasTopicBoxes([{...first,cardIds:['x'.repeat(512)]}])[0].cardIds,['x'.repeat(512)]);
});
