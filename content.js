(()=>{
  if(globalThis.__wholeSentenceInstalled)return;globalThis.__wholeSentenceInstalled=true;
  const DEFAULT_FONT_SIZE=28,SOURCE_SCALE=.6;
  const PRIMARY_SHADOW='0 2px 4px rgba(0,0,0,.9), 0 0 2px rgba(0,0,0,.85)';
  const SECONDARY_SHADOW='0 1px 2px rgba(0,0,0,.7)';
  const DEFAULT_STYLE={fontSize:DEFAULT_FONT_SIZE,sourceScale:SOURCE_SCALE,mainColor:'#ffffff',sourceColor:'#c6cbd0',mainBold:true,sourceBold:false,mainShadow:true,sourceShadow:true};
  let videoId='',state=null,settings={...DEFAULT_STYLE,enabled:true,enabledEpoch:0,bilingual:true,visible:true,background:true,language:'auto'},panelOpen=false,changingEnabled=false;
  let host,root,captionHost,captionRoot,lastCaption='',checking=false,starting=false,errorMessage='';
  let actionEpoch=0,settingsRevision=0,settingsQueue=Promise.resolve();
  const id=()=>new URL(location.href).searchParams.get('v')||'';
  const ask=async message=>{
    const response=await chrome.runtime.sendMessage({...message,videoId:id()});
    if(!response?.ok)throw new Error(response?.error||'扩展已更新，请刷新视频页面。');return response.data;
  };
  function showError(error){errorMessage=error.message||String(error);render();}
  function element(tag,text,attributes={}){
    const node=document.createElement(tag);if(text)node.textContent=text;
    for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);return node;
  }
  function makeSection(name,title){
    const section=element('details','',{id:name}),summary=element('summary',title);
    section.append(summary);return section;
  }
  function mount(){
    if(host?.isConnected)return;
    host=element('div','',{id:'ytzh-controls'});host.style.cssText='position:fixed;right:20px;top:92px;z-index:2147483000;pointer-events:none;max-width:calc(100vw - 24px);';
    root=host.attachShadow({mode:'open'});
    const style=element('style');style.textContent=`
      *{box-sizing:border-box}:host{font:14px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#edf1ee}
      [hidden]{display:none!important}button,select,input{font:inherit}button,select,summary{cursor:pointer}
      button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #c6dfcb;outline-offset:3px}
      button{border:1px solid #435249;background:#28382e;color:#edf1ee;border-radius:8px;padding:8px 12px}button:hover{background:#344a3b}button:disabled{cursor:default}
      #launcher{pointer-events:auto;display:block;margin-left:auto;background:#1d3025eF;box-shadow:0 3px 18px #0005;border-radius:20px;padding:8px 15px;font-size:13px}
      #panel{pointer-events:auto;background:#19231eef;border:1px solid #3b4b40;border-radius:14px;width:300px;max-width:calc(100vw - 24px);margin-top:10px;padding:18px;box-shadow:0 12px 40px #0006;backdrop-filter:blur(14px)}
      .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}h2{font-size:15px;font-weight:600;margin:0;letter-spacing:.02em}.close{border:0;padding:0 2px;background:transparent;color:#b7c4bb;font-size:21px;line-height:1}
      .topActions{display:flex;align-items:center;gap:12px}.toggle{display:flex;align-items:center;gap:6px;font-size:11px;color:#b8c8bd;cursor:pointer}.toggle input{appearance:none;width:29px;height:17px;margin:0;border:1px solid #627469;border-radius:12px;background:#3b4b40;position:relative;cursor:pointer}.toggle input::after{content:'';position:absolute;left:2px;top:2px;width:11px;height:11px;border-radius:50%;background:#dce6dd;transition:transform .12s}.toggle input:checked{background:#bdddc4;border-color:#bdddc4}.toggle input:checked::after{background:#203c2a;transform:translateX(12px)}.toggle input:disabled{opacity:.55;cursor:wait}
      #start{width:100%;border:0;background:#c5e2c9;color:#193021;font-weight:650;padding:12px;border-radius:9px;font-size:15px}#start:hover:not(:disabled){background:#d8eedb}#start:disabled{background:#32493a;color:#c8d9cc}
      #status{margin-top:12px}#message{font-size:12px;color:#b9c9bd;margin:0;overflow-wrap:anywhere}#status.error #message{color:#efd0b3}#statusActions{display:flex;gap:12px;align-items:center;margin-top:5px}
      .link{padding:0;border:0;border-radius:2px;color:#bdd1c2;background:transparent;font-size:12px}.link:hover{background:transparent;color:white;text-decoration:underline}
      #progress{display:block;width:100%;height:4px;margin:10px 0 0;accent-color:#c5e2c9}
      details{border-top:1px solid #344239;margin-top:15px}details+details{margin-top:0}summary{list-style:none;display:flex;align-items:center;justify-content:space-between;padding:12px 0;color:#b8c8bd;font-size:12px;user-select:none}summary::-webkit-details-marker{display:none}summary::after{content:'⌄';font-size:15px;color:#899e8f}details[open]>summary::after{transform:rotate(180deg)}
      .sectionBody{padding:0 0 14px}.row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;font-size:12px}.row label{display:flex;gap:8px;align-items:center}.row select{background:#27382e;color:#edf1ee;border:1px solid #435249;border-radius:6px;padding:5px;max-width:150px}input[type=checkbox],input[type=range]{accent-color:#c5e2c9}input[type=range]{width:130px}output{color:#95aa9b;font-size:11px}
      .labelWithValue{display:flex;gap:6px;align-items:baseline}.preview{background:var(--caption-bg,#000a);border-radius:8px;padding:12px 8px;text-align:center;font-size:20px;line-height:1.4}.preview .primary{color:var(--main-color,#fff);font-weight:var(--main-weight,600);text-shadow:var(--main-shadow,${PRIMARY_SHADOW})}.preview .secondary{font-size:var(--source-scale,.6em);font-weight:var(--source-weight,400);color:var(--source-color,#c6cbd0);text-shadow:var(--source-shadow,${SECONDARY_SHADOW});margin-top:4px}.hint{color:#8fa595;font-size:11px;margin:7px 0 0;line-height:1.5}
      .downloads{display:flex;gap:8px;margin-top:14px}.downloads button{flex:1;font-size:12px;padding:7px}.downloads button:disabled{opacity:.45}.tools{display:flex;justify-content:space-between;margin-top:14px}.tools button{font-size:12px}#file{display:none}#notes{font-size:11px;color:#c6c3a5;margin:10px 0 0;max-height:74px;overflow:auto}
      #customize{width:100%;margin-top:14px;font-size:12px}dialog{width:350px;max-width:calc(100vw - 28px);max-height:85vh;overflow:auto;padding:20px;border:1px solid #4c6153;border-radius:14px;background:#19251e;color:#edf1ee;box-shadow:0 18px 60px #0008}dialog::backdrop{background:#0007}.tabs{display:flex;gap:6px;margin:16px 0}.tabs button{flex:1;font-size:12px;background:#25362b;color:#b9c9bd}.tabs button[aria-selected=true]{background:#c5e2c9;color:#193021;border-color:#c5e2c9}.dialogActions{display:flex;justify-content:space-between;align-items:center;margin-top:22px}.dialogActions .done{background:#c5e2c9;color:#193021;border:0}.color{width:46px;height:28px;border:1px solid #506456;border-radius:5px;background:none;padding:2px;cursor:pointer}
      dialog{pointer-events:auto}
    `;root.append(style);
    const launcher=element('button','YIHAO 翻译器',{id:'launcher','aria-label':'打开YIHAO翻译器控制面板'});
    launcher.onclick=()=>{panelOpen=!panelOpen;render();};root.append(launcher);
    const panel=element('section','',{id:'panel','aria-label':'YIHAO翻译器控制面板'});panel.hidden=true;root.append(panel);
    const top=element('div','',{class:'top'});top.append(element('h2','YIHAO 翻译器'));
    const topActions=element('div','',{class:'topActions'}),toggleLabel=element('label','启用翻译',{class:'toggle',for:'enabled'}),enabled=element('input','',{id:'enabled',type:'checkbox',role:'switch','aria-label':'启用翻译'});
    enabled.onchange=async()=>{
      const previous=settings.enabled;changingEnabled=true;
      try{await saveSettings({enabled:enabled.checked});}catch(error){settings.enabled=previous;await refresh(true);showError(error);}finally{changingEnabled=false;render();}
    };toggleLabel.append(enabled);topActions.append(toggleLabel);
    const close=element('button','×',{class:'close','aria-label':'关闭面板'});close.onclick=()=>{panelOpen=false;render();};topActions.append(close);top.append(topActions);panel.append(top);
    const start=element('button','开始翻译',{id:'start'});
    start.onclick=async event=>{
      if(!event.isTrusted||starting||!settings.enabled)return;
      const epoch=++actionEpoch,startedVideo=id();
      errorMessage='';starting=true;render();
      try{
        if(!settings.keyConfigured){await ask({type:'openSettings'});return;}
        if(state?.status==='complete'){await saveSettings({visible:true});return;}
        const next=await ask({type:'start'});if(epoch===actionEpoch&&startedVideo===id())state=next;
      }catch(error){if(epoch===actionEpoch&&startedVideo===id())showError(error);}finally{if(epoch===actionEpoch){starting=false;render();}}
    };panel.append(start);
    const status=element('div','',{id:'status'});status.append(element('p','',{id:'message',role:'status'}));
    const statusActions=element('div','',{id:'statusActions'});
    const connect=element('button','首次设置',{id:'connect',class:'link'});connect.onclick=()=>ask({type:'openSettings'}).catch(showError);
    const stop=element('button','停止',{id:'stop',class:'link'});stop.onclick=async()=>{try{const result=await ask({type:'cancel'});errorMessage='';root.querySelector('#message').textContent=result.message;}catch(error){showError(error);}};
    statusActions.append(connect,stop);status.append(statusActions,element('progress','',{id:'progress',max:'100',value:'0'}));panel.append(status);

    const styleOptions=makeSection('styleOptions','字幕样式'),styleBody=element('div','',{class:'sectionBody'});
    const preview=element('div','',{id:'stylePreview',class:'preview','aria-label':'双语字幕样式预览'});
    preview.append(element('div','让每句话完整呈现。',{class:'primary'}),element('div','Keep every sentence complete.',{class:'secondary'}));styleBody.append(preview);
    styleBody.append(element('p','中文主字幕 · 原文在下。',{class:'hint',id:'styleHint'}));
    for(const [name,label]of [['bilingual','双语字幕'],['visible','显示字幕'],['background','暗色背景']]){
      const row=element('div','',{class:'row'}),check=element('input','',{type:'checkbox',id:name});
      check.onchange=()=>saveSettings({[name]:check.checked}).catch(showError);
      const lab=element('label',label,{for:name});lab.prepend(check);row.append(lab);styleBody.append(row);
    }
    const customize=element('button','调整字幕样式',{id:'customize'});customize.onclick=()=>root.querySelector('#styleDialog').showModal();
    styleBody.append(customize);styleOptions.append(styleBody);panel.append(styleOptions);

    const moreOptions=makeSection('moreOptions','更多选项'),moreBody=element('div','',{class:'sectionBody'});
    const languageRow=element('div','',{class:'row'});languageRow.append(element('label','原字幕语言',{for:'language'}));
    const language=element('select','',{id:'language'});
    for(const [value,label]of [['auto','自动选择'],['en','英语'],['es','西班牙语'],['ja','日语'],['fr','法语'],['de','德语'],['ko','韩语']])language.append(element('option',label,{value}));
    language.onchange=()=>{errorMessage='';saveSettings({language:language.value}).then(()=>refresh(true)).catch(showError);};languageRow.append(language);moreBody.append(languageRow);
    const downloads=element('div','',{class:'downloads'});
    for(const [bilingual,label]of [[true,'下载双语字幕'],[false,'下载中文字幕']]){
      const button=element('button',label,{'data-download':'true'});button.onclick=()=>ask({type:'download',bilingual}).catch(showError);downloads.append(button);
    }moreBody.append(downloads);
    const tools=element('div','',{class:'tools'}),help=element('button','使用教程',{class:'link'});help.onclick=()=>ask({type:'openHelp'}).catch(showError);
    tools.append(help);moreBody.append(tools,element('p','',{id:'notes'}));moreOptions.append(moreBody);panel.append(moreOptions);
    const dialog=element('dialog','',{id:'styleDialog','aria-labelledby':'styleTitle'}),dialogTop=element('div','',{class:'top'});
    dialogTop.append(element('h2','字幕样式',{id:'styleTitle'}));const dialogClose=element('button','×',{class:'close','aria-label':'关闭样式设置'});dialogClose.onclick=()=>dialog.close();dialogTop.append(dialogClose);dialog.append(dialogTop);
    const dialogPreview=element('div','',{id:'dialogPreview',class:'preview','aria-label':'双语样式预览'});dialogPreview.append(element('div','让每句话完整呈现。',{class:'primary'}),element('div','Keep every sentence complete.',{class:'secondary'}));dialog.append(dialogPreview);
    const tabs=element('div','',{class:'tabs',role:'tablist','aria-label':'字幕类型'});
    const fields=[['main','中文主字幕'],['source','原文副字幕']];
    for(const [kind,label]of fields){const tab=element('button',label,{id:kind+'Tab',role:'tab','aria-controls':kind+'Styles','aria-selected':String(kind==='main'),tabindex:kind==='main'?'0':'-1'});
      tab.onclick=()=>selectStyleTab(kind);tab.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?'main':event.key==='End'?'source':kind==='main'?'source':'main';selectStyleTab(target);root.querySelector('#'+target+'Tab').focus();}};tabs.append(tab);}
    dialog.append(tabs);
    for(const [kind]of fields){const body=element('div','',{id:kind+'Styles',role:'tabpanel','aria-labelledby':kind+'Tab'});body.hidden=kind!=='main';
      const size=element('div','',{class:'row'}),label=element('div','',{class:'labelWithValue'}),name=kind==='main'?'fontSize':'sourceScale';
      label.append(element('label',kind==='main'?'字号':'字号比例',{for:name}),element('output','',{id:name+'Value',for:name}));
      const slider=element('input','',{id:name,type:'range',min:kind==='main'?'16':'40',max:kind==='main'?'42':'90',step:'1'});
      slider.oninput=()=>{settingsRevision++;settings[name]=Number(slider.value)/(kind==='main'?1:100);lastCaption='';render();captions();};
      slider.onchange=()=>saveSettings({[name]:Number(slider.value)/(kind==='main'?1:100)}).catch(showError);size.append(label,slider);body.append(size);
      if(kind==='source')body.append(element('p','跟随主字幕字号，默认 60%。',{class:'hint'}));
      const colorRow=element('div','',{class:'row'}),colorName=kind+'Color',color=element('input','',{id:colorName,type:'color',class:'color'});color.oninput=()=>{settingsRevision++;settings[colorName]=color.value;lastCaption='';render();captions();};color.onchange=()=>saveSettings({[colorName]:color.value}).catch(showError);colorRow.append(element('label','文字颜色',{for:colorName}),color);body.append(colorRow);
      for(const [suffix,caption]of [['Bold','加粗'],['Shadow','文字投影']]){const row=element('div','',{class:'row'}),field=kind+suffix,check=element('input','',{id:field,type:'checkbox'}),lab=element('label',caption,{for:field});check.onchange=()=>saveSettings({[field]:check.checked}).catch(showError);lab.prepend(check);row.append(lab);body.append(row);}
      dialog.append(body);
    }
    const dialogActions=element('div','',{class:'dialogActions'}),reset=element('button','恢复默认',{class:'link',id:'resetStyle'}),done=element('button','完成',{class:'done'});reset.onclick=()=>saveSettings(DEFAULT_STYLE).catch(showError);done.onclick=()=>dialog.close();dialogActions.append(reset,done);dialog.append(element('p','修改立即生效。',{class:'hint'}),dialogActions);root.append(dialog);
    document.documentElement.append(host);
  }
  function selectStyleTab(kind){for(const current of ['main','source']){root.querySelector('#'+current+'Styles').hidden=current!==kind;const tab=root.querySelector('#'+current+'Tab');tab.setAttribute('aria-selected',String(current===kind));tab.tabIndex=current===kind?0:-1;}}
  function applySubtitleStyle(node,preview=false){
    node.style.fontSize=`${preview?Math.round(settings.fontSize*.72):settings.fontSize*(document.fullscreenElement?1.3:1)}px`;
    node.style.setProperty('--main-color',settings.mainColor);node.style.setProperty('--source-color',settings.sourceColor);
    node.style.setProperty('--main-weight',settings.mainBold?'600':'400');node.style.setProperty('--source-weight',settings.sourceBold?'600':'400');
    node.style.setProperty('--main-shadow',settings.mainShadow?PRIMARY_SHADOW:'none');node.style.setProperty('--source-shadow',settings.sourceShadow?SECONDARY_SHADOW:'none');
    node.style.setProperty('--caption-bg',settings.background?'#000a':'transparent');node.style.setProperty('--source-scale',settings.sourceScale+'em');
  }
  async function saveSettings(patch){
    const revision=++settingsRevision;
    if('enabled'in patch){actionEpoch++;starting=false;errorMessage='';if(!patch.enabled)root?.querySelector('#styleDialog')?.close();}
    settings={...settings,...patch};lastCaption='';render();captions();
    const saving=settingsQueue.catch(()=>{}).then(()=>ask({type:'saveSettings',settings:patch}));settingsQueue=saving;
    const saved=await saving;if(revision!==settingsRevision)return;
    const activation=settings.enabledEpoch>saved.enabledEpoch?{enabled:settings.enabled,enabledEpoch:settings.enabledEpoch}:{};
    settings={...saved,...activation};lastCaption='';render();captions();
  }
  function activationChanged(message){
    if(message.enabledEpoch<settings.enabledEpoch)return;
    if(message.enabled!==settings.enabled||message.enabledEpoch!==settings.enabledEpoch){
      settingsRevision++;actionEpoch++;starting=false;errorMessage='';
      settings={...settings,enabled:message.enabled,enabledEpoch:message.enabledEpoch};lastCaption='';
      if(!settings.enabled)root?.querySelector('#styleDialog')?.close();
      render();captions();
    }
  }
  function render(){
    if(!root)return;root.querySelector('#panel').hidden=!panelOpen;
    root.querySelector('#enabled').checked=settings.enabled;root.querySelector('#enabled').disabled=changingEnabled;root.querySelector('#enabled').setAttribute('aria-checked',String(settings.enabled));
    root.querySelector('#launcher').textContent=settings.enabled?'YIHAO 翻译器':'YIHAO 翻译器 · 已关闭';root.querySelector('#launcher').setAttribute('aria-expanded',String(panelOpen));
    root.querySelector('#language').value=settings.language;root.querySelector('#visible').checked=settings.visible;
    root.querySelector('#bilingual').checked=settings.bilingual;root.querySelector('#background').checked=settings.background;root.querySelector('#fontSize').value=settings.fontSize;
    root.querySelector('#fontSizeValue').value=`${settings.fontSize}px`;
    root.querySelector('#sourceScale').value=Math.round(settings.sourceScale*100);root.querySelector('#sourceScaleValue').value=`${Math.round(settings.sourceScale*100)}% · ${(settings.fontSize*settings.sourceScale).toFixed(1)}px`;
    for(const kind of ['main','source']){root.querySelector('#'+kind+'Color').value=settings[kind+'Color'];for(const field of ['Bold','Shadow'])root.querySelector('#'+kind+field).checked=settings[kind+field];}
    applySubtitleStyle(root.querySelector('#stylePreview'),true);applySubtitleStyle(root.querySelector('#dialogPreview'),true);
    root.querySelector('#styleHint').textContent=`中文主字幕 · 原文在下，字号 ${Math.round(settings.sourceScale*100)}%。`;
    root.querySelector('#stylePreview .secondary').hidden=!settings.bilingual;
    const active=['queued','analyzing','translating','reviewing'].includes(state?.status),complete=state?.status==='complete';
    const stopping=active&&state.enabledEpoch!==undefined&&state.enabledEpoch!==settings.enabledEpoch;
    const resumable=state?.cues?.length||state?.plan||['paused','cancelled'].includes(state?.status);
    root.querySelector('#start').textContent=!settings.enabled?'翻译已关闭':starting?'正在准备…':stopping?'正在停止…':active?(state.status==='reviewing'?'正在审校…':'正在翻译…'):complete?(settings.visible?'字幕已就绪':'显示字幕'):resumable?'继续翻译':'开始翻译';
    root.querySelector('#start').disabled=!settings.enabled||starting||active||(complete&&settings.visible);
    let message='';
    if(!settings.enabled)message=active?'已关闭，当前请求完成后停止。':'已关闭，开启后可继续使用。';
    else if(stopping)message='上一请求仍在结束，请稍后点击继续。';
    else if(starting)message='正在获取原字幕。';
    else if(active)message=state.status==='analyzing'?'正在理解视频内容。':state.status==='queued'?'正在准备字幕。':state.status==='reviewing'?'正在检查句意、术语和表达。':`已翻译 ${Math.max(0,Math.min(100,state.progress||0))}%`;
    else if(complete)message=state.metadata?.sampleOnly?`示例已就绪 · 前 ${state.metadata.duration} 秒`:`已完成 · ${state.cues?.length||0} 条字幕`;
    else if(state?.status==='failed'||state?.status==='paused'||state?.status==='cancelled')message=/原文单词|分句编号|句末标点|混入了多个句子|字幕格式|引号或括号|数值|输出上限|完整JSON|有效JSON/.test(state.message||'')?'已保留进度，点击继续翻译。':state.message;
    else if(!settings.keyConfigured)message='首次使用，请先完成一次配置。';
    root.querySelector('#message').textContent=errorMessage||message;
    root.querySelector('#status').hidden=!message&&!errorMessage;
    root.querySelector('#status').classList.toggle('error',Boolean(errorMessage)||state?.status==='failed');
    root.querySelector('#connect').hidden=settings.keyConfigured;
    root.querySelector('#stop').hidden=!settings.enabled||!active;
    root.querySelector('#statusActions').hidden=!settings.enabled||(settings.keyConfigured&&!active);
    root.querySelector('#progress').hidden=!settings.enabled||!active;root.querySelector('#progress').value=state?.progress||0;
    root.querySelectorAll('[data-download]').forEach(button=>button.disabled=!state?.cues?.length);
    root.querySelector('#notes').textContent='';root.querySelector('#notes').hidden=true;
  }
  function captions(){
    const player=document.querySelector('#movie_player');if(!player)return;
    if(!captionHost?.isConnected||captionHost.parentNode!==player){
      captionHost?.remove();captionHost=element('div','',{id:'ytzh-subtitle-overlay'});captionHost.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:48;';
      captionRoot=captionHost.attachShadow({mode:'open'});
      const css=element('style');css.textContent=`#box{position:absolute;bottom:11%;left:50%;transform:translateX(-50%);width:max-content;max-width:90%;text-align:center;font-family:system-ui,"Microsoft YaHei",sans-serif;line-height:1.4}#text{padding:8px 14px;background:var(--caption-bg,#000a);border-radius:8px}#zh,#en{max-width:100%;overflow-wrap:anywhere;white-space:pre-line}#zh{color:var(--main-color,#fff);font-weight:var(--main-weight,600);text-shadow:var(--main-shadow,${PRIMARY_SHADOW})}#en{font-size:var(--source-scale,.6em);font-weight:var(--source-weight,400);color:var(--source-color,#c6cbd0);text-shadow:var(--source-shadow,${SECONDARY_SHADOW});margin-top:4px;line-height:1.4}`;
      const box=element('div','',{id:'box'}),text=element('div','',{id:'text'});text.append(element('div','',{id:'zh'}),element('div','',{id:'en'}));box.append(text);captionRoot.append(css,box);player.append(captionHost);lastCaption='';
      if(!document.querySelector('#ytzh-native-style')){const native=element('style','',{id:'ytzh-native-style'});native.textContent='#movie_player.ytzh-caption-active .ytp-caption-window-container{visibility:hidden!important}';document.head.append(native);}
    }
    const video=player.querySelector('video'),cues=state?.cues||[];let cue=null;
    const errorLayer=player.querySelector('.ytp-error-content-wrap');
    if(settings.enabled&&settings.visible&&state?.videoId===id()&&video&&!video.error&&!player.classList.contains('ad-showing')&&!(errorLayer&&errorLayer.offsetParent)){
      const ms=video.currentTime*1000;let low=0,high=cues.length-1;while(low<=high){const mid=(low+high)>>1;if(cues[mid].start_ms<=ms)low=mid+1;else high=mid-1;}if(high>=0&&ms<cues[high].end_ms)cue=cues[high];
    }
    const signature=JSON.stringify([state?.jobId,settings.language,cue?.id,cue?.zh,cue?.source,settings,Boolean(document.fullscreenElement)]);
    if(signature!==lastCaption){
      captionRoot.querySelector('#box').style.display=cue?'block':'none';applySubtitleStyle(captionRoot.querySelector('#box'));
      captionRoot.querySelector('#zh').textContent=cue?.zh||'';captionRoot.querySelector('#en').textContent=settings.bilingual?(cue?.source||''):'';
      captionRoot.querySelector('#en').style.display=settings.bilingual?'block':'none';player.classList.toggle('ytzh-caption-active',Boolean(cue));lastCaption=signature;
    }
  }
  async function refresh(force=false){
    if(checking)return;checking=true;
    try{
      const next=id();if(!/^[A-Za-z0-9_-]{11}$/.test(next)){host?.remove();captionHost?.remove();document.querySelectorAll('.ytzh-caption-active').forEach(player=>player.classList.remove('ytzh-caption-active'));return;}
      mount();if(next!==videoId){actionEpoch++;starting=false;videoId=next;state=null;lastCaption='';errorMessage='';force=true;}
      if(force||!settings.keyConfigured)settings=await ask({type:'settings'});
      const job=await ask({type:'find'});state=job||null;render();captions();
    }catch(error){showError(error);}finally{checking=false;}
  }
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(message.type==='activationChanged')activationChanged(message);
    if(message.type==='togglePanel'){mount();panelOpen=!panelOpen;render();}
    if(message.type==='jobUpdate'&&message.state?.videoId===id()){
      if(message.state.enabledEpoch!==undefined&&message.state.enabledEpoch!==settings.enabledEpoch)return;
      state=message.state;render();lastCaption='';captions();
    }
  });
  document.addEventListener('yt-navigate-finish',()=>refresh(true));
  document.addEventListener('fullscreenchange',()=>{if(host?.isConnected)(document.fullscreenElement||document.documentElement).append(host);lastCaption='';});
  setInterval(()=>refresh(),2500);setInterval(captions,120);refresh(true);
})();
