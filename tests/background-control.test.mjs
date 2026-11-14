import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import * as core from '../core.js';

// Exercise the registered runtime listener with isolated Chrome/storage mocks.
// The placeholder credential exists only in this test; no real key or API is used.
const backgroundUrl = new URL('../service-worker.js', import.meta.url);
const backgroundSource = (await readFile(backgroundUrl, 'utf8'))
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/source\.js['"];?/m, 'const {$1} = __deps.source;')
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/core\.js['"];?/m, 'const {$1} = __deps.core;')
  .replace(/^import\s*\*\s*as\s+store\s+from\s*['"]\.\/store\.js['"];?/m, 'const store = __deps.store;');
const placeholderKey = 'test-placeholder-not-a-real-key';
const videoId = 'testVideo01';
const turn = () => new Promise(resolve => setImmediate(resolve));

async function until(predicate, description) {
  for (let i = 0; i < 1000; i++) {
    const value = predicate();
    if (value) return value;
    await turn();
  }
  assert.fail(`Background did not reach: ${description}`);
}

function harness({offscreenExists = true} = {}) {
  const copy = value => value === undefined ? undefined : structuredClone(value);
  let config = {enabled:true, enabledEpoch:10, apiKey:placeholderKey, fontSize:28};
  const records = new Map(), storeWrites = [], settingsWrites = [], tabMessages = [], runtimeMessages = [], acquisitions = [];
  const queries = [], accessLevels = [], createdOffscreens = [];
  let listener, writing = 0, maxWriting = 0;
  const tabs = [
    {id:1, url:`https://www.youtube.com/watch?v=${videoId}`, title:'Synthetic video one'},
    {id:2, url:'https://www.youtube.com/watch?v=otherVideo2', title:'Synthetic video two'},
    {id:3, url:'https://www.youtube.com/', title:'YouTube home'},
    {id:4, url:'https://example.test/', title:'Unrelated page'}
  ];
  const store = {
    get: async key => copy(records.get(key)),
    set: async (key, value) => { await turn(); records.set(key, copy(value)); storeWrites.push({key, value:copy(value)}); },
    remove: async key => { records.delete(key); }
  };
  const chrome = {
    storage:{local:{
      setAccessLevel: async value => { accessLevels.push(copy(value)); },
      get: async () => ({settings:copy(config)}),
      set: async value => {
        writing++; maxWriting = Math.max(maxWriting, writing);
        try { await turn(); config = copy(value.settings); settingsWrites.push(copy(config)); }
        finally { writing--; }
      }
    }},
    runtime:{
      id:'test-extension-id', getURL:path => `chrome-extension://test-extension-id/${path}`,
      getContexts: async () => offscreenExists ? [{contextType:'OFFSCREEN_DOCUMENT'}] : [],
      sendMessage: async message => { runtimeMessages.push(copy(message)); return {ok:true}; },
      onMessage:{addListener:value => { listener = value; }}
    },
    offscreen:{createDocument:async options => { createdOffscreens.push(copy(options)); offscreenExists = true; }},
    tabs:{
      query: async query => {
        queries.push(copy(query));
        const prefix = query.url.replace(/\*$/, '');
        return copy(tabs.filter(tab => tab.url.startsWith(prefix)));
      },
      sendMessage: async (tabId, message) => { tabMessages.push({tabId, message:copy(message)}); },
      get: async tabId => copy(tabs.find(tab => tab.id === tabId)),
      create: async () => {}, reload: async () => {}
    },
    downloads:{download:async () => {}},
    action:{onClicked:{addListener:() => {}}}
  };
  const source = {
    tabMetadata:async () => ({id:videoId, title:'Synthetic control test', duration:2}),
    acquire:(tabId, language, id) => new Promise(resolve => acquisitions.push({tabId, language, id,
      finish:(raw = {events:[{tStartMs:0, dDurationMs:1000, segs:[{utf8:'A complete sentence.'}]}]}) =>
        resolve({metadata:{id, title:'Synthetic control test', duration:2}, raw:copy(raw)})}))
  };
  vm.runInNewContext(backgroundSource, {__deps:{source, core, store}, chrome, URL, TextEncoder, crypto:webcrypto}, {filename:backgroundUrl.pathname});
  assert.equal(typeof listener, 'function');
  const sender = {id:chrome.runtime.id, url:tabs[0].url, tab:copy(tabs[0])};
  const request = message => new Promise(resolve => {
    assert.equal(listener(copy(message), copy(sender), response => resolve(copy(response))), true);
  });
  const save = settings => request({type:'saveSettings', settings});
  return {records, storeWrites, settingsWrites, tabMessages, runtimeMessages, acquisitions, queries, accessLevels, createdOffscreens,
    request, save, config:() => copy(config), maxWriting:() => maxWriting,
    acquisition:(index = 0) => until(() => acquisitions[index], `pending caption acquisition ${index + 1}`),
    starts:() => runtimeMessages.filter(message => message.type === 'start')};
}

test('disable while captions are pending prevents dispatching a translation start', {timeout:2000}, async () => {
  const h = harness({offscreenExists:false});
  const starting = h.request({type:'start', videoId});
  const captions = await h.acquisition();
  assert.equal((await h.save({enabled:false})).ok, true);
  captions.finish();
  const result = await starting;
  assert.equal(result.ok, false);
  assert.match(result.error, /关闭|切换/);
  assert.equal(h.starts().length, 0, 'A result from pending acquisition must not start API work after disable');
  assert.equal(h.createdOffscreens.length, 0, 'Disable must not create a translation worker');
  assert.deepEqual(h.records.get('translation-control'), {enabled:false, epoch:11});
});

test('disable then re-enable still rejects captions acquired in an earlier epoch', {timeout:2000}, async () => {
  const h = harness({offscreenExists:false});
  const starting = h.request({type:'start', videoId});
  const captions = await h.acquisition();
  await h.save({enabled:false});
  await h.save({enabled:true});
  captions.finish();
  assert.equal((await starting).ok, false, 'Enabled=true does not authorize an old start operation');
  assert.equal(h.starts().length, 0);
  assert.equal(h.createdOffscreens.length, 0);
  assert.deepEqual(h.records.get('translation-control'), {enabled:true, epoch:12});
  const retry = h.request({type:'start', videoId});
  (await h.acquisition(1)).finish();
  assert.equal((await retry).ok, true, 'A fresh explicit start in the current epoch must remain usable');
  assert.equal(h.starts().length, 1);
  assert.equal(h.starts()[0].enabledEpoch, 12);
});

test('activation broadcasts reach every YouTube tab and expose only activation fields', {timeout:2000}, async () => {
  const h = harness();
  const disabled = await h.save({enabled:false});
  const enabled = await h.save({enabled:true});
  assert.equal(disabled.ok, true); assert.equal(enabled.ok, true);
  assert.equal(h.tabMessages.length, 6, 'Both transitions must reach the two video tabs and the YouTube home tab');
  for (const tabId of [1, 2, 3]) {
    assert.deepEqual(h.tabMessages.filter(item => item.tabId === tabId).map(item => item.message), [
      {type:'activationChanged', enabled:false, enabledEpoch:11},
      {type:'activationChanged', enabled:true, enabledEpoch:12}
    ]);
  }
  assert(!h.tabMessages.some(item => item.tabId === 4), 'Do not message unrelated websites');
  assert(h.queries.every(query => query.url === 'https://www.youtube.com/*'));
  assert(!JSON.stringify(h.tabMessages).includes(placeholderKey), 'Never broadcast the stored credential');
  const publicSettings = await h.request({type:'settings'});
  assert.equal(publicSettings.data.keyConfigured, true);
  assert(!('apiKey' in publicSettings.data));
  assert(!JSON.stringify([disabled, enabled, publicSettings]).includes(placeholderKey));
  assert.deepEqual(h.accessLevels, [{accessLevel:'TRUSTED_CONTEXTS'}]);
  assert.equal(h.runtimeMessages.filter(message => message.type === 'cancelAll').length, 1);
  assert.equal(h.starts().length, 0, 'Enabling translation does not automatically start it');
});

test('concurrent and duplicate switches serialize persisted epochs without losing style changes', {timeout:2000}, async () => {
  const h = harness();
  const results = await Promise.all([
    h.save({enabled:false}), h.save({enabled:false}), h.save({enabled:true}),
    h.save({enabled:false}), h.save({fontSize:37}), h.save({bilingual:false})
  ]);
  assert(results.every(result => result.ok));
  assert.deepEqual(results.map(result => result.data.enabledEpoch), [11, 11, 12, 13, 13, 13], 'Duplicate values must not invent transitions or overwrite a newer epoch');
  assert.deepEqual(h.config(), {enabled:false, enabledEpoch:13, apiKey:placeholderKey, fontSize:37, bilingual:false});
  assert.deepEqual(h.records.get('translation-control'), {enabled:false, epoch:13});
  assert.deepEqual(h.storeWrites.filter(write => write.key === 'translation-control').map(write => write.value), [
    {enabled:true, epoch:10}, {enabled:false, epoch:11}, {enabled:true, epoch:12}, {enabled:false, epoch:13}
  ]);
  assert.equal(h.maxWriting(), 1, 'Concurrent requests must not race chrome.storage writes');
  assert.equal(h.tabMessages.length, 9, 'Only the three actual transitions are broadcast');
  assert.equal(h.runtimeMessages.filter(message => message.type === 'cancelAll').length, 2);
  assert.equal(h.starts().length, 0);
});

test('changed webpage captions do not resume an imported partial task from the same rule version', {timeout:2000}, async () => {
  const h = harness();
  const imported = await h.request({type:'importText', videoId,
    text:'1\n00:00:00,000 --> 00:00:01,000\nbeta beta.\n\n'});
  assert.equal(imported.ok, true);
  const oldJob = {...imported.data, ruleVersion:core.RULE_VERSION, status:'cancelled', consumed:2,
    plan:{topic:'Old imported source', glossary:[], translation_rules:[]},
    cues:[{id:1, first_word_id:1, last_word_id:2, start_ms:0, end_ms:1000, source:'beta beta.', zh:'旧来源译文。', notes:[]}]};
  h.records.set(oldJob.jobId, structuredClone(oldJob));
  // Older releases did not persist the source, so the compatibility fallback
  // may acquire a different webpage track. It must still get a fresh task.
  h.records.delete(oldJob.jobId + ':sourceData');
  const restarting = h.request({type:'start', videoId});
  (await h.acquisition()).finish();
  const result = await restarting;
  assert.equal(result.ok, true);
  assert.notEqual(result.data.jobId, oldJob.jobId, 'A different raw caption source must use a separate job/cache namespace');
  assert.deepEqual(result.data.cues, [], 'Do not attach old translated words to the new source');
  assert.equal(result.data.consumed, undefined, 'A new source must start from its first word');
  assert.equal(result.data.plan, undefined, 'A plan made from the old transcript must not be reused');
  assert.deepEqual(h.records.get(oldJob.jobId), oldJob, 'Keep the old source available for an explicit same-file resume');
  assert.equal(h.records.get(`job:${core.RULE_VERSION}:${videoId}:auto:active`), result.data.jobId);
  assert.equal(h.starts().at(-1).jobId, result.data.jobId);
});

test('an unchanged uncached webpage caption source still resumes its existing partial task', {timeout:2000}, async () => {
  const h = harness();
  const raw = {events:[{tStartMs:0, dDurationMs:1000, segs:[{utf8:'Read this. Continue here.'}]}]};
  const first = h.request({type:'start', videoId});
  (await h.acquisition()).finish(raw);
  const initial = await first;
  assert.equal(initial.ok, true);
  const partial = {...initial.data, ruleVersion:core.RULE_VERSION, status:'cancelled', consumed:2,
    plan:{topic:'Same source plan', glossary:[], translation_rules:[]},
    cues:[{id:1, first_word_id:1, last_word_id:2, start_ms:0, end_ms:500, source:'Read this.', zh:'请阅读。', notes:[]}]};
  h.records.set(partial.jobId, structuredClone(partial));
  h.records.delete(partial.jobId + ':sourceData');
  const restarting = h.request({type:'start', videoId});
  (await h.acquisition(1)).finish(structuredClone(raw));
  const result = await restarting;
  assert.equal(result.ok, true);
  assert.equal(result.data.jobId, partial.jobId);
  assert.deepEqual(result.data.cues, partial.cues);
  assert.equal(result.data.consumed, 2);
  assert.deepEqual(result.data.plan, partial.plan);
  assert.equal(h.acquisitions.length, 2, 'An older task without sourceData may reacquire the identical source');
  assert.equal(h.records.get(`job:${core.RULE_VERSION}:${videoId}:auto:active`), partial.jobId);
  assert.deepEqual(h.starts().map(message => message.jobId), [partial.jobId, partial.jobId]);
});

test('continue reuses an imported partial source without acquiring webpage captions and explicit import can replace it', {timeout:2000}, async () => {
  const h = harness();
  const imported = await h.request({type:'importText', videoId,
    text:'1\n00:00:00,000 --> 00:00:01,000\nRead this.\n\n2\n00:00:01,000 --> 00:00:02,000\nContinue here.\n\n'});
  assert.equal(imported.ok, true);
  const partial = {...imported.data, ruleVersion:core.RULE_VERSION, status:'cancelled', consumed:2,
    plan:{topic:'Imported source', glossary:[], translation_rules:[]},
    cues:[{id:1, first_word_id:1, last_word_id:2, start_ms:0, end_ms:1000, source:'Read this.', zh:'请阅读。', notes:[]}]};
  h.records.set(partial.jobId, structuredClone(partial));
  const sourceData = h.records.get(partial.jobId + ':sourceData');
  assert.deepEqual(Object.keys(sourceData).sort(), ['metadata', 'raw']);
  assert.equal(sourceData.metadata.id, videoId);
  assert.equal(sourceData.raw.events.length, 2);
  assert(!JSON.stringify(sourceData).includes(placeholderKey), 'Never persist API credentials with subtitle sources');
  const resumed = await h.request({type:'start', videoId});
  assert.equal(resumed.ok, true);
  assert.equal(h.acquisitions.length, 0, 'Continuing an imported task must not silently switch to webpage JSON3');
  assert.equal(resumed.data.jobId, partial.jobId);
  assert.equal(resumed.data.consumed, 2);
  assert.deepEqual(resumed.data.cues, partial.cues);
  assert.deepEqual(resumed.data.plan, partial.plan);
  assert.deepEqual(h.starts().at(-1).raw, sourceData.raw);
  const replaced = await h.request({type:'importText', videoId,
    text:'1\n00:00:00,000 --> 00:00:01,000\nA different source.\n\n'});
  assert.equal(replaced.ok, true);
  assert.notEqual(replaced.data.jobId, partial.jobId, 'Explicitly changing the source must create a separate task');
  assert.deepEqual(replaced.data.cues, []);
  assert.equal(replaced.data.consumed, undefined);
  assert.deepEqual(h.records.get(partial.jobId), partial);
  assert.deepEqual(h.records.get(partial.jobId + ':sourceData'), sourceData);
  assert.equal(h.records.get(`job:${core.RULE_VERSION}:${videoId}:auto:active`), replaced.data.jobId);
});

test('a mismatched or malformed persisted source falls back to webpage acquisition', {timeout:2000}, async () => {
  for (const corrupted of [
    {metadata:{id:'otherVideo2'}, raw:{events:[]}},
    {metadata:{id:videoId}, raw:{events:{unexpected:true}}}
  ]) {
    const h = harness();
    const imported = await h.request({type:'importText', videoId,
      text:'1\n00:00:00,000 --> 00:00:01,000\nOld source.\n\n'});
    assert.equal(imported.ok, true);
    h.records.set(imported.data.jobId + ':sourceData', structuredClone(corrupted));
    const restarting = h.request({type:'start', videoId});
    (await h.acquisition()).finish();
    const result = await restarting;
    assert.equal(result.ok, true);
    assert.equal(h.acquisitions.length, 1);
    assert.notEqual(result.data.jobId, imported.data.jobId);
    assert.equal(h.starts().at(-1).metadata.id, videoId);
    assert(Array.isArray(h.starts().at(-1).raw.events));
  }
});
