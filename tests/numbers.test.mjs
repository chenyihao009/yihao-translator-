import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNumbers} from '../numbers.js';

function accepted(source,target){const result=validateNumbers(source,target);assert.equal(result.ok,true,JSON.stringify(result));return result;}
function rejected(source,target){const result=validateNumbers(source,target);assert.equal(result.ok,false,JSON.stringify(result));return result;}

test('accepts equivalent Arabic, Chinese, grouped and full-width numerals',()=>{
  for(const target of ['1000米。','一千米。','１０００米。'])accepted('1000 meters',target);
  accepted('1,000 people','一千人。');
  accepted('1 000 people','1000人。');
  accepted('In 1969','在一九六九年。');
  accepted('1969 2020','1969年和2020年。');
  accepted('1969','一千九百六十九。');
  accepted('2.5','二点五。');
  accepted('1.5 billion','十五亿。');
  accepted('135 million','一点三五亿。');
  accepted('135 million','一亿三千五百万。');
  accepted('35000','3万5千。');
  accepted('1000000 stars','一百万颗恒星。');
  accepted('+1000000 stars','一百万颗恒星。');
  accepted('1 trillion','1万亿。');
  accepted('1,5','1.5。');
});
test('normalizes decimal multipliers and percent notation without forcing spelling',()=>{
  accepted('1.5 million stars','150万颗恒星。');
  accepted('13.5 billion years ago','135亿年前。');
  accepted('300 or so million years after','约三亿年后。');
  accepted('15%','百分之十五。');
  accepted('15 percent','15%。');
  accepted('0.15','0.150。');
  rejected('15%','15。');
  rejected('15%','百分之二十五。');
});
test('handles mixed fractions and numerical tutorial expressions',()=>{
  accepted('6 and a half meters','6.5米。');
  accepted('6 and a quarter meters','六点二五米。');
  accepted('-6 and a half meters','负6.5米。');
  accepted('6 1/2 meters','6.5米。');
  accepted('1/2','0.5。');
  accepted('more than 6 times','六倍多。');
  accepted('5-layer','五层。');
  accepted('3-weeks','三周。');
});
test('compares scientific notation as exact values',()=>{
  accepted('1.2e6','120万。');
  accepted('1.2 × 10^6','120万。');
  accepted('1.2 × 10⁶','120万。');
  accepted('-2.5e-3','负零点零零二五。');
  rejected('1.2e6','1200万。');
});
test('matches explicit unit conversions and flags uncertain rounded conversions',()=>{
  accepted('1000 meters','1公里。');
  rejected('35 meters','35秒。');
  rejected('35 seconds','35米。');
  accepted('13.5 billion years ago','135亿年前。');
  assert(accepted('1 year','365天。').notes.length>0,'Calendar units must be reviewed instead of treated as equal spellings');
  assert(accepted('1 year','1秒。').notes.length>0,'An unspecified calendar conversion must never silently match');
  accepted('60 seconds','一分钟。');
  const approximate=accepted('1 mile','1.6公里。');
  assert(approximate.notes.length>0,'Approximate conversion should be reviewed, not trigger a batch retry');
  const temperature=accepted('32 degrees Fahrenheit','0摄氏度。');
  assert(temperature.notes.length>0);
});
test('detects actual changes and preserves repeated quantities as a multiset',()=>{
  rejected('35','第135帧。');
  rejected('1969','在1970年。');
  rejected('5 and 5','五。');
  accepted('a 5-meter mirror in an Ariane 5','一面五米的镜子装进阿丽亚娜5号。');
  rejected('a 5-meter mirror in an Ariane 5','一面五米的镜子。');
  rejected('35 kilograms','数值未给出。');
  rejected('about 90 stars and 35 frames','约90颗星、135帧。');
  rejected('35 frames using H.264','使用H264时为135帧。');
  rejected('35 and 120','135和一百二。');
});
test('phone numbers, versions and shortcuts are not decimal fragments',()=>{
  accepted('Call +1 (555) 010-1234','拨打+1-555-010-1234。');
  rejected('Call +1 (555) 010-1234','拨打+1-555-010-1235。');
  accepted('Version 3.5.1','3.5.1版。');
  rejected('Version 3.5.1','3.5.2版。');
  accepted('Press F9','按F9。');
  rejected('Press F9','按F10。');
});
test('unknown representations and year abbreviations produce notes instead of blocking',()=>{
  assert(accepted('In 1969','在69年。').notes.length>0);
  assert(accepted('120','一百二。').notes.length>0);
  assert(accepted('1:30','90秒。').notes.length>0);
  accepted('H.264','H264。');
  assert(accepted('2021-12-25','2021年12月25日。').ok);
  accepted('Hello world','你好，世界。');
});
