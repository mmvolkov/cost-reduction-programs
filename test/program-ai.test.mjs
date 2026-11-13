import test from 'node:test';
import assert from 'node:assert/strict';
import { aiTasks,aiTextFields,createAiSnapshot,assertAiSnapshotCurrent,normalizeAiDraftResponse,applyAiTextDraft } from '../public/program-ai.js';
import { createProgram,createProgramMeasure,calculateProgram } from '../public/program-model.js';
import { measures } from '../public/data.js';
import { requestsCalculation } from '../public/calculation-report.js';
import { normalizeInput } from '../lib/server-security.mjs';
const sample=()=>{const p=createProgram({id:'ai-synthetic',name:'PRIVATE_PROGRAM_NAME',startMonth:'2026-01'});p.notes='PRIVATE_PROGRAM_NOTES';p.diagnostic.industry='trade';const m=createProgramMeasure('procurement');m.inputs={annualSpend:12,savingsPercent:10,implementationCost:.2,monthlyCost:.02,rampMonths:0,startMonth:1};m.costScope='Контур сырья';m.execution={owner:'PRIVATE_OWNER',dueDate:'2026-11-01',nextStep:'Сопоставить условия',successCriterion:'Сопоставимые предложения',qualityMetric:'Доля дефектов',notes:'Текст выбранной меры',status:'pilot'};m.facts[0]={baseline:1,actualSpend:.8,implementationCost:0,monthlyCost:0,source:'PRIVATE_FACT',qualityChecked:true,normalization:{enabled:false,baseVolume:null,actualVolume:null,unit:''},confirmed:true};p.overlap={confirmed:true,note:'PRIVATE_OVERLAP'};p.measures.push(m,createProgramMeasure('logistics'));p.measures[1].execution.notes='PRIVATE_OTHER_MEASURE';p.expenses.records=[{id:'test-record',period:'2026-01',article:'PRIVATE_ARTICLE',department:'PRIVATE_DEPT',supplier:'PRIVATE_SUPPLIER',amountRub:12345,source:'PRIVATE_SOURCE'}];return p;};
const snap=(p,extra={})=>createAiSnapshot(p,{measureId:'procurement',task:'pilot',revision:0,...extra});

test('AI default context never transmits program data and all task/measure prompts use existing AI route',()=>{
 for(const item of measures)for(const task of aiTasks){const p=createProgram({id:'all-public'});p.measures=[createProgramMeasure(item.id)];const s=createAiSnapshot(p,{measureId:item.id,task:task.id,revision:0});assert.equal(requestsCalculation(s.request.messages[0].content),false,item.id+' '+task.id);assert.equal(s.request.messages.length,1);assert.equal(s.request.messages[0].role,'user');assert.deepEqual(s.request.context,{measureIds:[item.id]});assert.ok(s.preview.includes(item.title));assert.ok(s.preview.includes(item.guard));assert.ok(s.request.messages[0].content.length<=6000);normalizeInput({...s.request,consent:true,providerId:'softline',temperature:0});}
 const p=sample(),before=JSON.stringify(p),s=snap(p);assert.equal(JSON.stringify(p),before);assert.doesNotMatch(JSON.stringify(s.request),/PRIVATE_|Контур сырья|Текст выбранной меры|annualSpend|facts|expenses|supplier|ai-synthetic/);assert.doesNotMatch(s.preview,/PRIVATE_|Контур сырья|Текст выбранной меры|annualSpend|facts|expenses|ai-synthetic/);
});

test('explicit text opt-in is previewed exactly and still excludes private unrelated fields and money',()=>{
 const s=snap(sample(),{includeText:true}),preview=JSON.parse(s.preview);assert.equal(preview.messages[0].content,s.request.messages[0].content);assert.deepEqual(preview.context.measureIds,s.request.context.measureIds);assert.match(s.preview,/Контур сырья/);assert.match(s.preview,/Текст выбранной меры/);assert.match(s.preview,/trade/);assert.doesNotMatch(s.preview,/PRIVATE_|annualSpend|savingsPercent|actualSpend|12345/);
 assert.equal(Object.isFrozen(s.request.messages[0]),true);assert.throws(()=>{s.request.messages[0].content='tampered';});assert.throws(()=>{s.measureId='logistics';});
});

