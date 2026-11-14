import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverSegments,makeFallbackChunks,recoverFixedTranslations} from '../recovery.js';
const words='Do not change the 35 meters value'.split(' ').map((text,index)=>({id:index+1,text,start_ms:index*400,end_ms:(index+1)*400}));
const output=(zh='不要修改35米这个数值。',en='Do not change the 35 meters value.')=>({consumed_through:7,segments:[{first_word_id:1,last_word_id:7,en,zh}]});
test('rewritten or missing model English is restored from the original without losing usable Chinese',()=>{
  for(const en of ['Do not change the 35 metre value.',null]){
    const checked=recoverSegments(output(undefined,en),words,true);
    assert.equal(checked.consumed,7);assert.equal(checked.cues[0].source,words.map(w=>w.text).join(' '));
    assert.equal(checked.cues[0].zh,'不要修改35米这个数值。');
    assert.equal(checked.cues[0].start_ms,0);assert.equal(checked.cues[0].end_ms,2800);
  }
});
test('number and punctuation concerns retain a usable translation instead of stopping',()=>{
  const checked=recoverSegments(output('将它设置为36米，然后继续，'),words,true);
  assert.equal(checked.cues[0].zh,'将它设置为36米，然后继续。');
  assert(checked.cues[0].notes.length);assert.equal(checked.consumed,7);
  assert.doesNotThrow(()=>recoverSegments(output('“不要修改。稍后再做。'),words,true));
});
test('invalid word coverage and empty translations still require the simple fallback',()=>{
  for(const item of [{first_word_id:2,last_word_id:7,zh:'测试。'},{first_word_id:1,last_word_id:8,zh:'测试。'},{first_word_id:1,last_word_id:7,zh:''}]){
    assert.throws(()=>recoverSegments({consumed_through:7,segments:[item]},words,true),{code:'SUBTITLE_STRUCTURE'});
  }
  assert.throws(()=>recoverSegments({...output(),consumed_through:6},words,true),{code:'SUBTITLE_STRUCTURE'});
});
test('fixed fallback spans cover every original word once and keep program timestamps',()=>{
  const input=Array.from({length:101},(_,index)=>({id:index+12,text:'word',start_ms:index*300,end_ms:index*300+300}));
  const chunks=makeFallbackChunks(input,{maxWords:36});
  assert.deepEqual(chunks.map(c=>[c.first_word_id,c.last_word_id]),[[12,47],[48,83],[84,112]]);
  const translated=recoverFixedTranslations({translations:chunks.map(c=>({chunk_id:c.chunk_id,zh:'这是译文。',start_ms:999999}))},chunks);
  assert.equal(translated.consumed,112);assert.equal(translated.cues[0].start_ms,0);assert.equal(translated.cues.at(-1).end_ms,30300);
});
test('fixed fallback rejects missing, repeated and empty translations without inventing Chinese',()=>{
  const chunks=makeFallbackChunks(words);
  for(const translations of [[],[{chunk_id:1,zh:''}],[{chunk_id:2,zh:'译文。'}],[{chunk_id:1,zh:'译文。'},{chunk_id:1,zh:'重复。'}]])assert.throws(()=>recoverFixedTranslations({translations},chunks),{code:'SUBTITLE_STRUCTURE'});
});
