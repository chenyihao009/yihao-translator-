import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';
import * as review from '../review.js';
import * as recovery from '../recovery.js';

// The real worker and validators run with synthetic subtitles, isolated memory
// storage and manually resolved API responses. No key or network is used.
const workerUrl=new URL('../worker.js',import.meta.url);
const source=(await readFile(workerUrl,'utf8'))
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/core\.js['"];?/m,'const {$1}=__deps.core;')
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/review\.js['"];?/m,'const {$1}=__deps.review;')
  .replace(/^import\s*\*\s*as\s+store\s+from\s*['"]\.\/store\.js['"];?/m,'const store=__deps.store;')
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/recovery\.js['"];?/m,'const {$1}=__deps.recovery;')
  .replaceAll('import.meta.url',JSON.stringify(workerUrl.href));
const JOB='review-test-job';
const PLAN={topic:'Synthetic review test',outline:[],glossary:[],translation_rules:[],ambiguities:[]};
async function until(predicate,label){
  for(let i=0;i<1000;i++){const result=predicate();if(result)return result;await new Promise(resolve=>setImmediate(resolve));}
  assert.fail('Worker did not reach: '+label);
}
function harness(text='alpha alpha'){
  const copy=value=>value===undefined?undefined:structuredClone(value);
  const records=new Map(),messages=[],requests=[],errors=[];
  let control={enabled:true,epoch:1},runStart=0;
  const store={get:async key=>copy(records.get(key)),set:async(key,value)=>records.set(key,copy(value)),
    remove:async key=>records.delete(key),translationControl:async()=>copy(control)};
  const self={postMessage:message=>messages.push(copy(message))};
  const fetch=(url,options)=>{
    if(/\/(?:sentence-prompt|review-prompt|subtitle-rules)\.txt$/.test(String(url))){
      return Promise.resolve({text:async()=>String(url).endsWith('/subtitle-rules.txt')?'SHARED_QUALITY_RULES':'Role prompt.'});
    }
    assert.equal(String(url),'https://api.deepseek.com/chat/completions');
    let complete;const pending=new Promise(resolve=>complete=resolve);
    const body=JSON.parse(options.body);
    const request={body,data:JSON.parse(body.messages[1].content),
      finish(output,{reason='stop',content,status=200}={}){
        assert(!request.finished,'Mock response completed twice');request.finished=true;
        complete({ok:status===200,status,json:async()=>({choices:[{finish_reason:reason,message:{content:content??JSON.stringify(output)}}],usage:{total_tokens:7}})});
      }};
    requests.push(request);return pending;
  };
  vm.runInNewContext(source,{__deps:{core,review,recovery,store},self,fetch,URL,AbortSignal,AbortController},{filename:workerUrl.pathname});
  const send=message=>{try{self.onmessage({data:copy(message)})?.catch?.(error=>errors.push(error));}catch(error){errors.push(error);}};
  function start(){
    runStart=messages.length;
    send({type:'start',requestId:'start-'+runStart,enabledEpoch:control.epoch,jobId:JOB,
      raw:{events:[{tStartMs:0,dDurationMs:text.split(' ').length*1000,segs:[{utf8:text}]}]},
      metadata:{id:'reviewVid01',duration:text.split(' ').length+1,title:'Synthetic subtitle review'},key:'test-placeholder'});
  }
  const request=index=>until(()=>requests[index],'request '+index);
  const terminal=()=>until(()=>messages.slice(runStart).findLast(item=>item.type==='progress'&&['failed','complete','cancelled'].includes(item.state.status))?.state,'terminal state');
  async function disable(){
    control={enabled:false,epoch:control.epoch+1};const requestId='disable-'+control.epoch;
    send({type:'cancelAll',requestId});assert((await until(()=>messages.find(item=>item.type==='ack'&&item.requestId===requestId),'cancel ACK')).ok);
  }
  async function settle(){for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(errors,[]);}
  return{records,messages,requests,start,request,terminal,disable,settle,enable:()=>control={enabled:true,epoch:control.epoch+1}};
}
function translated(request,zh='这是完整的测试句子。'){
  const words=request.data.words;
  return{consumed_through:words.at(-1).id,segments:[{first_word_id:words[0].id,last_word_id:words.at(-1).id,
    en:words.map(word=>word.text).join(' ')+'.',zh}]};
}
async function reachReview(h,zh){
  h.start();(await h.request(0)).finish(PLAN);
  const draft=await h.request(1);draft.finish(translated(draft,zh));
  return h.request(2);
}
const keep={action:'keep',notes:[]};

test('rewritten model English no longer stops a usable translation or charges for a repair',async()=>{
  const h=harness('Do not delete the keyframe');h.start();(await h.request(0)).finish(PLAN);
  const initial=await h.request(1);initial.finish({...translated(initial,'不要删除这个关键帧。'),segments:[{first_word_id:1,last_word_id:5,en:'Do not remove the keyframe.',zh:'不要删除这个关键帧。'}]});
  const check=await h.request(2);assert.equal(check.data.task,'subtitle_review');
  assert.equal(check.data.draft_subtitles[0].en,'Do not delete the keyframe');check.finish(keep);
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.consumed,5);
  assert.equal(state.cues[0].source,'Do not delete the keyframe');assert.equal(h.requests.length,3);await h.settle();
});

test('a numerical doubt is available for AI review without blocking the draft',async()=>{
  const h=harness('The distance is 35 meters');const check=await reachReview(h,'距离是36米。');
  const first=check.data.draft_subtitles[0];assert.equal(first.zh,'距离是36米。');
  check.finish({action:'revise',consumed_through:5,segments:[{...first,zh:'距离是35米。'}],notes:[]});
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.cues[0].zh,'距离是35米。');await h.settle();
});

test('two unusable word-index outputs automatically switch to fixed spans and finish',async()=>{
  const h=harness(Array(50).fill('alpha').join(' '));h.start();(await h.request(0)).finish(PLAN);
  (await h.request(1)).finish({segments:[]});(await h.request(2)).finish({segments:[]});
  const fixed=await h.request(3);assert.equal(fixed.data.task,'fixed_translation');assert.equal(fixed.data.chunks.length,2);
  fixed.finish({translations:fixed.data.chunks.map(c=>({chunk_id:c.chunk_id,zh:'这是分块翻译的结果。'}))});
  (await h.request(4)).finish(keep);const state=await h.terminal();assert.equal(state.status,'complete');
  assert.deepEqual(state.cues.map(c=>[c.first_word_id,c.last_word_id]),[[1,36],[37,50]]);assert.equal(state.consumed,50);await h.settle();
});

test('malformed grouped fallback uses cached short plain translations and still completes',async()=>{
  const h=harness(Array(50).fill('alpha').join(' '));h.start();(await h.request(0)).finish(PLAN);
  (await h.request(1)).finish({segments:[]});(await h.request(2)).finish({segments:[]});(await h.request(3)).finish({translations:[]});
  const single=await h.request(4);assert.equal(single.body.response_format,undefined);assert.equal(single.data.source.split(' ').length,36);
  single.finish(null,{content:'这是第一部分的译文。'});
  const next=await h.request(5);assert.equal(next.data.source.split(' ').length,14);next.finish(null,{content:'这是剩余部分的译文。'});
  (await h.request(6)).finish(keep);const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.cues.length,2);assert.equal(state.consumed,50);await h.settle();
});

test('stopping the grouped fallback prevents paid individual fallbacks and preserves its mode',async()=>{
  const h=harness();h.start();(await h.request(0)).finish(PLAN);(await h.request(1)).finish({segments:[]});(await h.request(2)).finish({segments:[]});
  const fixed=await h.request(3);await h.disable();fixed.finish({translations:[]});
  const state=await h.terminal();assert.equal(state.status,'cancelled');assert.equal(state.simpleCursor,0);
  assert.equal(h.requests.length,4);await h.settle();h.enable();h.start();
  const single=await h.request(4);assert(single.data.source);assert.equal(single.data.words,undefined);single.finish(null,{content:'恢复后的译文。'});
  (await h.request(5)).finish(keep);assert.equal((await h.terminal()).status,'complete');await h.settle();
});

test('each batch gets one separate review using the same rules, with no forced rewrite',async()=>{
  const h=harness();const check=await reachReview(h);
  assert.equal(check.data.task,'subtitle_review');assert.equal(check.body.thinking.type,'disabled');
  assert(!('reasoning_effort'in check.body));
  assert.equal(check.data.draft_subtitles[0].zh,'这是完整的测试句子。');
  assert(check.body.messages[0].content.includes('SHARED_QUALITY_RULES'));
  assert(h.requests[1].body.messages[0].content.includes('SHARED_QUALITY_RULES'));
  assert(h.records.get(JOB).pendingDraft,'A valid draft is cached before the review request');
  assert.equal(h.records.get(JOB).cues.length,0,'Unreviewed drafts are not published as completed captions');
  assert.equal(h.records.get(JOB).status,'reviewing');
  check.finish(keep);
  const state=await h.terminal();assert.equal(state.status,'complete');
  assert.equal(state.cues[0].zh,'这是完整的测试句子。');assert.equal(state.pendingDraft,undefined);
  assert.deepEqual(state.quality.review,{batches:1,passed:1,changed:0,needsCheck:0});
  assert.equal(h.requests.length,3);await h.settle();
});

test('a model correction can restore a missing negation while the source and timing stay fixed',async()=>{
  const h=harness('Do not delete the keyframe');const check=await reachReview(h,'删除这个关键帧。');
  const draft=h.records.get(JOB).pendingDraft.draft;
  const first=check.data.draft_subtitles[0];
  check.finish({action:'revise',consumed_through:check.data.consumed_through,segments:[{
    first_word_id:first.first_word_id,last_word_id:first.last_word_id,en:first.en,zh:'不要删除这个关键帧。',start_ms:999999,end_ms:999999,notes:[]}],notes:[]});
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.cues[0].zh,'不要删除这个关键帧。');
  assert.equal(state.cues[0].source,draft.cues[0].source);
  assert.equal(state.cues[0].start_ms,draft.cues[0].start_ms);assert.equal(state.cues[0].end_ms,draft.cues[0].end_ms);
  assert.equal(state.quality.review.changed,1);assert.equal(state.quality.review.needsCheck,0);await h.settle();
});

test('a harmful review proposal keeps the valid draft and explicitly marks it for checking',async()=>{
  const h=harness('It is 35 meters');const check=await reachReview(h,'距离为35米。');
  const first=check.data.draft_subtitles[0];
  check.finish({action:'revise',consumed_through:check.data.consumed_through,segments:[{
    first_word_id:first.first_word_id,last_word_id:first.last_word_id,en:first.en,zh:'距离为35秒。',notes:[]}],notes:[]});
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.cues[0].zh,'距离为35米。');
  assert.equal(state.cues[0].reviewed,false);assert.equal(state.quality.review.passed,0);assert.equal(state.quality.review.needsCheck,1);
  assert(state.quality.notes.some(item=>item.note.includes('保留初译')));assert.equal(h.requests.length,3);await h.settle();
});

