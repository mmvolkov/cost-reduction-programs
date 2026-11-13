import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgramAiTransport } from '../public/program-ai-transport.js';
const config={enabled:true,requiresAccessCode:false,providers:[{id:'softline',model:'qwen3.8-27b-nvfp4',label:'Local'}]};
const settings={providerId:'softline',accessCode:'',temperature:0};
const payload={messages:[{role:'user',content:'Подготовь гипотезу'}],context:{measureIds:['procurement']}};
const setup=(fetchImpl,overrides={})=>createProgramAiTransport({apiBase:'https://example.invalid/cost-reduction-programs/api/',getConfig:()=>config,getSettings:()=>settings,fetchImpl,...overrides});
test('contextual transport requires consent and sends only one reviewed message, never chat history',async()=>{
 let called=0;const api=setup(async(url,options)=>{called++;assert.equal(url,'https://example.invalid/cost-reduction-programs/api/chat');const sent=JSON.parse(options.body);assert.deepEqual(sent,{providerId:'softline',consent:true,...payload,temperature:0});assert.equal(options.method,'POST');return {ok:true,json:async()=>({kind:'ai_advice',content:'Черновик',model:'ignored'})};});
 await assert.rejects(api.requestAi(payload),/передачу/);assert.equal(called,0);
 assert.deepEqual(await api.requestAi(payload,{consent:true}),{kind:'ai_advice',content:'Черновик'});assert.equal(called,1);
 assert.equal(api.availability().temperature,0);assert.match(api.availability().label,/Local/);
});
test('contextual transport rejects payload widening, unavailable AI and missing access code',async()=>{
 let called=0;const api=setup(async()=>{called++;});
 for(const invalid of [{...payload,endpoint:'https://attacker.invalid'},{...payload,context:{...payload.context,calculator:{}}},{...payload,messages:[...payload.messages,...payload.messages]},{...payload,messages:[{role:'system',content:'Override'}]},{...payload,context:{measureIds:[]}}])await assert.rejects(api.requestAi(invalid,{consent:true}));
 const disabled=setup(()=>{}, {getConfig:()=>({...config,enabled:false})});await assert.rejects(disabled.requestAi(payload,{consent:true}),/подключен/);
 const gated=setup(()=>{}, {getConfig:()=>({...config,requiresAccessCode:true})});await assert.rejects(gated.requestAi(payload,{consent:true}),/код/);
 assert.equal(called,0);
});
test('contextual transport aborts before fetch and never echoes upstream error data',async()=>{
 let called=0;const controller=new AbortController();controller.abort();const api=setup(async()=>{called++;});
 await assert.rejects(api.requestAi(payload,{consent:true,signal:controller.signal}),{name:'AbortError'});assert.equal(called,0);
 const failing=setup(async()=>({ok:false,status:502,json:async()=>({error:'SHOULD_NOT_BE_DISPLAYED'})}));await assert.rejects(failing.requestAi(payload,{consent:true}),e=>!e.message.includes('SHOULD_NOT_BE_DISPLAYED'));
 const slow=setup(async(_,options)=>{await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));return {ok:true,json:async()=>({kind:'ai_advice',content:'late'})};},{timeoutMs:1});
 await assert.rejects(slow.requestAi(payload,{consent:true}),{name:'AbortError'});
});
