import test from 'node:test';
import assert from 'node:assert/strict';
import {calculationReply,inspectCalculation,requestsCalculation,fields} from '../public/calculation-report.js';
const input={annualSpend:12,savingsPercent:10,implementationCost:0.2,monthlyCost:0.02,rampMonths:0};
test('reported case is deterministic and labels all units and confirmed inputs',()=>{
 const r=calculationReply(input);assert.equal(r.kind,'calculation');assert.deepEqual(r.calculation.inputs,input);
 const v=r.calculation.values;assert.equal(v.annualGross,1.2);assert.equal(v.annualNet,0.96);assert.equal(v.firstYearNet,0.76);assert.equal(v.paybackMonths,2.5);
 assert.match(r.content,/0,76 млн ₽/);assert.match(r.content,/2,5 мес./);assert.equal(r.calculation.moneyUnit,'million_rub');assert.match(r.content,/не прогноз и не гарантия/);
});
test('every missing field remains missing, including explicit zero ramp',()=>{
 for(const key of Object.keys(fields)){const partial={...input};delete partial[key];const r=calculationReply(partial);assert.equal(r.kind,'calculation_inputs');assert.deepEqual(r.missingFields,[key]);assert.equal(r.calculation,undefined);}
});
test('null strings booleans non-finite numbers invalid ranges and units never coerce',()=>{
 for(const bad of [null,'',false,true,'12',NaN,Infinity,-1,1000001])assert.throws(()=>inspectCalculation({...input,annualSpend:bad}));
 assert.throws(()=>inspectCalculation({...input,savingsPercent:101}));assert.throws(()=>inspectCalculation({...input,rampMonths:37}));
 assert.throws(()=>inspectCalculation({...input,moneyUnit:'USD'}));assert.throws(()=>inspectCalculation({...input,firstYearNet:11.56}));
});
test('negative and ramp scenarios do not invent payback or immediate savings',()=>{
 const negative=calculationReply({...input,savingsPercent:0});assert.equal(negative.calculation.values.paybackMonths,null);assert.ok(negative.calculation.values.firstYearNet<0);
 const ramp=calculationReply({...input,rampMonths:24});assert.equal(ramp.calculation.values.firstYearGross,0.3);assert.ok(ramp.calculation.values.firstYearNet<0);
 const zero=calculationReply({...input,implementationCost:0});assert.equal(zero.calculation.values.paybackMonths,0);
});
test('calculation intent detection routes but never parses or promises arbitrary prose safety',()=>{
 for(const s of ['Рассчитай экономию','Посчитай окупаемость','12 млн затрат, снижение 10%, внедрение 0.2 млн','Как проверить мой расчёт?']) assert.equal(requestsCalculation(s),true);
 assert.equal(requestsCalculation('Помоги выбрать первые меры'),false);
});

test('small accepted values remain nonzero in the structured report and display',()=>{
 const r=calculationReply({annualSpend:1e-7,savingsPercent:100,implementationCost:1e-8,monthlyCost:0,rampMonths:0});
 assert.equal(r.calculation.values.annualGross,1e-7);assert.equal(r.calculation.values.paybackMonths,1.2);
 assert.ok(!r.content.includes('Годовая база затрат, млн ₽/год: 0\n'));
});
