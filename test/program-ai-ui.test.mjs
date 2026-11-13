import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createProgramAiController,createAiRequestGuard} from '../public/program-ai-ui.js';
import {createProgramAiTransport} from '../public/program-ai-transport.js';
import {createProgram,createProgramMeasure} from '../public/program-model.js';
const source=await readFile(new URL('../public/program-ai-ui.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/program-p3-styles.css',import.meta.url),'utf8');

function dom(){
 const ids=new Map();
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.classList={add(){}};this.value='';this.checked=false;this.disabled=false;this.textContent='';}
  set id(value){this._id=value;ids.set(value,this);}get id(){return this._id;}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  async fire(type){for(const fn of this.listeners[type]||[])await fn({target:this});}
 }
 const document={createElement:tag=>new Element(tag)};
 return {document,ids,root:new Element('div'),find(root,text){if(root.textContent===text)return root;for(const n of root.children){const found=this.find(n,text);if(found)return found;}}};
}
function harness(requestOverride){
 const d=dom();const before=globalThis.document;globalThis.document=d.document;
 let program=createProgram({id:'qa-program'}),revision=0,valid=true,available=true,calls=[],resolver;
 program.measures.push(createProgramMeasure('procurement'));
 const controller=createProgramAiController({getProgram:()=>program,getRevision:()=>revision,mutate:fn=>{fn(program);revision++;controller.invalidate();return true;},canNavigate:()=>valid,announce:()=>{},getAiAvailability:()=>({enabled:available,label:'Local QA',temperature:0}),requestAi:requestOverride||((payload,options)=>{calls.push({payload,options});return new Promise(resolve=>{resolver=resolve;});})});
 controller.mount(d.root);
 return {d,controller,calls,get program(){return program;},get revision(){return revision;},setValid:v=>{valid=v;},setAvailable:v=>{available=v;controller.refreshAvailability();},switchProgram(){program=createProgram({id:'other-program'});program.measures.push(createProgramMeasure('procurement'));revision++;controller.invalidate();},change(){revision++;controller.invalidate();},resolve:v=>resolver(v),cleanup(){controller.destroy();globalThis.document=before;},async select(){const measure=d.ids.get('pm-ai-measure');measure.value='procurement';await measure.fire('change');const task=d.ids.get('pm-ai-task');task.value='pilot';await task.fire('change');await d.find(d.root,'Подготовить предпросмотр контекста').fire('click');},async consent(){const input=d.ids.get('pm-ai-consent');input.checked=true;await input.fire('change');},async readyResponse(content='Тестовый план пилота'){await this.select();await this.consent();const pending=d.ids.get('pm-ai-send').fire('click');this.resolve({kind:'ai_advice',content});await pending;}};
}

