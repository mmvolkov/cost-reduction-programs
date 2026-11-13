import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const help=html.match(/<section\b[^>]*\bid="help"[^>]*>([\s\S]*?)<\/section>/)?.[1];

test('help is a labeled section with two clear document cards and workflow coverage',()=>{
  assert.ok(help);
  for(const tag of ['header','footer']){const block=html.match(new RegExp('<'+tag+'\\b[\\s\\S]*?</'+tag+'>'))?.[0];assert.ok(block?.includes('href="#help"'),tag);}
  assert.match(html,/<section[^>]*id="help"[^>]*aria-labelledby="help-title"/);
  assert.match(help,/<h2 id="help-title">Помощь<\/h2>/);
  assert.equal([...help.matchAll(/<article class="help-card">/g)].length,2);
  for(const label of ['Инструкция пользователя','Google Docs','Презентация со скриншотами','PPTX','Выбор мер','согласование','JSON','план-факт'])assert.ok(help.includes(label),label);
  assert.match(help,/Материалы открываются в новой вкладке Google/);
});

test('help links use the exact approved URLs, separate tabs and safe opener/referrer attributes',()=>{
  const links=[...help.matchAll(/<a\b([^>]+)>/g)].map(([,attrs])=>Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,value])));
  assert.deepEqual(links.map(x=>x.href),[
    'https://docs.google.com/document/d/1diULCCIVJVuJsMt_yMYCfhMsmFJcEpv4kYd161N29zI/edit',
    'https://docs.google.com/presentation/d/1-ZOeIR2o2-YCPBxuI9TpE-6PsOng6oCy/edit'
  ]);
  for(const link of links){assert.equal(link.target,'_blank');assert.deepEqual(new Set(link.rel.split(/\s+/)),new Set(['noopener','noreferrer']));assert.equal(link['aria-describedby'],'help-external-note');}
  assert.doesNotMatch(help,/<iframe|<script|\bdownload\s*=/i);
});

