import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgram,createProgramMeasure,validateProgram} from '../public/program-model.js';
import {addParticipant,updateParticipant,removeParticipant,selectParticipant,addComment,addDecision,decisionStatus,recordProgramChange,historyActionLabel} from '../public/program-collaboration.js';
import {exportProgramJson,importProgramJson,cloneProgramScenario} from '../public/program-storage.js';
import {createProgramReport,exportProgramReport} from '../public/program-report.js';
import {reportText} from '../public/report-export.js';
function sample(){let p=createProgram({id:'local',startMonth:'2026-01'});p.measures.push(createProgramMeasure('procurement'));p=addParticipant(p,{name:'Учебный автор',role:'viewer'});return selectParticipant(p,p.collaboration.participants[0].id);}
const decide=p=>addDecision(p,{revision:p.collaboration.revision,decision:'approve',note:'Только ограниченный пилот',confirmed:true});
test('manual roles grant no ACL; author snapshots survive participant edits and removal',()=>{let p=sample();const original=p.collaboration.participants[0];p=addComment(p,{scope:'measure',measureId:'procurement',text:'Проверить условия'});p=decide(p);p=updateParticipant(p,{id:original.id,name:'Новое имя',role:'owner'});p=removeParticipant(p,original.id);assert.equal(p.collaboration.comments[0].author.name,'Учебный автор');assert.equal(p.collaboration.decisions[0].author.role,'viewer');assert.equal(p.collaboration.activeParticipantId,null);assert.equal(p.collaboration.revision,1);assert.equal(p.collaboration.decisions[0].provenance,'local-manual');});
test('business edits monotonically invalidate decisions, even changed and reverted economics',()=>{const p=decide(sample()),decision=p.collaboration.decisions[0];assert.equal(decisionStatus(p,decision),'current-local');for(const edit of [n=>n.measures[0].inputs.annualSpend=12,n=>n.measures[0].inputs.startMonth=2,n=>n.measures[0].included=false,n=>n.startMonth='2026-02',n=>n.approvalRequest.requestedDecision='Запустить']){const next=structuredClone(p);edit(next);const changed=recordProgramChange(p,next);assert.equal(changed.collaboration.revision,2);assert.equal(decisionStatus(changed,decision),'stale');assert.equal(changed.collaboration.history.at(-1).revision,2);assert.deepEqual(changed.collaboration.decisions,p.collaboration.decisions);}const edited=structuredClone(p);edited.measures[0].inputs.annualSpend=12;const v2=recordProgramChange(p,edited),revert=structuredClone(v2);revert.measures[0].inputs.annualSpend=null;const v3=recordProgramChange(v2,revert);assert.equal(v3.collaboration.revision,3);assert.equal(decisionStatus(v3,decision),'stale');});
test('comments, author selection and timestamp do not make a decision stale; decision needs exact preview and confirmation',()=>{let p=sample();const original=structuredClone(p);p.updatedAt='2026-11-13T00:00:00.000Z';assert.equal(recordProgramChange(original,p).collaboration.revision,1);p=addComment(p,{scope:'program',text:'Комментарий'});assert.equal(p.collaboration.revision,1);assert.throws(()=>addDecision(p,{revision:1,decision:'approve'}));assert.throws(()=>addDecision(p,{revision:2,decision:'approve',confirmed:true}));assert.throws(()=>decide(selectParticipant(p,null)));const before=JSON.stringify(p.measures),overlap=JSON.stringify(p.overlap);p=decide(p);assert.equal(p.collaboration.revision,1);assert.equal(JSON.stringify(p.measures),before);assert.equal(JSON.stringify(p.overlap),overlap);});
test('JSON import and scenario clone mark all received claims unverified and preserve source independence',()=>{let p=decide(addComment(sample(),{scope:'program',text:'Ручной комментарий'}));const before=JSON.stringify(p);for(const copy of [importProgramJson(exportProgramJson(p)),cloneProgramScenario(p)]){assert.notEqual(copy.id,p.id);assert.equal(copy.collaboration.activeParticipantId,null);for(const key of ['participants','comments','history','decisions'])assert.ok(copy.collaboration[key].every(x=>x.provenance==='received-unverified'));assert.equal(decisionStatus(copy,copy.collaboration.decisions[0]),'received-unverified');copy.collaboration.comments[0].text='Другая копия';}assert.equal(JSON.stringify(p),before);});
test('strict local schema rejects invalid records, unknown scopes, future decisions and oversize data',()=>{const p=sample();for(const edit of [c=>c.revision=0,c=>c.activeParticipantId='missing',c=>c.historyDropped=-1,c=>c.participants[0].role='admin',c=>c.participants[0].name='',c=>c.participants[0].provenance='verified']){const n=structuredClone(p);edit(n.collaboration);assert.throws(()=>validateProgram(n));}assert.throws(()=>addComment(p,{scope:'measure',measureId:'not-a-measure',text:'bad'}));assert.throws(()=>addComment(p,{scope:'program',text:'x'.repeat(2001)}));let d=decide(p);d.collaboration.decisions[0].revision=2;assert.throws(()=>validateProgram(d));for(const [key,limit,record] of [['participants',30,p.collaboration.participants[0]],['comments',200,addComment(p,{scope:'program',text:'a'}).collaboration.comments[0]],['decisions',100,decide(p).collaboration.decisions[0]]]){const n=structuredClone(p);n.collaboration[key]=Array.from({length:limit+1},(_,i)=>({...record,id:'row-'+i}));assert.throws(()=>validateProgram(n));}});
test('bounded history explicitly counts omitted earlier records instead of breaking edits',()=>{let p=sample();for(let i=0;i<305;i++){const next=structuredClone(p);next.notes='Правка '+i;p=recordProgramChange(p,next,{at:new Date(Date.UTC(2026,0,1)+i*31000).toISOString()});}assert.equal(p.collaboration.history.length,300);assert.equal(p.collaboration.historyDropped,7);assert.equal(p.collaboration.revision,306);assert.equal(p.collaboration.history.at(-1).revision,306);});
test('collaboration report distinguishes current/manual stale and imported decisions in all formats with safe HTML',async()=>{let p=sample();p=addComment(p,{scope:'program',text:'<script>не выполнять</script>'});p=decide(p);let text=reportText(createProgramReport(p));assert.match(text,/только ручной локальной записью/);assert.match(text,/не подтверждает финансовый эффект/);const changed=structuredClone(p);changed.measures[0].inputs.annualSpend=12;p=recordProgramChange(p,changed);assert.match(reportText(createProgramReport(p)),/Устарело: содержание программы изменилось/);const imported=importProgramJson(exportProgramJson(p));text=reportText(createProgramReport(imported));assert.match(text,/Полученное решение не проверено/);assert.match(text,/получено из копии, не проверено/);for(const format of ['txt','html','pdf','docx']){const result=await exportProgramReport(imported,format);assert.ok(result.blob.size>100);if(format==='html'){const html=await result.blob.text();assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);}if(format==='txt')assert.match(await result.blob.text(),/Полученное решение не проверено/);}});

