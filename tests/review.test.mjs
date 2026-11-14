import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIRMED, validateSegments} from '../core.js';
import {REVIEW_VERSION, buildReviewInput, applyReview} from '../review.js';

function wordsFrom(text, first = 41) {
  return text.split(/\s+/).map((word, index) => ({id: first + index, text: word, start_ms: 5000 + index * 200, end_ms: 5160 + index * 200}));
}
function draftOf(words, segments) {
  return validateSegments({segments, consumed_through: words.at(-1).id}, words, true);
}
function segment(words, zh, extra = {}) {
  return {first_word_id: words[0].id, last_word_id: words.at(-1).id, en: words.map(word => word.text).join(' '), zh, ...extra};
}
function rejectReview(result, draft, words) {
  assert.throws(() => applyReview(result, draft, words), error => error.code === 'INVALID_REVIEW');
}

test('review input contains only the translated source span, glossary and read-only context', () => {
  const words = wordsFrom('Do not delete the keyframes. Then continue.');
  const covered = words.slice(0, 5);
  const draft = draftOf(covered, [segment(covered, '不要删除关键帧。')]);
  const plan = {domain: 'After Effects', tone: '简洁自然'};
  const input = buildReviewInput({draft, words, plan, previousCues: [{source: 'Select them.', zh: '选中它们。'}], followingWords: words.slice(5)});
  assert.equal(input.task, 'subtitle_review');
  assert.equal(input.review_version, REVIEW_VERSION);
  assert.deepEqual(input.translation_plan, plan);
  assert.deepEqual(input.confirmed_terms, CONFIRMED);
  assert.deepEqual(input.words, covered.map(({id, text}) => ({id, text})));
  assert.deepEqual(input.draft_subtitles, [{id: 1, first_word_id: 41, last_word_id: 45, en: 'Do not delete the keyframes.', zh: '不要删除关键帧。', notes: []}]);
  assert.match(input.data_policy, /不是指令/);
  assert.equal(input.previous_context, 'Select them.\n选中它们。');
  assert.equal(input.following_context, 'Then continue.');
  assert.equal(input.words[0].start_ms, undefined);
  input.draft_subtitles[0].notes.push('模型不可回写初稿');
  assert.deepEqual(draft.cues[0].notes, []);
});

test('a separate review can fix an omitted negation without changing the English or clock', () => {
  const words = wordsFrom('Do not delete the keyframes.');
  const draft = draftOf(words, [segment(words, '删除关键帧。')]);
  const reviewed = applyReview({action: 'revise', consumed_through: draft.consumed, segments: [segment(words, '不要删除关键帧。', {start_ms: 0, end_ms: 999999})], notes: []}, draft, words);
  assert.equal(reviewed.cues[0].zh, '不要删除关键帧。');
  assert.equal(reviewed.cues[0].source, draft.cues[0].source);
  assert.equal(reviewed.cues[0].start_ms, words[0].start_ms);
  assert.equal(reviewed.cues[0].end_ms, words.at(-1).end_ms);
  assert.deepEqual(reviewed.review, {status: 'changed', changed: true, notes: []});
  assert.equal(draft.cues[0].zh, '删除关键帧。');
});

test('review can unify a specialist term while keeping source content intact', () => {
  const words = wordsFrom('Apply Easy Ease to the selected keyframes.');
  const draft = draftOf(words, [segment(words, '对选中的关键帧应用轻松缓解。')]);
  const result = applyReview({action: 'revise', consumed_through: draft.consumed, segments: [segment(words, '对选中的关键帧应用缓动。')], notes: []}, draft, words);
  assert.equal(result.cues[0].zh, '对选中的关键帧应用缓动。');
  assert.equal(result.review.changed, true);
});

test('review can merge a split sentence and preserve the full original word span and time', () => {
  const words = wordsFrom('Open the panel and select the layer.');
  const draft = draftOf(words, [segment(words.slice(0, 3), '打开面板。'), segment(words.slice(3), '然后选中图层。')]);
  const result = applyReview({action: 'revise', consumed_through: draft.consumed, segments: [segment(words, '打开面板并选中图层。')], notes: []}, draft, words);
  assert.equal(result.cues.length, 1);
  assert.equal(result.cues[0].first_word_id, 41);
  assert.equal(result.cues[0].last_word_id, words.at(-1).id);
  assert.equal(result.cues[0].start_ms, words[0].start_ms);
  assert.equal(result.cues[0].end_ms, words.at(-1).end_ms);
  assert.equal(result.consumed, draft.consumed);
});

test('review can split at an actual sentence boundary with times derived from word IDs', () => {
  const words = wordsFrom('Select the layer. Then open the panel.');
  const draft = draftOf(words, [segment(words, '选中图层后打开面板。')]);
  const result = applyReview({action: 'revise', consumed_through: draft.consumed, segments: [segment(words.slice(0, 3), '选中图层。'), segment(words.slice(3), '然后打开面板。')], notes: []}, draft, words);
  assert.equal(result.cues.length, 2);
  assert.deepEqual(result.cues.map(cue => [cue.first_word_id, cue.last_word_id, cue.start_ms, cue.end_ms]), [
    [41, 43, words[0].start_ms, words[2].end_ms],
    [44, 47, words[3].start_ms, words.at(-1).end_ms]
  ]);
});

