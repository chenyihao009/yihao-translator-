// Numeric fidelity checks are deliberately narrower than mathematical or
// translation correctness. Equal written values are accepted; ambiguous
// conversions are review notes rather than reasons to retry an entire batch.
const DIGITS={零:'0',〇:'0',一:'1',二:'2',两:'2',三:'3',四:'4',五:'5',六:'6',七:'7',八:'8',九:'9'};
const CN_DIGIT='零〇一二两三四五六七八九';
const CN_NUMBER=CN_DIGIT+'十百千万亿兆点';
const SCALE={hundred:2,thousand:3,million:6,billion:9,trillion:12,十:1,百:2,千:3,万:4,亿:8,兆:12};
const UNIT_RULES=[
  ['length','km',1000,'(?:kilomet(?:er|re)s?|km|公里|千米)'],
  ['length','cm',.01,'(?:centimet(?:er|re)s?|cm|厘米)'],
  ['length','mm',.001,'(?:millimet(?:er|re)s?|mm|毫米)'],
  ['length','mile',1609.344,'(?:miles?|mi|英里)'],
  ['length','foot',.3048,'(?:feet|foot|ft|英尺)'],
  ['length','m',1,'(?:met(?:er|re)s?|m|米)'],
  ['time','week',604800,'(?:weeks?|周|星期)'],
  ['time','day',86400,'(?:days?|天|日)'],
  ['time','hour',3600,'(?:hours?|hrs?|小时|时)'],
  ['time','minute',60,'(?:minutes?|mins?|分钟|分)'],
  ['time','ms',.001,'(?:milliseconds?|ms|毫秒)'],
  ['time','second',1,'(?:seconds?|secs?|s|秒钟|秒)'],
  ['time','year',null,'(?:years?|年|岁)'],
  ['mass','kg',1000,'(?:kilograms?|kg|千克|公斤)'],
  ['mass','g',1,'(?:grams?|g|克)'],
  ['mass','tonne',1000000,'(?:tonnes?|吨)'],
  ['temperature','c',null,'(?:°\\s*c|degrees?\\s+celsius|摄氏度)'],
  ['temperature','f',null,'(?:°\\s*f|degrees?\\s+fahrenheit|华氏度)'],
  ['count','frame',1,'(?:frames?|帧)'],
  ['count','layer',1,'(?:layers?|层)'],
  ['count','times',1,'(?:times?|倍|次)'],
  ['count','item',1,'(?:items?|个|颗|枚|件|人|次|条|本|台|辆|套|张|只|位|种|段|项|级|号)']
].map(([family,id,factor,pattern])=>({family,id,factor,regex:new RegExp('^(?:\\s*[-–]?\\s*)('+pattern+')(?![A-Za-z])','i')}));