const stamp=i=>new Date(Date.UTC(2026,0,1)+i).toISOString();
function edit(p,change,options={}){const next=structuredClone(p);change(next);return recordProgramChange(p,next,{at:stamp(0),...options});}
test('100 sequential text keystrokes group display history but advance all revisions and keep decisions stale',()=>{
 let p=decide(sample()),decision=p.collaboration.decisions[0];const originalHistory=p.collaboration.history.length;
 for(let i=0;i<100;i++)p=edit(p,n=>n.measures[0].execution.notes='PRIVATE_TEXT_'+i,{at:stamp(i*100)});
 assert.equal(p.collaboration.revision,101);assert.equal(p.collaboration.history.length,originalHistory+1);assert.equal(p.collaboration.history.at(-1).revision,101);assert.doesNotMatch(p.collaboration.history.at(-1).summary,/PRIVATE_TEXT/);assert.match(p.collaboration.history.at(-1).summary,/Закупки без переплаты.*Заметки.*изменено/);assert.equal(decisionStatus(p,decision),'stale');
 p=edit(p,n=>n.measures[0].execution.notes='',{at:stamp(11000)});assert.equal(p.collaboration.revision,102);assert.equal(decisionStatus(p,decision),'stale');assert.equal(p.collaboration.history.length,originalHistory+1);
});
test('numeric grouping preserves the first value, latest value and null as unknown, never fabricated zero',()=>{
 let p=sample();p=edit(p,n=>n.measures[0].inputs.annualSpend=12);p=edit(p,n=>n.measures[0].inputs.annualSpend=120,{at:stamp(1000)});
 assert.match(p.collaboration.history.at(-1).summary,/Годовая база: нет данных → 120$/);assert.equal(p.collaboration.revision,3);
 p=edit(p,n=>n.measures[0].inputs.annualSpend=null,{at:stamp(2000)});assert.match(p.collaboration.history.at(-1).summary,/нет данных → нет данных$/);assert.equal(p.collaboration.revision,4);
 p=edit(p,n=>n.measures[0].inputs.annualSpend=0,{at:stamp(3000)});assert.match(p.collaboration.history.at(-1).summary,/нет данных → 0$/);
});
test('field, actor, interval, action and organizational events each break edit grouping',()=>{
 const base=edit(sample(),n=>n.notes='a');
 for(const options of [{at:stamp(31001)},{at:stamp(-1)},{at:stamp(1),action:'Применен AI-черновик'}]){const p=edit(base,n=>n.notes='b',options);assert.equal(p.collaboration.history.length,base.collaboration.history.length+1);}
 const anotherField=edit(base,n=>n.measures[0].execution.notes='b',{at:stamp(1)});assert.equal(anotherField.collaboration.history.length,base.collaboration.history.length+1);
 let other=addParticipant(base,{name:'Другой учебный автор',role:'editor'});other=selectParticipant(other,other.collaboration.participants.at(-1).id);const len=other.collaboration.history.length;other=edit(other,n=>n.notes='b',{at:new Date().toISOString()});assert.equal(other.collaboration.history.length,len+1);
 for(const event of [p=>addComment(p,{scope:'program',text:'Комментарий'}),p=>decide(p),p=>selectParticipant(selectParticipant(p,null),p.collaboration.activeParticipantId)]){let p=event(base);const n=p.collaboration.history.length;p=edit(p,x=>x.notes='b',{at:new Date().toISOString()});assert.equal(p.collaboration.history.length,n+1);}
});
test('registry and long text change summaries identify fields without copying private source content',()=>{
 let p=sample();p=edit(p,n=>{n.expenses.records.push({id:'private-row',period:'2026-01',article:'PRIVATE_ARTICLE',department:'PRIVATE_DEPARTMENT',supplier:'PRIVATE_SUPPLIER',amountRub:99999,source:'PRIVATE_SOURCE'});});
 const h=p.collaboration.history.at(-1);assert.match(h.summary,/Реестр расходов.*0 → 1/);assert.doesNotMatch(h.summary,/PRIVATE_|99999/);
 p=edit(p,n=>n.measures[0].execution.notes='PRIVATE_TEXT'.repeat(300),{at:stamp(1)});assert.doesNotMatch(p.collaboration.history.at(-1).summary,/PRIVATE_TEXT/);assert.ok(p.collaboration.history.at(-1).summary.length<150);
});
test('decision history uses Russian labels instead of internal enum codes',()=>{for(const [decision,label] of [['approve','Согласовано'],['changes-requested','Запрошены изменения'],['reject','Отклонено']]){const p=addDecision(sample(),{revision:1,decision,confirmed:true});assert.match(p.collaboration.history.at(-1).summary,new RegExp(label));assert.ok(!p.collaboration.history.at(-1).summary.includes(decision));}});

