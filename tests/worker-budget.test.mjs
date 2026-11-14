import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';
import * as review from '../review.js';
import * as recovery from '../recovery.js';

// Execute the actual worker and subtitle validator. Only storage and provider
// responses are mocked, so these tests never require credentials or networking.
const workerUrl=new URL('../worker.js',import.meta.url);
const source=(await readFile(workerUrl,'utf8'))
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/core\.js['"];?/m,'const {$1}=__deps.core;')
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['\"]\.\/review\.js['\"];?/m, 'const {$1} = __deps.review;')
  .replace(/^import\s*\*\s*as\s+store\s+from\s*['"]\.\/store\.js['"];?/m,'const store=__deps.store;')
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/recovery\.js['"];?/m,'const {$1}=__deps.recovery;')
  .replaceAll('import.meta.url',JSON.stringify(workerUrl.href));
const PLAN={topic:'Synthetic subtitle budget test',outline:[],glossary:[],translation_rules:['Use complete sentences.'],ambiguities:[]};
const JOB='budget-test-job';
async function until(predicate,label){
  for(let i=0;i<1000;i++){const result=predicate();if(result)return result;await new Promise(resolve=>setImmediate(resolve));}
  assert.fail('Worker did not reach: '+label);
}
function harness(wordCount=4,seed=[]){
  const records=new Map(seed),messages=[],requests=[],errors=[];
  let control={enabled:true,epoch:1},runStart=0;
  const copy=value=>value===undefined?undefined:structuredClone(value);
  const store={get:async key=>copy(records.get(key)),set:async(key,value)=>records.set(key,copy(value)),
    remove:async key=>records.delete(key),translationControl:async()=>copy(control)};
  const self={postMessage:message=>messages.push(copy(message))};
  const fetch=(url,options)=>{
    if(/\/(?:sentence-prompt|review-prompt|subtitle-rules)\.txt$/.test(String(url)))return Promise.resolve({text:async()=> 'Return complete JSON subtitle sentences.'});
    assert.equal(String(url),'https://api.deepseek.com/chat/completions');
    if(JSON.parse(JSON.parse(options.body).messages[1].content).task==='subtitle_review')return Promise.resolve({ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'keep',notes:[]})}}]})});
    let complete;const pending=new Promise(resolve=>complete=resolve);
    const body=JSON.parse(options.body);
    const request={body,data:JSON.parse(body.messages[1].content),signal:options.signal,
      finish(output,{reason='stop',content}={}){
        assert(!request.finished,'Mock response completed twice');request.finished=true;
        complete({ok:true,status:200,json:async()=>({choices:[{finish_reason:reason,message:{content:content??JSON.stringify(output)}}],usage:{total_tokens:7}})});
      }};
    requests.push(request);return pending;
  };
  vm.runInNewContext(source,{__deps:{core,review,recovery,store},self,fetch,URL,AbortSignal,AbortController},{filename:workerUrl.pathname});
  function send(message){try{self.onmessage({data:copy(message)})?.catch?.(error=>errors.push(error));}catch(error){errors.push(error);}}
  function start(){
    runStart=messages.length;
    send({type:'start',requestId:'start-'+runStart,enabledEpoch:control.epoch,jobId:JOB,
      raw:{events:[{tStartMs:0,dDurationMs:wordCount*1000,segs:[{utf8:Array(wordCount).fill('alpha').join(' ')}]}]},
      metadata:{id:'budgetVid01',duration:wordCount+1,title:'Original synthetic test fixture'},key:'test-placeholder'});
  }
  const request=index=>until(()=>requests[index],'request '+index);
  const terminal=()=>until(()=>messages.slice(runStart).findLast(item=>item.type==='progress'&&['failed','complete','cancelled'].includes(item.state.status))?.state,'terminal state');
  async function disable(){
    control={enabled:false,epoch:control.epoch+1};const id='disable-'+control.epoch;send({type:'cancelAll',requestId:id});
    assert((await until(()=>messages.find(item=>item.type==='ack'&&item.requestId===id),'cancel ACK')).ok);
  }
  async function settle(){for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(errors,[]);}
  return{records,messages,requests,start,request,terminal,disable,settle,enable:()=>control={enabled:true,epoch:control.epoch+1}};
}
function translated(request,through=request.data.words.at(-1).id){
  const words=request.data.words.filter(word=>word.id<=through);
  return{consumed_through:through,segments:[{first_word_id:words[0].id,last_word_id:through,
    en:words.map(word=>word.text).join(' ')+'.',zh:'这是完整的合成测试句子。'}]};
}

