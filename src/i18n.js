import { translateAuthoredText } from './locales/dictionary.js';
import anatomy from './locales/anatomy.json' with { type: 'json' };

export const languages = ['zh-CN', 'en', 'ja'];
const names = new Map();
const originals = new WeakMap();
const textSources = new WeakMap();
let language = 'zh-CN';
try { const saved = localStorage.getItem('atlas-language'); if (languages.includes(saved)) language = saved; } catch {}

export function getLanguage() { return language; }
export function registerNames(parts) {
  for (const part of parts) if (anatomy[part.name]) names.set(part.name, anatomy[part.name]);
}
export function partName(part, locale = language) {
  return locale === 'zh-CN' ? part.name : anatomy[part.name]?.[locale === 'en' ? 0 : 1] || t('名称未设置');
}
export function setText(element, source) {
  const text = String(source ?? '');
  textSources.set(element, text);
  element.dataset.i18nText = '';
  element.textContent = t(text);
}
export function sourceText(element) { return textSources.get(element) ?? element.textContent; }
export function formatDate(value) {
  let date = new Date(value);
  if (Number.isNaN(date.getTime()) && typeof value === 'string') {
    const match = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(上午|下午)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match) date = new Date(+match[1], +match[2]-1, +match[3], +match[5]%12 + (match[4]==='下午'?12:match[4]?0:+match[5]>=12?12:0), +match[6], +(match[7]||0));
  }
  return Number.isNaN(date.getTime()) ? String(value).replace(/上午/g,'AM').replace(/下午/g,'PM') : new Intl.DateTimeFormat(language, {dateStyle:'medium', timeStyle:'short'}).format(date);
}
export function t(value) {
  const text = String(value ?? '');
  if (language === 'zh-CN') return text;
  const key = text.trim(), slot = language === 'en' ? 0 : 1;
  let result = translateAuthoredText(key, slot) || names.get(key)?.[slot];
  const format = (en, ja) => language === 'en' ? en : ja;
  if (!result) {
    let match;
    if ((match = key.match(/^(.+)（已隐藏）$/)) && !/、| · /.test(match[1])) result = `${t(match[1])} ${t('（已隐藏）')}`;
    else if ((match = key.match(/^正在载入 (.+)…$/))) result = format(`Loading ${t(match[1])}…`,`${t(match[1])} を読み込み中…`);
    else if ((match = key.match(/^(.+)加载超时$/))) result = format(`Loading ${t(match[1])} timed out`,`${t(match[1])} の読み込みがタイムアウトしました`);
    else if ((match = key.match(/^(操作未完成：|模型加载失败：|所属系统：|此动态所需的结构不完整：|找不到 )(.+)$/))) {
      const detail = t(match[2]);
      result = t(match[1]) + (language === 'en' ? ' ' : '') + (detail === match[2] && !names.has(match[2]) && !translateAuthoredText(match[2], slot) && /操作未完成|模型加载失败/.test(match[1]) ? t('请重试；如仍失败，请重新加载页面。') : detail);
    }
    else if ((match = key.match(/^(\d+) \/ (\d+) 个结构$/))) result = format(`${match[1]} / ${match[2]} structures`,`${match[1]} / ${match[2]} 構造`);
    else if ((match = key.match(/^(\d+) 个(匹配结构|结构)$/))) result = format(`${match[1]} structures`,`${match[1]} 件の構造`);
    else if ((match = key.match(/^已选 (\d+)$/))) result = format(`${match[1]} selected`,`${match[1]} 件選択`);
    else if ((match = key.match(/^第 (\d+) \/ (\d+) 题 · 已答对 (\d+) 题$/))) result = format(`Question ${match[1]} / ${match[2]} · ${match[3]} correct`,`第 ${match[1]} / ${match[2]} 問・${match[3]} 問正解`);
    else if ((match = key.match(/^答对 (\d+) \/ (\d+) 题$/))) result = format(`${match[1]} / ${match[2]} correct`,`${match[1]} / ${match[2]} 問正解`);
    else if ((match = key.match(/^(减少|增加|筛选)(.+)$/))) result = format(`${{减少:'Decrease',增加:'Increase',筛选:'Filter'}[match[1]]} ${t(match[2])}`,`${t(match[2])}${{减少:'を減らす',增加:'を増やす',筛选:'で絞り込む'}[match[1]]}`);
    else if ((match = key.match(/^(.+)：(隐藏|轮廓|半透明|实体)$/))) result = `${t(match[1])}: ${t(match[2])}`;
    else if ((match = key.match(/^(找到：|✓ |已添加 |找到了：)(.+)$/))) result = format(`${{'找到：':'Find: ','✓ ':'✓ ','已添加 ':'Added: ','找到了：':'Found: '}[match[1]]}${t(match[2])}`,`${{'找到：':'探す：','✓ ':'✓ ','已添加 ':'追加：','找到了：':'発見：'}[match[1]]}${t(match[2])}`);
    else if ((match = key.match(/^(.+) · 观察笔记$/))) result = `${t(match[1])} · ${t('观察笔记')}`;
    else if ((match = key.match(/^(.*)% 全身高度$/))) result = format(`${match[1]}% of body height`, `全身高の ${match[1]}%`);
    else if ((match = key.match(/^这是(.+)，继续寻找(.+)。$/))) result = format(`This is ${t(match[1])}. Keep looking for ${t(match[2])}.`,`これは ${t(match[1])} です。${t(match[2])} を探してください。`);
    else if ((match = key.match(/^(回答正确。|再记一次。)正确答案：(.+)。所属系统：(.+)。$/))) result = format(`${t(match[1])} Answer: ${t(match[2])}. System: ${t(match[3])}.`,`${t(match[1])} 正解：${t(match[2])}。系統：${t(match[3])}。`);
    if(!result && (key.startsWith('回答正确。') || key.startsWith('再记一次。'))) { const prefix = key.startsWith('回答正确。') ? '回答正确。' : '再记一次。'; result = t(prefix) + ' ' + t(key.slice(prefix.length)); }
    if (!result && /、| · /.test(key)) result = key.split(/、| · /).map(piece => t(piece)).join(format(' · ', '・'));
  }
  return result ? text.replace(key, result) : text;
}

