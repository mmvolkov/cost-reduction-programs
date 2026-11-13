import { validateProgram } from './program-model.js';
import { measures as measureLibrary } from './data.js';

export const collaborationRoles=Object.freeze(['owner','editor','reviewer','viewer']);
export const collaborationLimits=Object.freeze({participants:30,comments:200,history:300,decisions:100,text:2000});
const provenances=['local-manual','received-unverified'];
const outcomes=['approve','changes-requested','reject'];
function own(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')))throw new TypeError('Неизвестные или отсутствующие поля совместной работы');}
function text(v,max=2000){if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(v)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v))throw new TypeError('Недопустимый текст совместной работы');return v;}
function id(v){if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v))throw new TypeError('Недопустимый ID совместной работы');return v;}
function integer(v,min=0,max=1e9){if(!Number.isSafeInteger(v)||v<min||v>max)throw new TypeError('Недопустимая версия или счетчик');return v;}
function at(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)throw new TypeError('Недопустимое время записи');return v;}
function provenance(v){if(!provenances.includes(v))throw new TypeError('Недопустимое происхождение записи');return v;}
function role(v){if(!collaborationRoles.includes(v))throw new TypeError('Неизвестная организационная роль');return v;}
function author(v){own(v,['id','name','role']);return {id:v.id===null?null:id(v.id),name:text(v.name,160),role:v.role===null?null:role(v.role)};}
function list(v,max,map){if(!Array.isArray(v)||v.length>max)throw new TypeError('Превышен лимит локальных записей');const result=v.map(map);if(new Set(result.map(x=>x.id)).size!==result.length)throw new TypeError('Повторный ID записи');return result;}
export function createCollaboration(){return {revision:1,participants:[],activeParticipantId:null,comments:[],history:[],decisions:[],historyDropped:0};}
export function validateCollaboration(v,measureIds=[]){
 own(v,['revision','participants','activeParticipantId','comments','history','decisions','historyDropped']);const revision=integer(v.revision,1);
 const participants=list(v.participants,30,p=>{own(p,['id','name','role','provenance']);if(!text(p.name,160).trim())throw new TypeError('Имя участника не задано');return {id:id(p.id),name:p.name,role:role(p.role),provenance:provenance(p.provenance)};});
 if(v.activeParticipantId!==null&&!participants.some(p=>p.id===v.activeParticipantId))throw new TypeError('Выбранный участник не найден');
 const comments=list(v.comments,200,c=>{own(c,['id','scope','measureId','text','author','at','provenance']);if(!['program','measure'].includes(c.scope)||c.scope==='program'&&c.measureId!==null||c.scope==='measure'&&!measureIds.includes(c.measureId))throw new TypeError('Неизвестный предмет комментария');if(!text(c.text).trim())throw new TypeError('Комментарий пуст');return {id:id(c.id),scope:c.scope,measureId:c.measureId,text:c.text,author:author(c.author),at:at(c.at),provenance:provenance(c.provenance)};});
 const history=list(v.history,300,h=>{own(h,['id','revision','action','summary','author','at','provenance']);return {id:id(h.id),revision:integer(h.revision,1,revision),action:text(h.action,160),summary:text(h.summary),author:author(h.author),at:at(h.at),provenance:provenance(h.provenance)};});
 const decisions=list(v.decisions,100,d=>{own(d,['id','revision','decision','note','author','at','provenance']);if(!outcomes.includes(d.decision))throw new TypeError('Неизвестный вид решения');return {id:id(d.id),revision:integer(d.revision,1,revision),decision:d.decision,note:text(d.note),author:author(d.author),at:at(d.at),provenance:provenance(d.provenance)};});
 return {revision,participants,activeParticipantId:v.activeParticipantId,comments,history,decisions,historyDropped:integer(v.historyDropped)};
}
const clone=p=>validateProgram(p);
const actor=p=>{const a=p.collaboration.participants.find(x=>x.id===p.collaboration.activeParticipantId);return a?{id:a.id,name:a.name,role:a.role}:{id:null,name:'Автор не указан',role:null};};
function recordHistory(p,action,summary){const c=p.collaboration;c.history.push({id:crypto.randomUUID(),revision:c.revision,action,summary,author:actor(p),at:new Date().toISOString(),provenance:'local-manual'});if(c.history.length>300){c.history.splice(0,c.history.length-300);c.historyDropped++;}}
const business=p=>{const {updatedAt,collaboration,...rest}=p;return JSON.stringify(rest);};
const labels={name:'Название программы',startMonth:'Первый месяц',notes:'Заметки',annualSpend:'Годовая база',savingsPercent:'Снижение, %',implementationCost:'Внедрение',monthlyCost:'Поддержка',rampMonths:'Разгон',included:'Включение в итоги',costScope:'Область расходов',owner:'Ответственный',dueDate:'Срок',nextStep:'Следующий шаг',status:'Статус',successCriterion:'Критерий успеха',qualityMetric:'Показатель качества',risk:'Риск',complexity:'Сложность',evidenceType:'Основание оценки',sourceComment:'Источник оценки',requestedDecision:'Запрос решения',decisionOwner:'Ответственный за решение',decisionDueDate:'Срок принятия решения',dataLimitations:'Ограничения данных',baseline:'База расходов без изменений',actualSpend:'Фактические расходы',source:'Источник факта',qualityChecked:'Проверка качества и сопоставимости',normalization:'Нормализация базы',confirmed:'Подтверждение',enabled:'Включение нормализации',baseVolume:'Базовый объем',actualVolume:'Фактический объем',unit:'Единица объема',note:'Пояснение пересечений',industry:'Отрасль',spendAreas:'Структура расходов',constraints:'Ограничения',availableData:'Доступные данные'};
const measureTitle=id=>measureLibrary.find(m=>m.id===id)?.title||'Неизвестная мера';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const numberText=v=>v===null?'нет данных':String(v).replace('.',',');
function businessDiff(before,after){
 const changes=[];
 const change=(path,label,a,b)=>{if(same(a,b))return;const numeric=(a===null||typeof a==='number')&&(b===null||typeof b==='number');changes.push({path,numeric,summary:numeric?`${label}: ${numberText(a)} → ${numberText(b)}`:`${label}: изменено`});};
 for(const key of ['name','startMonth','notes'])change(key,labels[key],before[key],after[key]);
 for(const key of Object.keys(after.approvalRequest||{}))change('approvalRequest.'+key,'Согласование / '+(labels[key]||key),before.approvalRequest?.[key],after.approvalRequest[key]);
 for(const group of ['diagnostic','overlap'])for(const key of Object.keys(after[group]))change(group+'.'+key,(group==='diagnostic'?'Диагностика':'Проверка пересечений')+' / '+labels[key],before[group][key],after[group][key]);
 if(!same(before.expenses,after.expenses))changes.push({path:'expenses',numeric:false,summary:`Реестр расходов: изменен; записей ${before.expenses.records.length} → ${after.expenses.records.length}. Содержимое операций не копируется.`});
 for(const scenarioId of new Set([...before.scenarios,...after.scenarios].map(s=>s.id))){const a=before.scenarios.find(s=>s.id===scenarioId),b=after.scenarios.find(s=>s.id===scenarioId),prefix='Альтернатива '+((b?after.scenarios.findIndex(s=>s.id===scenarioId):before.scenarios.findIndex(s=>s.id===scenarioId))+1);
  if(!a||!b){changes.push({path:'scenario.'+scenarioId,numeric:false,summary:prefix+(!a?': добавлен':': удален')});continue;}
  change(`scenario.${scenarioId}.name`,prefix+' / Название',a.name,b.name);
  for(const measureId of new Set([...a.measures,...b.measures].map(m=>m.id))){const x=a.measures.find(m=>m.id===measureId),y=b.measures.find(m=>m.id===measureId),path=`scenario.${scenarioId}.${measureId}`,label=prefix+' / '+measureTitle(measureId);
   if(!x||!y){changes.push({path,numeric:false,summary:label+(!x?': добавлена':': удалена')});continue;}
   for(const key of ['included','costScope'])change(path+'.'+key,label+' / '+labels[key],x[key],y[key]);
   for(const key of Object.keys(y.inputs))change(path+'.inputs.'+key,label+' / '+(labels[key]||key),x.inputs[key],y.inputs[key]);
  }
 }
 const ids=new Set([...before.measures,...after.measures].map(m=>m.id));
 for(const id of ids){const a=before.measures.find(m=>m.id===id),b=after.measures.find(m=>m.id===id),prefix=measureTitle(id);
  if(!a||!b){changes.push({path:'measure.'+id,numeric:false,summary:prefix+(!a?': добавлена':': удалена')});continue;}
  for(const key of ['included','costScope'])change(`measure.${id}.${key}`,prefix+' / '+labels[key],a[key],b[key]);
  for(const group of ['inputs','execution','priority'])for(const key of Object.keys(b[group]))change(`measure.${id}.${group}.${key}`,prefix+' / '+(labels[key]||key),a[group][key],b[group][key]);
  for(let i=0;i<b.facts.length;i++)for(const key of Object.keys(b.facts[i])){
   const path=`measure.${id}.facts.${i}.${key}`,label=prefix+` / факт месяца ${i+1} / `+labels[key];
   if(key==='normalization')for(const subkey of Object.keys(b.facts[i].normalization))change(path+'.'+subkey,label+' / '+labels[subkey],a.facts[i].normalization[subkey],b.facts[i].normalization[subkey]);
   else change(path,label,a.facts[i][key],b.facts[i][key]);
  }
 }
 return changes;
}
// Presentation only. Strip only keys emitted by the current UI's default
// business-edit action; legacy/custom action text stays untouched.
export function historyActionLabel(action){
 if(typeof action!=='string')return action;
 const prefix='Изменение программы / ';
 if(!action.startsWith(prefix))return action;
 const path=action.slice(prefix.length),parts=path.split('.');
 const inputs=['annualSpend','savingsPercent','implementationCost','monthlyCost','rampMonths','startMonth'];
 const execution=['owner','dueDate','nextStep','status','successCriterion','qualityMetric','notes'];
 const priority=['complexity','risk','evidenceType','sourceComment'];
 let known=['name','startMonth','notes','expenses'].includes(path);
 if(parts.length===2){const fields={approvalRequest:['requestedDecision','decisionOwner','decisionDueDate','dataLimitations'],diagnostic:['industry','spendAreas','constraints','availableData'],overlap:['confirmed','note']};known||=!!fields[parts[0]]?.includes(parts[1]);}
 if(parts[0]==='measure'&&measureLibrary.some(m=>m.id===parts[1])){
  known||=parts.length===2||parts.length===3&&['included','costScope'].includes(parts[2]);
  known||=parts.length===4&&({inputs,execution,priority})[parts[2]]?.includes(parts[3]);
  if(parts[2]==='facts'&&/^(?:[0-9]|1[01])$/.test(parts[3]||''))known||=parts.length===5&&['baseline','actualSpend','implementationCost','monthlyCost','source','qualityChecked','confirmed'].includes(parts[4])||parts.length===6&&parts[4]==='normalization'&&['enabled','baseVolume','actualVolume','unit'].includes(parts[5]);
 }
 if(parts[0]==='scenario'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(parts[1]||'')){
  known||=parts.length===2||parts.length===3&&parts[2]==='name';
  if(measureLibrary.some(m=>m.id===parts[2]))known||=parts.length===3||parts.length===4&&['included','costScope'].includes(parts[3])||parts.length===5&&parts[3]==='inputs'&&inputs.includes(parts[4]);
 }
 return known?'Изменение программы':action;
}
export function recordProgramChange(previous,next,{action='Изменение программы',at:changedAt=new Date().toISOString()}={}){
 const before=clone(previous),after=clone(next);if(before.id!==after.id)throw new TypeError('Изменение другой программы запрещено');
 if(business(before)===business(after))return after;
 text(action,160);at(changedAt);
 // The business revision ALWAYS advances, even when display history is grouped.
 after.collaboration=structuredClone(before.collaboration);after.collaboration.revision=integer(before.collaboration.revision+1,1);
 const changes=businessDiff(before,after),single=changes.length===1?changes[0]:null;
 const key=single?`${action} / ${single.path}`:action;
 // Never truncate identifiers into an ambiguous coalescing key.
 const historyAction=key.length<=160?key:action;
 const summary=changes.map(x=>x.summary).join('; ').slice(0,1900)||'Содержание программы изменено';
 const c=after.collaboration,last=c.history.at(-1),currentActor=actor(after),elapsed=last?Date.parse(changedAt)-Date.parse(last.at):Infinity;
 const coalesce=single&&key.length<=160&&last&&last.action===historyAction&&last.provenance==='local-manual'&&same(last.author,currentActor)&&last.revision===before.collaboration.revision&&elapsed>=0&&elapsed<=30000;
 if(coalesce){
  // Numeric history retains the first pre-edit value and the latest value.
  const separator=single.numeric?last.summary.lastIndexOf(' → '):-1;
  last.summary=separator>=0?last.summary.slice(0,separator)+' → '+single.summary.slice(single.summary.lastIndexOf(' → ')+3):summary;
  last.revision=c.revision;last.at=changedAt;
 }else{
  c.history.push({id:crypto.randomUUID(),revision:c.revision,action:historyAction,summary,author:currentActor,at:changedAt,provenance:'local-manual'});
  if(c.history.length>300){const omitted=c.history.length-300;c.history.splice(0,omitted);c.historyDropped+=omitted;}
 }
 return clone(after);
}
export function addParticipant(program,{name,role:roleValue}){const p=clone(program);if(p.collaboration.participants.length>=30)throw new RangeError('Не более 30 участников');p.collaboration.participants.push({id:crypto.randomUUID(),name:text(name,160),role:role(roleValue),provenance:'local-manual'});recordHistory(p,'Добавлен участник','Организационная запись, личность и права не проверены.');return clone(p);}
export function updateParticipant(program,{id:participantId,name,role:roleValue}){const p=clone(program),a=p.collaboration.participants.find(x=>x.id===participantId);if(!a)throw new TypeError('Участник не найден');a.name=text(name,160);a.role=role(roleValue);a.provenance='local-manual';recordHistory(p,'Изменен участник','Прежние авторские снимки не изменены.');return clone(p);}
export function selectParticipant(program,participantId){const p=clone(program);if(participantId!==null&&!p.collaboration.participants.some(x=>x.id===participantId))throw new TypeError('Участник не найден');if(p.collaboration.activeParticipantId!==participantId){p.collaboration.activeParticipantId=participantId;recordHistory(p,'Выбран автор','Изменен автор последующих организационных записей.');}return clone(p);}
export function removeParticipant(program,participantId){const p=clone(program);if(!p.collaboration.participants.some(x=>x.id===participantId))throw new TypeError('Участник не найден');recordHistory(p,'Удален участник','Снимки авторов прежних записей сохранены.');p.collaboration.participants=p.collaboration.participants.filter(x=>x.id!==participantId);if(p.collaboration.activeParticipantId===participantId)p.collaboration.activeParticipantId=null;return clone(p);}
export function addComment(program,{scope,measureId=null,text:value}){const p=clone(program);if(p.collaboration.comments.length>=200)throw new RangeError('Не более 200 комментариев');p.collaboration.comments.push({id:crypto.randomUUID(),scope,measureId,text:text(value),author:actor(p),at:new Date().toISOString(),provenance:'local-manual'});recordHistory(p,'Добавлен комментарий',scope==='program'?'К программе':'К мере «'+measureTitle(measureId)+'»');return clone(p);}
export function addDecision(program,{revision,decision,note='',confirmed=false}){const p=clone(program);if(confirmed!==true)throw new TypeError('Нужно отдельное явное подтверждение решения');if(revision!==p.collaboration.revision)throw new TypeError('Версия изменилась: пересмотрите решение');if(!p.collaboration.activeParticipantId)throw new TypeError('Явно выберите автора организационной записи');if(p.collaboration.decisions.length>=100)throw new RangeError('Не более 100 решений');if(!outcomes.includes(decision))throw new TypeError('Неизвестный вид решения');p.collaboration.decisions.push({id:crypto.randomUUID(),revision,decision,note:text(note),author:actor(p),at:new Date().toISOString(),provenance:'local-manual'});recordHistory(p,'Записано решение',`Версия ${revision}: ${({approve:'Согласовано', 'changes-requested':'Запрошены изменения', reject:'Отклонено'})[decision]}. Организационная запись, не подтверждение денег.`);return clone(p);}
export function decisionStatus(program,decision){const p=clone(program),d=p.collaboration.decisions.find(x=>x.id===decision.id);if(!d)throw new TypeError('Решение не найдено');return d.provenance==='received-unverified'?'received-unverified':d.revision===p.collaboration.revision?'current-local':'stale';}
export function markCollaborationReceived(program){const p=clone(program);p.collaboration.activeParticipantId=null;for(const key of ['participants','comments','history','decisions'])p.collaboration[key].forEach(item=>{item.provenance='received-unverified';});return p;}
