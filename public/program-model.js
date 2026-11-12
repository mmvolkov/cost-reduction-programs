import { calculateSavings } from './calculator.js';
import { measures as library } from './data.js';

export const PROGRAM_SCHEMA_VERSION = 1;
export const executionStatuses = Object.freeze(['hypothesis', 'review', 'pilot', 'implementation', 'confirmation']);
const limits = Object.freeze({annualSpend:1000000,savingsPercent:100,implementationCost:1000000,monthlyCost:100000,rampMonths:36});
const keys = Object.keys(limits);
const factKeys = ['baseline','actualSpend','implementationCost','monthlyCost','source','qualityChecked','normalization','confirmed'];
function record(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}: ожидается объект`);
  const own = Object.keys(value);
  if (own.length !== allowed.length || own.some(k => !allowed.includes(k)) || allowed.some(k => !Object.hasOwn(value,k))) throw new TypeError(`${label}: неизвестные или отсутствующие поля`);
}
function text(value, max=4000) { if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) throw new TypeError('Недопустимый текст'); return value; }
function bool(value) { if (typeof value !== 'boolean') throw new TypeError('Ожидается логическое значение'); return value; }
function number(value,max=1000000) { if (value === null) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new RangeError('Недопустимое число'); return value; }
function month(value) { if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || Number(value.slice(0,4)) < 1900 || Number(value.slice(0,4)) > 9999) throw new TypeError('Недопустимый начальный месяц'); return value; }
function date(value) { if(value === '') return ''; if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1900 || new Date(value+'T00:00:00Z').toISOString().slice(0,10) !== value) throw new TypeError('Недопустимая дата'); return value; }
function timestamp(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError('Недопустимая дата обновления UTC'); return value; }
export function createFact() { return {baseline:null,actualSpend:null,implementationCost:null,monthlyCost:null,source:'',qualityChecked:false,normalization:{enabled:false,baseVolume:null,actualVolume:null,unit:''},confirmed:false}; }
function validateFact(fact) {
  record(fact,factKeys,'Факт'); record(fact.normalization,['enabled','baseVolume','actualVolume','unit'],'Нормализация');
  const result = {baseline:number(fact.baseline),actualSpend:number(fact.actualSpend),implementationCost:number(fact.implementationCost),monthlyCost:number(fact.monthlyCost,100000),source:text(fact.source),qualityChecked:bool(fact.qualityChecked),normalization:{enabled:bool(fact.normalization.enabled),baseVolume:number(fact.normalization.baseVolume,1e12),actualVolume:number(fact.normalization.actualVolume,1e12),unit:text(fact.normalization.unit,80)},confirmed:bool(fact.confirmed)};
  if (result.normalization.enabled && result.normalization.baseVolume === 0) throw new RangeError('Базовый объём должен быть больше нуля');
  const computed = actualValues(result);
  if (result.confirmed && (!computed.complete || !result.source.trim() || !result.qualityChecked)) throw new TypeError('Подтверждение требует полного факта, источника и проверки качества');
  return result;
}
function actualValues(fact) {
  const missing = ['baseline','actualSpend','implementationCost','monthlyCost'].filter(k => fact[k] === null);
  if (fact.normalization.enabled) {
    if (fact.normalization.baseVolume === null || fact.normalization.baseVolume <= 0) missing.push('normalization.baseVolume');
    if (fact.normalization.actualVolume === null) missing.push('normalization.actualVolume');
    if (!fact.normalization.unit.trim()) missing.push('normalization.unit');
  }
  const complete = missing.length === 0;
  const comparableBaseline = complete ? (fact.normalization.enabled ? fact.baseline / fact.normalization.baseVolume * fact.normalization.actualVolume : fact.baseline) : null;
  if (comparableBaseline !== null && (!Number.isFinite(comparableBaseline) || comparableBaseline > 1000000)) throw new RangeError('Сопоставимая база после нормализации не должна превышать 1 000 000 млн ₽');
  return {complete,missing,comparableBaseline,net:complete ? comparableBaseline-fact.actualSpend-fact.implementationCost-fact.monthlyCost : null,confirmed:complete && fact.confirmed};
}
export function calculateActual(fact) { return actualValues(validateFact(fact)); }
export function updateFact(fact, patch) {
  const original = validateFact(fact);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !factKeys.includes(k) || k === 'confirmed')) throw new TypeError('Изменяйте подтверждение отдельным действием');
  const next = {...original,...patch,normalization:patch.normalization ? {...original.normalization,...patch.normalization} : original.normalization,confirmed:false};
  const validated = validateFact(next);
  const unchanged = JSON.stringify({...original,confirmed:false}) === JSON.stringify(validated);
  return {...validated,confirmed:unchanged ? original.confirmed : false};
}
export function confirmFact(fact) { return validateFact({...validateFact(fact),confirmed:true}); }
export function createProgramMeasure(id) {
  const item = library.find(m=>m.id===id); if (!item) throw new TypeError('Неизвестная мера');
  return {id,costScope:'',included:true,inputs:{annualSpend:null,savingsPercent:null,implementationCost:null,monthlyCost:null,rampMonths:null,startMonth:1},execution:{owner:'',dueDate:'',nextStep:'',status:'hypothesis',successCriterion:'',qualityMetric:'',notes:''},facts:Array.from({length:12},createFact)};
}
export function createProgram({id=globalThis.crypto.randomUUID(),name='Новая программа',startMonth=new Date().toISOString().slice(0,7)}={}) {
  return validateProgram({id,name,startMonth,updatedAt:new Date().toISOString(),notes:'',measures:[],overlap:{confirmed:false,note:''}});
}
export function validateProgram(program) {
  record(program,['id','name','startMonth','updatedAt','notes','measures','overlap'],'Программа');
  if (typeof program.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(program.id)) throw new TypeError('Недопустимый ID');
  if (!Array.isArray(program.measures) || program.measures.length > library.length) throw new TypeError('Слишком много мер');
  record(program.overlap,['confirmed','note'],'Пересечения'); const seen = new Set();
  const measures = program.measures.map(m=>{
    record(m,['id','costScope','included','inputs','execution','facts'],'Мера');
    if (!library.some(x=>x.id===m.id) || seen.has(m.id)) throw new TypeError('Неизвестная или повторная мера'); seen.add(m.id);
    record(m.inputs,[...keys,'startMonth'],'Параметры'); const inputs = Object.fromEntries(keys.map(k=>[k,number(m.inputs[k],limits[k])]));
    if (!Number.isInteger(m.inputs.startMonth) || m.inputs.startMonth < 1 || m.inputs.startMonth > 12) throw new RangeError('Месяц запуска должен быть от 1 до 12'); inputs.startMonth=m.inputs.startMonth;
    record(m.execution,['owner','dueDate','nextStep','status','successCriterion','qualityMetric','notes'],'Исполнение');
    if(!executionStatuses.includes(m.execution.status)) throw new TypeError('Неизвестный статус');
    const execution={owner:text(m.execution.owner,160),dueDate:date(m.execution.dueDate),nextStep:text(m.execution.nextStep),status:m.execution.status,successCriterion:text(m.execution.successCriterion),qualityMetric:text(m.execution.qualityMetric),notes:text(m.execution.notes)};
    if(!Array.isArray(m.facts) || m.facts.length!==12) throw new TypeError('Нужно 12 месяцев факта');
    return {id:m.id,costScope:text(m.costScope),included:bool(m.included),inputs,execution,facts:m.facts.map(validateFact)};
  });
  return {id:program.id,name:text(program.name,160),startMonth:month(program.startMonth),updatedAt:timestamp(program.updatedAt),notes:text(program.notes),measures,overlap:{confirmed:bool(program.overlap.confirmed),note:text(program.overlap.note)}};
}
export function updateMeasureInputs(program,id,patch) {
  const next=validateProgram(program), measure=next.measures.find(m=>m.id===id); if(!measure) throw new TypeError('Мера не найдена');
  const old=JSON.stringify(measure.inputs); measure.inputs={...measure.inputs,...patch};
  if(JSON.stringify(measure.inputs)!==old) next.overlap.confirmed=false;
  next.updatedAt=new Date().toISOString(); return validateProgram(next);
}
export function setMeasureIncluded(program,id,included) {
  const next=validateProgram(program), measure=next.measures.find(m=>m.id===id); if(!measure) throw new TypeError('Мера не найдена');
  if(measure.included!==included) next.overlap.confirmed=false; measure.included=included; next.updatedAt=new Date().toISOString(); return validateProgram(next);
}
function measureResult(m) {
  const missing=keys.filter(k=>m.inputs[k]===null), complete=missing.length===0;
  if(!complete) return {id:m.id,included:m.included,complete,missing,calculation:null,series:[]};
  const input=Object.fromEntries(keys.map(k=>[k,m.inputs[k]])), calculation=calculateSavings(input);
  let accumulated=0;
  const series=Array.from({length:120},(_,i)=>{
    const month=i+1, relative=month-m.inputs.startMonth+1, active=relative>0;
    // The first year uses the existing pure calculator verbatim. Later months extend its documented linear-ramp rule for portfolio payback only.
    const gross=!active ? 0 : relative<=12 ? calculation.series[relative-1].gross : calculation.annualGross/12*(input.rampMonths===0 ? 1 : Math.min(1,(relative-.5)/input.rampMonths));
    const support=active ? input.monthlyCost : 0, implementation=relative===1 ? input.implementationCost : 0, net=gross-support-implementation; accumulated+=net;
    return {month,gross,support,implementation,net,accumulated};
  });
  return {id:m.id,included:m.included,complete,missing,calculation,series};
}
// Suppress only a few floating-point ulps relative to the operands. There is
// deliberately no absolute floor (such as max(1, ...)) or decimal rounding:
// genuinely small financial differences must remain visible at their own scale.
function planFactDifference(actual, plan) {
  const difference = actual - plan;
  const roundoff = 4 * Number.EPSILON * Math.max(Math.abs(actual), Math.abs(plan));
  return Math.abs(difference) <= roundoff ? 0 : difference;
}
export function calculateProgram(program) {
  const p=validateProgram(program), measures=p.measures.map(measureResult), included=measures.filter(m=>m.included), complete=included.filter(m=>m.complete);
  const incompleteMeasureIds=included.filter(m=>!m.complete).map(m=>m.id), overlapResolved=included.length<=1 || p.overlap.confirmed;
  const reasons=[]; if(!included.length) reasons.push('Не выбраны меры'); if(incompleteMeasureIds.length) reasons.push('Есть незаполненные параметры мер'); if(!overlapResolved) reasons.push('Не подтверждено отсутствие двойного счёта');
  let accumulated=0;
  const allSeries=Array.from({length:120},(_,i)=>{
    const gross=complete.reduce((s,m)=>s+m.series[i].gross,0), support=complete.reduce((s,m)=>s+m.series[i].support,0), implementation=complete.reduce((s,m)=>s+m.series[i].implementation,0), net=gross-support-implementation;
    accumulated+=net; return {month:i+1,gross,support,implementation,net,accumulated};
  });
  // Last recovery, not the first transient crossing: later starts may put a seemingly repaid portfolio back below zero.
  const annualNet=complete.reduce((s,m)=>s+m.calculation.annualNet,0);
  let paybackMonths=null;
  for(let i=0;i<allSeries.length;i++) {
    const row=allSeries[i], before=(i ? allSeries[i-1].accumulated : 0)-row.implementation, operating=row.gross-row.support;
    const futureSolvent=allSeries.slice(i+1).every((x,k)=>allSeries[i+k].accumulated-x.implementation>=0 && x.accumulated>=0);
    if(annualNet>=0 && operating>0 && row.accumulated>=0 && futureSolvent) {
      paybackMonths=before<0 ? i+(-before/operating) : i; break;
    }
  }
  const actualSeries=Array.from({length:12},(_,i)=>{
    let net=0,confirmedNet=0,matchedPlan=0,filledCells=0,confirmedCells=0,comparisonComplete=true;
    for(const m of p.measures.filter(m=>m.included)) {
      const actual=calculateActual(m.facts[i]); if(!actual.complete) continue;
      filledCells++; net+=actual.net; if(actual.confirmed) {confirmedCells++;confirmedNet+=actual.net;}
      const plan=measures.find(x=>x.id===m.id); if(plan.complete) matchedPlan+=plan.series[i].net; else comparisonComplete=false;
    }
    return {month:i+1,net,confirmedNet,matchedPlan,variance:comparisonComplete ? planFactDifference(net,matchedPlan) : null,filledCells,confirmedCells,complete:included.length>0 && filledCells===included.length,comparisonComplete};
  });
  const filledCells=actualSeries.reduce((s,x)=>s+x.filledCells,0), net=actualSeries.reduce((s,x)=>s+x.net,0), matchedPlan=actualSeries.reduce((s,x)=>s+x.matchedPlan,0), comparisonComplete=actualSeries.every(x=>x.comparisonComplete);
  return {reliable:reasons.length===0,reasons,incompleteMeasureIds,overlapResolved,measures,series:allSeries.slice(0,12),firstYearNet:allSeries[11].accumulated,annualNet,paybackMonths,paybackHorizonMonths:120,
    actual:{reliable:overlapResolved && included.length>0 && filledCells>0,completeMonths:actualSeries.filter(x=>x.complete).length,filledCells,confirmedCells:actualSeries.reduce((s,x)=>s+x.confirmedCells,0),net,confirmedNet:actualSeries.reduce((s,x)=>s+x.confirmedNet,0),matchedPlan,variance:comparisonComplete && filledCells>0 ? planFactDifference(net,matchedPlan) : null,comparisonComplete,series:actualSeries}};
}

// Only economic changes invalidate the portfolio overlap attestation.
// Source/quality edits still reset that record's confirmation through updateFact.
export function factEconomicsChanged(previous,next) {
  return ['baseline','actualSpend','implementationCost','monthlyCost'].some(key=>previous[key]!==next[key])
    || ['enabled','baseVolume','actualVolume','unit'].some(key=>previous.normalization[key]!==next.normalization[key]);
}