test('invalid review JSON does not trigger another paid repair or claim review success',async()=>{
  const h=harness();(await reachReview(h)).finish(null,{content:'{"action":'});
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.quality.review.needsCheck,1);
  assert.equal(state.cues[0].zh,'这是完整的测试句子。');assert.equal(h.requests.length,3);await h.settle();
});

test('uncertainties returned with keep survive in captions and the quality summary',async()=>{
  const h=harness();(await reachReview(h)).finish({action:'keep',notes:['原字幕术语不清，需要核对音频。']});
  const state=await h.terminal();assert.equal(state.quality.review.needsCheck,1);assert.equal(state.quality.review.passed,0);
  assert(state.cues[0].notes.includes('原字幕术语不清，需要核对音频。'));
  assert(state.quality.notes.some(item=>item.note==='原字幕术语不清，需要核对音频。'));await h.settle();
});

test('a review API failure retains the draft and completes without a paid review retry',async()=>{
  const h=harness();(await reachReview(h)).finish(null,{status:503});
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.cues.length,1);
  assert.equal(state.quality.review.needsCheck,1);assert.equal(h.requests.length,3);await h.settle();
});

test('disable after draft starts prevents review and explicit resume reviews the cached draft',async()=>{
  const h=harness();h.start();(await h.request(0)).finish(PLAN);const draft=await h.request(1);
  await h.disable();draft.finish(translated(draft));
  const stopped=await h.terminal();assert.equal(stopped.status,'cancelled');assert(stopped.pendingDraft);await h.settle();
  assert.equal(h.requests.length,2,'Disable cannot start a paid review');
  h.enable();h.start();const resumed=await h.request(2);assert.equal(resumed.data.task,'subtitle_review');
  resumed.finish(keep);assert.equal((await h.terminal()).status,'complete');assert.equal(h.requests.length,3);await h.settle();
});

