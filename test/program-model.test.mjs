import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram,createProgramMeasure,createFact,validateProgram,calculateProgram,calculateActual,updateFact,confirmFact,updateMeasureInputs,setMeasureIncluded } from '../public/program-model.js';
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
function measure(id='procurement',patch={}) { const m=createProgramMeasure(id); m.inputs={annualSpend:12,savingsPercent:10,implementationCost:.2,monthlyCost:.02,rampMonths:0,startMonth:1,...patch}; return m; }
function program(ms=[measure()]) { const p=createProgram({id:'test',startMonth:'2026-01'});p.measures=ms;return p; }
function fact(patch={}) { return updateFact(createFact(),{baseline:1,actualSpend:.8,implementationCost:.1,monthlyCost:.02,...patch}); }
test('program defaults do not invent monetary parameters or duplicate quick-calculator base',()=>{
 const m=createProgramMeasure('production');assert.equal(m.inputs.annualSpend,null);assert.equal(m.inputs.savingsPercent,null);assert.equal(m.facts.length,12);assert.notEqual(m.facts[0],m.facts[1]);assert.equal(createProgram().measures.length,0);
});
test('reference calculation preserved: .76 first year, .96 steady annual, 2.5 months',()=>{ const r=calculateProgram(program());assert.equal(r.reliable,true);approx(r.firstYearNet,.76);approx(r.annualNet,.96);approx(r.paybackMonths,2.5);approx(r.series[0].net,-.12); });
test('two measures shift investment and support to own start; summed flows not averaged paybacks',()=>{
 const p=program([measure(),measure('energy',{startMonth:4,annualSpend:24,implementationCost:.6,monthlyCost:.04})]);p.overlap.confirmed=true;
 const r=calculateProgram(p);assert.equal(r.reliable,true);assert.equal(r.measures[1].series[2].gross,0);assert.equal(r.measures[1].series[2].support,0);assert.equal(r.measures[1].series[2].implementation,0);
 approx(r.series[3].implementation,.6);approx(r.series[3].support,.06);approx(r.firstYearNet,1.6);approx(r.paybackMonths,3+(.56/.24));assert.notEqual(r.paybackMonths,(2.5+3.75)/2);
});
test('later launch can undo early recovery; portfolio uses final recovery',()=>{const p=program([measure('energy',{annualSpend:12,savingsPercent:100,implementationCost:0,monthlyCost:0}),measure('procurement',{annualSpend:0,savingsPercent:0,implementationCost:20,monthlyCost:0,startMonth:12})]);p.overlap.confirmed=true;const r=calculateProgram(p);approx(r.paybackMonths,20);approx(r.firstYearNet,-8);});
test('empty numbers are missing, explicit zero is complete, negative input rejected',()=>{const p=program();p.measures[0].inputs.annualSpend=null;assert.equal(calculateProgram(p).reliable,false);assert.deepEqual(calculateProgram(p).incompleteMeasureIds,['procurement']);p.measures[0].inputs.annualSpend='';assert.throws(()=>validateProgram(p));p.measures[0].inputs.annualSpend=-1;assert.throws(()=>validateProgram(p));p.measures[0]=measure('procurement',{annualSpend:0,savingsPercent:0,implementationCost:0,monthlyCost:0});const r=calculateProgram(p);assert.equal(r.reliable,true);assert.equal(r.firstYearNet,0);assert.equal(r.paybackMonths,null);});
test('negative effects remain negative and do not claim payback',()=>{const r=calculateProgram(program([measure('procurement',{annualSpend:0})]));approx(r.firstYearNet,-.44);assert.equal(r.paybackMonths,null);});
test('unresolved overlap blocks reliable plan and fact even with filled inputs',()=>{const p=program([measure(),measure('energy')]);p.measures[0].facts[0]=fact();const r=calculateProgram(p);assert.equal(r.reliable,false);assert.equal(r.actual.reliable,false);assert.equal(r.overlapResolved,false);assert.ok(r.reasons.some(x=>/двойного/.test(x)));p.overlap.confirmed=true;assert.equal(calculateProgram(p).actual.reliable,true);});
test('excluded incomplete measures do not enter aggregates or overlap',()=>{const p=program([measure(),createProgramMeasure('energy')]);p.measures[1].included=false;const r=calculateProgram(p);assert.equal(r.reliable,true);approx(r.firstYearNet,.76);});
test('input and inclusion changes reset overlap and preserve original',()=>{const p=program([measure(),measure('energy')]);p.overlap.confirmed=true;const next=updateMeasureInputs(p,'energy',{savingsPercent:5});assert.equal(next.overlap.confirmed,false);assert.equal(p.overlap.confirmed,true);assert.equal(setMeasureIncluded(p,'energy',false).overlap.confirmed,false);assert.equal(updateMeasureInputs(p,'energy',{savingsPercent:10}).overlap.confirmed,true);});
test('ramp uses existing midpoint monthly arithmetic, no prelaunch cash flows',()=>{const r=calculateProgram(program([measure('energy',{startMonth:3,rampMonths:4})]));assert.equal(r.series[0].net,0);assert.equal(r.series[1].net,0);approx(r.series[2].gross,.0125);approx(r.series[2].net,-.2075);approx(r.measures[0].series[14].gross,.1);});
test('payback horizon includes exact boundary and rejects later recovery',()=>{assert.equal(calculateProgram(program([measure('energy',{annualSpend:12,savingsPercent:100,implementationCost:120,monthlyCost:0})])).paybackMonths,120);assert.equal(calculateProgram(program([measure('energy',{annualSpend:12,savingsPercent:100,implementationCost:121,monthlyCost:0})])).paybackMonths,null);});
test('facts subtract implementation and support exactly once; negative facts preserved',()=>{approx(calculateActual(fact()).net,.08);approx(calculateActual(fact({actualSpend:2})).net,-1.12);});
test('missing facts are not zeros; explicitly entered all-zero fact is complete',()=>{assert.equal(calculateActual(createFact()).complete,false);assert.equal(calculateActual(createFact()).net,null);const f=fact({baseline:0,actualSpend:0,implementationCost:0,monthlyCost:0});assert.equal(calculateActual(f).complete,true);assert.equal(calculateActual(f).net,0);});
test('normalization uses baseline/baseVolume*actualVolume and needs units/positive base volume',()=>{const f=fact({baseline:10,actualSpend:12,implementationCost:1,monthlyCost:.5,normalization:{enabled:true,baseVolume:100,actualVolume:150,unit:'тонна'}});approx(calculateActual(f).comparableBaseline,15);approx(calculateActual(f).net,1.5);assert.throws(()=>updateFact(f,{normalization:{baseVolume:0}}));assert.equal(calculateActual(updateFact(f,{normalization:{unit:''}})).complete,false);assert.equal(calculateActual(updateFact(f,{normalization:{actualVolume:0}})).net,-13.5);});
test('confirmation needs explicit action, complete values, source and quality check',()=>{assert.throws(()=>confirmFact(fact()));assert.throws(()=>confirmFact(fact({source:'Счёт №1'})));const f=confirmFact(fact({source:'Счёт №1',qualityChecked:true}));assert.equal(f.confirmed,true);assert.equal(calculateActual(f).confirmed,true);assert.throws(()=>updateFact(f,{confirmed:true}));assert.throws(()=>confirmFact({...createFact(),source:'x',qualityChecked:true}));});
test('any confirmed data change resets confirmation, no-op does not',()=>{const f=confirmFact(fact({source:'Счёт №1',qualityChecked:true}));assert.equal(updateFact(f,{actualSpend:.7}).confirmed,false);assert.equal(updateFact(f,{source:'Другой счёт'}).confirmed,false);assert.equal(updateFact(f,{normalization:{unit:'шт'}}).confirmed,false);assert.equal(updateFact(f,{actualSpend:.8}).confirmed,true);});
test('execution status never confirms fact',()=>{const p=program();p.measures[0].execution.status='confirmation';p.measures[0].facts[0]=fact({source:'Счёт',qualityChecked:true});assert.equal(calculateProgram(p).actual.confirmedCells,0);});
test('plan comparison includes filled cells only, annual plan stays separate',()=>{const p=program([measure(),measure('energy',{startMonth:2})]);p.overlap.confirmed=true;p.measures[0].facts[0]=fact();p.measures[0].facts[2]=fact({baseline:0,actualSpend:0,implementationCost:0,monthlyCost:0});const r=calculateProgram(p);assert.equal(r.actual.filledCells,2);assert.equal(r.actual.completeMonths,0);approx(r.actual.matchedPlan,-.04);approx(r.actual.net,.08);approx(r.actual.variance,.12);approx(r.firstYearNet,1.44);});
test('fact totals independent from missing plan, but comparison marked incomplete',()=>{const p=program([createProgramMeasure('energy')]);p.measures[0].facts[0]=fact();const r=calculateProgram(p);assert.equal(r.reliable,false);assert.equal(r.actual.reliable,true);assert.equal(r.actual.comparisonComplete,false);assert.equal(r.actual.variance,null);});
test('strict schema rejects prototype pollution, unknown keys, invalid dates, excessive data and duplicate IDs',()=>{const p=program();assert.throws(()=>validateProgram({...p,accessCode:'secret'}));assert.throws(()=>validateProgram(JSON.parse(JSON.stringify(p).replace('"notes":""','"__proto__":{"polluted":true},"notes":""'))));assert.equal({}.polluted,undefined);assert.throws(()=>validateProgram({...p,name:'x'.repeat(161)}));const q=structuredClone(p);q.measures.push(structuredClone(q.measures[0]));assert.throws(()=>validateProgram(q));q.measures.pop();q.measures[0].execution.dueDate='2026-02-30';assert.throws(()=>validateProgram(q));q.measures[0].execution.dueDate='2026-02-28';assert.doesNotThrow(()=>validateProgram(q));});
test('canonical validation reconstructs objects and rejects nonfinite values or forged confirmations',()=>{const p=program();const q=validateProgram(p);q.measures[0].execution.owner='Иван';assert.equal(p.measures[0].execution.owner,'');p.measures[0].inputs.annualSpend=Infinity;assert.throws(()=>validateProgram(p));assert.throws(()=>calculateActual({...fact(),confirmed:true}));});