test('fact normalization is field-level with numeric before/after and Russian public measure titles',()=>{
 let p=sample();p.measures[0].facts[0].normalization={enabled:true,baseVolume:1,actualVolume:1,unit:'шт'};
 p=edit(p,n=>n.measures[0].facts[0].normalization.baseVolume=2);
 assert.match(p.collaboration.history.at(-1).summary,/Закупки без переплаты \/ факт месяца 1 \/ Нормализация базы \/ Базовый объем: 1 → 2$/);
 assert.doesNotMatch(p.collaboration.history.at(-1).summary,/procurement|normalization|baseVolume/);
 p=edit(p,n=>n.measures[0].facts[0].normalization.baseVolume=3,{at:stamp(1000)});assert.match(p.collaboration.history.at(-1).summary,/Базовый объем: 1 → 3$/);assert.equal(p.collaboration.revision,3);
});
test('approval, diagnostic, overlap and all fact fields have explicit Russian history labels',()=>{
 const p=sample(),cases=[
  [n=>n.approvalRequest.decisionOwner='PRIVATE_OWNER','Ответственный за решение'],
  [n=>n.approvalRequest.decisionDueDate='2026-02-01','Срок принятия решения'],
  [n=>n.approvalRequest.dataLimitations='PRIVATE_TEXT','Ограничения данных'],
  [n=>n.diagnostic.industry='trade','Диагностика / Отрасль'],
  [n=>n.diagnostic.spendAreas=['it'],'Диагностика / Структура расходов'],
  [n=>n.diagnostic.constraints=['quality'],'Диагностика / Ограничения'],
  [n=>n.diagnostic.availableData=['ledger'],'Диагностика / Доступные данные'],
  [n=>n.overlap.note='PRIVATE_TEXT','Проверка пересечений / Пояснение пересечений'],
  [n=>n.overlap.confirmed=true,'Проверка пересечений / Подтверждение'],
  [n=>n.measures[0].facts[0].baseline=1,'База расходов без изменений'],
  [n=>n.measures[0].facts[0].actualSpend=1,'Фактические расходы'],
  [n=>n.measures[0].facts[0].source='PRIVATE_SOURCE','Источник факта'],
  [n=>n.measures[0].facts[0].qualityChecked=true,'Проверка качества и сопоставимости'],
  [n=>n.measures[0].facts[0].normalization.enabled=true,'Включение нормализации'],
  [n=>n.measures[0].facts[0].normalization.actualVolume=1,'Фактический объем'],
  [n=>n.measures[0].facts[0].normalization.unit='PRIVATE_UNIT','Единица объема']
 ];
 for(const [change,label] of cases){const result=edit(p,change);assert.ok(result.collaboration.history.at(-1).summary.includes(label),label);assert.doesNotMatch(result.collaboration.history.at(-1).summary,/PRIVATE_|undefined|decisionOwner|decisionDueDate|dataLimitations|baseline|actualSpend|qualityChecked|normalization/);}
});

test('history action presentation hides only known generated paths and preserves legacy/custom labels',()=>{
 for(const path of ['notes','approvalRequest.decisionOwner','diagnostic.availableData','overlap.confirmed','expenses','measure.procurement','measure.procurement.inputs.annualSpend','measure.procurement.execution.notes','measure.procurement.facts.0.baseline','measure.procurement.facts.11.normalization.baseVolume','scenario.scenario-1.procurement.inputs.savingsPercent'])assert.equal(historyActionLabel('Изменение программы / '+path),'Изменение программы',path);
 for(const action of ['Старое действие','Мое действие / notes','Изменение программы / неизвестное','Изменение программы / measure.unknown.inputs.annualSpend','Изменение программы / measure.procurement.facts.12.baseline','Изменение программы / measure.procurement.inputs.secret','Изменение программы / notes / текст пользователя','Изменение программы'])assert.equal(historyActionLabel(action),action);
 const p=edit(sample(),n=>n.measures[0].inputs.annualSpend=12),entry=p.collaboration.history.at(-1),before=JSON.stringify(entry);assert.equal(historyActionLabel(entry.action),'Изменение программы');assert.equal(JSON.stringify(entry),before);
});