test('an in-flight review is cached after disable, then reused for free before the next batch',async()=>{
  const h=harness(Array(200).fill('alpha').join(' '));const check=await reachReview(h);
  await h.disable();check.finish(keep);
  const stopped=await h.terminal();assert.equal(stopped.status,'cancelled');assert.equal(stopped.cues.length,0);
  assert(stopped.pendingDraft);await h.settle();assert.equal(h.requests.length,3);
  assert([...h.records.values()].some(value=>value?.phase==='review'&&value.output.action==='keep'));
  h.enable();h.start();const next=await h.request(3);
  assert.equal(next.data.task,undefined,'The cached review must not be sent again');
  assert.equal(next.data.words[0].id,161);assert.equal(h.records.get(JOB).consumed,160);
  next.finish(translated(next));(await h.request(4)).finish(keep);
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.quality.review.batches,2);
  assert.equal(h.requests.length,5);await h.settle();
});

test('review output length immediately retains usable draft rather than blocking the video',async()=>{
  const h=harness();const first=await reachReview(h);first.finish(null,{reason:'length'});
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.cues.length,1);
  assert.equal(state.quality.review.needsCheck,1);assert.equal(h.requests.length,3);await h.settle();
});

test('a failed review on an early batch does not prevent the next translation batch',async()=>{
  const h=harness(Array(200).fill('alpha').join(' '));(await reachReview(h)).finish(null,{status:503});
  const next=await h.request(3);assert.equal(next.data.words[0].id,161);next.finish(translated(next));
  (await h.request(4)).finish(keep);const state=await h.terminal();assert.equal(state.status,'complete');
  assert.equal(state.quality.review.batches,2);assert.equal(state.quality.review.needsCheck,1);await h.settle();
});

