import { validateProgram, calculateProgram, calculateActual } from './program-model.js';
import { measures as library } from './data.js';
import { fields } from './calculation-report.js';
import { reportText, reportHtml, exportFormats } from './report-export.js';

const money = n => new Intl.NumberFormat('ru-RU', {maximumSignificantDigits:12,notation:n !== 0 && Math.abs(n)<.000001?'scientific':'standard'}).format(n);
const specified = value => typeof value === 'string' && value.trim() ? value : 'Не задано';
const statuses = {hypothesis:'Гипотеза',review:'Проверка',pilot:'Пилот',implementation:'Внедрение',confirmation:'Подтверждение'};
const numeric = value => value === null ? 'Нет данных' : money(value);
const financial = value => value === null ? 'Нет данных' : `${money(value)} млн ₽`;
function monthName(start, offset) {
  const [year,month]=start.split('-').map(Number), d=new Date(Date.UTC(year,month-1+offset,1));
  return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(d);
}
// Shared by the browser summary and every report format: never present an
// unverified cross-measure sum as a confirmed financial result.
export function actualSummaryPresentation(calculation) {
  const actual=calculation.actual;
  const partial=actual.completeMonths<12 || !actual.comparisonComplete;
  return {
    partial,
    coverage:`Заполнено ${actual.filledCells} пар «мера × месяц»; полностью заполнено месяцев: ${actual.completeMonths} из 12. Пропуски не равны нулю.`,
    completeness:partial?'Частичные данные: не все меры/месяцы заполнены либо план для введенных фактов неполон. Сумма факта не является полным годовым итогом.':'Все включенные меры имеют факты за 12 месяцев; параметры сопоставимого плана заполнены.',
    confirmation:!calculation.overlapResolved || !actual.reliable && actual.confirmedCells>0
      ? 'Сводная подтвержденная сумма заблокирована до проверки пересечений и исключения двойного счета. Индивидуальные подтверждения сохранены.'
      : actual.confirmedCells>0
        ? `Подтвержденный пользователем эффект по заполненным записям: ${financial(actual.confirmedNet)} (${actual.confirmedCells} пар «мера × месяц»). Это оценка пользователя, не аудит; статус исполнения сам по себе не подтверждает деньги.`
        : 'Подтвержденных фактических записей пока нет. Статус исполнения сам по себе не подтверждает деньги.'
  };
}
export function createProgramReport(source) {
  const program=validateProgram(source), calculation=calculateProgram(program), blocks=[];
  const add=(type,text)=>blocks.push({type,text:String(text)});
  add('title',specified(program.name));
  add('subtitle','Рабочая программа снижения затрат. Расчёты по формулам, без AI. Подтверждение факта — оценка пользователя, не независимый аудит.');
  add('paragraph',`Начало программы: ${program.startMonth}. Денежные суммы в млн ₽.`);
  add('paragraph',`Последнее обновление (UTC): ${program.updatedAt}`);
  add('paragraph',`Заметки программы: ${specified(program.notes)}`);
  add('heading','Проверка полноты и пересечений');
  add('paragraph',calculation.reliable?'Все включённые меры заполнены; проверка пересечений пройдена. Расчёт остаётся сценарием, не гарантией экономии.':`Достоверный общий итог заблокирован: ${calculation.reasons.join('; ')}.`);
  add('paragraph',`Отсутствие двойного счёта: ${program.overlap.confirmed?'явно подтверждено пользователем':program.measures.filter(m=>m.included).length<=1?'между мерами не требуется (включено не более одной меры)':'не подтверждено'}. Пояснение: ${specified(program.overlap.note)}`);
  add('heading',calculation.reliable?'План программы':'Предварительная сумма заполненных мер, НЕ полный итог');
  add('paragraph',`План за 12 месяцев от начала программы: ${financial(calculation.firstYearNet)}.`);
  add('paragraph',`Годовой эффект при полном выходе всех заполненных мер на режим: ${financial(calculation.annualNet)}. Это не план первого года.`);
  add('paragraph',`Общая окупаемость по сумме потоков: ${calculation.reliable ? (calculation.paybackMonths===null?'не достигнута в горизонте 120 месяцев':`${money(calculation.paybackMonths)} мес. от начала программы`) : 'не показывается до заполнения мер и проверки пересечений'}.`);
  for(const row of calculation.series) add('paragraph',`Месяц ${row.month} (${monthName(program.startMonth,row.month-1)}): экономия ${financial(row.gross)}; внедрение ${financial(row.implementation)}; поддержка ${financial(row.support)}; чистый поток ${financial(row.net)}; накоплено ${financial(row.accumulated)}.`);
  add('heading','План-факт по заполненным данным');
  const actualPresentation=actualSummaryPresentation(calculation);
  add('paragraph',actualPresentation.coverage);
  add('paragraph',actualPresentation.completeness);
  add('paragraph',actualPresentation.confirmation);
  if(calculation.actual.filledCells) {
    add('paragraph',`${calculation.actual.reliable?'Сумма введённого факта':'Предварительная сумма факта, НЕ достоверный общий итог (пересечения не разрешены)'}: ${financial(calculation.actual.net)}.`);
    add('paragraph',calculation.actual.comparisonComplete ? `План только за те же заполненные пары «мера × месяц»: ${financial(calculation.actual.matchedPlan)}; отклонение факта от этого плана: ${financial(calculation.actual.variance)}. Годовой план приведён отдельно выше.` : 'Сопоставление план-факт неполное: у части введённых фактов не заполнены параметры плана. Общее отклонение не рассчитано.');
  } else add('paragraph','Нет заполненных фактов. Фактический эффект и отклонение не рассчитаны.');
  add('heading','Меры и реальный план исполнения');
  if(!program.measures.length) add('paragraph','Меры пока не добавлены.');
  for(const m of program.measures) {
    const entry=library.find(x=>x.id===m.id), result=calculation.measures.find(x=>x.id===m.id);
    add('subheading',`${entry.title} — ${m.included?'включена в суммы':'исключена из сумм'}`);
    add('paragraph',`Область расходов / границы базы: ${specified(m.costScope)}`);
    add('paragraph',`Начало: месяц ${m.inputs.startMonth} (${monthName(program.startMonth,m.inputs.startMonth-1)}). Параметры: ${result.complete?'заполнены':'неполные; результат этой меры не включён в план'}.`);
    for(const [key,spec] of Object.entries(fields)) add('paragraph',`${spec.label}: ${numeric(m.inputs[key])}`);
    if(result.complete) {
      add('paragraph',`Индивидуальный первый год меры (12 месяцев от её запуска): ${financial(result.calculation.firstYearNet)}. Вклад в первые 12 месяцев программы: ${financial(result.series[11].accumulated)}.`);
      add('paragraph',`Годовой эффект меры на полном режиме: ${financial(result.calculation.annualNet)}. Индивидуальная окупаемость от запуска меры: ${result.calculation.paybackMonths === null ? 'не достигнута за 120 месяцев' : `${money(result.calculation.paybackMonths)} мес.`}. Индивидуальные сроки не усредняются для общей окупаемости.`);
    } else add('paragraph','Индивидуальные итоги не рассчитаны: заполните все параметры меры.');
    add('paragraph',`Ответственный: ${specified(m.execution.owner)}. Срок: ${specified(m.execution.dueDate)}.`);
    add('paragraph',`Статус: ${statuses[m.execution.status]}. Следующий шаг: ${specified(m.execution.nextStep)}`);
    add('paragraph',`Критерий успеха: ${specified(m.execution.successCriterion)}`);
    add('paragraph',`Показатель качества: ${specified(m.execution.qualityMetric)}`);
    add('paragraph',`Заметки исполнения: ${specified(m.execution.notes)}`);
    add('paragraph',`Подсказка библиотеки — метрика: ${entry.metric} Ограничение: ${entry.guard}`);
    add('paragraph',`Подсказки следующих шагов: ${entry.steps.join(' ')}`);
    add('subheading','Месячные факты и подтверждения');
    m.facts.forEach((fact,index)=>{
      const actual=calculateActual(fact);
      add('paragraph',`Месяц ${index+1} (${monthName(program.startMonth,index)}): ${actual.complete?`факт ${financial(actual.net)}`:'нет полного набора данных'}. ${fact.confirmed?'Явно подтверждён пользователем':'Не подтверждён пользователем'}.`);
      add('paragraph',`Базовые расходы без изменений: ${financial(fact.baseline)}; фактические расходы без внедрения и поддержки: ${financial(fact.actualSpend)}; фактическое внедрение: ${financial(fact.implementationCost)}; фактическая поддержка: ${financial(fact.monthlyCost)}.`);
      if(fact.normalization.enabled) add('paragraph',`Нормализация включена: базовый объём ${numeric(fact.normalization.baseVolume)}; фактический объём ${numeric(fact.normalization.actualVolume)}; единица ${specified(fact.normalization.unit)}. Сопоставимая база = базовые расходы / базовый объём × фактический объём: ${financial(actual.comparableBaseline)}.`);
      else add('paragraph','Нормализация объёма отключена; сопоставимая база задана непосредственно.');
      add('paragraph',`Источник / пояснение: ${specified(fact.source)}. Качество: ${fact.qualityChecked?'проверено пользователем':'проверка не отмечена'}.`);
    });
  }
  add('heading','Реальный план 30/60/90 из карточек исполнения');
  add('paragraph','Группировка по сроку карточки относительно первого дня начального месяца программы. День начала — день 1. Здесь нет придуманных задач, ответственных и сроков.');
  const groups = [['before','До начала программы'],['30','Дни 1–30'],['60','Дни 31–60'],['90','Дни 61–90'],['after','После 90-го дня'],['unset','Без заданного срока']];
  const start = Date.parse(program.startMonth+'-01T00:00:00Z');
  const bucket = measure => {
    if(!measure.execution.dueDate) return 'unset';
    const day = Math.round((Date.parse(measure.execution.dueDate+'T00:00:00Z')-start)/86400000)+1;
    return day < 1 ? 'before' : day <= 30 ? '30' : day <= 60 ? '60' : day <= 90 ? '90' : 'after';
  };
  for(const [key,label] of groups) {
    add('subheading',label);
    const items = program.measures.filter(m=>bucket(m)===key);
    if(!items.length) add('paragraph','Карточек в этой группе нет.');
    for(const m of items) {
      const title = library.find(x=>x.id===m.id).title;
      add('paragraph',`${title}${m.included?'':' (исключена из сумм)'}. Ответственный: ${specified(m.execution.owner)}. Срок: ${specified(m.execution.dueDate)}. Статус: ${statuses[m.execution.status]}. Следующий шаг: ${specified(m.execution.nextStep)}`);
    }
  }
  add('heading','Методика и ограничения');
  add('paragraph','Каждая мера рассчитывается отдельно существующим калькулятором. Внедрение оплачивается в начале месяца запуска; поддержка начисляется с этого же месяца. До запуска потоки равны нулю. Линейный разгон использует среднюю точку месяца. Общая окупаемость определяется по суммарным потокам, а не средним сроком мер, в пределах 120 месяцев; учитываются поздние затраты запуска. Налоги, сезонность, изменение выручки и стоимость капитала не моделируются.');
  add('paragraph','Факт = сопоставимая база − фактические расходы − фактическое внедрение − фактическая поддержка. В поле расходов не включают внедрение и поддержку повторно. Отрицательный результат сохраняется. План сравнивается только с заполненными фактами для тех же мер и месяцев. Неполнота и нерешённые пересечения не дают достоверного общего итога.');
  add('paragraph','Программа хранится только в текущем браузере и origin. Файл сформирован локально, без передачи программы AI-провайдеру. JSON предназначен для резервного копирования; при импорте создаётся новая программа и подтверждения требуют повторной проверки.');
  return {version:1,program,calculation,blocks};
}
export async function exportProgramReport(program,format) {
  if(!Object.hasOwn(exportFormats,format)) throw new TypeError('Неизвестный формат экспорта.');
  const report=createProgramReport(program); let bytes;
  if(format==='txt') bytes='\uFEFF'+reportText(report);
  else if(format==='html') bytes=reportHtml(report);
  else if(format==='docx') bytes=(await import('./report-export-docx.js')).buildDocx(report);
  else bytes=await(await import('./report-export-pdf.js')).buildPdf(report);
  return {blob:new Blob([bytes],{type:exportFormats[format]}),filename:`cost-reduction-program.${format}`};
}
