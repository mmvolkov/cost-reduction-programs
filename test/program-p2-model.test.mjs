import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram,createProgramMeasure,validateProgram,migrateProgramV1,calculateProgram } from '../public/program-model.js';
import { diagnosticOptions,priorityOptions,diagnoseProgram,addDiagnosticMeasures,createComparisonScenarios,updateComparisonScenario,compareProgramScenarios,rankProgramMeasures } from '../public/program-p2-model.js';
import { validateExpenses,MAX_EXPENSE_RECORDS } from '../public/program-p2-schema.js';
const sample=()=>{const p=createProgram({id:'sample',startMonth:'2026-01'});const m=createProgramMeasure('procurement');m.inputs={annualSpend:12,savingsPercent:10,implementationCost:.2,monthlyCost:.02,rampMonths:0,startMonth:1};p.measures.push(m);return p;};
const v1=p=>{const old=structuredClone(p);delete old.collaboration;delete old.approvalRequest;delete old.diagnostic;delete old.expenses;delete old.scenarios;old.measures.forEach(m=>delete m.priority);return old;};
const expense=()=>({id:'expense-1',period:'2026-01',article:'Материалы',department:'Цех',supplier:'Учебный поставщик',amountRub:1000,source:'Искусственный пример'});
test('P2 defaults add no invented diagnosis, financial inputs, confidence or evidence',()=>{
 const p=createProgram(),m=createProgramMeasure('procurement');assert.deepEqual(p.diagnostic,{industry:'',spendAreas:[],constraints:[],availableData:[]});assert.deepEqual(p.expenses,{records:[]});assert.deepEqual(p.scenarios,[]);assert.deepEqual(m.priority,{complexity:'unknown',risk:'unknown',evidenceType:'unknown',sourceComment:''});assert.ok(Object.values(m.inputs).filter(v=>v===null).length===5);assert.doesNotMatch(JSON.stringify(p),/confidence|apiKey/);
});
test('strict migration retains every P1 field and confirmed fact without mutating input',()=>{
 const p=sample();p.overlap={confirmed:true,note:'Проверено'};p.measures[0].facts[0]={baseline:1,actualSpend:.8,implementationCost:0,monthlyCost:0,source:'Источник',qualityChecked:true,normalization:{enabled:false,baseVolume:null,actualVolume:null,unit:''},confirmed:true};const old=v1(p),before=JSON.stringify(old),m=migrateProgramV1(old);assert.equal(JSON.stringify(old),before);assert.deepEqual(v1(m),old);assert.equal(m.measures[0].facts[0].confirmed,true);assert.equal(m.overlap.confirmed,true);assert.deepEqual(m.expenses,{records:[]});assert.deepEqual(calculateProgram(m).firstYearNet,calculateProgram(p).firstYearNet);
 assert.throws(()=>migrateProgramV1({...old,diagnostic:p.diagnostic}));assert.throws(()=>migrateProgramV1({...old,unknown:1}));assert.throws(()=>validateProgram(old));
});
test('diagnostic rules explain 3-5 recommendations and missing data with constraints for every industry',()=>{
 for(const industry of ['',...diagnosticOptions.industries.map(x=>x.id)]){
 const d={industry,spendAreas:['transport','it'],constraints:['quality','cash'],availableData:['ledger']};const result=diagnoseProgram(d);assert.ok(result.recommendations.length>=3&&result.recommendations.length<=5);assert.equal(new Set(result.recommendations.map(x=>x.id)).size,result.recommendations.length);assert.ok(result.recommendations.some(x=>x.id==='logistics'));for(const r of result.recommendations){assert.ok(r.reasons.length>0);assert.ok(r.qualityConstraints.some(x=>x.includes('Качество')));assert.ok(r.qualityConstraints.some(x=>x.includes('вложения')));assert.ok(r.missingData.every(x=>!x.includes('Реестр расходов')));}assert.doesNotMatch(JSON.stringify(result),/confidence|percent|savingsPercent/);assert.ok(result.limitations.length>0);
 }
});
test('diagnostic unknown and duplicated options fail; selected additions preserve existing facts and blank money',()=>{
 const p=sample(),before=JSON.stringify(p);p.measures[0].facts[0].source='Сохранить';const expected=structuredClone(p);const next=addDiagnosticMeasures(p,['procurement','logistics','logistics']);assert.equal(next.measures.length,2);assert.deepEqual(next.measures[0],expected.measures[0]);assert.equal(next.measures[1].inputs.annualSpend,null);assert.equal(next.overlap.confirmed,false);assert.deepEqual(p,expected);assert.throws(()=>addDiagnosticMeasures(p,['bogus']));assert.throws(()=>diagnoseProgram({...p.diagnostic,availableData:['ledger','ledger']}));assert.throws(()=>diagnoseProgram({...p.diagnostic,industry:'unknown'}));assert.ok(before);
});
test('two alternatives are independent snapshots with no facts or confirmations and common horizon/start',()=>{
 const p=sample();p.measures[0].facts[0].source='Private fact source';p.overlap.confirmed=true;const before=JSON.stringify(p),next=createComparisonScenarios(p);assert.equal(JSON.stringify(p),before);assert.equal(next.scenarios.length,2);assert.notEqual(next.scenarios[0].id,next.scenarios[1].id);assert.doesNotMatch(JSON.stringify(next.scenarios),/facts|confirmed|Private fact/);assert.equal(next.scenarios[0].measures[0].inputs.annualSpend,12);
 const changed=updateComparisonScenario(next,next.scenarios[0].id,'procurement',{savingsPercent:5,startMonth:4,implementationCost:.4,monthlyCost:.03});assert.equal(changed.measures[0].inputs.savingsPercent,10);assert.equal(changed.scenarios[1].measures[0].inputs.savingsPercent,10);assert.equal(next.scenarios[0].measures[0].inputs.savingsPercent,10);
 const result=compareProgramScenarios(changed);assert.equal(result.horizonMonths,12);assert.equal(result.startMonth,'2026-01');assert.equal(result.rows.length,3);assert.equal(result.rows[0].firstYearNet,calculateProgram(p).firstYearNet);assert.ok(Math.abs(result.rows[0].paybackMonths-2.5)<1e-12);assert.equal(result.rows[1].measures[0].differences.length,4);assert.equal(result.rows[2].measures[0].differences.length,0);assert.doesNotMatch(JSON.stringify(result),/Private fact/);assert.equal(result.rows[1].series[0].net,0);assert.equal(result.rows[1].series.length,12);
});
test('scenario rerun does not overwrite alternatives, facts do not influence scenario results',()=>{
 const p=createComparisonScenarios(sample()),id=p.scenarios[0].id;p.scenarios[0].name='Свой сценарий';p.scenarios[0].measures[0].inputs.savingsPercent=3;const next=createComparisonScenarios(p);assert.equal(next.scenarios[0].id,id);assert.equal(next.scenarios[0].name,'Свой сценарий');assert.equal(next.scenarios[0].measures[0].inputs.savingsPercent,3);
 const before=compareProgramScenarios(next).rows;next.measures[0].facts[0].baseline=100;next.measures[0].facts[0].actualSpend=0;next.measures[0].facts[0].implementationCost=0;next.measures[0].facts[0].monthlyCost=0;assert.deepEqual(compareProgramScenarios(next).rows,before);
 assert.throws(()=>updateComparisonScenario(next,id,'procurement',{confirmed:true}));assert.throws(()=>updateComparisonScenario(next,id,'procurement',{savingsPercent:101}));assert.throws(()=>updateComparisonScenario(next,'base','procurement',{}));
});
test('scenario incompleteness, unresolved overlaps and nonpayback remain explicit',()=>{
 let p=sample();p.measures.push(createProgramMeasure('logistics'));p=createComparisonScenarios(p);const a=compareProgramScenarios(p);assert.equal(a.rows[1].reliable,false);assert.deepEqual(a.rows[1].incompleteMeasureIds,['logistics']);assert.equal(a.rows[1].overlapResolved,false);assert.ok(a.rows[1].reasons.length>=2);
 p.scenarios[0].measures[0].inputs.monthlyCost=2;assert.equal(compareProgramScenarios(p).rows[1].paybackMonths,null);
});
test('priority comparison sorts only requested criterion with unknowns last and no synthetic score',()=>{
 const p=sample();p.measures.push(createProgramMeasure('saas'));p.measures[0].priority={complexity:'high',risk:'low',evidenceType:'pilot',sourceComment:'Учебный пилот'};const r=rankProgramMeasures(p,'net','desc');assert.equal(r.rows[0].id,'procurement');assert.equal(r.rows[1].net,null);assert.equal(r.rows[1].investment,null);assert.equal(r.rows[1].payback,null);assert.equal(r.rows[0].evidenceType,'pilot');assert.doesNotMatch(JSON.stringify(r),/confidence|score/);
 for(const direction of ['asc','desc'])assert.equal(rankProgramMeasures(p,'risk',direction).rows.at(-1).risk,'unknown');assert.throws(()=>rankProgramMeasures(p,'confidence'));assert.throws(()=>rankProgramMeasures(p,'net','unknown'));
 p.measures[0].included=false;const excluded=rankProgramMeasures(p).rows.find(x=>x.id==='procurement');assert.equal(excluded.included,false);assert.equal(excluded.net,calculateProgram(sample()).firstYearNet);assert.ok(Math.abs(excluded.payback-2.5)<1e-12);
});
test('P2 schema bounds expense rows, text, periods, refunds and strict scenario/priority shapes',()=>{
 const p=sample();p.expenses.records=[expense()];assert.equal(validateProgram(p).expenses.records[0].amountRub,1000);p.expenses.records[0].amountRub=-500;assert.equal(validateProgram(p).expenses.records[0].amountRub,-500);
 for(const patch of [{period:'2026-13'},{period:'1800-01'},{amountRub:Infinity},{amountRub:1e12+1},{article:''},{supplier:'x'.repeat(161)}])assert.throws(()=>validateExpenses({records:[{...expense(),...patch}]}));assert.throws(()=>validateExpenses({records:[expense(),expense()]}));assert.throws(()=>validateExpenses({records:Array.from({length:MAX_EXPENSE_RECORDS+1},()=>expense())}));
 p.measures[0].priority.evidenceType='90%';assert.throws(()=>validateProgram(p));p.measures[0].priority.evidenceType='estimate';p.scenarios=[{id:'s',name:'Сценарий',measures:[],facts:[]}];assert.throws(()=>validateProgram(p));assert.equal(priorityOptions.evidenceType.length,4);
});
test('scenario comparison exposes both directions of changed composition after snapshot',()=>{
 const p=createComparisonScenarios(sample());p.measures.push(createProgramMeasure('logistics'));p.scenarios[0].measures.push({id:'saas',costScope:'',included:true,inputs:{...createProgramMeasure('saas').inputs}});
 const rows=compareProgramScenarios(p).rows;
 assert.deepEqual(rows[0].compositionDifferences,[]);
 assert.deepEqual(rows[1].compositionDifferences.map(({id,change})=>({id,change})),[{id:'logistics',change:'removed'},{id:'saas',change:'added'}]);
 assert.deepEqual(rows[2].compositionDifferences.map(({id,change})=>({id,change})),[{id:'logistics',change:'removed'}]);
});
