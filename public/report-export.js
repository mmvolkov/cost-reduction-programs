import { documentText } from './document-text.js';
import { calculateSavings } from './calculator.js';
import { inspectCalculation, fields } from './calculation-report.js';
import { measures } from './data.js';

const money = n => new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 12, notation: n !== 0 && Math.abs(n) < .000001 ? 'scientific' : 'standard' }).format(n);
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DISCLAIMER = 'Расчётный сценарий, не прогноз и не гарантия результата. Расчёт выполнен по формулам; модель AI не участвовала.';
const METHOD = 'Экономия растёт линейно в период разгона; в месяце используется средняя точка. Поддержка оплачивается с первого месяца, затраты запуска возникают в начале. Первый год — сумма месячной экономии за 12 месяцев минус поддержка и внедрение. Налоги, сезонность, стоимость капитала и изменение объёмов не моделируются. Высвобождение запасов и часов считается отдельно. Проверьте влияние на выручку и маржу и исключите двойной счёт. Окупаемость ищется в пределах 120 месяцев с линейной интерполяцией внутри месяца.';
export const exportFormats = Object.freeze({ txt:'text/plain;charset=utf-8', html:'text/html;charset=utf-8', pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

export function createReport(input, measureIds = []) {
  const { inputs, missing } = inspectCalculation(input);
  if (missing.length) throw new TypeError('Для экспорта заполните все поля калькулятора.');
  if (!Array.isArray(measureIds) || measureIds.length > measures.length || measureIds.some(id => typeof id !== 'string' || !measures.some(m => m.id === id))) throw new TypeError('Неизвестная мера программы.');
  const ids = [...new Set(measureIds)];
  const selected = measures.filter(m => ids.includes(m.id));
  const r = calculateSavings(inputs);
  const blocks = [];
  const add = (type, text) => blocks.push(Object.freeze({type, text:documentText(text)}));
  add('title', 'Программа снижения затрат'); add('subtitle', DISCLAIMER);
  add('heading', 'Исходные данные');
  for (const [key, spec] of Object.entries(fields)) add('paragraph', `${spec.label}: ${money(inputs[key])}`);
  add('heading', 'Результаты расчёта');
  add('paragraph', `Чистый эффект первого года: ${money(r.firstYearNet)} млн ₽`);
  add('paragraph', `Чистый годовой эффект на полном ходу: ${money(r.annualNet)} млн ₽`);
  add('paragraph', `Валовая годовая экономия на полном ходу: ${money(r.annualGross)} млн ₽`);
  add('paragraph', `Поддержка за год: ${money(inputs.monthlyCost * 12)} млн ₽`);
  add('paragraph', `Окупаемость: ${r.paybackMonths === null ? 'не достигнута за 120 месяцев' : r.paybackMonths === 0 ? 'без разовых вложений, положительный эффект сразу' : money(r.paybackMonths) + ' месяцев от начала программы'}`);
  if (r.annualNet <= 0) add('paragraph', 'При полном эффекте поддержка не покрывается экономией.');
  add('heading', 'Выбранные меры');
  if (!selected.length) add('paragraph', 'Меры не выбраны. Сценарий рассчитан только по указанным параметрам.');
  for (const m of selected) {
    add('subheading', m.title);
    m.steps.forEach((s,i) => add('paragraph', `${i+1}. ${s}`));
    add('paragraph', `Метрика: ${m.metric}`); add('paragraph', `Ограничение: ${m.guard}`);
    add('paragraph', 'Владелец: __________    Срок: __________');
  }
  add('heading', 'План 30/60/90');
  add('paragraph', '1–30: база расходов, владельцы, 3–5 гипотез, ограничения качества.');
  add('paragraph', '31–60: пилот, сверка факта с базой, учёт внедрения и пересечений.');
  add('paragraph', '61–90: масштабирование подтверждённого результата и ежемесячная проверка.');
  add('heading', 'Месячный накопленный эффект');
  r.series.forEach(p => add('paragraph', `Месяц ${p.month}: ${money(p.accumulated)} млн ₽`));
  add('heading', 'Методика и ограничения'); add('paragraph', METHOD);
  add('paragraph', 'Сделано в проекте cost-reduction-programs.');
  return Object.freeze({version:1, inputs:Object.freeze({...inputs}), measureIds:Object.freeze(ids), calculation:r, blocks:Object.freeze(blocks)});
}

export function reportText(report) {
  return report.blocks.map(b => b.text).join('\n\n');
}
export function reportHtml(report) {
  const body = report.blocks.map(b => {
    const tag = {title:'h1',heading:'h2',subheading:'h3',subtitle:'p',paragraph:'p'}[b.type] || 'p';
    return `<${tag}${b.type === 'subtitle' ? ' class="notice"' : ''}>${escape(b.text)}</${tag}>`;
  }).join('\n');
  return `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Программа снижения затрат</title><style>body{max-width:800px;margin:40px auto;padding:0 24px;font-family:system-ui,sans-serif;color:#111827;line-height:1.6;font-size:16px;overflow-wrap:anywhere}h1{font-size:30px;line-height:1.2}h2{margin-top:32px;color:#008241;font-size:22px;break-after:avoid}h3{margin-top:24px;font-size:18px;break-after:avoid}p{margin:10px 0}.notice{color:#475569;font-size:14px}@page{size:A4;margin:36pt}@media print{body{max-width:none;margin:0;padding:0;font-size:11pt}h1{font-size:22pt}h2{font-size:15pt}h3{font-size:12pt}.notice{font-size:10pt}p{orphans:3;widows:3}}</style></head><body>\n${body}\n</body></html>`;
}

export async function exportReport(report, format) {
  if (!Object.hasOwn(exportFormats, format)) throw new TypeError('Неизвестный формат экспорта.');
  // Rebuild from the confirmed inputs and library IDs, never trust injected report text/results.
  const canonical = createReport(report?.inputs, report?.measureIds);
  let bytes;
  if (format === 'txt') bytes = '\uFEFF' + reportText(canonical);
  else if (format === 'html') bytes = reportHtml(canonical);
  else if (format === 'docx') bytes = (await import('./report-export-docx.js')).buildDocx(canonical);
  else bytes = await (await import('./report-export-pdf.js')).buildPdf(canonical);
  return {blob:new Blob([bytes], {type:exportFormats[format]}), filename:`cost-reduction-plan.${format}`};
}
