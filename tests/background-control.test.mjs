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
      finish:() => resolve({metadata:{id, title:'Synthetic control test', duration:2},
        raw:{events:[{tStartMs:0, dDurationMs:1000, segs:[{utf8:'A complete sentence.'}]}]}})}))
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
