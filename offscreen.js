const worker = new Worker('worker.js',{type:'module'});
let sequence=0;
const pending=new Map();
worker.onmessage = event => {
  const message=event.data;
  if(message.type==='ack'){
    const item=pending.get(message.requestId);
    if(item){clearTimeout(item.timeout);pending.delete(message.requestId);item.reply({ok:message.ok,error:message.error});}
    return;
  }
  chrome.runtime.sendMessage({target:'background',...message}).catch(()=>{});
};
worker.onerror=()=>{
  for(const item of pending.values()){clearTimeout(item.timeout);item.reply({ok:false,error:'翻译线程已中断，请刷新扩展后重试。'});}
  pending.clear();
};
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if (sender.id !== chrome.runtime.id || message.target !== 'offscreen') return;
  const requestId=++sequence;
  const timeout=setTimeout(()=>{if(pending.delete(requestId))reply({ok:false,error:'翻译线程暂未响应，请稍后重试。'});},8000);
  pending.set(requestId,{reply,timeout});worker.postMessage({...message,requestId});return true;
});