const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){const next=a%b;a=b;b=next;}return a||1n;};
function rational(n,d=1n){if(d===0n)return null;if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};}
const multiply=(a,b)=>rational(a.n*b.n,a.d*b.d);
const add=(a,b)=>rational(a.n*b.d+b.n*a.d,a.d*b.d);
const key=value=>`${value.n}/${value.d}`;
function decimal(raw){
  let value=raw.replace(/[\s\u00a0\u202f_]/g,'');
  if(value.includes(',')){
    if(/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))value=value.replaceAll(',','');
    else if(!value.includes('.')&&(value.match(/,/g)||[]).length===1)value=value.replace(',','.');
    else return null;
  }
  const match=value.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if(!match||value.length>160)return null;
  const exponent=Number(match[4]||0)-(match[3]||'').length;
  if(!Number.isInteger(exponent)||Math.abs(exponent)>256)return null;
  const coefficient=BigInt(match[2]+(match[3]||''))*(match[1]==='-'?-1n:1n);
  return exponent>=0?rational(coefficient*10n**BigInt(exponent)):rational(coefficient,10n**BigInt(-exponent));
}
function chineseInteger(raw){
  if(!raw)return 1n;
  if(!/[十百千万亿兆]/.test(raw)){
    const digits=[...raw].map(c=>DIGITS[c]??(/\d/.test(c)?c:'')).join('');
    return digits&&digits.length===raw.length?BigInt(digits):null;
  }
  for(const [unit,power]of [['兆',12],['亿',8],['万',4]]){
    const at=raw.indexOf(unit);
    if(at>=0){
      const left=chineseInteger(raw.slice(0,at)),right=raw.slice(at+1)?chineseInteger(raw.slice(at+1)):0n;
      return left===null||right===null?null:left*10n**BigInt(power)+right;
    }
  }
  let total=0n,part='';
  for(const char of raw){
    if(char in DIGITS||/\d/.test(char)){part+=DIGITS[char]??char;continue;}
    const factor={十:10n,百:100n,千:1000n}[char];if(!factor)return null;
    total+=BigInt(part||'1')*factor;part='';
  }
  return total+BigInt(part||'0');
}
function chinese(raw){
  const match=raw.match(/^([负正]?)([\d零〇一二两三四五六七八九十百千万亿兆]+)(?:点([\d零〇一二两三四五六七八九]+)([十百千万亿兆]*))?$/);
  if(!match)return null;
  // Colloquial 一百二 can mean 120 or 102. Leave this to review.
  if(/[百千][一二两三四五六七八九]$/.test(match[2]))return null;
  const integer=chineseInteger(match[2]);if(integer===null)return null;
  const tail=match[3]?[...match[3]].map(c=>DIGITS[c]??c).join(''):'';
  const sign=match[1]==='负'?-1n:1n,denominator=10n**BigInt(tail.length);
  const result=rational(sign*(integer*denominator+BigInt(tail||'0')),denominator);
  return match[4]?multiply(result,rational(chineseInteger(match[4]))):result;
}
function ambiguousChinese(raw){
  const match=raw.match(/^(.*[百千])([一二两三四五六七八九])$/);
  if(!match)return [];
  return [chineseInteger(raw),chineseInteger(raw+(match[1].endsWith('千')?'百':'十'))].filter(value=>value!==null).map(value=>key(rational(value)));
}
function normalize(text){
  const superscripts={'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁻':'-','⁺':'+'};
  return String(text).replace(/[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹]+/g,s=>'^'+[...s].map(c=>superscripts[c]).join(''))
    .normalize('NFKC').replace(/[−﹣]/g,'-').replace(/[壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬億兩]/g,c=>({壹:'一',贰:'二',貳:'二',叁:'三',參:'三',肆:'四',伍:'五',陆:'六',陸:'六',柒:'七',捌:'八',玖:'九',拾:'十',佰:'百',仟:'千',萬:'万',億:'亿',兩:'两'})[c]);
}
function unitAt(text,index){for(const rule of UNIT_RULES){const match=text.slice(index).match(rule.regex);if(match)return {...rule,raw:match[1]};}return null;}
function extract(input){
  const text=normalize(input),tokens=[],notes=[],ambiguous=[],reserved=Array(text.length).fill(false);
  const complexRanges=[...text.matchAll(/\b(?:\d{1,2}:\d{2}(?::\d{2})?|(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2})\b/g)].map(match=>[match.index,match.index+match[0].length]);
  function protect(regex,kind,canonical){
    for(const match of text.matchAll(regex)){
      const start=match.index,end=start+match[0].length;if(reserved.slice(start,end).some(Boolean))continue;
      tokens.push({kind,raw:match[0],canonical:canonical(match[0]),start,end});reserved.fill(true,start,end);
    }
  }
  protect(/(?<![\p{L}\d])(?:\+?\d[\d ()-]{5,}\d)(?![\p{L}\d])/gu,'phone',raw=>raw.replace(/\D/g,''));
  // A date range is not a telephone number; only reserve clearly formatted phones.
  for(let i=tokens.length-1;i>=0;i--){const token=tokens[i];if(token.canonical.length<7||/^(?:19|20)\d{2}-\d{1,2}-\d{1,2}$/.test(token.raw)||((token.raw.match(/[-()]/g)||[]).length<2&&!/(?:phone|call|tel|电话|拨打)\s*$/i.test(text.slice(0,token.start)))){reserved.fill(false,token.start,token.end);tokens.splice(i,1);}}
  protect(/(?<![A-Za-z\d])(?:v(?:ersion)?\s*)?\d+(?:\.\d+){2,}(?:[-+][A-Za-z\d.]+)?/gi,'version',raw=>raw.toLowerCase().replace(/^v(?:ersion)?\s*/,''));
  protect(/\bf(?:[1-9]|1\d|2[0-4])\b/gi,'shortcut',raw=>raw.toLowerCase());
  protect(/\b[A-Za-z]+[._-]?\d+(?:\.\d+)*\b/g,'identifier',raw=>raw.toLowerCase().replace(/[^a-z\d]/g,''));

  const arabic=/^[+-]?(?:\d{1,3}(?:[ ,\u00a0\u202f]\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)(?:e[+-]?\d+)?(?!\d)/i;
  const cn=new RegExp('^[负正]?['+CN_NUMBER+'\\d]+');
  for(let index=0;index<text.length;){
    if(reserved[index]){index++;continue;}
    if(/[+-]/.test(text[index])&&/\d/.test(text[index-1]||'')){index++;continue;}
    const start=index;let at=index,percent=0;
    for(const [prefix,power]of [['百分之',-2],['千分之',-3],['万分之',-4]])if(text.startsWith(prefix,at)){percent=power;at+=prefix.length;break;}
    let negative=text.slice(at).match(/^(?:minus|negative)\s+/i);if(negative)at+=negative[0].length;
    if(/[负正]/.test(text[at]||'')&&/\d/.test(text[at+1]||'')){if(text[at]==='负')negative=true;at++;}
    const compound=text.slice(at).match(cn);
    const mixedChinese=compound&&new RegExp('[十百千万亿兆].*[\\d'+CN_DIGIT+']').test(compound[0]);
    let match=mixedChinese?null:text.slice(at).match(arabic),value=null,end=at,uncertain=false;
    if(match){
      value=decimal(match[0]);end=at+match[0].length;
      const mixed=text.slice(end).match(/^\s+(?:and\s+)?(?:a\s+(half|quarter)|three\s+quarters|([1-9]\d*)\s*\/\s*([1-9]\d*))/i);
      if(mixed&&value){let fraction=mixed[1]?rational(1n,mixed[1].toLowerCase()==='half'?2n:4n):mixed[2]?rational(BigInt(mixed[2]),BigInt(mixed[3])):rational(3n,4n);if(value.n<0n)fraction=rational(-fraction.n,fraction.d);value=add(value,fraction);end+=mixed[0].length;}
      else if(text[end]==='/'){
        const denominator=text.slice(end+1).match(/^\d+/);if(denominator&&value){const d=BigInt(denominator[0]);value=d?rational(value.n,value.d*d):null;end+=1+denominator[0].length;}
      }
      const scientific=text.slice(end).match(/^\s*[×x*]\s*10\s*\^\s*([+-]?\d+)/i);
      if(scientific&&value){const power=Number(scientific[1]);value=Math.abs(power)<=256?multiply(value,decimal('1e'+power)):null;end+=scientific[0].length;}
      const scale=text.slice(end).match(/^\s*(?:(?:or\s+so|approximately|roughly|about)\s+)?(hundred|thousand|million|billion|trillion|[十百千万亿兆]+)(?=$|[^A-Za-z])/i);
      if(scale&&value){const factor=SCALE[scale[1].toLowerCase()]!==undefined?decimal('1e'+SCALE[scale[1].toLowerCase()]):rational(chineseInteger(scale[1]));value=multiply(value,factor);end+=scale[0].length;}
    }else{
      match=text.slice(at).match(cn);
      if(match){
        end=at+match[0].length;value=chinese(match[0]);
        const after=text.slice(end),before=text.slice(0,at);
        if(match[0].length===1&&!percent&&!/[十百千万亿兆]/.test(match[0])&&!unitAt(text,end)&&!/(?:第|为|是|等于|约|至|到|、|，|,|和|或|[=<>])\s*$/.test(before)&&!/^(?:[。？！,，、；;\s]|$)/.test(after)){
          index=end;continue;
        }
      }
    }
    if(!match){index++;continue;}
    if(reserved.slice(start,end).some(Boolean)){index=end;continue;}
    const suffix=text.slice(end).match(/^\s*(%|percent(?:age)?(?:\s+points?)?)/i);
    if(suffix){percent=-2;end+=suffix[0].length;}
    if(value&&percent)value=multiply(value,decimal('1e'+percent));
    if(value&&negative)value=rational(-value.n,value.d);
    // Numerals embedded in identifiers (H.264, RFC123, 3D) require semantic
    // interpretation and must not be assembled into an unrelated quantity.
    if(/[A-Za-z]/.test(text[start-1]||'')||(/^[A-Za-z]/.test(text.slice(end))&&!unitAt(text,end)))uncertain=true;
    const raw=text.slice(start,end),unit=unitAt(text,end);
    if(value&&!uncertain)tokens.push({kind:'number',raw,value,canonical:key(value),unit,start,end});
    else{notes.push(`数字表达“${raw.slice(0,45)}”未自动判定，请核对。`);ambiguous.push({raw,candidates:ambiguousChinese(raw),start,end});}
    index=Math.max(end,index+1);
  }
  return {text,tokens:tokens.sort((a,b)=>a.start-b.start),notes,ambiguous,complexRanges};
}
function sameValue(source,target){
  if(source.kind!==target.kind)return false;
  if(source.kind!=='number')return source.canonical===target.canonical;
  if(source.unit&&target.unit&&source.unit.family!==target.unit.family)return false;
  if(source.unit&&target.unit&&source.unit.family===target.unit.family&&source.unit.id!==target.unit.id&&(source.unit.factor===null||target.unit.factor===null))return false;
  if(source.unit&&target.unit&&source.unit.family===target.unit.family&&source.unit.family!=='count'&&source.unit.factor!==null&&target.unit.factor!==null){
    return key(multiply(source.value,decimal(String(source.unit.factor))))===key(multiply(target.value,decimal(String(target.unit.factor))));
  }
  return source.canonical===target.canonical;
}
function mayConvert(source,target){
  if(source.kind!=='number'||target.kind!=='number')return false;
  if(source.unit&&target.unit&&source.unit.family===target.unit.family&&source.unit.id!==target.unit.id)return true;
  // Preserve year abbreviations for review rather than declaring them wrong.
  return /^(?:1\d{3}|20\d{2})$/.test(source.raw)&&/^\d{2}$/.test(target.raw)&&source.raw.endsWith(target.raw)&&target.unit?.id==='year';
}

/**
 * @returns {{ok:boolean, errors:string[], notes:string[]}}
 * Errors mean an unambiguous written quantity/identifier was changed or lost.
 * Notes cover formats or conversions this conservative parser cannot prove.
 */
export function validateNumbers(original,translation){
  const source=extract(original),target=extract(translation),notes=[...source.notes,...target.notes],errors=[];
  const available=target.tokens.slice(),missing=[];
  for(const item of source.tokens){const at=available.findIndex(other=>sameValue(item,other));if(at>=0)available.splice(at,1);else missing.push(item);}
  for(const item of missing){
    const at=available.findIndex(other=>mayConvert(item,other));
    if(at>=0){notes.push(`“${item.raw}”与“${available[at].raw}”可能涉及单位换算或年份缩写，请核对。`);available.splice(at,1);}
    else if(item.kind==='identifier'||source.complexRanges.some(([start,end])=>item.start>=start&&item.end<=end))notes.push(`原文数字表达“${item.raw}”未能可靠对应，请核对。`);
    else if(item.kind==='number'&&target.ambiguous.some(other=>other.candidates.includes(item.canonical)))notes.push(`原文数字“${item.raw}”对应可能有歧义的中文数词，请核对。`);
    else errors.push(`中文修改或漏掉了原文数字“${item.raw}”，请保留数值，允许等值的中文数字与单位表达。`);
  }
  if(available.length)notes.push('译文中有未自动对应的数字表达，请结合原文核对。');
  return {ok:errors.length===0,errors,notes:[...new Set(notes)]};
}