test('analysis uses low thinking while translation and one repair disable it',async()=>{
  const h=harness();h.start();const analysis=await h.request(0);
  assert.equal(analysis.body.thinking.type,'enabled');assert.equal(analysis.body.reasoning_effort,'low');
  assert(analysis.body.max_tokens>16000,'The analysis budget must account for reasoning as well as final JSON');
  analysis.finish(PLAN);
  const batch=await h.request(1);assert.equal(batch.body.thinking.type,'disabled');assert(!('reasoning_effort'in batch.body));
  batch.finish({consumed_through:4,segments:[]});
  const repair=await h.request(2);assert.equal(repair.body.thinking.type,'disabled');assert.equal(repair.body.max_tokens,batch.body.max_tokens);
  repair.finish(translated(repair));assert.equal((await h.terminal()).status,'complete');await h.settle();
});

test('truncated full analysis retries once without thinking and never caches partial JSON',async()=>{
  const h=harness(200);h.start();
  (await h.request(0)).finish(null,{reason:'length',content:'{"topic":'});
  const direct=await h.request(1);assert.equal(direct.body.thinking.type,'disabled');
  assert.equal(direct.data.full_transcript.split(' ').length,200,'Fallback must still read the entire transcript');
  assert(![...h.records.entries()].some(([key,value])=>key.endsWith('analysis:0')&&value.output));
  direct.finish(PLAN);
  const first=await h.request(2);first.finish(translated(first));
  const last=await h.request(3);last.finish(translated(last));
  assert.equal((await h.terminal()).status,'complete');assert.equal(h.requests.length,4);await h.settle();
});

test('length reduces the word window and saves successful sub-batches under distinct keys',async()=>{
  const h=harness(200);h.start();(await h.request(0)).finish(PLAN);
  const large=await h.request(1);assert.equal(large.data.words.length,160);large.finish(null,{reason:'length',content:'{"segments":['});
  const small=await h.request(2);assert.equal(small.data.words.length,80);assert.equal(small.data.words[0].id,1);small.finish(translated(small));
  const second=await h.request(3);assert.equal(second.data.words[0].id,81);
  assert.equal(h.records.get(JOB).consumed,80,'A successful sub-batch must be saved before the whole video finishes');
  second.finish(translated(second));
  const last=await h.request(4);assert.equal(last.data.words[0].id,161);last.finish(translated(last));
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.batchWordLimit,80);
  assert([...h.records.entries()].some(([key,value])=>key.includes('batch:1-80:')&&value.output));
  assert(![...h.records.entries()].some(([key,value])=>key.includes('batch:1-160:')&&value.output));await h.settle();
});

test('repeated translation length switches to fixed spans and completes without losing earlier captions',async()=>{
  const h=harness(350);h.start();(await h.request(0)).finish(PLAN);
  const good=await h.request(1);good.finish(translated(good));
  const sizes=[],budgets=[];
  for(let index=2;index<=5;index++){
    const batch=await h.request(index);sizes.push(batch.data.words.length);budgets.push(batch.body.max_tokens);
    assert.equal(batch.data.words[0].id,161);batch.finish(null,{reason:'length'});
  }
  const fixed=await h.request(6);assert.equal(fixed.data.task,'fixed_translation');
  assert.equal(h.records.get(JOB).consumed,160);
  fixed.finish({translations:fixed.data.chunks.map(c=>({chunk_id:c.chunk_id,zh:'这是简化翻译。'}))});
  for(let index=7;index<=10;index++){const next=await h.request(index);next.finish(translated(next));}
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.consumed,350);
  assert.deepEqual(sizes,[160,80,40,40]);assert.deepEqual(budgets,[8192,8192,8192,16384]);
  assert.equal(state.cues[0].last_word_id,160);assert.equal(state.simpleCursor,undefined);await h.settle();
});

test('disable prevents a length retry and preserves the smaller window for explicit resume',async()=>{
  const h=harness(200);h.start();(await h.request(0)).finish(PLAN);
  const batch=await h.request(1);await h.disable();batch.finish(null,{reason:'length'});
  const stopped=await h.terminal();assert.equal(stopped.status,'cancelled');assert.equal(stopped.batchWordLimit,80);await h.settle();
  assert.equal(h.requests.length,2);h.enable();h.start();
  const resumed=await h.request(2);assert.equal(resumed.data.words.length,80);assert.equal(resumed.body.thinking.type,'disabled');
  await h.disable();resumed.finish(translated(resumed));assert.equal((await h.terminal()).status,'cancelled');await h.settle();
  assert.equal(h.requests.length,3);
});