// Retain source text for reversible language switching, including dynamically built UI.
// User-authored notes and saved view titles opt out; values and model data are never changed.
function translateValue(node, key, read, write) {
  const current = read();
  if (!current) return;
  let record = originals.get(node);
  if (!record) { record = {}; originals.set(node, record); }
  if (!record[key] || current !== record[key].rendered) record[key] = { source:current, rendered:current };
  const translated = t(record[key].source);
  if (current !== translated) write(translated);
  record[key].rendered = translated;
}
export function translateDOM(root = document.body) {
  const ignored = 'script,style,[data-i18n-skip]';
  for (const element of [root, ...root.querySelectorAll('[data-i18n-text]')]) {
    if (textSources.has(element) && !element.closest(ignored)) element.textContent = t(textSources.get(element));
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement?.closest(ignored + ',textarea,[data-i18n-text]')) {
      const textNode = node;
      translateValue(textNode, 'text', () => textNode.nodeValue, text => { textNode.nodeValue = text; });
    }
  }
  for (const element of [root, ...root.querySelectorAll('[aria-label],[title],[placeholder],[alt],optgroup')]) {
    if (element.closest(ignored)) continue;
    for (const key of ['aria-label','title','placeholder','label','alt']) {
      if (element.hasAttribute(key)) translateValue(element, key, () => element.getAttribute(key), value => element.setAttribute(key, value));
    }
  }
}
export function setLanguage(next) {
  if (!languages.includes(next)) return;
  language = next;
  try { localStorage.setItem('atlas-language', language); } catch {}
  document.documentElement.lang = language;
  document.getElementById('language').value = language;
  translateDOM();
  document.dispatchEvent(new CustomEvent('atlas:language'));
}
export function initLanguage() {
  document.getElementById('language').addEventListener('change', event => setLanguage(event.target.value));
  setLanguage(language);
}
