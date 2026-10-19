import test from 'node:test';
import assert from 'node:assert/strict';
import {entryCategories,entryCategoryOptions,categoryAfterTypeChange} from '../src/ledger-entry-categories.js';

test('entry form offers all presets and exact historical labels without changing records',()=>{
  const ledger={entries:[{type:'expense',category:'社团活动',archived:true},{type:'expense',category:'餐饮'},{type:'income',category:'稿费'}]};
  const before=structuredClone(ledger),options=entryCategoryOptions(ledger,'expense','all');
  assert.deepEqual(options,[...entryCategories.expense,'社团活动','all']);
  assert.ok(!options.includes('稿费'));
  assert.ok(entryCategoryOptions(ledger,'income','').includes('稿费'));
  assert.deepEqual(ledger,before);
});

test('switching entry type uses corresponding defaults while preserving custom and valid labels',()=>{
  assert.equal(categoryAfterTypeChange('交通','income'),'生活费');
  assert.equal(categoryAfterTypeChange('生活费','expense'),'餐饮');
  assert.equal(categoryAfterTypeChange('报销','income'),'报销');
  assert.equal(categoryAfterTypeChange('社团活动','income'),'社团活动');
  assert.equal(categoryAfterTypeChange('','income'),'生活费');
});
