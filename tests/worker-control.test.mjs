import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';
import * as review from '../review.js';
import * as recovery from '../recovery.js';

// Run the real worker with isolated storage and controlled responses. No Chrome,
// real credentials, network access or IndexedDB are used by the worker.
const workerUrl = new URL('../worker.js', import.meta.url);
const workerSource = (await readFile(workerUrl, 'utf8'))
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/core\.js['"];?/m, 'const {$1} = __deps.core;')
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['\"]\.\/review\.js['\"];?/m, 'const {$1} = __deps.review;')
  .replace(/^import\s*\*\s*as\s+store\s+from\s*['"]\.\/store\.js['"];?/m, 'const store = __deps.store;')
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/recovery\.js['"];?/m,'const {$1}=__deps.recovery;')
  .replaceAll('import.meta.url', JSON.stringify(workerUrl.href));
const plan = {topic:'Control test', outline:[], glossary:[], translation_rules:['Keep complete sentences.'], ambiguities:[]};
const stopped = new Set(['paused', 'cancelled']);
const jobId = 'control-test-job';

async function until(predicate, description) {
  for (let i = 0; i < 1000; i++) {
    const result = predicate();
    if (result) return result;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`Worker did not reach: ${description}`);
}

function harness(wordCount = 2) {
  const records = new Map(), messages = [], requests = [], errors = [];
  let control = {enabled:true, epoch:1};
  const copy = value => value === undefined ? undefined : structuredClone(value);
  const store = {
    get: async key => copy(records.get(key)),
    set: async (key, value) => { records.set(key, copy(value)); },
    remove: async key => { records.delete(key); },
    translationControl: async () => copy(control)
  };
  const self = {postMessage: message => messages.push(copy(message))};
  const fetch = (url, options) => {
    if (/\/(?:sentence-prompt|review-prompt|subtitle-rules)\.txt$/.test(String(url))) return Promise.resolve({text:async () => 'Test translation rules.'});
    assert.equal(String(url), 'https://api.deepseek.com/chat/completions', 'Unexpected network target');
    if(JSON.parse(JSON.parse(options.body).messages[1].content).task==='subtitle_review')return Promise.resolve({ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'keep',notes:[]})}}]})});
    let resolve;
    const promise = new Promise(complete => { resolve = complete; });
    const request = {
      data:JSON.parse(options.body), signal:options.signal,
      finish(output) {
        assert.equal(request.finished, undefined, 'A mocked response was completed twice');
        request.finished = true;
        resolve({ok:true, status:200, json:async () => ({choices:[{finish_reason:'stop', message:{content:JSON.stringify(output)}}], usage:{total_tokens:1}})});
      }
    };
    requests.push(request);
    return promise;
  };
  vm.runInNewContext(workerSource, {__deps:{core, review, recovery, store}, self, fetch, URL, AbortSignal, AbortController}, {filename:workerUrl.pathname});
  function send(message) {
    try {
      const pending = self.onmessage({data:copy(message)});
      pending?.catch?.(error => errors.push(error));
    } catch (error) { errors.push(error); }
  }
  const raw = {events:[{tStartMs:0, dDurationMs:wordCount * 1000, segs:[{utf8:Array(wordCount).fill('alpha').join(' ')}]}]};
  function start(requestId, epoch = control.epoch) {
    send({type:'start', requestId, enabledEpoch:epoch, jobId, raw, metadata:{id:'testVideo01', duration:wordCount + 1, title:'Synthetic control test'}, key:'test-placeholder'});
  }
  const ack = requestId => until(() => messages.find(message => message.type === 'ack' && message.requestId === requestId), `ACK ${requestId}`);
  const request = index => until(() => requests[index], `API request ${index + 1}`);
  const terminal = () => until(() => {
    const state = records.get(jobId);
    return state && !['queued', 'analyzing', 'translating', 'reviewing'].includes(state.status) && state;
  }, 'terminal job state');
  const cached = output => [...records.values()].some(value => value?.output && JSON.stringify(value.output) === JSON.stringify(output));
  async function disable() {
    control = {enabled:false, epoch:control.epoch + 1};
    send({type:'cancelAll', requestId:'disable'});
    assert.equal((await ack('disable')).ok, true);
  }
  async function settle() {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, [], 'Worker event handler rejected unexpectedly');
  }
  return {records, messages, requests, start, send, ack, request, terminal, cached, disable, settle,
    setControl: value => { control = copy(value); }};
}

