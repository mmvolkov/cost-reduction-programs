import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram,createProgramMeasure,confirmFact } from '../public/program-model.js';
import { createProgramReport,exportProgramReport } from '../public/program-report.js';
import { reportText } from '../public/report-export.js';
function sample(){const p=createProgram({name:'Рабочая программа № 7',startMonth:'2026-01'}),m=createProgramMeasure('procurement');m.inputs={annualSpend:12,savingsPercent:10,implementationCost:.2,monthlyCost:.02,rampMonths:0,startMonth:1};m.execution.owner='Иван Петров';m.execution.dueDate='2026-03-31';m.execution.nextStep='Сверить коммерческие предложения';m.execution.successCriterion='Цена ниже при равном объёме';m.execution.qualityMetric='Срок поставки не увеличен';m.facts[0]=confirmFact({baseline:1,actualSpend:1.2,implementationCost:.1,monthlyCost:.02,source:'Счёт № 123; проверка главного бухгалтера',qualityChecked:true,normalization:{enabled:false,baseVolume:null,actualVolume:null,unit:''},confirmed:false});p.measures.push(m);return p;}
function zipText(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let p=0;const out={};while(view.getUint32(p,true)===0x04034b50){const size=view.getUint32(p+18,true),n=view.getUint16(p+26,true),extra=view.getUint16(p+28,true),name=new TextDecoder().decode(bytes.subarray(p+30,p+30+n)),start=p+30+n+extra;out[name]=new TextDecoder().decode(bytes.subarray(start,start+size));p=start+size;}return out;}
test('program report uses actual execution fields, same deterministic totals, negative facts and matched plan only',()=>{
 const report=createProgramReport(sample()),text=reportText(report);assert.ok(Math.abs(report.calculation.firstYearNet-.76)<1e-12);assert.ok(Math.abs(report.calculation.paybackMonths-2.5)<1e-12);
 for(const phrase of ['Рабочая программа № 7','Иван Петров','2026-03-31','Сверить коммерческие предложения','Счет № 123','-0,32 млн ₽','0,76 млн ₽','0,96 млн ₽','2,5 мес.','не независимый аудит','Пропуски не равны нулю','только за те же заполненные пары'])assert.ok(text.includes(phrase),phrase);
 assert.doesNotMatch(text,/Владелец: __________/);assert.equal(report.calculation.actual.filledCells,1);assert.ok(Math.abs(report.calculation.actual.matchedPlan-(-.12))<1e-12);
});
test('unset fields, incomplete plans and unresolved overlaps are explicit, never a full total',()=>{
 const p=sample();p.measures.push(createProgramMeasure('production'));const text=reportText(createProgramReport(p));
 for(const phrase of ['Достоверный общий итог заблокирован','Предварительная сумма заполненных мер, НЕ полный итог','Ответственный: Не задано. Срок: Не задано.','Общая окупаемость по сумме потоков: не показывается','не подтверждено','неполные; результат этой меры не включен'])assert.ok(text.includes(phrase),phrase);
});
test('all four program exports are real files with Russian data and safe HTML/OOXML',async()=>{
 const p=sample();p.notes='<img src=x onerror="alert(1)"> & отчёт';
 for(const format of ['txt','html','docx','pdf']){
  const result=await exportProgramReport(p,format),bytes=new Uint8Array(await result.blob.arrayBuffer());assert.equal(result.filename,`cost-reduction-program.${format}`);
  if(format==='pdf'){const raw=new TextDecoder('latin1').decode(bytes);assert.match(raw,/^%PDF-/);assert.match(raw,/\/ToUnicode/);assert.doesNotMatch(raw,/\/JavaScript|\/Launch|\/URI\b/);}
  else if(format==='docx'){const parts=zipText(bytes);assert.match(parts['word/document.xml'],/Иван Петров/);assert.match(parts['word/document.xml'],/Счет № 123/);assert.match(parts['word/document.xml'],/&lt;img/);assert.doesNotMatch(parts['word/_rels/document.xml.rels'],/TargetMode="External"/);}
  else {const text=await result.blob.text();assert.match(text,/Иван Петров/);assert.match(text,/0,76 млн ₽/);if(format==='html'){assert.match(text,/&lt;img/);assert.doesNotMatch(text,/<img|<script/);assert.match(text,/default-src 'none'/);}}
 }
 await assert.rejects(exportProgramReport(p,'exe'));await assert.rejects(exportProgramReport({...p,calculation:{net:999}},'txt'));
});

