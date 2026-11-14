import {validateNumbers} from './numbers.js';
export {wordsFromJson3} from './caption-source.js';
export const RULE_VERSION = 'sentence-v2.4';
export const CONFIRMED = {'Keyframe Assistant': '关键帧助手', 'Easy Ease': '缓动', opacity: '不透明度',
  'pre-compose': '预合成', 'Blender Graph Editor': '曲线编辑器', 'AE Graph Editor': '图表编辑器'};
export const normalized = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function parseTimedText(text){
  const trimmed=text.replace(/^\uFEFF/,'').trim();
  if(trimmed.startsWith('{')){
    const parsed=JSON.parse(trimmed);if(parsed.raw?.events)return parsed;
    if(parsed.events)return {raw:parsed};throw new Error('JSON不是JSON3字幕。');
  }
  const toMs=value=>{const p=value.replace(',','.').split(':').map(Number);return Math.round((p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+p[1])*1000);};
  const events=[];
  for(const block of trimmed.split(/\r?\n\s*\r?\n/)){
    const lines=block.split(/\r?\n/),index=lines.findIndex(line=>line.includes('-->'));
    if(index<0)continue;
    const match=lines[index].match(/((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})/);
    if(!match)continue;const start=toMs(match[1]),end=toMs(match[2]);
    const source=lines.slice(index+1).join(' ').replace(/<[^>]*>/g,'').trim();
    if(source&&end>start)events.push({tStartMs:start,dDurationMs:end-start,segs:[{utf8:source}]});
  }
  if(!events.length)throw new Error('没有读到有效的SRT、VTT或JSON3字幕。');
  return {raw:{events}};
}
function normalizeSentenceEnd(value){
  const text=value.trim();
  if(/\.{2,}[”」』）)\]】"’']*$/.test(text))return text;
  return text.replace(/([.!?])([”」』）)\]】"’']*)$/,(_,mark,closing)=>({'.':'。','!':'！','?':'？'}[mark])+closing);
}
function sentenceCount(text){
  const pairs={'“':'”','「':'」','『':'』','（':'）','(':')','【':'】','[':']','"':'"'},stack=[];
  const chars=Array.from(text);let count=0,punctuation=false;
  for(let i=0;i<chars.length;i++){
    const char=chars[i];
    if(stack.length&&char===stack.at(-1)){stack.pop();punctuation=false;continue;}
    if(pairs[char]){stack.push(pairs[char]);punctuation=false;continue;}
    if(stack.length)continue;
    const prefix=chars.slice(Math.max(0,i-30),i+1).join('');
    const acronym=/(?:[A-Za-z]+\.){2,}$/.test(prefix)||/\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc)\.$/i.test(prefix);
    const period=char==='.'&&!acronym&&chars[i-1]!=='.'&&chars[i+1]!=='.'&&!(/[A-Za-z0-9]/.test(chars[i-1]||'')&&/[A-Za-z0-9]/.test(chars[i+1]||''));
    if(/[。？！!?]/.test(char)||period){if(!punctuation)count++;punctuation=true;}
    else if(char.trim())punctuation=false;
  }
  if(stack.length)throw new Error('字幕中的引号或括号未闭合，请按完整句意修复。');
  return count;
}
export function validateSegments(output, words, isFinal) {
  if (!output||!Array.isArray(output.segments) || !output.segments.length) throw new Error('模型没有返回完整句子。');
  const map = new Map(words.map(w => [w.id, w])); let next = words[0].id;
  const cues = output.segments.map(item => {
    if(!item||typeof item!=='object')throw new Error('字幕正文缺失。');
    const first = item.first_word_id, last = item.last_word_id;
    if (!Number.isInteger(first) || !Number.isInteger(last) || first !== next || last < first || !map.has(last)) throw new Error('分句编号不连续、重叠或越界。');
    if (typeof item.zh !== 'string' || typeof item.en !== 'string') throw new Error('字幕正文缺失。');
    const zh = normalizeSentenceEnd(item.zh), en = item.en.trim();
    if(!zh||!en)throw new Error('字幕正文缺失。');
    const original = Array.from({length: last-first+1}, (_,i) => map.get(first+i).text).join(' ');
    if (normalized(original) !== normalized(en)) throw new Error('模型改写了原文单词或数字。');
    const numeric=validateNumbers(original,zh);
    if(!numeric.ok)throw new Error(numeric.errors[0]);
    if (!/[。？！][”」』）)\]】"’']*$/.test(zh)) throw new Error('字幕不是以完整句末标点结束。');
    if (sentenceCount(zh)>1) throw new Error('一条字幕混入了多个句子。');
    if (zh.includes('-->') || /\n\s*\n/.test(zh)) throw new Error('字幕格式非法。');
    next = last + 1;
    return {first_word_id: first, last_word_id: last, start_ms: map.get(first).start_ms,
      end_ms: map.get(last).end_ms, source: en,
      zh: /keyframe assistant/i.test(en) ? zh.replaceAll('关键帧辅助', '关键帧助手') : zh,
      notes:[...new Set([...(Array.isArray(item.notes)?item.notes.map(String):[]),...numeric.notes])]};
  });
  if (output.consumed_through !== cues.at(-1).last_word_id || (isFinal && output.consumed_through !== words.at(-1).id)) throw new Error('字幕没有完整覆盖本批原文。');
  return {cues, consumed: output.consumed_through};
}
export function stamp(ms) {
  const total = Math.round(ms);
  return `${String(Math.floor(total/3600000)).padStart(2,'0')}:${String(Math.floor(total/60000)%60).padStart(2,'0')}:${String(Math.floor(total/1000)%60).padStart(2,'0')},${String(total%1000).padStart(3,'0')}`;
}
export function wrap(text, width = 26) {
  const tokens = text.replace(/\n/g,'').match(/[A-Za-z0-9]+(?:[ .+_/-][A-Za-z0-9]+)*|[^]/g) || [];
  const lines = []; let line = '';
  for (const token of tokens) { if (line.length + token.length > width && line) {lines.push(line); line = '';} line += token; }
  if (line) lines.push(line);
  return lines.join('\n');
}
export function srt(cues, bilingual) {
  return '\uFEFF' + cues.map((cue,i) => `${i+1}\n${stamp(cue.start_ms)} --> ${stamp(cue.end_ms)}\n${wrap(cue.zh)}${bilingual ? '\n'+cue.source : ''}`).join('\n\n')+'\n';
}
export function cueAt(cues, seconds) {
  const ms = seconds * 1000; let low = 0, high = cues.length - 1;
  while (low <= high) {const mid = (low+high)>>1; if (cues[mid].start_ms <= ms) low = mid+1; else high = mid-1;}
  return high >= 0 && ms < cues[high].end_ms ? cues[high] : null;
}