function translated(first, last) {
  return {consumed_through:last, segments:[{first_word_id:first, last_word_id:last,
    en:Array(last - first + 1).fill('alpha').join(' ') + '.', zh:'这是完整的测试句子。'}]};
}

test('disable during analysis caches its response without starting translation', async () => {
  const h = harness();
  h.start('start-analysis');
  const analysis = await h.request(0);
  assert.equal((await h.ack('start-analysis')).ok, true);
  await h.disable();
  assert.equal(analysis.signal?.aborted, false, 'Disable must not abort a request already sent');
  analysis.finish(plan);
  assert(stopped.has((await h.terminal()).status));
  await h.settle();
  assert.equal(h.requests.length, 1, 'No translation request is permitted after disable');
  assert(h.cached(plan), 'The response already paid for should remain reusable');
});

test('disable during an invalid translation prevents its repair request', async () => {
  const h = harness();
  h.start('start-repair');
  (await h.request(0)).finish(plan);
  const translation = await h.request(1);
  await h.disable();
  const invalid = {consumed_through:2, segments:[]};
  translation.finish(invalid);
  assert(stopped.has((await h.terminal()).status), 'A disabled task is stopped rather than reported as a translation failure');
  await h.settle();
  assert.equal(h.requests.length, 2, 'Validation failure must not trigger a paid repair after disable');
  assert(h.cached(invalid), 'The in-flight API response is cached before stopping');
});

test('disable during a valid batch prevents starting the next batch', async () => {
  const h = harness(350);
  h.start('start-next-batch');
  (await h.request(0)).finish(plan);
  const translation = await h.request(1);
  const batch = JSON.parse(translation.data.messages[1].content);
  assert.equal(batch.is_final, false, 'The fixture must need a second batch');
  await h.disable();
  const firstBatch = translated(batch.words[0].id, batch.words.at(-1).id);
  translation.finish(firstBatch);
  assert(stopped.has((await h.terminal()).status));
  await h.settle();
  assert.equal(h.requests.length, 2, 'The remaining words must wait for an explicit resume');
  assert(h.cached(firstBatch), 'The completed in-flight batch remains reusable');
});

test('a disable/re-enable epoch change invalidates the old run even without cancelAll delivery', async () => {
  const h = harness();
  h.start('start-old-epoch', 1);
  const analysis = await h.request(0);
  h.setControl({enabled:false, epoch:2});
  h.setControl({enabled:true, epoch:3});
  analysis.finish(plan);
  assert(stopped.has((await h.terminal()).status));
  await h.settle();
  assert.equal(h.requests.length, 1, 'Enabled=true must not revive a run from an older epoch');
});

test('duplicate starts return busy and re-enable requires a fresh explicit start', async () => {
  const h = harness();
  h.start('original-start');
  const analysis = await h.request(0);
  assert.equal((await h.ack('original-start')).ok, true);
  h.start('duplicate-start');
  assert.equal((await h.ack('duplicate-start')).ok, false, 'An active job must not acknowledge a duplicate start as accepted');
  assert.equal(h.requests.length, 1);
  await h.disable();
  h.setControl({enabled:true, epoch:3});
  h.start('still-stopping', 3);
  assert.equal((await h.ack('still-stopping')).ok, false, 'The old in-flight run must finish before a replacement starts');
  analysis.finish(plan);
  assert(stopped.has((await h.terminal()).status));
  await h.settle();
  assert.equal(h.requests.length, 1, 'Re-enable alone must not resume API use');
  h.start('explicit-resume', 3);
  assert.equal((await h.ack('explicit-resume')).ok, true);
  (await h.request(1)).finish(translated(1, 2));
  assert.equal((await h.terminal()).status, 'complete');
  await h.settle();
  assert.equal(h.requests.length, 2, 'Explicit resume should reuse the cached analysis');
});
