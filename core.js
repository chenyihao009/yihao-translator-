export const RULE_VERSION = 'sentence-v2.2';
export const CONFIRMED = {'Keyframe Assistant': '关键帧助手', 'Easy Ease': '缓动', opacity: '不透明度',
  'pre-compose': '预合成', 'Blender Graph Editor': '曲线编辑器', 'AE Graph Editor': '图表编辑器'};
export function wordsFromJson3(raw, durationMs) {
  const entries = []; let estimated = false;
  for (const event of raw.events || []) {
    const segs = event.segs || [];
    const text = segs.map(s => s.utf8 || '').join('');
    if (!text.trim()) continue;
    if (segs.some(s => 'tOffsetMs' in s)) {
      for (const seg of segs) (seg.utf8 || '').match(/\S+/g)?.forEach((word, i) =>
        entries.push({start: (event.tStartMs || 0) + (seg.tOffsetMs || 0) + i, text: word}));
    } else {
      const parts = text.match(/\S+/g) || [];
      if (parts.length > 1) estimated = true;
      parts.forEach((word, i) => entries.push({start: (event.tStartMs || 0) + Math.round((event.dDurationMs || 1000) * i / parts.length), text: word}));
    }
  }
  const unique = [...new Map(entries.map(e => [`${e.start}:${e.text}`, e])).values()].sort((a,b) => a.start - b.start);
  const words = unique.filter(w => w.start < durationMs).map((w, i, all) => ({id: i + 1, text: w.text,
    start_ms: w.start, end_ms: Math.min(durationMs, Math.max(w.start + 1, Math.min(all[i+1]?.start ?? w.start + 500, w.start + 1200)))}));
  if (!words.length) throw new Error('未取得可用的带时间字幕。');
  return {words, timing: estimated ? 'estimated' : 'word-starts'};
}
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
export function validateSegments(output, words, isFinal) {
  if (!Array.isArray(output.segments) || !output.segments.length) throw new Error('模型没有返回完整句子。');
  const map = new Map(words.map(w => [w.id, w])); let next = words[0].id;
  const cues = output.segments.map(item => {
    const first = item.first_word_id, last = item.last_word_id;
    if (!Number.isInteger(first) || !Number.isInteger(last) || first !== next || last < first || !map.has(last)) throw new Error('分句编号不连续、重叠或越界。');
    const zh = item.zh?.trim(), en = item.en?.trim();
    if (typeof zh !== 'string' || typeof en !== 'string') throw new Error('字幕正文缺失。');
    const original = Array.from({length: last-first+1}, (_,i) => map.get(first+i).text).join(' ');
    if (normalized(original) !== normalized(en)) throw new Error('模型改写了原文单词或数字。');
    const sourceNumbers=original.match(/\d+(?:[.,]\d+)*/g)||[],targetNumbers=zh.match(/\d+(?:[.,]\d+)*/g)||[];
    if(sourceNumbers.some(number=>!targetNumbers.includes(number)))throw new Error('中文修改或漏掉了原文数字，必须保留数值，疑点单独记录。');
    if (!/[。？！][”」』）)]?$/.test(zh)) throw new Error('字幕不是以完整句末标点结束。');
    if (/[。？！].+[。？！][”」』）)]?$/.test(zh)) throw new Error('一条字幕混入了多个句子。');
    if (zh.includes('-->') || /\n\s*\n/.test(zh)) throw new Error('字幕格式非法。');
    next = last + 1;
    return {first_word_id: first, last_word_id: last, start_ms: map.get(first).start_ms,
      end_ms: map.get(last).end_ms, source: en,
      zh: /keyframe assistant/i.test(en) ? zh.replaceAll('关键帧辅助', '关键帧助手') : zh,
      notes: Array.isArray(item.notes) ? item.notes.map(String) : []};
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
