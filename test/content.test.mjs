import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { measures, cases, industries } from '../public/data.js';
import { calculateSavings } from '../public/calculator.js';

test('library, cases and industries reference valid unique measures', () => {
  const ids = new Set(measures.map(m => m.id));
  assert.equal(ids.size, measures.length);
  assert.equal(industries.length, 6);
  for (const m of measures) { assert.ok(m.guard); assert.ok(m.metric); assert.ok(m.steps.length > 0); }
  for (const item of [...cases, ...industries]) for (const id of item.measures) assert.ok(ids.has(id));
});
test('every illustrative case can be evaluated without invented data', () => {
  for (const c of cases) {
    const r = calculateSavings({ annualSpend:c.spend, savingsPercent:c.rate, implementationCost:c.investment, monthlyCost:c.monthly, rampMonths:c.ramp });
    assert.ok(Number.isFinite(r.firstYearNet)); assert.ok(r.series.length === 12);
  }
});
test('page anchors and local assets exist; no duplicate ids or inline scripts/styles', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]), match[1]);
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) await access(new URL('../public'+match[1], import.meta.url));
  assert.doesNotMatch(html, /<script(?![^>]+src=)[^>]*>|\bstyle="|\bonclick="/i);
});
