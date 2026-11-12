import { industries, measures as library } from './data.js';

export const MAX_EXPENSE_RECORDS = 2000;
export const MAX_COMPARISON_SCENARIOS = 4;
export const diagnosticOptions = Object.freeze({
  industries: industries.map(x=>({id:x.id,label:x.title})),
  spendAreas: [ ['materials','Материалы и закупки'],['transport','Транспорт и доставка'],['people','Труд и ручные операции'],['it','IT и подписки'],['equipment','Оборудование и ремонт'],['energy','Энергия'],['stock','Запасы и хранение'],['services','Услуги и договоры'] ].map(([id,label])=>({id,label})),
  constraints: [ ['safety','Безопасность и обязательные регламенты'],['quality','Качество продукции'],['service','Сроки и клиентский сервис'],['staff','Критическая экспертиза команды'],['cash','Ограниченный бюджет внедрения'],['seasonality','Сезонность и нестабильный спрос'] ].map(([id,label])=>({id,label})),
  availableData: [ ['ledger','Реестр расходов'],['volumes','Объемы выпуска или продаж'],['contracts','Договоры и тарифы'],['quality','Качество и рекламации'],['usage','Фактическая загрузка и использование'],['inventory','Остатки и движение запасов'] ].map(([id,label])=>({id,label})),
});
export const priorityOptions = Object.freeze({
  complexity:[['unknown','Не оценена'],['low','Низкая'],['medium','Средняя'],['high','Высокая']],
  risk:[['unknown','Не оценен'],['low','Низкий'],['medium','Средний'],['high','Высокий']],
  evidenceType:[['unknown','Не указано'],['estimate','Предварительная оценка'],['supplier','Предложение поставщика'],['pilot','Результат пилота']],
});
const own=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!keys.includes(k))||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')))throw new TypeError('Неизвестные или отсутствующие поля P2');};
const text=(v,max=4000)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(v)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v))throw new TypeError('Недопустимый текст P2');return v;};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v))throw new TypeError('Недопустимый идентификатор P2');return v;};
const month=v=>{if(typeof v!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)||Number(v.slice(0,4))<1900)throw new TypeError('Период должен быть месяцем YYYY-MM');return v;};
const selected=(v,options)=>{if(!Array.isArray(v)||v.length>options.length||v.some(x=>!options.some(o=>o.id===x))||new Set(v).size!==v.length)throw new TypeError('Недопустимые ответы диагностики');return [...v];};
export function createDiagnostic(){return {industry:'',spendAreas:[],constraints:[],availableData:[]};}
export function validateDiagnostic(v){own(v,['industry','spendAreas','constraints','availableData']);if(v.industry!==''&&!industries.some(x=>x.id===v.industry))throw new TypeError('Неизвестная отрасль');return {industry:v.industry,spendAreas:selected(v.spendAreas,diagnosticOptions.spendAreas),constraints:selected(v.constraints,diagnosticOptions.constraints),availableData:selected(v.availableData,diagnosticOptions.availableData)};}
export function createPriority(){return {complexity:'unknown',risk:'unknown',evidenceType:'unknown',sourceComment:''};}
export function validatePriority(v){own(v,['complexity','risk','evidenceType','sourceComment']);for(const key of ['complexity','risk','evidenceType'])if(!priorityOptions[key].some(([id])=>id===v[key]))throw new TypeError('Неизвестная оценка приоритета');return {complexity:v.complexity,risk:v.risk,evidenceType:v.evidenceType,sourceComment:text(v.sourceComment)};}
export function validateExpenses(v){
 own(v,['records']);if(!Array.isArray(v.records)||v.records.length>MAX_EXPENSE_RECORDS)throw new RangeError('Не более 2000 строк расходов');const seen=new Set();
 return {records:v.records.map(r=>{own(r,['id','period','article','department','supplier','amountRub','source']);const key=id(r.id);if(seen.has(key))throw new TypeError('ID расхода повторяется');seen.add(key);if(typeof r.amountRub!=='number'||!Number.isFinite(r.amountRub)||Math.abs(r.amountRub)>1e12)throw new RangeError('Недопустимая сумма расхода');if(!text(r.article,160).trim())throw new TypeError('Статья расхода обязательна');return {id:key,period:month(r.period),article:r.article,department:text(r.department,160),supplier:text(r.supplier,160),amountRub:r.amountRub,source:text(r.source,500)};})};
}
export function validateScenarios(list,validateInputs){
 if(!Array.isArray(list)||list.length>MAX_COMPARISON_SCENARIOS)throw new RangeError('Не более четырех альтернативных сценариев');const ids=new Set();
 return list.map(s=>{own(s,['id','name','measures']);const key=id(s.id);if(key==='base'||ids.has(key))throw new TypeError('ID сценария повторяется или зарезервирован');ids.add(key);if(!Array.isArray(s.measures)||s.measures.length>library.length)throw new RangeError('Слишком много мер сценария');const measures=new Set();return {id:key,name:text(s.name,160),measures:s.measures.map(m=>{own(m,['id','costScope','included','inputs']);if(!library.some(x=>x.id===m.id)||measures.has(m.id))throw new TypeError('Неизвестная или повторная мера сценария');measures.add(m.id);if(typeof m.included!=='boolean')throw new TypeError('Неверный признак включения');return {id:m.id,costScope:text(m.costScope),included:m.included,inputs:validateInputs(m.inputs)};})};});
}
