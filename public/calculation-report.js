import { calculateSavings } from './calculator.js';

export const fields = Object.freeze({
  annualSpend: { label:'Годовая база затрат, млн ₽/год', max:1000000 },
  savingsPercent: { label:'Снижение затрат, %', max:100 },
  implementationCost: { label:'Разовые затраты внедрения, млн ₽', max:1000000 },
  monthlyCost: { label:'Поддержка, млн ₽/мес.', max:100000 },
  rampMonths: { label:'Линейный разгон, мес. (0 — сразу)', max:36 },
});
export const AI_NOTICE = 'AI-обсуждение, не проверенный расчёт. Числа и финансовые выводы могут быть ошибочны; подтверждённые результаты даёт только калькулятор.';
const fmt = n => new Intl.NumberFormat('ru-RU', { maximumSignificantDigits:12, notation:n !== 0 && Math.abs(n) < 0.000001 ? 'scientific' : 'standard' }).format(n);

export function inspectCalculation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('calculator');
  if (Object.keys(input).some(key => !Object.hasOwn(fields,key))) throw new TypeError('calculator fields');
  const inputs = {}, missing = [];
  for (const [key, spec] of Object.entries(fields)) {
    if (!Object.hasOwn(input,key)) { missing.push(key); continue; }
    const n = input[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > spec.max) throw new RangeError('calculator value');
    inputs[key] = n;
  }
  return { inputs, missing };
}

export function calculationReply(input = {}) {
  const { inputs, missing } = inspectCalculation(input);
  if (missing.length) return {
    kind:'calculation_inputs', nextAction:'open_calculator', missingFields:missing,
    content:'Для проверенного расчёта заполните и подтвердите поля калькулятора. Значения из свободного текста не подставляются автоматически. Ноль нужно указать явно.\n\nНе хватает:\n' + missing.map(key => '• ' + fields[key].label).join('\n') + '\n\nДо подтверждения всех полей финансовый результат не рассчитывается.',
  };
  const r = calculateSavings(inputs);
  const values = JSON.parse(JSON.stringify(r, (_key,value) => typeof value === 'number' ? Number(value.toPrecision(15)) : value));
  const payback = r.paybackMonths === null ? 'Не достигнута за 120 месяцев' : r.paybackMonths === 0 ? 'Без разовых вложений, положительный эффект сразу' : `${fmt(r.paybackMonths)} мес. от начала программы`;
  const lines = [
    'РАСЧЁТ ПО ФОРМУЛАМ. МОДЕЛЬ НЕ УЧАСТВОВАЛА.',
    'Использованы только подтверждённые поля формы. Текст сообщения не меняет эти значения.', '',
    'Исходные данные:', ...Object.entries(fields).map(([key,spec]) => `${spec.label}: ${fmt(inputs[key])}`), '',
    `Валовая годовая экономия при полном эффекте: ${fmt(r.annualGross)} млн ₽`,
    `Поддержка за год: ${fmt(inputs.monthlyCost * 12)} млн ₽`,
    `Чистый годовой эффект при полном эффекте: ${fmt(r.annualNet)} млн ₽`,
    `Чистый эффект первого года с учётом внедрения и разгона: ${fmt(r.firstYearNet)} млн ₽`,
    `Окупаемость: ${payback}.`,
  ];
  if (inputs.rampMonths === 0) lines.push('', `Первый год: ${fmt(inputs.annualSpend)} × ${fmt(inputs.savingsPercent)}% − ${fmt(inputs.monthlyCost)} × 12 − ${fmt(inputs.implementationCost)} = ${fmt(r.firstYearNet)} млн ₽.`);
  if (r.annualNet <= 0) lines.push('Предупреждение: при полном эффекте поддержка не покрывается экономией.');
  lines.push('', 'Это расчётный сценарий, не прогноз и не гарантия экономии. При разгоне используется линейное нарастание эффекта и средняя точка месяца. Поддержка начисляется с первого месяца, внедрение оплачивается в начале. Налоги, сезонность, потери выручки и стоимость капитала не учтены. Для другого сценария измените поля и подтвердите их заново.');
  return { kind:'calculation', content:lines.join('\n'), calculation:{ version:1, moneyUnit:'million_rub', inputs, values } };
}

// Best-effort routing only, NOT a guarantee about arbitrary model prose.
// Never extract, infer or calculate values from unstructured text.
export function requestsCalculation(text) {
  if (typeof text !== 'string') return false;
  if (/(?:рассчита|посчита|пересчита|окупаем|расч[её]т|сколько.{0,35}(?:эконом|сэконом|выгод)|calculate|payback)/iu.test(text)) return true;
  return /(?:затрат|расход|эконом|снижени|внедрени|поддержк|выручк|прибыл|марж)/iu.test(text) && /\d[\d\s.,]*\s*(?:млн|миллион|тыс|руб|₽|%|million|rub)/iu.test(text);
}
