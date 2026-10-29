import test from 'node:test';
import assert from 'node:assert/strict';
import {structureChatGPTLink,structureDeepSeekLink} from '../src/chatgpt-link.js';

test('structure prompts preserve names and URL-sensitive characters in all languages',()=>{
  for(const [language,name,marker] of [['zh-CN','左心室 & 主动脉','请用中文'],['en','Left ventricle & aorta','in English'],['ja','左心室 & 大動脈','日本語']]){
    const url=new URL(structureChatGPTLink(name,language));
    assert.equal(url.origin,'https://chatgpt.com');
    assert.deepEqual([...url.searchParams.keys()],['prompt']);
    assert.ok(url.searchParams.get('prompt').includes(name));
    assert.ok(url.searchParams.get('prompt').includes(marker));
  }
});

test('DeepSeek uses q with the same localized prompt as ChatGPT',()=>{
  for(const language of ['zh-CN','en','ja']){
    const gpt=new URL(structureChatGPTLink('Left & right / 左右',language));
    const deepseek=new URL(structureDeepSeekLink('Left & right / 左右',language));
    assert.equal(deepseek.origin,'https://chat.deepseek.com');
    assert.deepEqual([...deepseek.searchParams.keys()],['q']);
    assert.equal(deepseek.searchParams.get('q'),gpt.searchParams.get('prompt'));
  }
});
