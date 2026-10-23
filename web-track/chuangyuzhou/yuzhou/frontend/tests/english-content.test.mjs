import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {READINGS,WRITING_PROMPTS,TRANSLATION_PROMPTS,VOCABULARY} from '../src/english-content.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=value=>typeof value==='string'&&value.trim().length>0;

test('legacy reading, answer IDs, prompt text and six word indices preserve saved progress semantics',()=>{
  // Digests captured from the pre-DEV-014 English module, before extraction.
  const {title,subtitle,paragraphs,questions}=READINGS[0];
  assert.equal(digest({title,subtitle,paragraphs,questions}),'3951c28439a990e7181b68e8dc5256d743d18cc3becee8e972e7001581361137');
  assert.equal(digest(VOCABULARY.slice(0,6)),'f61c8cfc318d440944dc2ded85ea5f13410b0dc13d929bcac429212feaddb375');
  assert.deepEqual(READINGS[0].questions.map(question=>question.id),['r1','r2','r3']);
  assert.equal(WRITING_PROMPTS[0].prompt,'Write an essay discussing how technology can support independent learning. Give examples and explain one possible limitation. Suggested length: 150–200 words.');
  assert.equal(TRANSLATION_PROMPTS[0].prompt,'近年来，越来越多的大学生开始使用数字工具管理学习资料。他们把课堂笔记、阅读材料和个人想法保存在同一个地方，以便随时查找。然而，收集资料只是第一步。只有定期回顾并尝试用自己的语言解释所学内容，知识才能真正成为自己的。');
  for(const [bank,id]of [[READINGS,'quiet-progress'],[WRITING_PROMPTS,'technology-learning'],[TRANSLATION_PROMPTS,'digital-learning']]){
    assert.equal(bank[0].id,id);assert.equal(bank[0].legacy,true);assert.ok(bank.slice(1).every(entry=>!Object.hasOwn(entry,'legacy')));
  }
});

test('reading and draft identities cannot collide and every reading answer points to one distinct option',()=>{
  const entries=[...READINGS,...WRITING_PROMPTS,...TRANSLATION_PROMPTS],entryIds=new Set(),questionIds=new Set();
  const levels=new Set(['基础','进阶','挑战']),topics=new Set(['日常沟通','校园学习','职场协作','项目展示','信息素养']);
  for(const entry of entries){
    assert.match(entry.id,/^[a-z][a-z0-9-]*$/);assert.ok(!entryIds.has(entry.id),`duplicate exercise ID: ${entry.id}`);entryIds.add(entry.id);
    assert.ok(text(entry.title));assert.ok(levels.has(entry.level));assert.ok(topics.has(entry.topic));
  }
  for(const reading of READINGS){
    assert.ok(text(reading.subtitle));assert.ok(reading.paragraphs.length>=2&&reading.paragraphs.every(text));assert.equal(reading.questions.length,3);
    for(const question of reading.questions){
      assert.ok(!questionIds.has(question.id),`duplicate reading answer slot: ${question.id}`);questionIds.add(question.id);
      assert.ok(text(question.text)&&text(question.explanation));assert.equal(question.options.length,4);assert.ok(question.options.every(text));
      assert.equal(new Set(question.options.map(option=>option.trim().toLowerCase())).size,4);
      assert.ok(Number.isInteger(question.answer)&&question.answer>=0&&question.answer<question.options.length);
    }
  }
  assert.equal(READINGS.length,8);assert.equal(questionIds.size,24);
  assert.deepEqual(new Set(READINGS.map(entry=>entry.level)),levels);assert.deepEqual(new Set(READINGS.map(entry=>entry.topic)),topics);
});

test('draft exercises have actionable guidance and vocabulary has independent complete tuples',()=>{
  assert.equal(WRITING_PROMPTS.length,6);assert.equal(TRANSLATION_PROMPTS.length,6);
  for(const entry of WRITING_PROMPTS){assert.ok(text(entry.prompt));assert.ok(entry.guide.length>=3&&entry.guide.every(text));}
  for(const entry of TRANSLATION_PROMPTS){assert.ok(text(entry.prompt)&&text(entry.reference));assert.ok(entry.notes.length>=3&&entry.notes.every(text));}
  assert.equal(VOCABULARY.length,24);assert.equal(new Set(VOCABULARY.map(row=>row[0].toLowerCase())).size,VOCABULARY.length);
  for(const row of VOCABULARY){assert.equal(row.length,5);assert.ok(row.every(text));assert.match(row[1],/^\/[^/]+\/$/);assert.ok(row[3].toLowerCase().includes(row[0].toLowerCase())||row[0]==='revise');}
});