test('a non-final batch may leave an unfinished tail without skipping or duplicating words',async()=>{
  const h=harness(200);h.start();(await h.request(0)).finish(PLAN);
  const first=await h.request(1);assert.equal(first.data.is_final,false);first.finish(translated(first,20));
  const next=await h.request(2);assert.equal(next.data.words[0].id,21);assert.equal(next.data.words.at(-1).id,180);next.finish(translated(next));
  const last=await h.request(3);assert.equal(last.data.words[0].id,181);assert.equal(last.data.is_final,true);last.finish(translated(last));
  const state=await h.terminal();assert.equal(state.status,'complete');
  assert.deepEqual(state.cues.map(cue=>[cue.first_word_id,cue.last_word_id]),[[1,20],[21,180],[181,200]]);await h.settle();
});

test('an old subtitle rule cannot reuse old word indexes, captions or legacy API cache keys',async()=>{
  const legacyPlan={...PLAN,topic:'Do not reuse this stale plan'};
  const h=harness(4,[[JOB,{ruleVersion:core.RULE_VERSION+'-old',plan:legacyPlan,consumed:999,cues:[{zh:'旧字幕。'}]}],
    [JOB+':analysis',{output:legacyPlan}]]);
  h.start();const analysis=await h.request(0);assert.equal(analysis.data.full_transcript,'alpha alpha alpha alpha');
  assert.equal(h.records.get(JOB).cues.length,0);analysis.finish(PLAN);
  const batch=await h.request(1);assert.equal(batch.data.words[0].id,1);assert.equal(batch.data.translation_plan.topic,PLAN.topic);batch.finish(translated(batch));
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.consumed,4);assert.equal(state.cues.length,1);await h.settle();
});

test('an unavailable analysis can use a default plan and move on to translation',async()=>{
  for(const reason of ['content_filter','insufficient_system_resource','aborted']){
    const h=harness();h.start();(await h.request(0)).finish(null,{reason});
    const batch=await h.request(1);assert(batch.data.translation_plan.topic);batch.finish(translated(batch));
    const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.analysisSimplified,true);
    assert.equal(h.requests.length,2);await h.settle();
  }
});

test('two truncated analysis attempts use a simple plan rather than blocking translation',async()=>{
  const h=harness();h.start();(await h.request(0)).finish(null,{reason:'length'});
  (await h.request(1)).finish(null,{reason:'length'});
  const batch=await h.request(2);batch.finish(translated(batch));
  const state=await h.terminal();assert.equal(state.status,'complete');assert.equal(state.analysisSimplified,true);
  assert.equal(h.requests.length,3);await h.settle();
});

test('empty stop JSON can use one non-thinking repair without caching the empty response',async()=>{
  const h=harness();h.start();(await h.request(0)).finish(PLAN);
  (await h.request(1)).finish(null,{content:'   '});
  const repair=await h.request(2);assert.equal(repair.body.thinking.type,'disabled');repair.finish(translated(repair));
  assert.equal((await h.terminal()).status,'complete');assert.equal(h.requests.length,3);await h.settle();
});

test('cancelled analysis remembers its direct fallback without automatically sending it',async()=>{
  const h=harness();h.start();const first=await h.request(0);await h.disable();first.finish(null,{reason:'length'});
  assert.equal((await h.terminal()).status,'cancelled');await h.settle();assert.equal(h.requests.length,1);
  h.enable();h.start();const fallback=await h.request(1);assert.equal(fallback.body.thinking.type,'disabled');fallback.finish(PLAN);
  const batch=await h.request(2);batch.finish(translated(batch));assert.equal((await h.terminal()).status,'complete');await h.settle();
});

test('a short final batch uses fixed spans after one larger budget without repeating ineffective windows',async()=>{
  const h=harness(4);h.start();(await h.request(0)).finish(PLAN);
  const first=await h.request(1);assert.equal(first.data.words.length,4);first.finish(null,{reason:'length'});
  const increased=await h.request(2);assert.equal(increased.data.words.length,4);assert.equal(increased.body.max_tokens,16384);increased.finish(null,{reason:'length'});
  const fixed=await h.request(3);assert.equal(fixed.data.task,'fixed_translation');
  fixed.finish({translations:fixed.data.chunks.map(c=>({chunk_id:c.chunk_id,zh:'这是一条可用译文。'}))});
  assert.equal((await h.terminal()).status,'complete');assert.equal(h.requests.length,4);await h.settle();
});
