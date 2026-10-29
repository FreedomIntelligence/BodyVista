import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ui from '../src/locales/ui.js';
import motionLabels from '../src/locales/motions.js';
import micro from '../src/locales/micro.js';
import { dictionary, translateAuthoredText } from '../src/locales/dictionary.js';
import { collectLearningContent } from '../tools/collect-learning-content.mjs';
import { collectDisplayContent } from '../tools/collect-display-content.mjs';
import { searchParts } from '../src/state.js';

for (const locale of ['zh-CN','en','ja']) {
  test(`${locale}: names, counts, generated labels and user text`, async () => {
    globalThis.localStorage = {getItem:()=>locale};
    const {t,registerNames} = await import(`../src/i18n.js?test=${locale}`);
    registerNames([{name:'左侧股骨',english:'femur left'}]);
    assert.equal(t('保存视图'), { 'zh-CN':'保存视图',en:'Save view',ja:'ビューを保存' }[locale]);
    assert.equal(t('已选 2'), { 'zh-CN':'已选 2',en:'2 selected',ja:'2 件選択' }[locale]);
    assert.equal(t('找到：左侧股骨'), { 'zh-CN':'找到：左侧股骨',en:'Find: femur left',ja:'探す：左側の大腿骨' }[locale]);
    assert.equal(t('My own note 123'), 'My own note 123');
    assert.equal(t('  保存视图  '), `  ${{ 'zh-CN':'保存视图',en:'Save view',ja:'ビューを保存' }[locale]}  `);
    if(locale!=='zh-CN') assert.doesNotMatch(t('第 2 / 5 题 · 已答对 1 题'), /已答对/);
  });
}
test('all UI strings and listed animations have English and Japanese labels',()=>{
  for(const [key,values] of Object.entries(dictionary)) {
    assert.equal(values.length,2,key);
    assert.ok(values.every(value=>typeof value==='string'&&value.trim()),key);
  }
  const motions=JSON.parse(fs.readFileSync(new URL('../src/motions.json',import.meta.url)));
  for(const list of Object.values(motions)) for(const {label} of list) assert.ok(motionLabels[label],label);
});
test('all authored display text and all 2,900 structure entries are localized', () => {
  for (const text of collectDisplayContent()) assert.ok(dictionary[text.trim()], text);
  const parts = JSON.parse(fs.readFileSync(new URL('../catalog.json', import.meta.url))).parts;
  assert.equal(parts.length, 2900);
  for (const part of parts) {
    const [en, ja] = dictionary[part.name];
    assert.doesNotMatch(en, /[\u4e00-\u9fff\u3040-\u30ff]/, part.name);
    assert.doesNotMatch(ja, /[a-z]{3,}|[锁纵筛耻层车结缘髋韧侧肾脉脑]/i, part.name);
  }
});
test('Japanese structure names are searchable', () => {
  const parts = JSON.parse(fs.readFileSync(new URL('../catalog.json', import.meta.url))).parts.map(p => ({...p, japanese:dictionary[p.name][1]}));
  const found = searchParts(parts, '大腿骨', 'all');
  assert.ok(found.some(p=>p.english === 'femur left'));
  assert.ok(found.some(p=>p.english === 'femur right'));
});
test('generated loading, selection, hidden labels and feedback use the selected language', async () => {
  for (const locale of ['en', 'ja']) {
    globalThis.localStorage = {getItem:()=>locale};
    const { t, formatDate } = await import(`../src/i18n.js?generated=${locale}`);
    const texts = ['骨与关节：隐藏', '正在载入 骨与关节、肌肉系统…', '骨与关节加载超时', '左侧股骨（已隐藏）、右侧股骨 · 2 个结构', '回答正确。正确答案：左侧股骨。所属系统：骨与关节。', '操作未完成：视图文件格式不正确或与当前图谱不匹配。'];
    for (const text of texts) {
      const translated = t(text);
      assert.notEqual(translated, text);
      assert.doesNotMatch(translated, locale === 'en' ? /[\u4e00-\u9fff]/ : /femur|侧|结构|载入|所属系统/);
    }
    assert.doesNotMatch(formatDate('2026-10-29T02:00:00Z'), /年.*月.*日.*上午|NaN/);
  }
});
test('all structure knowledge, micro lessons, references and animation phases have both translations', () => {
  const content = collectLearningContent();
  assert.ok(content.length > 900);
  for (const text of content) {
    assert.ok(dictionary[text.trim()], `Missing translation: ${text}`);
    assert.doesNotMatch(translateAuthoredText(text, 0), /[\u4e00-\u9fff]/, `Chinese in English lesson: ${text}`);
  }
});
test('composed joint and muscle descriptions retain every translated sentence', () => {
  for (const [intro, suffix] of [
    ['上臂向前抬起，前臂和手随上臂一起移动。', '观察关节两侧骨骼的联动。'],
    ['肱二头肌参与屈肘，肱三头肌参与伸肘。', '观察肌腹交替缩短与舒张。'],
  ]) {
    for (const slot of [0, 1]) {
      assert.equal(translateAuthoredText(intro + ' ' + suffix, slot), dictionary[intro][slot] + (slot === 0 ? ' ' : '') + dictionary[suffix][slot]);
    }
  }
  assert.equal(translateAuthoredText('这是用户自行撰写的内容。观察关节两侧骨骼的联动。', 0), undefined);
});
test('all micro quiz questions, choices and feedback have translations',()=>{
  const content=JSON.parse(fs.readFileSync(new URL('../src/content.json',import.meta.url)));
  for(const topic of content.topics) for(const question of topic.quiz) {
    for(const text of [question.question,...question.options,question.explanation]) assert.ok(micro[text],text);
  }
});
