const status=document.querySelector('#status'),importStatus=document.querySelector('#importStatus');
const ask=async message=>{const response=await chrome.runtime.sendMessage(message);if(!response?.ok)throw new Error(response?.error||'操作失败，请刷新页面。');return response.data;};
ask({type:'settings'}).then(config=>status.textContent=config.keyConfigured?'已保存密钥；不必重复填写。':'尚未保存密钥。').catch(error=>status.textContent=error.message);
document.querySelector('#save').addEventListener('click',async()=>{
  const input=document.querySelector('#key'),key=input.value.trim();
  if(!key.startsWith('sk-')){status.textContent='请粘贴DeepSeek开放平台创建的API Key。';return;}
  try{await ask({type:'saveSettings',settings:{apiKey:key}});input.value='';status.textContent='已保存。回到YouTube即可开始翻译。';}catch(error){status.textContent=error.message;}
});
document.querySelector('#clear').addEventListener('click',async()=>{try{await ask({type:'saveSettings',settings:{apiKey:''}});document.querySelector('#key').value='';status.textContent='本机密钥已清除，已有字幕缓存保留。';}catch(error){status.textContent=error.message;}});
let tabs=[];
async function refreshTabs(){
  try{tabs=await ask({type:'listVideoTabs'});const select=document.querySelector('#targetTab');select.replaceChildren();
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=tabs.length?'请选择目标视频':'请先打开一个YouTube视频';select.append(placeholder);
    for(const tab of tabs){const option=document.createElement('option');option.value=String(tab.tabId);option.textContent=tab.title;select.append(option);}
    document.querySelector('#import').disabled=!tabs.length;
  }catch(error){importStatus.textContent=error.message;}
}
document.querySelector('#refreshTabs').onclick=refreshTabs;
document.querySelector('#advanced').ontoggle=()=>{if(document.querySelector('#advanced').open)refreshTabs();};
document.querySelector('#import').onclick=()=>{if(!document.querySelector('#targetTab').value){importStatus.textContent='请先选择目标视频，并核对标题。';return;}document.querySelector('#importFile').click();};
document.querySelector('#importFile').onchange=async event=>{
  const file=event.target.files[0],selected=tabs.find(tab=>String(tab.tabId)===document.querySelector('#targetTab').value);
  try{if(!file)return;if(!selected)throw new Error('目标视频已变化，请刷新视频列表。');if(file.size>20e6)throw new Error('字幕文件过大。');
    importStatus.textContent='正在导入…';await ask({type:'advancedImport',tabId:selected.tabId,videoId:selected.videoId,text:await file.text()});importStatus.textContent='已交给所选视频处理，请回到YouTube查看进度。';
  }catch(error){importStatus.textContent=error.message;}finally{event.target.value='';}
};