test('text rejects invalid XML controls and lone surrogates, preserves safe Unicode and literal HTML',()=>{for(const name of ['bad\\u0000','bad\\ud800','bad\\udfff','bad\\uffff'].map(s=>JSON.parse('"'+s+'"'))) assert.throws(()=>validateProgram({...program(),name}));assert.equal(validateProgram({...program(),name:'Иван 👋 <script>x</script>'}).name,'Иван 👋 <script>x</script>');});

test('payback includes a future opening-of-month deficit even if month-end is positive',()=>{const p=program([measure('energy',{annualSpend:12,savingsPercent:10,implementationCost:0,monthlyCost:0}),measure('procurement',{annualSpend:12,savingsPercent:10,implementationCost:.15,monthlyCost:0,startMonth:2})]);p.overlap.confirmed=true;approx(calculateProgram(p).paybackMonths,1.25);});
test('normalized amounts stay bounded so multiple finite facts cannot overflow aggregate',()=>{assert.throws(()=>calculateActual(fact({baseline:1,actualSpend:0,implementationCost:0,monthlyCost:0,normalization:{enabled:true,baseVolume:1e-308,actualVolume:1,unit:'шт'}})),/нормализации/);});

test('update timestamp is canonical UTC ISO and expense scope is bounded text',()=>{const p=program();assert.match(p.updatedAt,/^\d{4}-\d{2}-\d{2}T.*Z$/);assert.equal(p.measures[0].costScope,'');p.measures[0].costScope='Сырьё цеха №2';assert.equal(validateProgram(p).measures[0].costScope,'Сырьё цеха №2');for(const updatedAt of ['2026-02-30T00:00:00.000Z','2026-01-01','2026-01-01T00:00:00+03:00','not-a-date']) assert.throws(()=>validateProgram({...p,updatedAt}));assert.throws(()=>validateProgram({...p,measures:[{...p.measures[0],costScope:'x'.repeat(4001)}]}));p.updatedAt='2000-01-01T00:00:00.000Z';assert.notEqual(updateMeasureInputs(p,'procurement',{savingsPercent:11}).updatedAt,p.updatedAt);assert.notEqual(setMeasureIncluded(p,'procurement',false).updatedAt,p.updatedAt);});