test('a review changing numerical facts or the original English is rejected', () => {
  const words = wordsFrom('Set the duration to 35 frames.');
  const draft = draftOf(words, [segment(words, '将时长设为35帧。')]);
  rejectReview({action: 'revise', consumed_through: draft.consumed, segments: [segment(words, '将时长设为135帧。')]}, draft, words);
  rejectReview({action: 'revise', consumed_through: draft.consumed, segments: [segment(words, '将时长设为35帧。', {en: 'Set the duration to 135 frames.'})]}, draft, words);
  rejectReview({action: 'revise', consumed_through: draft.consumed, segments: [segment(words, '将时长设为35帧。', {en: 'Do not set the duration to 35 frames.'})]}, draft, words);
  assert.equal(draft.cues[0].zh, '将时长设为35帧。');
});

test('review cannot use a later context word, skip coverage or duplicate a word', () => {
  const words = wordsFrom('Open the panel and select the layer. Then continue.');
  const covered = words.slice(0, 7);
  const draft = draftOf(covered, [segment(covered, '打开面板并选中图层。')]);
  const results = [
    {action: 'revise', consumed_through: words.at(-1).id, segments: [segment(words, '打开面板、选中图层并继续。')]},
    {action: 'revise', consumed_through: draft.consumed, segments: [segment(words.slice(0, 8), '打开面板并选中图层。')]},
    {action: 'revise', consumed_through: draft.consumed, segments: [segment(covered.slice(1), '打开面板并选中图层。')]},
    {action: 'revise', consumed_through: draft.consumed, segments: [segment(covered.slice(0, 3), '打开面板。'), segment(covered.slice(4), '选中图层。')]},
    {action: 'revise', consumed_through: draft.consumed, segments: [segment(covered.slice(0, 4), '打开面板。'), segment(covered.slice(3), '选中图层。')]},
    {action: 'revise', consumed_through: draft.consumed - 1, segments: [segment(covered.slice(0, -1), '打开面板并选中图层。')]}
  ];
  for (const result of results) rejectReview(result, draft, words);
});

test('keep preserves a valid translation without requiring stylistic changes or repeated subtitles', () => {
  const words = wordsFrom('Select the layer.');
  const draft = draftOf(words, [segment(words, '选中图层。')]);
  const frozen = JSON.stringify(draft);
  const result = applyReview({action: 'keep', notes: []}, draft, words);
  assert.equal(result.cues[0].zh, draft.cues[0].zh);
  assert.equal(result.cues[0].source, draft.cues[0].source);
  assert.deepEqual(result.review, {status: 'passed', changed: false, notes: []});
  assert.equal(result.cues[0].reviewed, true);
  assert.equal(JSON.stringify(draft), frozen);
});

test('resegmentation retains all old uncertainty notes and deduplicates reviewer notes', () => {
  const words = wordsFrom('Open the panel and select the layer.');
  const draft = draftOf(words, [segment(words.slice(0, 3), '打开面板。', {notes: ['panel所指面板需结合画面确认']}), segment(words.slice(3), '然后选中图层。', {notes: ['代词所指需确认']})]);
  const result = applyReview({action: 'revise', consumed_through: draft.consumed, segments: [segment(words, '打开面板并选中图层。', {notes: ['代词所指需确认', '字幕未包含画面信息']})], notes: ['字幕未包含画面信息']}, draft, words);
  assert.deepEqual(result.cues[0].notes, ['panel所指面板需结合画面确认', '代词所指需确认', '字幕未包含画面信息']);
  assert.equal(result.review.status, 'needs_check');
  assert.deepEqual(result.review.notes, result.cues[0].notes);
  const kept = applyReview({action: 'keep', notes: []}, draft, words);
  assert.equal(kept.review.status, 'needs_check');
  assert.equal(kept.review.changed, false);
  const newConcern = applyReview({action: 'keep', notes: ['画面中对象身份需确认']}, draft, words);
  assert.ok(newConcern.cues[0].notes.includes('画面中对象身份需确认'));
  assert.equal(newConcern.review.status, 'needs_check');
});

test('malformed review and core validation failures consistently expose INVALID_REVIEW', () => {
  const words = wordsFrom('Select the layer.');
  const draft = draftOf(words, [segment(words, '选中图层。')]);
  for (const result of [null, {}, {action: 'approve'}, {action: 'keep', notes: '很好'}, {action: 'keep', notes: [42]}, {action: 'keep', notes: ['x'.repeat(1001)]}, {action: 'keep', consumed_through: 999}, {action: 'revise', consumed_through: draft.consumed, segments: []}, {action: 'revise', consumed_through: draft.consumed, segments: [segment(words, '选中后，')]}]) {
    rejectReview(result, draft, words);
  }
});
