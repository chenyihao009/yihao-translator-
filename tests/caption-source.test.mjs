import test from 'node:test';
import assert from 'node:assert/strict';
import {wordsFromJson3} from '../caption-source.js';

const text=result=>result.words.map(word=>word.text).join(' ');
const parse=events=>wordsFromJson3({events},20000);
const event=(tStartMs,content,extra={})=>({tStartMs,dDurationMs:4000,wWinId:1,segs:[{utf8:content}],...extra});
function ordered(result){
  result.words.forEach((word,i)=>{
    assert.equal(word.id,i+1);assert(word.end_ms>word.start_ms);
    if(i)assert(word.start_ms>result.words[i-1].start_ms,'Clocks must follow the source word order');
  });
}

test('overlapping append clocks cannot interleave two spoken lines',()=>{
  const result=parse([
    event(0,"I'm John",{segs:[{utf8:"I'm",tOffsetMs:0},{utf8:' John',tOffsetMs:400}]}),
    event(100,'the video guy',{aAppend:1,segs:[{utf8:'the',tOffsetMs:0},{utf8:' video guy',tOffsetMs:400}]})
  ]);
  assert.equal(text(result),"I'm John the video guy");ordered(result);
  assert.equal(result.timing,'estimated','Conflicting clocks are not advertised as exact word starts');
});

test('inferred first-line clocks stop before the next speech line starts',()=>{
  const result=parse([event(0,"I'm John the video guy"),event(1200,"and this is the tutorial",{aAppend:1})]);
  assert.equal(text(result),"I'm John the video guy and this is the tutorial");
  assert(result.words[4].start_ms<1200);assert.equal(result.words[5].start_ms,1200);ordered(result);
});

test('a roll-up redraw drops a complete carried line and does not delay the new line',()=>{
  const result=parse([event(0,"I'm John"),event(990,'\n',{aAppend:1}),event(1000,"I'm John\nthe video guy")]);
  assert.equal(text(result),"I'm John the video guy");
  assert.equal(result.words[2].start_ms,1000);ordered(result);
});

test('an identical redraw with matching word clocks is not spoken twice',()=>{
  const first=event(0,'Read this',{segs:[{utf8:'Read',tOffsetMs:0},{utf8:' this',tOffsetMs:200}]});
  const result=parse([first,{...first},event(600,'next',{aAppend:1})]);
  assert.equal(text(result),'Read this next');ordered(result);
});

test('a redraw from the same origin can extend an untimed caption',()=>{
  const result=parse([event(0,'Read this'),event(0,'Read this tutorial')]);
  assert.equal(text(result),'Read this tutorial');ordered(result);
});

test('real repeated words and appended repeated phrases remain intact',()=>{
  const result=parse([event(0,'very very'),event(800,'very good',{aAppend:1}),event(1600,'very good',{aAppend:1})]);
  assert.equal(text(result),'very very very good very good');ordered(result);
});

test('matching words in different windows are not merged',()=>{
  const result=parse([event(0,'hello world'),event(500,'hello world\nagain',{wWinId:2})]);
  assert.equal(text(result),'hello world hello world again');ordered(result);
});

test('non-overlapping captions with matching text are preserved',()=>{
  const result=parse([event(0,'hello world',{dDurationMs:500}),event(1500,'hello world\nagain')]);
  assert.equal(text(result),'hello world hello world again');ordered(result);
});

test('overlapping flat text alone is insufficient to delete a repeated phrase',()=>{
  const result=parse([event(0,'hello world'),event(1000,'hello world again')]);
  assert.equal(text(result),'hello world hello world again');ordered(result);
});

test('a newline without an explicit roll marker is insufficient to delete a repeated sentence',()=>{
  const result=parse([event(0,'hello world'),event(1000,'hello world\nagain')]);
  assert.equal(text(result),'hello world hello world again');ordered(result);
});

test('unknown-window multiline captions are not assumed to be redraws',()=>{
  const result=parse([event(0,'hello world',{wWinId:undefined}),event(1000,'hello world\nagain',{wWinId:undefined})]);
  assert.equal(text(result),'hello world hello world again');ordered(result);
});

test('ordinary timed-text imports preserve their text and estimated segment times',()=>{
  const result=parse([event(1000,'A simple sentence.',{wWinId:undefined,dDurationMs:1500}),event(3000,'A second sentence.',{wWinId:undefined,dDurationMs:1500})]);
  assert.equal(text(result),'A simple sentence. A second sentence.');assert.equal(result.words[0].start_ms,1000);
  assert.equal(result.words[3].start_ms,3000);assert.equal(result.timing,'estimated');ordered(result);
});

test('native word starts are retained while window and newline-only events add no words',()=>{
  const result=parse([{tStartMs:0,dDurationMs:10000,id:1},
    event(100,'Hello world',{segs:[{utf8:'Hello'},{utf8:' world',tOffsetMs:400}]}),
    event(700,'\n',{aAppend:1}),event(800,'again',{aAppend:1})]);
  assert.equal(text(result),'Hello world again');assert.deepEqual(result.words.map(word=>word.start_ms),[100,500,800]);
  assert.equal(result.timing,'word-starts');ordered(result);
});

test('styled text segments within one word are joined before tokenization',()=>{
  const result=parse([event(100,'',{segs:[{utf8:'key'},{utf8:'frame',tOffsetMs:100},{utf8:' assistant',tOffsetMs:300}]})]);
  assert.equal(text(result),'keyframe assistant');assert.equal(result.words[1].start_ms,400);ordered(result);
});