test('program report shows cost scope, individual economics and real 30/60/90 buckets without invented tasks',()=>{
 const p=sample();p.updatedAt='2026-11-12T12:34:56.000Z';p.measures[0].costScope='Только сырье цеха № 2';p.measures[0].inputs.startMonth=4;
 const ids=['production','logistics','energy','contracts','saas'];
 const dates=['2025-12-31','2026-01-30','2026-01-31','2026-04-01',''];
 ids.forEach((id,i)=>{const m=createProgramMeasure(id);m.execution.dueDate=dates[i];m.execution.nextStep=`Реальная задача ${i}`;p.measures.push(m);});
 const report=createProgramReport(p),text=reportText(report);
 for(const phrase of ['Последнее обновление (UTC): 2026-11-12T12:34:56.000Z','Только сырье цеха № 2','Индивидуальный первый год меры (12 месяцев от ее запуска): 0,76 млн ₽','Вклад в первые 12 месяцев программы: 0,52 млн ₽','Индивидуальная окупаемость от запуска меры: 2,5 мес.','Реальный план 30/60/90','До начала программы','Дни 1-30','Дни 31-60','Дни 61-90','После 90-го дня','Без заданного срока'])assert.ok(text.includes(phrase),phrase);
 const start=report.blocks.findIndex(b=>b.text==='Реальный план 30/60/90 из карточек исполнения');
 const plan=report.blocks.slice(start);let group='';const located={};for(const block of plan){if(block.type==='subheading')group=block.text;const found=block.text.match(/Реальная задача (\d)/);if(found)located[found[1]]=group;}
 assert.deepEqual(located,{'0':'До начала программы','1':'Дни 1-30','2':'Дни 31-60','3':'После 90-го дня','4':'Без заданного срока'});
});

test('two confirmed facts with unresolved overlap never show a confirmed aggregate, individual confirmations stay intact',async()=>{
 const p=sample(),second=structuredClone(p.measures[0]);second.id='energy';p.measures.push(second);p.overlap.confirmed=false;
 const report=createProgramReport(p),summary=report.blocks.slice(report.blocks.findIndex(b=>b.text==='План-факт по заполненным данным'),report.blocks.findIndex(b=>b.text==='Меры и реальный план исполнения')).map(b=>b.text).join('\n');
 assert.equal(report.calculation.actual.confirmedCells,2);assert.equal(report.calculation.actual.reliable,false);
 assert.match(summary,/Сводная подтвержденная сумма заблокирована.*двойного счета/);
 assert.doesNotMatch(summary,/Подтвержденный пользователем эффект по заполненным записям:/);
 assert.match(summary,/полностью заполнено месяцев: 1 из 12/);assert.match(summary,/Частичные данные/);
 assert.ok(p.measures.every(m=>m.facts[0].confirmed));
 const fullText=reportText(report);assert.equal((fullText.match(/Явно подтвержден пользователем/g)||[]).length,2);
 for(const format of ['txt','html','docx']){
   const file=await exportProgramReport(p,format);
   const text=format==='docx'?zipText(new Uint8Array(await file.blob.arrayBuffer()))['word/document.xml']:await file.blob.text();
   assert.match(text,/Сводная подтвержденная сумма заблокирована/);assert.doesNotMatch(text,/Подтвержденный пользователем эффект по заполненным записям:/);
 }
 p.overlap.confirmed=true;
 const resolved=reportText(createProgramReport(p));assert.match(resolved,/Подтвержденный пользователем эффект по заполненным записям: -0,64 млн ₽/);
});

