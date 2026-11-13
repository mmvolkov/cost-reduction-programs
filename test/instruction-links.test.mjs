import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instructionLink } from '../public/instruction-links.js';

const base='https://docs.google.com/document/d/1diULCCIVJVuJsMt_yMYCfhMsmFJcEpv4kYd161N29zI/edit?tab=t.0#heading=';
test('contextual help creates fresh safe links to the four approved headings without action handlers',()=>{
  const old=globalThis.document;
  globalThis.document={createElement:tag=>({tag,attributes:{},setAttribute(key,value){this.attributes[key]=value;}})};
  try{
    for(const [section,heading] of Object.entries({measures:'h.zcqmzhmv6a3p',approval:'h.kb73ptor3kau',json:'h.z6pzwfq2opv3',facts:'h.zfrpcwgw9dmg'})){
      const link=instructionLink(section),again=instructionLink(section);
      assert.notEqual(link,again);assert.equal(link.tag,'a');assert.equal(link.href,base+heading);
      assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
      assert.ok(link.attributes['aria-label'].startsWith(link.textContent.replace(' ↗','')));
      assert.match(link.attributes['aria-label'],/новой вкладке/);assert.equal(link.onclick,undefined);
    }
    assert.throws(()=>instructionLink('__proto__'),/Неизвестный раздел/);
  }finally{globalThis.document=old;}
});

test('library contextual help matches the measure heading and preserves the general Help section',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const library=html.match(/<section[^>]*id="measures"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  const link=library?.match(/<a class="context-help"([^>]+)>/)?.[1];assert.ok(link);
  for(const attr of [`href="${base}h.zcqmzhmv6a3p"`,'target="_blank"','rel="noopener noreferrer"','aria-label="Как выбрать меры. Откроется в новой вкладке."'])assert.ok(link.includes(attr),attr);
  assert.match(html,/id="help"/);
});
