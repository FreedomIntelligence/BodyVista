// Keep the prompt self-contained: GitHub Pages may not expose individual structure URLs.
function structurePrompt(name, language = 'zh-CN') {
  const prompts = {
    'zh-CN': `请用中文向我介绍人体解剖结构“${name}”。请先用简短易懂的语言概括，再分点说明：1. 所在位置与相邻结构；2. 主要组成和形态特点；3. 主要功能及参与的生理过程；4. 容易混淆的结构及辨别方法；5. 一个帮助记忆的小提示。请准确区分左右侧（如名称中有标明），解释必要的专业术语，不要编造不确定的信息。最后给我一道理解检查题，先不要公布答案，等我回答后再解释。`,
    en: `Please introduce the human anatomical structure "${name}" in English. Begin with a short, accessible overview, then explain: 1. Its location and neighboring structures; 2. Its main components and shape; 3. Its functions and physiological roles; 4. Commonly confused structures and how to distinguish them; 5. One useful memory aid. Respect the specified side if the name includes left or right. Explain necessary technical terms and acknowledge uncertainty rather than inventing information. Finish with one comprehension question, withholding the answer until I respond.`,
    ja: `人体の解剖学的構造「${name}」について日本語で説明してください。まず短くわかりやすく概要を述べ、次に、1. 位置と隣接する構造、2. 主な構成と形態、3. 機能と関係する生理過程、4. 混同しやすい構造と見分け方、5. 覚え方のヒントを説明してください。名称に左右の指定がある場合は正確に区別してください。必要な専門用語を説明し、不確かな情報は作らず不確かだと明示してください。最後に理解を確認する問題を一問出し、私が回答するまで正解は示さないでください。`,
  };
  return prompts[language] || prompts['zh-CN'];
}

export function structureChatGPTLink(name, language) {
  return `https://chatgpt.com/?prompt=${encodeURIComponent(structurePrompt(name, language))}`;
}
export function structureDeepSeekLink(name, language) {
  return `https://chat.deepseek.com/?q=${encodeURIComponent(structurePrompt(name, language))}`;
}
