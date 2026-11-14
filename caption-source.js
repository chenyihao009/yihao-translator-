// JSON3 events describe a caption display stream. Its word clocks can overlap
// while two lines roll, so the clocks must not be used to reorder the text.
const number=value=>value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value):undefined;
const key=text=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')||text;

function frameFromEvent(event){
  let text='';const ranges=[];
  for(const seg of event?.segs||[]){
    if(typeof seg?.utf8!=='string')continue;
    const from=text.length;text+=seg.utf8;
    ranges.push({from,to:text.length,offset:number(seg.tOffsetMs)});
  }
  if(!text.trim())return null; // Window definitions and append-newline events.
  const rawStart=number(event.tStartMs),start=Math.max(0,rawStart??0);
  const duration=number(event.dDurationMs),span=duration>0?duration:1000;
  const tokens=[];let rangeIndex=0,line=0,previousEnd=0,previousRange=-1;
  for(const match of text.matchAll(/\S+/g)){
    line+=(text.slice(previousEnd,match.index).match(/\n/g)||[]).length;
    while(rangeIndex<ranges.length-1&&match.index>=ranges[rangeIndex].to)rangeIndex++;
    const range=ranges[rangeIndex],firstInRange=rangeIndex!==previousRange;
    const anchor=firstInRange&&range.offset!==undefined?start+Math.max(0,range.offset)
      :tokens.length===0?start:undefined;
    tokens.push({text:match[0],key:key(match[0]),line,anchor,
      anchored:anchor!==undefined&&rawStart!==undefined});
    previousRange=rangeIndex;previousEnd=match.index+match[0].length;
  }
  const knownWindow=event.wWinId!==undefined&&event.wWinId!==null;
  return {start,end:start+span,knownWindow,window:knownWindow?String(event.wWinId):null,
    append:event.aAppend===true||number(event.aAppend)===1,tokens,estimated:rawStart===undefined};
}

function timeTokens(tokens,frame,end,trimmed=false){
  const times=tokens.map(token=>token.anchor);let estimated=frame.estimated;
  if(times[0]===undefined){times[0]=frame.start;estimated=true;}
  let left=0;
  while(left<tokens.length){
    let right=left+1;
    while(right<tokens.length&&times[right]===undefined)right++;
    const stop=right<tokens.length?Math.max(times[left],times[right]):Math.max(times[left],end);
    for(let i=left+1;i<right;i++){
      times[i]=times[left]+(stop-times[left])*(i-left)/(right-left);estimated=true;
    }
    left=right;
  }
  return {entries:tokens.map((token,i)=>({...token,rawStart:times[i],eventStart:frame.start,eventEnd:frame.end,
    anchored:token.anchored&&!(trimmed&&i===0&&token.anchor===undefined)})),estimated};
}

function repeatedPrefix(entries,frame,previous){
  // aAppend carries NEW text. Matching a previous word is not evidence that an
  // appended word is a duplicate (e.g. "very" followed by another "very").
  if(!frame.knownWindow||frame.append||!previous||frame.start<previous.start||frame.start>=previous.end)return 0;
  const history=previous.entries;
  for(let count=Math.min(entries.length,history.length);count>0;count--){
    const old=history.slice(-count),current=entries.slice(0,count);
    if(!current.every((word,i)=>word.key===old[i].key))continue;
    const sameClocks=current.every((word,i)=>word.anchored&&old[i].anchored&&Math.abs(word.rawStart-old[i].rawStart)<=1);
    const sameOrigin=frame.start===previous.start&&old[0].eventStart===frame.start&&Math.abs(current[0].rawStart-old[0].rawStart)<=1;
    // A complete old line followed by a new line in the SAME still-visible
    // window is a roll-up redraw. An ordinary repeated phrase is preserved.
    const rolled=frame.rollMarker!==undefined&&frame.rollMarker>=previous.start&&frame.rollMarker<=frame.start&&frame.rollMarker<previous.end;
    const carriedLine=rolled&&count<entries.length&&entries[count].line>entries[count-1].line;
    if(sameClocks||sameOrigin||carriedLine)return count;
  }
  return 0;
}

export function wordsFromJson3(raw,durationMs){
  const duration=number(durationMs),limit=duration===undefined?Infinity:Math.max(0,duration);
  const frames=[],rollMarkers=new Map();
  for(const event of Array.isArray(raw?.events)?raw.events:[]){
    const frame=frameFromEvent(event);
    if(frame){
      if(frame.knownWindow){frame.rollMarker=rollMarkers.get(frame.window);rollMarkers.delete(frame.window);}
      frames.push(frame);
    }else if(event?.wWinId!==undefined&&event.wWinId!==null&&(event.aAppend===true||number(event.aAppend)===1)
      &&(event.segs||[]).some(seg=>typeof seg?.utf8==='string'&&seg.utf8.includes('\n'))){
      rollMarkers.set(String(event.wWinId),number(event.tStartMs));
    }
  }
  // Only inferred times are bounded by the next speech event. dDurationMs can
  // describe how long an old line stays visible, not how long it is spoken.
  const nextStarts=new Array(frames.length),stack=[];
  for(let i=frames.length-1;i>=0;i--){
    while(stack.length&&frames[stack.at(-1)].start<=frames[i].start)stack.pop();
    nextStarts[i]=stack.length?frames[stack.at(-1)].start:Infinity;stack.push(i);
  }
  const entries=[],windows=new Map();let estimated=false;
  for(let i=0;i<frames.length;i++){
    const frame=frames[i],end=Math.min(frame.end,nextStarts[i],limit);
    let timed=timeTokens(frame.tokens,frame,end);
    const previous=frame.knownWindow?windows.get(frame.window):null;
    const repeated=repeatedPrefix(timed.entries,frame,previous);
    if(repeated){
      if(repeated===frame.tokens.length){
        windows.set(frame.window,{...previous,start:frame.start,end:frame.end});continue;
      }
      // Retained screen text does not consume the NEW line's inferred time.
      timed=timeTokens(frame.tokens.slice(repeated),frame,end,true);
    }
    estimated||=timed.estimated;
    entries.push(...timed.entries);
    if(frame.knownWindow)windows.set(frame.window,{start:frame.start,end:frame.end,
      entries:[...(previous?.entries||[]),...timed.entries].slice(-1024)});
  }
  const ordered=[];let lastStart=-1;
  for(const entry of entries){
    if(entry.rawStart>=limit)continue;
    const rawStart=Math.round(entry.rawStart);
    const start=Math.min(Math.max(0,Math.ceil(limit)-1),Math.max(0,rawStart,lastStart+1));
    if(start!==rawStart)estimated=true;
    ordered.push({...entry,start});lastStart=start;
  }
  const words=ordered.map((word,i)=>({id:i+1,text:word.text,start_ms:word.start,
    end_ms:Math.min(limit,Math.max(word.start+1,Math.min(ordered[i+1]?.start??word.start+500,
      word.start+1200,word.eventEnd>word.start?word.eventEnd:word.start+500)))}));
  if(!words.length)throw new Error('未取得可用的带时间字幕。');
  return {words,timing:estimated?'estimated':'word-starts'};
}
