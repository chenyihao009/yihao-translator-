export async function tabMetadata(tabId){
  const [result]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
    const response=document.querySelector('#movie_player')?.getPlayerResponse?.()||window.ytInitialPlayerResponse;
    const details=response?.videoDetails||{};
    return {id:details.videoId,title:details.title,duration:Number(details.lengthSeconds),uploader:details.author,tracks:response?.captions?.playerCaptionsTracklistRenderer?.captionTracks||[]};
  }});
  if(!result.result?.id)throw new Error('请等待YouTube播放器加载完成后重试。');
  return result.result;
}
export async function acquire(tabId,language,expectedId){
  const metadata=await tabMetadata(tabId);
  if(metadata.id!==expectedId)throw new Error('视频已切换，请重试当前视频。');
  const available=metadata.tracks.filter(t=>t.baseUrl&&t.languageCode);
  const track=language==='auto'?(available.find(t=>t.kind!=='asr')||available[0]):(available.find(t=>t.languageCode===language&&t.kind!=='asr')||available.find(t=>t.languageCode===language));
  if(!track)throw new Error('当前播放器未提供所选字幕。请先开启YouTube原语言字幕后重试；无字幕视频暂不支持。');
  const url=new URL(track.baseUrl);
  if(url.hostname!=='www.youtube.com'||url.pathname!=='/api/timedtext')throw new Error('字幕地址不在允许范围。');
  url.searchParams.set('fmt','json3');url.searchParams.delete('tlang');
  let text='',status=0;
  try{const r=await fetch(url,{credentials:'include',signal:AbortSignal.timeout(15000)});status=r.status;text=await r.text();}catch{}
  if(!text.trim()||status!==200){
    const [result]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:async captionUrl=>{
      const response=await fetch(captionUrl,{credentials:'include'});return {status:response.status,text:await response.text()};
    },args:[url.href]});
    text=result.result?.text||'';status=result.result?.status;
  }
  let raw;try{raw=JSON.parse(text);}catch{}
  if(!raw?.events){
    const [captured]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:async(videoId,lang,kind)=>{
      const player=document.querySelector('#movie_player');
      const existing=window.__ytzhCaptionCache?.[videoId];
      if(existing&&existing.language===lang)return existing.raw;
      const button=document.querySelector('.ytp-subtitles-button');
      if(button&&button.getAttribute('aria-pressed')!=='true')button.click();
      try{player?.loadModule?.('captions');player?.setOption?.('captions','track',{languageCode:lang,...(kind?{kind}: {})});}catch{}
      for(let i=0;i<100;i++){const item=window.__ytzhCaptionCache?.[videoId];if(item&&item.language===lang)return item.raw;await new Promise(resolve=>setTimeout(resolve,100));}
      return null;
    },args:[expectedId,track.languageCode,track.kind||'']});
    raw=captured.result;
  }
  if(!raw?.events){
    // Public player-client compatibility path, equivalent to the standalone extractor's public caption route.
    // No account cookies, video media, or age-restricted content are requested here.
    try{
      const response=await fetch('https://www.youtube.com/youtubei/v1/player',{method:'POST',credentials:'omit',
        headers:{'Content-Type':'application/json','X-YouTube-Client-Name':'101','X-YouTube-Client-Version':'1.02'},
        body:JSON.stringify({videoId:expectedId,context:{client:{clientName:'VISIONOS',clientVersion:'1.02',
          deviceMake:'Apple',deviceModel:'RealityDevice17,1',osName:'visionOS',osVersion:'26.5.23O471',
          userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'}}}),
        signal:AbortSignal.timeout(15000)});
      const compatible=await response.json();
      if(compatible.playabilityStatus?.status==='LOGIN_REQUIRED'){
        throw new Error('YTZH_SESSION_REQUIRED');
      }
      if(compatible.playabilityStatus?.status==='OK'){
        const candidates=compatible.captions?.playerCaptionsTracklistRenderer?.captionTracks||[];
        const candidate=candidates.find(t=>t.languageCode===track.languageCode&&t.kind===track.kind)||candidates.find(t=>t.languageCode===track.languageCode);
        if(candidate){const captionUrl=new URL(candidate.baseUrl);if(captionUrl.hostname==='www.youtube.com'&&captionUrl.pathname==='/api/timedtext'){
          captionUrl.searchParams.set('fmt','json3');captionUrl.searchParams.delete('tlang');
          const captions=await fetch(captionUrl,{credentials:'omit',signal:AbortSignal.timeout(15000)});
          raw=await captions.json();metadata.acquisition='public-player-client';
        }}
      }
    }catch(error){if(error.message==='YTZH_SESSION_REQUIRED')throw new Error('YouTube要求登录或确认当前会话。请在常用Chrome中完成平台提示，确认原字幕正常显示后重试；也可导入原字幕。');}
  }
  if(!raw?.events)throw new Error(`网页字幕接口未返回可用内容（${status||'网络失败'}）。请开启原字幕重试，也可在扩展设置的“高级排错”中导入原字幕。`);
  if(!Array.isArray(raw.events))throw new Error('字幕数据格式不支持。');
  delete metadata.tracks;metadata.language=track.languageCode;metadata.subtitle_type=track.kind==='asr'?'automatic':'manual';
  return {raw,metadata};
}