test('actual economic changes require renewed overlap review, without clearing unrelated individual confirmations',async()=>{
 const {factEconomicsChanged}=await import('../public/program-model.js');
 const f=confirmFact(fact({source:'Счет',qualityChecked:true}));
 for(const patch of [{baseline:2},{actualSpend:.9},{implementationCost:.2},{monthlyCost:.03},{normalization:{enabled:true}},{normalization:{baseVolume:10}},{normalization:{actualVolume:20}},{normalization:{unit:'шт'}}]){
   const next=updateFact(f,patch);assert.equal(factEconomicsChanged(f,next),true);assert.equal(next.confirmed,false);assert.equal(f.confirmed,true);
 }
 for(const patch of [{baseline:1},{source:'Другой счет'},{qualityChecked:false}])assert.equal(factEconomicsChanged(f,updateFact(f,patch)),false);
});

test('plan-fact variance suppresses relative floating point noise for semantically equal amounts',()=>{
 const p=program();p.measures[0].facts[0]=fact({baseline:1,actualSpend:.9,implementationCost:.2,monthlyCost:.02});
 const r=calculateProgram(p);
 assert.notEqual(r.actual.net-r.actual.matchedPlan,0,'fixture exercises binary roundoff');
 assert.equal(r.actual.series[0].variance,0);assert.equal(r.actual.variance,0);
 // Do not alter the underlying monetary inputs or either calculated operand.
 assert.equal(r.actual.net,calculateActual(p.measures[0].facts[0]).net);
 assert.equal(r.actual.matchedPlan,r.series[0].net);
});

test('plan-fact variance preserves genuine small positive and negative differences',()=>{
 for(const direction of [-1,1]){
  const p=program();p.measures[0].facts[0]=fact({baseline:1,actualSpend:.9+direction*1e-12,implementationCost:.2,monthlyCost:.02});
  const r=calculateProgram(p),raw=r.actual.net-r.actual.matchedPlan;
  assert.equal(Math.sign(raw),-direction);assert.equal(r.actual.variance,raw);assert.equal(r.actual.series[0].variance,raw);
 }
});

test('plan-fact variance has no fixed minimum currency threshold',()=>{
 const p=program([measure('procurement',{annualSpend:12e-20,savingsPercent:10,implementationCost:0,monthlyCost:0})]);
 p.measures[0].facts[0]=fact({baseline:2e-20,actualSpend:0,implementationCost:0,monthlyCost:0});
 const r=calculateProgram(p),raw=r.actual.net-r.actual.matchedPlan;
 assert.ok(raw>0&&raw<1e-19);assert.equal(r.actual.variance,raw);assert.equal(r.actual.series[0].variance,raw);
});
