import {tabMetadata,acquire} from './source.js';
import {RULE_VERSION,srt,parseTimedText} from './core.js';
import * as store from './store.js';
const ready=(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const config=(await chrome.storage.local.get('settings')).settings||{};
  await store.set('translation-control',{enabled:config.enabled!==false,epoch:config.enabledEpoch||0});
})();
let creating,transitions=Promise.resolve();
const transition=action=>{const result=transitions.catch(()=>{}).then(action);transitions=result;return result;};
const publicSettings=value=>({enabled:value.enabled!==false,enabledEpoch:value.enabledEpoch||0,bilingual:value.bilingual??true,visible:value.visible??true,fontSize:value.fontSize??28,
  sourceScale:value.sourceScale??.6,background:value.background??true,mainColor:value.mainColor||'#ffffff',sourceColor:value.sourceColor||'#c6cbd0',
  mainBold:value.mainBold??true,sourceBold:value.sourceBold??false,mainShadow:value.mainShadow??true,sourceShadow:value.sourceShadow??true,
  language:value.language||'auto',keyConfigured:Boolean(value.apiKey)});
async function settings(){await ready;return (await chrome.storage.local.get('settings')).settings||{};}
async function offscreen(){
  if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)return;
  if(!creating)creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS'],justification:'在浏览器内运行分句翻译工作线程，无需独立程序或额外窗口。'}).finally(()=>creating=null);
  await creating;
}
const jobKey=(videoId,language)=>`job:${RULE_VERSION}:${videoId}:${language}`;
async function assertEnabled(epoch){
  const latest=await settings();
  if(latest.enabled===false)throw new Error('翻译已关闭，请先在YouTube面板开启“启用翻译”。');
  if((latest.enabledEpoch||0)!==epoch)throw new Error('翻译开关已切换，请重新点击开始翻译。');
}
async function handle(message,sender){
  await ready;if(sender.id!==chrome.runtime.id)throw new Error('无效来源。');
  const internal=sender.url?.startsWith(chrome.runtime.getURL(''));
  const youtube=sender.tab&&/^https:\/\/www\.youtube\.com\//.test(sender.url||'');
  if(!internal&&!youtube)throw new Error('页面无效。');
  const config=await settings();
  if(message.type==='settings')return publicSettings(config);
  if(message.type==='openSettings'){await chrome.tabs.create({url:chrome.runtime.getURL('settings.html')});return true;}
  if(message.type==='openHelp'){await chrome.tabs.create({url:chrome.runtime.getURL('help.html')});return true;}
  if(message.type==='listVideoTabs'){
    if(!internal)throw new Error('请在扩展设置中选择视频。');
    return (await chrome.tabs.query({url:'https://www.youtube.com/watch*'})).filter(tab=>/^[A-Za-z0-9_-]{11}$/.test(new URL(tab.url).searchParams.get('v')||''))
      .map(tab=>({tabId:tab.id,videoId:new URL(tab.url).searchParams.get('v'),title:tab.title||'YouTube视频'}));
  }
  if(message.type==='advancedImport'){
    if(!internal||!Number.isInteger(message.tabId))throw new Error('请先选择目标视频标签页。');
    const tab=await chrome.tabs.get(message.tabId);
    if(!/^https:\/\/www\.youtube\.com\/watch\?/.test(tab.url||''))throw new Error('目标标签页不是普通YouTube视频。');
    const currentId=new URL(tab.url).searchParams.get('v');
    if(currentId!==message.videoId)throw new Error('目标视频已切换，请重新选择。');
    return handle({type:'importText',text:message.text,videoId:currentId},{id:chrome.runtime.id,url:tab.url,tab});
  }
  if(message.type==='saveSettings'){
    const input=message.settings||{};
    return transition(async()=>{
      const current=await settings(),next={...current};
      for(const field of ['enabled','bilingual','visible','background','mainBold','sourceBold','mainShadow','sourceShadow'])if(typeof input[field]==='boolean')next[field]=input[field];
      if(Number.isFinite(input.fontSize))next.fontSize=Math.max(16,Math.min(42,input.fontSize));
      if(Number.isFinite(input.sourceScale))next.sourceScale=Math.max(.4,Math.min(.9,input.sourceScale));
      for(const field of ['mainColor','sourceColor'])if(typeof input[field]==='string'&&/^#[0-9a-fA-F]{6}$/.test(input[field]))next[field]=input[field].toLowerCase();
      if(typeof input.language==='string'&&/^(auto|[A-Za-z]{2,3}(?:-[A-Za-z]{2,8})?)$/.test(input.language))next.language=input.language;
      if('apiKey'in input){if(!internal)throw new Error('请在扩展自己的设置页保存密钥。');next.apiKey=String(input.apiKey).trim();}
      const activationChanged=(current.enabled!==false)!==(next.enabled!==false);
      if(activationChanged)next.enabledEpoch=(current.enabledEpoch||0)+1;
      await chrome.storage.local.set({settings:next});
      if(activationChanged){
        await store.set('translation-control',{enabled:next.enabled!==false,epoch:next.enabledEpoch});
        if(!next.enabled&&(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length){
          await chrome.runtime.sendMessage({target:'offscreen',type:'cancelAll'}).catch(()=>{});
        }
        await Promise.allSettled((await chrome.tabs.query({url:'https://www.youtube.com/*'})).map(tab=>chrome.tabs.sendMessage(tab.id,
          {type:'activationChanged',enabled:next.enabled!==false,enabledEpoch:next.enabledEpoch})));
      }
      return publicSettings(next);
    });
  }
  if(message.type==='progress'){
    if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('无效任务来源。');
    if(message.state.enabledEpoch!==undefined&&message.state.enabledEpoch!==(config.enabledEpoch||0))return true;
    const active=await store.get(jobKey(message.state.videoId,config.language||'auto')+':active');
    if(active&&active!==message.state.jobId)return true;
    await Promise.allSettled((await chrome.tabs.query({url:'https://www.youtube.com/*'})).map(tab=>chrome.tabs.sendMessage(tab.id,{type:'jobUpdate',state:message.state})));
    return true;
  }
  const videoId=message.videoId;
  if(!/^[A-Za-z0-9_-]{11}$/.test(videoId||''))throw new Error('请打开一个YouTube视频。');
  const language=config.language||'auto',baseId=jobKey(videoId,language);
  let jobId=await store.get(baseId+':active')||baseId;
  if(message.type==='find'){
    const job=await store.get(jobId);
    if(job&&['queued','analyzing','translating'].includes(job.status)&&!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length){
      job.status='paused';job.message='上次浏览器处理已中断，点击继续可复用缓存。';await store.set(jobId,job);
    }
    return job||null;
  }
  if(message.type==='inspect')return tabMetadata(sender.tab.id);
  if(message.type==='start'||message.type==='import'||message.type==='importText'){
    const epoch=config.enabledEpoch||0;await assertEnabled(epoch);
    if(!config.apiKey)throw new Error('请先在扩展设置页配置DeepSeek密钥。');
    let existing=await store.get(jobId);if(message.type==='start'&&existing?.status==='complete')return existing;
    let source;
    if(message.type==='importText'){
      if(typeof message.text!=='string'||message.text.length>20e6)throw new Error('字幕文件过大或无效。');
      source=parseTimedText(message.text);if(!source.metadata){source.metadata=await tabMetadata(sender.tab.id);delete source.metadata.tracks;}
    }else source=message.type==='import'?message.source:await acquire(sender.tab.id,language,videoId);
    if((message.type==='import'||message.type==='importText')&&(!source?.raw?.events||source?.metadata?.id!==videoId))throw new Error('请在对应视频页面导入原字幕。');
    await assertEnabled(epoch);
    if(message.type!=='start'){
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(source.raw)));
      const fingerprint=Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
      jobId=baseId+':source:'+fingerprint;
    }
    return transition(async()=>{
      await assertEnabled(epoch);
      if(message.type!=='start')await store.set(baseId+':active',jobId);
      existing=await store.get(jobId);if(existing?.status==='complete')return existing;
      const initial=existing||{jobId,videoId,metadata:source.metadata,cues:[],status:'queued',progress:0,message:'正在准备整句翻译。'};
      await offscreen();
      const response=await chrome.runtime.sendMessage({target:'offscreen',type:'start',jobId,...source,key:config.apiKey,enabledEpoch:epoch});
      if(!response?.ok)throw new Error(response?.error||'未能启动浏览器翻译线程。');return initial;
    });
  }
  if(message.type==='cancel'){
    if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)await chrome.runtime.sendMessage({target:'offscreen',type:'cancel',jobId});
    return {message:'当前API请求完成后停止，保留缓存。'};
  }
  if(message.type==='download'){
    const job=await store.get(jobId);if(!job?.cues?.length)throw new Error('字幕尚未生成。');
    await chrome.downloads.download({url:`data:application/x-subrip;charset=utf-8,${encodeURIComponent(srt(job.cues,message.bilingual))}`,filename:`${videoId}.${message.bilingual?'bilingual':'zh-CN'}.srt`,saveAs:true});return true;
  }
  throw new Error('不支持的操作。');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.target==='offscreen')return;
  handle(message,sender).then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.message}));return true;
});
chrome.action.onClicked.addListener(async tab=>{
  if(/^https:\/\/www\.youtube\.com\//.test(tab.url||'')){
    try{await chrome.tabs.sendMessage(tab.id,{type:'togglePanel'});}catch{await chrome.tabs.reload(tab.id);}
  }else await chrome.tabs.create({url:chrome.runtime.getURL('help.html')});
});