test('snapshots reject invalid selection, unsafe options and excessive text without silent truncation',()=>{
 const p=sample();for(const extra of [{measureId:'unknown'},{task:'finance'},{includeText:'true'},{revision:-1},{revision:NaN},{revision:Infinity},{revision:1.5},{revision:undefined},{providerId:'arbitrary'}])assert.throws(()=>snap(p,extra));
 const options={measureId:'procurement',task:'pilot',revision:0};Object.defineProperty(options,'includeText',{get(){throw new Error('getter must not execute');},enumerable:true});assert.throws(()=>createAiSnapshot(p,options),/недопустимые поля/);
 p.measures[0].execution.notes='Т'.repeat(4000);p.measures[0].execution.nextStep='Т'.repeat(4000);assert.throws(()=>snap(p,{includeText:true}),/слишком длинный/);assert.doesNotThrow(()=>snap(p));
});

test('financial routing terms in optional text fail clearly rather than bypass server routing',()=>{
 for(const value of ['Не рассчитывай окупаемость','Проверить расчет','пересчитать процесс','calculate','payback','расходы 12 млн']){const p=sample();p.measures[0].execution.notes=value;assert.throws(()=>snap(p,{includeText:true}),/сервер направит его в калькулятор/);assert.doesNotThrow(()=>snap(p));}
 assert.throws(()=>normalizeAiDraftResponse({kind:'deterministic_calculation',content:'result'}),/калькулятор/);
});

test('freshness detects program switch, edits, removal, revision changes and change-then-revert',()=>{
 const p=sample(),s=snap(p);assert.equal(assertAiSnapshotCurrent(s,p,0),true);assert.throws(()=>assertAiSnapshotCurrent({...s},p,0),/Неизвестный/);
 for(const change of [n=>n.id='another-program',n=>n.measures[0].inputs.annualSpend=13,n=>n.measures[0].execution.notes='edited',n=>n.measures.pop(),n=>n.name='renamed',n=>n.updatedAt='2026-11-01T00:00:00.000Z']){const n=structuredClone(p);change(n);assert.throws(()=>assertAiSnapshotCurrent(s,n,0),/устарел/);}
 const restored=structuredClone(p);assert.throws(()=>assertAiSnapshotCurrent(s,restored,2),/устарел/);assert.throws(()=>assertAiSnapshotCurrent(s,p,-1));
});

test('approved draft changes exactly one allowlisted text field; input, money, facts and attestations stay intact',()=>{
 const p=sample(),s=snap(p),before=JSON.stringify(p),financial=calculateProgram(p);
 for(const {id:field} of aiTextFields){const text='<script>alert(1)</script> Учебный черновик; 999 млн - непроверенное утверждение';const actual=applyAiTextDraft(p,s,{revision:0,field,text,confirmed:true});const expected=structuredClone(p);expected.measures[0].execution[field]=text;assert.deepEqual(actual,expected);assert.deepEqual(calculateProgram(actual),financial);assert.equal(actual.overlap.confirmed,true);assert.equal(actual.measures[0].facts[0].confirmed,true);assert.equal(JSON.stringify(p),before);}
});

test('draft application requires separate consent and denies nontext financial or other mutations',()=>{
 const p=sample(),s=snap(p),good={revision:0,field:'notes',text:'Черновик',confirmed:true};
 for(const field of ['annualSpend','facts','confirmed','owner','status','costScope','dueDate','__proto__','constructor','execution.notes'])assert.throws(()=>applyAiTextDraft(p,s,{...good,field}));
 for(const confirmed of [false,undefined,1,'true'])assert.throws(()=>applyAiTextDraft(p,s,{...good,confirmed}));
 for(const text of ['', '  ',null,{},'x'.repeat(4001),'\u0000','\ud800'])assert.throws(()=>applyAiTextDraft(p,s,{...good,text}));
 assert.throws(()=>applyAiTextDraft(p,s,{...good,inputs:{annualSpend:100}}));assert.throws(()=>applyAiTextDraft(p,s,{...good,revision:1}),/устарел/);
});

test('model output is plain bounded prose, never deserialized or executed as a patch',()=>{
 const text='{"inputs":{"annualSpend":999},"confirmed":true}<img src=x onerror=alert(1)>';
 assert.equal(normalizeAiDraftResponse({kind:'ai_advice',content:text,model:'qwen'}),text);
 const accessor={kind:'ai_advice'};Object.defineProperty(accessor,'content',{get(){throw new Error('getter must not execute');},enumerable:true});assert.throws(()=>normalizeAiDraftResponse(accessor),/недопустимые поля/);
 assert.throws(()=>normalizeAiDraftResponse({kind:'ai_advice',content:'x',patch:{annualSpend:99}}));
 for(const content of ['', ' ',null,{},'x'.repeat(24001),'\u0000','\ud800'])assert.throws(()=>normalizeAiDraftResponse({kind:'ai_advice',content}));
 for(const response of [null,[],{}, {kind:'error',content:'x'},{kind:'deterministic_calculation',content:'x'}])assert.throws(()=>normalizeAiDraftResponse(response));
});
