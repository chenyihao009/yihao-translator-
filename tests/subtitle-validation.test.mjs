import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSegments} from '../core.js';

function validate(zh,source='Select the keyframes.'){
  const words=source.split(/\s+/).map((text,i)=>({id:i+1,text,start_ms:i*200,end_ms:(i+1)*200}));
  return validateSegments({consumed_through:words.length,segments:[{first_word_id:1,last_word_id:words.length,en:source,zh}]},words,true).cues[0];
}

test('normalizes terminal punctuation without appending a period to unfinished text',()=>{
  assert.equal(validate('请选择关键帧.').zh,'请选择关键帧。');
  assert.equal(validate('选中了吗?').zh,'选中了吗？');
  assert.equal(validate('完成了!').zh,'完成了！');
  for(const text of ['选择关键帧','选中后，','下一步：','还没有说完……'])assert.throws(()=>validate(text));
});

test('quoted punctuation and nested closing marks do not imply mixed sentences',()=>{
  assert.equal(validate('他说：“开始！”然后离开。','He said go and then left.').zh,'他说：“开始！”然后离开。');
  assert.equal(validate('他问：“真的完成了吗？”').zh,'他问：“真的完成了吗？”');
  assert.equal(validate('结果是（“已经完成了。”）').zh,'结果是（“已经完成了。”）');
  assert.throws(()=>validate('第一句话。第二句话。'));
  assert.throws(()=>validate('“第一句话。第二句话。'),/未闭合/);
});

test('initialisms, versions and common abbreviations are not sentence boundaries',()=>{
  assert.equal(validate('使用 N.A.S.A. 技术。').zh,'使用 N.A.S.A. 技术。');
  assert.equal(validate('参考 Dr. Smith 的研究。').zh,'参考 Dr. Smith 的研究。');
  assert.equal(validate('版本为v1.2.3。').zh,'版本为v1.2.3。');
  assert.throws(()=>validate('第一句话.第二句话。'));
});

test('equivalent Chinese numeric wording is accepted, changed facts still fail',()=>{
  assert.equal(validate('使用三十五帧。','Use 35 frames.').zh,'使用三十五帧。');
  assert.equal(validate('镜面直径为6.5米。','The mirror is 6 and a half meters wide.').zh,'镜面直径为6.5米。');
  assert.equal(validate('形成于135亿年前。','It formed 13.5 billion years ago.').zh,'形成于135亿年前。');
  assert.throws(()=>validate('使用一百三十五帧。','Use 35 frames.'));
});

test('malformed caption fields produce validation errors rather than method-call errors',()=>{
  assert.throws(()=>validate(35),/字幕正文缺失/);
  assert.throws(()=>validate(null),/字幕正文缺失/);
});