test('review caches with a different input identity or review version are never reused',async()=>{
  const h=harness();const check=await reachReview(h);await h.disable();check.finish(keep);
  assert.equal((await h.terminal()).status,'cancelled');await h.settle();
  const [key,entry]=[...h.records.entries()].find(([,value])=>value?.phase==='review'&&value.output);
  h.records.delete(key);
  h.records.set(key.replace(review.REVIEW_VERSION,'review-old'),entry);
  h.records.set(key,{...entry,identity:entry.identity+'different-draft'});
  h.enable();h.start();const resumed=await h.request(3);assert.equal(resumed.data.task,'subtitle_review');
  resumed.finish(keep);assert.equal((await h.terminal()).status,'complete');assert.equal(h.requests.length,4);await h.settle();
});

test('an old review block cannot prevent using a same-rule cached draft',async()=>{
  const h=harness();const check=await reachReview(h);await h.disable();check.finish(keep);
  assert.equal((await h.terminal()).status,'cancelled');await h.settle();
  const state=h.records.get(JOB);state.pendingDraft.reviewVersion='review-old';state.pendingDraft.reviewBlocked='old-block';
  h.records.set(JOB,state);h.enable();h.start();
  assert.equal((await h.terminal()).status,'complete');assert.equal(h.requests.length,3);await h.settle();
});
