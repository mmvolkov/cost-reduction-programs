import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSavings } from '../public/calculator.js';
const base = { annualSpend: 120, savingsPercent: 10, implementationCost: 2, monthlyCost: 0.1, rampMonths: 4 };
test('linear ramp and one-off vs recurring effects are separated', () => {
  const r = calculateSavings(base);
  assert.equal(r.annualGross, 12);
  assert.equal(r.firstYearGross, 10);
  assert.equal(r.firstYearNet, 6.8);
  assert.equal(r.annualNet, 10.8);
  assert.ok(Math.abs(r.paybackMonths - 4.4444444444) < 0.00001);
});
test('zero ramp reaches savings immediately', () => {
  const r = calculateSavings({ ...base, rampMonths: 0 });
  assert.equal(r.firstYearGross, 12);
  assert.ok(Math.abs(r.paybackMonths - 2 / .9) < .00001);
});
test('negative economics have no payback', () => {
  assert.equal(calculateSavings({ ...base, savingsPercent: 0 }).paybackMonths, null);
});
test('zero baseline and zero costs do not invent payback', () => {
  const r = calculateSavings({ ...base, annualSpend: 0, implementationCost: 0, monthlyCost: 0 });
  assert.equal(r.firstYearNet, 0); assert.equal(r.paybackMonths, null);
});
test('invalid and out-of-range values rejected', () => {
  for (const n of [-1, NaN, Infinity, 1000001]) assert.throws(() => calculateSavings({ ...base, annualSpend: n }));
  assert.throws(() => calculateSavings({ ...base, savingsPercent: 101 }));
});
test('ramp over one year stays partial and first year can be negative', () => {
  const r = calculateSavings({ ...base, rampMonths: 24, implementationCost: 20 });
  assert.equal(r.firstYearGross, 3); assert.ok(r.firstYearNet < 0);
});
test('exact breakeven at the ten-year horizon is counted', () => {
  assert.equal(calculateSavings({ annualSpend:12, savingsPercent:100, implementationCost:120, monthlyCost:0, rampMonths:0 }).paybackMonths,120);
});
