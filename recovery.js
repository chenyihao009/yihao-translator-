import {validateSegments,normalized} from './core.js';
import {validateNumbers} from './numbers.js';

function structural(message){const error=new Error(message);error.code='SUBTITLE_STRUCTURE';return error;}
function text(value){return typeof value==='string'?value.replace(/\r?\n/g,' ').replace(/\s+/g,' ').trim():'';}
function endSentence(value){
  let result=text(value).replace(/-->/g,'→');
  if(!result)return '';
  result=result.replace(/([.!?])([”」』）)\]】"’']*)$/,(_,mark,close)=>({'.':'。','!':'！','?':'？'}[mark])+close);
  if(!/[。？！…][”」』）)\]】"’']*$/.test(result))result=result.replace(/[，,；;：:—-]+$/,'')+'。';
  return result;
}
function cueFor(item,span){
  const source=span.map(word=>word.text).join(' '),en=text(item.en),zh=endSentence(item.zh);
  if(!zh)throw structural('片段没有可用译文。');
  const numeric=validateNumbers(source,zh);
  const notes=[...(Array.isArray(item.notes)?item.notes.filter(note=>typeof note==='string'):[]),...numeric.notes,...numeric.errors];
  if(en&&normalized(en)!==normalized(source))notes.push('原文显示已从原字幕恢复，未采用模型改写的原文。');
  return {first_word_id:span[0].id,last_word_id:span.at(-1).id,start_ms:span[0].start_ms,end_ms:span.at(-1).end_ms,
    source:en&&normalized(en)===normalized(source)?en:source,zh,notes:[...new Set(notes)].slice(0,20),recovered:true};
}

// Only unusable text or an unreliable source span blocks this path. Wording,
// punctuation and numerical doubts stay internal and can be improved by review.
export function recoverSegments(output,words,isFinal){
  if(!words?.length||!Array.isArray(output?.segments)||!output.segments.length)throw structural('没有可用字幕片段。');
  const map=new Map(words.map(word=>[word.id,word]));let next=words[0].id;
  const cues=output.segments.map(item=>{
    const first=item?.first_word_id,last=item?.last_word_id;
    if(!Number.isInteger(first)||!Number.isInteger(last)||first!==next||last<first||!map.has(last))throw structural('字幕范围需要重新对齐。');
    const span=words.filter(word=>word.id>=first&&word.id<=last);
    if(span.length!==last-first+1)throw structural('字幕范围需要重新对齐。');
    const cue=cueFor(item,span);next=last+1;return cue;
  });
  const consumed=cues.at(-1).last_word_id;
  if(output.consumed_through!==consumed||(isFinal&&consumed!==words.at(-1).id))throw structural('字幕范围尚未覆盖完整输入。');
  // Preserve nicer model punctuation when all strict checks happen to pass.
  try{return validateSegments(output,words,isFinal);}catch{}
  return {cues,consumed};
}

// The last resort fixes source spans in code. The model then translates text
// only, and has no opportunity to invent or skip word IDs or timestamps.
export function makeFallbackChunks(words,{maxWords=36}={}){
  const limit=Math.max(8,Math.min(60,Math.floor(maxWords)||36)),chunks=[];let start=0;
  for(let index=0;index<words.length;index++){
    const size=index-start+1,word=words[index],next=words[index+1];
    const sentence=/[.!?][”’"')\]]*$/.test(word.text)&&!/(?:\b(?:Mr|Mrs|Dr|Ms|St)|(?:[A-Za-z]\.)+[A-Za-z])\.$/i.test(word.text);
    if(index===words.length-1||size>=limit||(size>=6&&(sentence||(next&&next.start_ms-word.end_ms>650)))){
      const span=words.slice(start,index+1);
      chunks.push({chunk_id:chunks.length+1,first_word_id:span[0].id,last_word_id:span.at(-1).id,
        source:span.map(value=>value.text).join(' '),start_ms:span[0].start_ms,end_ms:span.at(-1).end_ms});
      start=index+1;
    }
  }
  return chunks;
}

export function recoverFixedTranslations(output,chunks){
  const items=Array.isArray(output?.translations)?output.translations:[];
  const byId=new Map();
  for(const item of items){
    if(!Number.isInteger(item?.chunk_id)||byId.has(item.chunk_id))throw structural('字幕片段需要重新整理。');
    byId.set(item.chunk_id,item);
  }
  if(!chunks.length||items.length!==chunks.length)throw structural('部分片段还没有译文。');
  const cues=chunks.map(chunk=>{
    const item=byId.get(chunk.chunk_id);if(!text(item?.zh))throw structural('部分片段还没有译文。');
    const zh=endSentence(item.zh),numeric=validateNumbers(chunk.source,zh);
    return {first_word_id:chunk.first_word_id,last_word_id:chunk.last_word_id,start_ms:chunk.start_ms,end_ms:chunk.end_ms,
      source:chunk.source,zh,notes:[...new Set([...numeric.notes,...numeric.errors])].slice(0,20),recovered:true};
  });
  return {cues,consumed:cues.at(-1).last_word_id};
}
