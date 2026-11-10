import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dataStrings, translateAnatomy } from '../experiments/body-lab/motion-locale-data.js';
import { translateMotion } from '../experiments/body-lab/motion-locale.js';

const lab = new URL('../experiments/body-lab/', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, lab), 'utf8'));
const languages = ['en', 'ja'];

test('live force and playback messages keep the original numbers and model identifiers', () => {
  const messages = [
    '已读取固定缓存。整段 85/85 帧通过；每帧 740/740 个肌腱张力完整。支撑与关节止挡单独列出。',
    'passed · 123 个单元', '右臂 · BIClong_r', '整段张力 4.73–10.21 N，变化 5.48 N',
    '已载入：右手2 kg哑铃弯举', '7 秒 · 85 帧均已验证', '哑铃（6）',
  ];
  for (const source of messages) {
    assert.equal(translateMotion(source, 'zh-CN'), source);
    for (const lang of languages) {
      const translated = translateMotion(source, lang);
      assert.notEqual(translated, source);
      assert.deepEqual(translated.match(/\d+(?:\.\d+)?/g), source.match(/\d+(?:\.\d+)?/g));
      if (source.includes('BIClong_r')) assert.ok(translated.includes('BIClong_r'));
      if (lang === 'en') assert.doesNotMatch(translated, /\p{Script=Han}/u);
    }
  }
});

// Git contains the scene definitions even when the optional release cache is absent.
function sourceCatalog() {
  const { fixtureSets, originals, cases } = read('showcase/scenes.json');
  const originalMotions = [
    ...read('candidates/verified-motions-20261103/catalog.json').motions,
    ...read('candidates/dumbbell-motions-20261103/catalog.json').motions,
  ];
  const fixtures = new Map(Object.entries(fixtureSets).map(([id, source]) => [
    id, read('candidates/model-repair-20261106/' + source.path).cases,
  ]));
  const extended = cases.map(motion => {
    const fixture = fixtures.get(motion.fixtureSet).find(item => item.id === motion.fixture);
    const suffix = { assisted: '由骨盆支架承托。', feet: '双脚踩地承重。' }[fixture.scene.support];
    assert.ok(suffix, motion.id);
    return { ...motion, description: motion.description + '。' + suffix };
  });
  return [...originals.map(({ id, category }) => ({
    ...originalMotions.find(item => item.id === id), category,
  })), ...extended];
}

function quantities(text) {
  const units = { '秒': 's', second: 's', seconds: 's' };
  return [...text.matchAll(/(−?\d+(?:\.\d+)?)\s*(°|kg|秒|seconds?\b)/gu)]
    .map(([, value, unit]) => value + (units[unit] || unit)).sort();
}

test('all 50 motion titles, descriptions and seven categories have English and Japanese display text', () => {
  const motions = sourceCatalog();
  assert.equal(new Set(motions.map(motion => motion.id)).size, 50);
  assert.equal(new Set(motions.map(motion => motion.category)).size, 7);
  for (const motion of motions) {
    for (const [slot, lang] of languages.entries()) {
      for (const key of ['label', 'description', 'category']) {
        const source = motion[key];
        const translated = dataStrings[source]?.[slot];
        assert.ok(translated?.trim(), `${motion.id}: ${lang} ${key}`);
        assert.equal(translateAnatomy(source, lang), translated);
        if (lang === 'en') assert.doesNotMatch(translated, /\p{Script=Han}/u);
        if (key === 'description') {
          assert.notEqual(source, translated);
          assert.deepEqual(quantities(translated), quantities(source), `${motion.id}: ${lang}`);
          if (source.includes('由骨盆支架承托')) {
            assert.match(translated, lang === 'en' ? /frame supports the body at the pelvis/i : /骨盤支持具/);
          }
          if (source.includes('双脚踩地承重')) {
            assert.match(translated, lang === 'en' ? /both feet bear weight/i : /両足を接地して体重を支え/);
          }
        }
      }
      assert.equal(translateAnatomy(motion.id, lang), undefined);
    }
  }
});

test('installed release catalog agrees with checked-in motion text', {
  skip: !existsSync(new URL('motion-cache/catalog.json', lab)),
}, () => {
  const displayFields = ({ id, label, description, category }) => [id, label, description, category];
  const source = sourceCatalog().map(displayFields).sort();
  const release = read('motion-cache/catalog.json').motions.map(displayFields).sort();
  assert.deepEqual(release, source);
});

test('atlas surfaces and joint handles are localized and native muscle IDs remain intact', () => {
  const model = read('fullbody-model-data.json');
  const surfaces = read('atlas-muscles.json').parts;
  for (const lang of languages) {
    for (const { label } of [...surfaces, ...model.bodyMetadata]) {
      assert.ok(translateAnatomy(label, lang), `${lang}: ${label}`);
    }
    for (const { name } of model.muscles) {
      assert.equal(translateAnatomy(name, lang), undefined, name);
      const label = translateMotion('左手与手指 · ' + name, lang);
      assert.ok(label.endsWith(' · ' + name));
      assert.ok(!label.startsWith('左手与手指'));
    }
  }
  assert.equal(translateAnatomy('右第 4 肋 · X 轴', 'en'), 'Right rib 4 · X axis');
  assert.equal(translateAnatomy('右第 4 肋 · X 轴', 'ja'), '右第4肋骨 · X軸');
  assert.equal(translateAnatomy('左食指远端指间 · 屈伸', 'ja'), '左示指遠位指節間関節 · 屈伸');
  assert.equal(translateAnatomy('右腕屈伸控制坐标', 'en'), 'Right wrist flexion–extension control coordinate');
  assert.equal(translateAnatomy('T12–L1 · 旋转', 'ja'), 'T12–L1 · 回旋');
  assert.equal(translateAnatomy('BIClong_r', 'en'), undefined);
  assert.equal(translateAnatomy('User exercise 02', 'ja'), undefined);
});
