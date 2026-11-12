import { measures as library, industries } from './data.js';
import { createProgramMeasure, validateProgram, calculateProgram } from './program-model.js';
import { diagnosticOptions, priorityOptions, validateDiagnostic } from './program-p2-schema.js';
export { diagnosticOptions, priorityOptions } from './program-p2-schema.js';

const clone=v=>JSON.parse(JSON.stringify(v));
const labels=(group,id)=>diagnosticOptions[group].find(x=>x.id===id)?.label || id;
const spendMeasures={materials:['procurement','production'],transport:['logistics'],people:['process'],it:['saas'],equipment:['maintenance'],energy:['energy'],stock:['inventory'],services:['contracts']};
const needed={procurement:['ledger','contracts','quality'],inventory:['inventory','volumes'],logistics:['ledger','volumes','usage'],process:['usage','ledger'],saas:['contracts','usage'],production:['volumes','quality','ledger'],maintenance:['usage','quality','ledger'],energy:['usage','volumes','ledger'],contracts:['contracts','ledger']};
/** Explainable ordered rules, not an AI answer, financial forecast or confidence score. */
export function diagnoseProgram(answers) {
 const d=validateDiagnostic(answers), industry=industries.find(x=>x.id===d.industry), candidates=new Map();
 const add=(id,reason)=>{if(!candidates.has(id))candidates.set(id,[]);if(!candidates.get(id).includes(reason))candidates.get(id).push(reason);};
 d.spendAreas.forEach(area=>(spendMeasures[area]||[]).forEach(id=>add(id,'Вы указали расходы: '+labels('spendAreas',area)+'.')));
 industry?.measures.forEach(id=>add(id,'Для отрасли «'+industry.title+'» библиотека предлагает проверить этот источник потерь.'));
 for(const id of ['procurement','contracts','process'])if(candidates.size<3)add(id,'Стартовая проверка при недостатке исходных сведений; применимость нужно подтвердить.');
 const recommendations=[...candidates].slice(0,5).map(([id,reasons])=>{
  const item=library.find(x=>x.id===id);
  const missingData=needed[id].filter(key=>!d.availableData.includes(key)).map(key=>'Подготовить: '+labels('availableData',key)+'.');
  const qualityConstraints=[item.guard,...d.constraints.map(key=>'Сохранить ограничение: '+labels('constraints',key)+'.')];
  if(d.constraints.includes('cash'))qualityConstraints.push('Сначала оценить вложения и проверить пилот; размер инвестиций пока неизвестен.');
  return {id,title:item.title,reasons,missingData,qualityConstraints};
 });
 return {recommendations,missingData:[...new Set([...(d.industry?[]:['Уточнить отрасль.']),...(d.spendAreas.length?[]:['Уточнить структуру расходов.']),...recommendations.flatMap(x=>x.missingData)])],limitations:['Рекомендации задают порядок проверки, не гарантируют экономию.','Проценты, суммы и ответственные не подставляются автоматически.']};
}
export function addDiagnosticMeasures(program,ids) {
 const p=validateProgram(program);
 if(!Array.isArray(ids)||ids.some(id=>!library.some(x=>x.id===id)))throw new TypeError('Неизвестная мера диагностики');
 let changed=false; for(const id of new Set(ids))if(!p.measures.some(m=>m.id===id)){p.measures.push(createProgramMeasure(id));changed=true;}
 if(changed){p.overlap.confirmed=false;p.updatedAt=new Date().toISOString();}return validateProgram(p);
}
const snapshot=p=>p.measures.map(m=>({id:m.id,costScope:m.costScope,included:m.included,inputs:clone(m.inputs)}));
/** Create missing alternatives without replacing existing scenarios or inventing inputs. */
export function createComparisonScenarios(program) {
 const p=validateProgram(program);
 while(p.scenarios.length<2)p.scenarios.push({id:globalThis.crypto.randomUUID(),name:'Альтернатива '+(p.scenarios.length+1),measures:snapshot(p)});
 p.updatedAt=new Date().toISOString();return validateProgram(p);
}
export function updateComparisonScenario(program,scenarioId,measureId,patch) {
 const p=validateProgram(program),s=p.scenarios.find(x=>x.id===scenarioId);if(!s)throw new TypeError('Сценарий не найден');
 const m=s.measures.find(x=>x.id===measureId);if(!m)throw new TypeError('Мера сценария не найдена');
 const allowed=['annualSpend','savingsPercent','implementationCost','monthlyCost','rampMonths','startMonth'];
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!allowed.includes(k)))throw new TypeError('Неизвестный параметр сценария');
 m.inputs={...m.inputs,...patch};p.updatedAt=new Date().toISOString();return validateProgram(p);
}
function scenarioProgram(program,scenario) {
 const p=validateProgram(program);
 p.measures=scenario.measures.map(s=>({...createProgramMeasure(s.id),costScope:s.costScope,included:s.included,inputs:clone(s.inputs)}));
 p.overlap={confirmed:false,note:''};p.expenses={records:[]};p.scenarios=[];return validateProgram(p);
}
function financial(result){return {firstYearNet:result.firstYearNet,annualNet:result.annualNet,paybackMonths:result.paybackMonths,reliable:result.reliable,reasons:[...result.reasons],overlapResolved:result.overlapResolved,incompleteMeasureIds:[...result.incompleteMeasureIds],series:result.series.map(x=>({...x}))};}
export function compareProgramScenarios(program) {
 const p=validateProgram(program);
 const row=(id,name,measures,result,isBase)=>({id,name,isBase,...financial(result),compositionDifferences:[...p.measures.filter(m=>!measures.some(x=>x.id===m.id)).map(m=>({id:m.id,title:library.find(x=>x.id===m.id).title,change:'removed'})),...measures.filter(m=>!p.measures.some(x=>x.id===m.id)).map(m=>({id:m.id,title:library.find(x=>x.id===m.id).title,change:'added'}))],measures:measures.map(m=>{
  const original=p.measures.find(x=>x.id===m.id),differences=[];
  if(!original)differences.push({field:'measure',base:null,value:m.id});
  else {for(const key of Object.keys(m.inputs))if(m.inputs[key]!==original.inputs[key])differences.push({field:key,base:original.inputs[key],value:m.inputs[key]});if(m.included!==original.included)differences.push({field:'included',base:original.included,value:m.included});}
  return {id:m.id,title:library.find(x=>x.id===m.id).title,included:m.included,inputs:clone(m.inputs),differences};
 })});
 return {startMonth:p.startMonth,horizonMonths:12,rows:[row('base','Базовый',p.measures,calculateProgram(p),true),...p.scenarios.map(s=>row(s.id,s.name,s.measures,calculateProgram(scenarioProgram(p,s)),false))],warning:'Альтернативы - независимые плановые гипотезы. Факты и подтверждения исходной программы не являются доказательством сценария.'};
}
export const priorityCriteria=Object.freeze([['net','Чистый эффект первого года'],['investment','Разовые вложения'],['payback','Окупаемость'],['complexity','Сложность'],['risk','Риск']]);
export function rankProgramMeasures(program,criterion='net',direction=criterion==='net'?'desc':'asc') {
 const p=validateProgram(program);if(!priorityCriteria.some(([id])=>id===criterion)||!['asc','desc'].includes(direction))throw new TypeError('Неизвестный порядок сортировки');
 const rows=p.measures.map(m=>{const single={...p,measures:[{...m,included:true}],scenarios:[]},r=calculateProgram(single),complete=r.measures[0].complete;
  return {id:m.id,title:library.find(x=>x.id===m.id).title,included:m.included,net:complete?r.firstYearNet:null,investment:m.inputs.implementationCost,payback:complete?r.paybackMonths:null,complete,complexity:m.priority.complexity,risk:m.priority.risk,evidenceType:m.priority.evidenceType,sourceComment:m.priority.sourceComment,priority:clone(m.priority),warnings:!complete?['Параметры не заполнены']:r.paybackMonths===null?['Не окупается в расчетном горизонте']:[]};
 });
 const value=row=>['complexity','risk'].includes(criterion)?({low:1,medium:2,high:3}[row[criterion]]??null):row[criterion];
 rows.sort((a,b)=>{const av=value(a),bv=value(b);if(av===null&&bv===null)return a.title.localeCompare(b.title,'ru');if(av===null)return 1;if(bv===null)return-1;return (direction==='asc'?av-bv:bv-av)||a.title.localeCompare(b.title,'ru');});
 return {criterion,direction,rows,warning:'Сортировка по выбранному критерию, не объективный рейтинг. Неизвестные значения показаны отдельно; отсутствие окупаемости не равно нулю.'};
}
