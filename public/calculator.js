export function calculateSavings(input) {
  const limits = { annualSpend: [0, 1000000], savingsPercent: [0, 100], implementationCost: [0, 1000000], monthlyCost: [0, 100000], rampMonths: [0, 36] };
  const values = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw new RangeError(`Некорректное значение: ${key}`);
    values[key] = n;
  }
  const { annualSpend, savingsPercent, implementationCost, monthlyCost, rampMonths } = values;
  const annualGross = annualSpend * savingsPercent / 100;
  const monthGross = annualGross / 12;
  let accumulated = -implementationCost;
  let firstYearGross = 0;
  let paybackMonths = implementationCost === 0 && monthGross > monthlyCost && rampMonths === 0 ? 0 : null;
  const series = [];
  for (let month = 1; month <= 120; month++) {
    const factor = rampMonths === 0 ? 1 : Math.min(1, (month - 0.5) / rampMonths);
    const gross = monthGross * factor;
    const net = gross - monthlyCost;
    const previous = accumulated;
    accumulated += net;
    if (paybackMonths === null && net > 0 && previous <= 0 && accumulated >= 0) paybackMonths = month - 1 + (-previous / net);
    if (month <= 12) { firstYearGross += gross; series.push({ month, gross, net, accumulated }); }
  }
  return { ...values, annualGross, annualNet: annualGross - monthlyCost * 12, firstYearGross, firstYearNet: firstYearGross - implementationCost - monthlyCost * 12, paybackMonths, series };
}