test('request guard cancels previous work even when provider ignores cancellation',()=>{
 const gate=createAiRequestGuard(),first=gate.begin(),second=gate.begin();assert.equal(first.signal.aborted,true);assert.equal(gate.isCurrent(first),false);assert.equal(gate.isCurrent(second),true);gate.cancel();assert.equal(gate.isCurrent(second),false);
});
test('preview and separate consent are mandatory; transport receives only snapshot request',async()=>{
 const h=harness();try{await h.select();await h.d.ids.get('pm-ai-send').fire('click');assert.equal(h.calls.length,0);await h.consent();const pending=h.d.ids.get('pm-ai-send').fire('click');assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.consent,true);assert.ok(h.calls[0].options.signal);assert.deepEqual(Object.keys(h.calls[0].payload).sort(),['context','messages']);h.resolve({kind:'ai_advice',content:'Учебный черновик'});await pending;assert.equal(h.d.ids.get('pm-ai-draft').value,'Учебный черновик');}finally{h.cleanup();}
});
test('switching programs or cancelling rejects late AI and clears consent/draft',async()=>{
 for(const action of ['switch','cancel','revision']){const h=harness();try{await h.select();await h.consent();const pending=h.d.ids.get('pm-ai-send').fire('click');if(action==='switch')h.switchProgram();else if(action==='revision')h.change();else await h.d.ids.get('pm-ai-cancel').fire('click');assert.equal(h.calls[0].options.signal.aborted,true);h.resolve({kind:'ai_advice',content:'Устаревший ответ'});await pending;assert.equal(h.d.ids.get('pm-ai-draft').value,'');assert.equal(h.d.ids.get('pm-ai-consent').checked,false);assert.equal(h.d.ids.get('pm-ai-response').children.length,0);}finally{h.cleanup();}}
});
test('storage conflict/raw invalid guard rejects reply and application',async()=>{
 const h=harness();try{await h.select();await h.consent();const pending=h.d.ids.get('pm-ai-send').fire('click');h.setValid(false);h.resolve({kind:'ai_advice',content:'Не применять'});await pending;assert.equal(h.d.ids.get('pm-ai-draft').value,'');assert.equal(h.program.measures[0].execution.notes,'');}finally{h.cleanup();}
});
test('only reviewed confirmed text is applied; editing draft invalidates confirmation',async()=>{
 const h=harness();try{const money=JSON.stringify({inputs:h.program.measures[0].inputs,facts:h.program.measures[0].facts,overlap:h.program.overlap});await h.readyResponse('<img src=x onerror=alert(1)> Текст');const target=h.d.ids.get('pm-ai-target');target.value='notes';await target.fire('change');await h.d.ids.get('pm-ai-review').fire('click');assert.equal(h.d.ids.get('pm-ai-apply').disabled,true);const confirm=h.d.ids.get('pm-ai-apply-confirm');confirm.checked=true;await confirm.fire('change');const draft=h.d.ids.get('pm-ai-draft');draft.value='Проверенный текст';await draft.fire('input');assert.equal(confirm.checked,false);await h.d.ids.get('pm-ai-apply').fire('click');assert.equal(h.program.measures[0].execution.notes,'');await h.d.ids.get('pm-ai-review').fire('click');confirm.checked=true;await confirm.fire('change');await h.d.ids.get('pm-ai-apply').fire('click');assert.equal(h.program.measures[0].execution.notes,'Проверенный текст');assert.equal(JSON.stringify({inputs:h.program.measures[0].inputs,facts:h.program.measures[0].facts,overlap:h.program.overlap}),money);}finally{h.cleanup();}
});
test('oversized AI reply is displayed but never truncated into an applicable draft',async()=>{
 const h=harness();try{await h.readyResponse('А'.repeat(4500));assert.equal(h.d.ids.get('pm-ai-draft').value,'');assert.equal(h.d.ids.get('pm-ai-review').disabled,true);}finally{h.cleanup();}
});
test('context UI has no raw HTML, storage, endpoint or direct transport access',()=>{
 assert.doesNotMatch(source,/\.innerHTML\s*=|insertAdjacentHTML|\bfetch\s*\(|localStorage|sessionStorage|sendBeacon|XMLHttpRequest|\beval\s*\(/);
 assert.match(source,/n\.textContent=text/);assert.match(source,/n\.tabIndex=0/);
 assert.match(source,/consent:true/);
 assert.match(css,/font-size:16px/);assert.match(css,/min-height:48px/);assert.match(css,/overflow-wrap:anywhere/);assert.match(css,/@media\(max-width:420px\)/);
});

 test('controller and real transport agree on explicit consent before backend call',async()=>{
 let sent=null;
 const transport=createProgramAiTransport({apiBase:'https://example.test/api/',getConfig:()=>({enabled:true,requiresAccessCode:false,providers:[{id:'local',label:'Local',model:'qa'}]}),getSettings:()=>({providerId:'local',temperature:0}),fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({kind:'ai_advice',content:'Интегрированный черновик'})};}});
 const h=harness(transport.requestAi);try{await h.select();await h.d.ids.get('pm-ai-send').fire('click');assert.equal(sent,null);await h.consent();await h.d.ids.get('pm-ai-send').fire('click');assert.equal(sent.consent,true);assert.equal(sent.temperature,0);assert.equal(h.d.ids.get('pm-ai-draft').value,'Интегрированный черновик');}finally{h.cleanup();}
 });