test('shared UI/report presentation exposes incomplete months and incomplete plan independently',async()=>{
 const {actualSummaryPresentation}=await import('../public/program-report.js');
 const p=sample();let report=createProgramReport(p),view=actualSummaryPresentation(report.calculation);
 assert.equal(view.partial,true);assert.match(view.coverage,/1 из 12/);
 p.measures[0].facts=Array.from({length:12},()=>structuredClone(p.measures[0].facts[0]));
 report=createProgramReport(p);view=actualSummaryPresentation(report.calculation);assert.equal(view.partial,false);assert.match(view.coverage,/12 из 12/);
 p.measures[0].inputs.annualSpend=null;view=actualSummaryPresentation(createProgramReport(p).calculation);assert.equal(view.partial,true);assert.match(view.completeness,/план.*неполон/);
});

test('P2 reports preserve evidence, explain scenarios and distinguish expense register from savings',async()=>{
 const {createComparisonScenarios,updateComparisonScenario}=await import('../public/program-p2-model.js');
 let p=sample();p.name='Ёлка — сценарии';p.measures[0].costScope='Сырьё — участок № 2';
 p.measures[0].priority={complexity:'high',risk:'low',evidenceType:'supplier',sourceComment:'Счёт поставщика — проверка цены'};
 p.diagnostic={industry:'factory',spendAreas:['materials'],constraints:['quality'],availableData:['contracts']};
 p.expenses.records=[{id:'row1',period:'2026-01',article:'Сырьё',department:'Цех',supplier:'Поставщик',amountRub:120000,source:'synthetic.csv'}, {id:'row2',period:'2026-01',article:'Возврат',department:'Цех',supplier:'Поставщик',amountRub:-20000,source:'synthetic.csv'}];
 p=createComparisonScenarios(p);p=updateComparisonScenario(p,p.scenarios[0].id,'procurement',{savingsPercent:0});
 const original=JSON.stringify(p),report=createProgramReport(p),text=reportText(report);
 for(const phrase of ['Сложность: Высокая','Риск: Низкий','Основание: Предложение поставщика','Счет поставщика - проверка цены','Это расходы, а не факт экономии','100 000 ₽','не достигнута за 120 месяцев','(в базе 10)','Сырье - участок № 2','Общий старт: 2026-01'])assert.ok(text.includes(phrase),phrase);
 assert.equal(JSON.stringify(p),original);assert.ok(p.measures[0].facts[0].confirmed);
 assert.doesNotMatch(text,/[ёЁ\u2010-\u2015\u2212]/);
 for(const format of ['txt','html','docx','pdf']){
   const output=await exportProgramReport(p,format);assert.ok(output.blob.size>1000);
   if(format==='pdf')assert.match(new TextDecoder('latin1').decode(await output.blob.arrayBuffer()),/^%PDF-/);
   else {const outputText=format==='docx'?zipText(new Uint8Array(await output.blob.arrayBuffer()))['word/document.xml']:await output.blob.text();assert.match(outputText,/Предложение поставщика/);assert.match(outputText,/Сравнение сценариев/);assert.doesNotMatch(outputText,/[ёЁ\u2010-\u2015\u2212]/);}
 }
});

test('scenario report shows changed composition and incomplete parameters without invented totals',async()=>{
 const {createComparisonScenarios}=await import('../public/program-p2-model.js');
 const p=createComparisonScenarios(sample());p.measures.push(createProgramMeasure('energy'));
 const text=reportText(createProgramReport(p));
 assert.match(text,/Отличие состава от базы: .*отсутствует в альтернативе/);
 assert.match(text,/Достоверный общий итог заблокирован/);
 assert.match(text,/Предварительная сумма заполненной части/);
 assert.match(text,/Нет данных/);
 assert.match(text,/Сложность: Не оценена/);
});
