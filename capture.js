// Runs in the page world before the player starts. Only public caption responses are retained.
(()=>{
  if(window.__ytzhCaptionCapture)return;window.__ytzhCaptionCapture=true;
  const cache=window.__ytzhCaptionCache=Object.create(null);
  const isCaption=url=>{try{const u=new URL(String(url),location.href);return u.hostname==='www.youtube.com'&&u.pathname==='/api/timedtext';}catch{return false;}};
  const keep=(url,text)=>{
    try{const u=new URL(String(url),location.href),id=u.searchParams.get('v');if(!id||u.searchParams.has('tlang'))return;
      const raw=typeof text==='string'?JSON.parse(text):text;if(!Array.isArray(raw?.events))return;
      cache[id]={raw,language:u.searchParams.get('lang'),received:Date.now()};
      const keys=Object.keys(cache);if(keys.length>4)delete cache[keys[0]];
    }catch{}
  };
  const fetchOriginal=window.fetch;
  window.fetch=function(...args){const url=typeof args[0]==='string'?args[0]:args[0]?.url;
    return fetchOriginal.apply(this,args).then(response=>{if(isCaption(url))response.clone().text().then(text=>keep(url,text)).catch(()=>{});return response;});};
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,urls=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...args){urls.set(this,url);return open.call(this,method,url,...args);};
  XMLHttpRequest.prototype.send=function(...args){const url=urls.get(this);if(isCaption(url))this.addEventListener('load',()=>{
    try{keep(url,this.responseType==='json'?this.response:this.responseText);}catch{}
  },{once:true});return send.apply(this,args);};
})();
