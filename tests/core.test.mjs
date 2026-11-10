import test from 'node:test';
import assert from 'node:assert/strict';
import {wordsFromJson3,validateSegments,srt,cueAt,parseTimedText} from '../core.js';
const words=[{id:1,text:'Hello',start_ms:100,end_ms:500},{id:2,text:'world',start_ms:500,end_ms:900},
  {id:3,text:'Next',start_ms:1100,end_ms:1500},{id:4,text:'sentence',start_ms:1500,end_ms:2000}];
const output={consumed_through:4,segments:[{first_word_id:1,last_word_id:2,en:'Hello world.',zh:'你好，世界。'},
  {first_word_id:3,last_word_id:4,en:'Next sentence.',zh:'下一句话。'}]};
test('word offsets preserve source timing',()=>{
  const result=wordsFromJson3({events:[{tStartMs:100,dDurationMs:900,segs:[{utf8:'Hello'},{utf8:' world',tOffsetMs:400}]}]},2000);
  assert.equal(result.words[1].start_ms,500);assert.equal(result.timing,'word-starts');
});
test('complete sentences preserve their word spans',()=>{
  const {cues}=validateSegments(output,words,true);assert.equal(cues.length,2);assert.equal(cues[1].start_ms,1100);
  assert.equal(cueAt(cues,.6).zh,'你好，世界。');assert.equal(cueAt(cues,1),null);
  assert(srt(cues,true).includes('00:00:00,100 --> 00:00:00,900\n你好，世界。\nHello world.'));
});
test('rejects unfinished, mixed, missing and changed source content',()=>{
  for(const patch of [{zh:'你好，世界，'},{zh:'你好。下一句。'},{en:'Hello 35.'},{last_word_id:3}]){
    assert.throws(()=>validateSegments({consumed_through:2,segments:[{...output.segments[0],...patch}]},words,false));
  }
  assert.throws(()=>validateSegments({consumed_through:2,segments:[output.segments[0]]},words,true));
  assert.equal(validateSegments({consumed_through:2,segments:[output.segments[0]]},words,false).consumed,2);
});
test('does not silently change numbers',()=>{
  assert.throws(()=>validateSegments({consumed_through:1,segments:[{first_word_id:1,last_word_id:1,en:'35.',zh:'第135帧。'}]},[{id:1,text:'35',start_ms:0,end_ms:1000}],true));
});
test('imports timed-text files and rejects plain text',()=>{
  const imported=parseTimedText('1\n00:00:01,000 --> 00:00:02,500\nHello world.\n\n');
  assert.equal(imported.raw.events[0].tStartMs,1000);assert.equal(imported.raw.events[0].dDurationMs,1500);
  assert.equal(parseTimedText('WEBVTT\n\n00:01.000 --> 00:02.500\nHello world.').raw.events.length,1);
  assert.throws(()=>parseTimedText('not subtitles'));
});
