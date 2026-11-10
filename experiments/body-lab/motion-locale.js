import { staticStrings } from "./motion-locale-static.js";
import { dataStrings, translateAnatomy } from "./motion-locale-data.js";
import { runtimeStrings, translateRuntime } from "./motion-locale-runtime.js";
import { evidenceStrings } from "./motion-locale-evidence.js";

const dictionaries = [staticStrings, dataStrings, runtimeStrings, evidenceStrings];
const valid = lang => ["zh-CN", "en", "ja"].includes(lang);
const textRecords = new WeakMap(), attributeRecords = new WeakMap();
const attrs = ["aria-label", "title", "placeholder", "alt", "label", "data-help"];
let language = "zh-CN";

export function translateMotion(source, lang = language, depth = 0) {
  if (typeof source !== "string" || lang === "zh-CN" || !valid(lang) || depth > 8) return source;
  const key = source.trim();
  if (!key) return source;
  const index = lang === "en" ? 0 : 1;
  let translated;
  for (const dict of dictionaries) {
    if (Object.hasOwn(dict, key)) { translated = dict[key][index]; break; }
  }
  if (!translated && /\p{Script=Han}/u.test(key)) {
    const part = s => translateMotion(s, lang, depth + 1);
    translated = translateRuntime(key, lang, part) || translateAnatomy(key, lang);
    if (!translated && key.includes("\n")) translated = key.split("\n").map(part).join("\n");
  }
  return translated ? source.replace(key, () => translated) : source;
}

// Keep the authored text so a language switch can update the same DOM in place.
// Identifiers, input values, cached motion data and numerical results stay in their native form.
function paint(record, current, write) {
  const source = record?.output === current ? record.source : current;
  const output = translateMotion(source);
  if (output !== current) write(output);
  return source === output ? null : {source, output};
}

export function sourceText(element) {
  if (!element) return "";
  if (element.nodeType === 3) {
    const record = textRecords.get(element);
    return record?.output === element.data ? record.source : element.data;
  }
  return Array.from(element.childNodes, sourceText).join("");
}

export function sourceAttribute(element, name) {
  const value = element.getAttribute(name);
  const record = attributeRecords.get(element)?.[name];
  return record && record.output === value ? record.source : value;
}

function paintNode(node) {
  if (node.nodeType === 3) {
    const rec = paint(textRecords.get(node), node.data, value => {node.data = value;});
    if (rec) textRecords.set(node, rec); else textRecords.delete(node);
    return;
  }
  if (node.nodeType !== 1) return;
  for (const attr of attrs) {
    if (!node.hasAttribute(attr)) continue;
    let records = attributeRecords.get(node);
    const rec = paint(records?.[attr], node.getAttribute(attr), value => node.setAttribute(attr, value));
    if (rec) {
      if (!records) attributeRecords.set(node, records = {});
      records[attr] = rec;
    } else if (records) delete records[attr];
  }
}

function paintTree(root) {
  if (!root.isConnected || (root.parentElement?.closest("script,style,textarea,code,pre")) ||
      root.matches?.("script,style,textarea,code,pre")) return;
  paintNode(root);
  if (root.nodeType !== 1) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.matches?.("script,style,textarea,code,pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  while (walker.nextNode()) paintNode(walker.currentNode);
}

export function startMotionLocale() {
  let pref;
  try {pref = localStorage.getItem("atlas-language");} catch { /* Browser storage can be disabled. */ }
  const query = new URL(location.href).searchParams.get("lang");
  language = valid(query) ? query : valid(pref) ? pref : "zh-CN";
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "childList") for (const node of record.addedNodes) paintTree(node);
      else if (record.type === "attributes") paintNode(record.target);
      else paintTree(record.target);
    }
  });
  function apply() {
    observer.disconnect();
    document.documentElement.lang = language;
    paintTree(document.documentElement);
    for (const link of document.querySelectorAll('a[href*="muscle-review.html"]')) {
      const url = new URL(link.href);
      url.searchParams.set("lang", language);
      link.href = url.href;
    }
    const local = document.querySelector('#publicDesign a[href^="http://127.0.0.1:4192"]');
    if (local) {
      const url = new URL(local.href); url.searchParams.set("lang", language); local.href = url.href;
    }
    const guide = document.getElementById("motionSetupGuide");
    if (guide) guide.href = "https://github.com/FreedomIntelligence/BodyVista/blob/v1.2.3/docs/" +
      (language === "zh-CN" ? "OFFLINE_MOTION.md" : `OFFLINE_MOTION.${language}.md`);
    if (language !== "zh-CN") observer.observe(document.documentElement, {
      subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:attrs
    });
  }
  apply();
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.data?.type !== "bodyvista:language" || !valid(event.data.lang)) return;
    if (event.origin !== location.origin &&
        !(location.origin === "https://freedomintelligence.github.io" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(event.origin))) return;
    if (language === event.data.lang) return;
    language = event.data.lang;
    apply();
    document.dispatchEvent(new Event("motion:language"));
  });
  if (window.parent !== window) {
    // A slow module import can finish after the iframe load event.
    window.parent.postMessage({type: "bodyvista:language-ready"}, document.referrer ? new URL(document.referrer).origin : "*");
  }
}
