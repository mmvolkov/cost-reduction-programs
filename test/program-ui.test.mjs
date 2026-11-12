import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/program-ui.js', import.meta.url), 'utf8');

test('month edit refreshes individual measure notices after rebuilding their DOM', () => {
  // Source-level guard for the render-order regression found by browser QA.
  assert.match(source, /if\(ok!==false&&type==='month'\)\{renderMeasures\(\);renderFacts\(\);updateSummary\(\);\}/);
});

test('payback display rounds months separately without reducing monetary precision', () => {
  assert.match(source, /const payback = n => new Intl.NumberFormat\('ru-RU', \{ maximumFractionDigits:2 \}\)/);
  assert.match(source, /payback\(r\.paybackMonths\)/);
  assert.match(source, /payback\(row\.calculation\.paybackMonths\)/);
  assert.match(source, /const money = .*maximumSignificantDigits: 10/);
});

test('month structural refresh is blocked by another invalid field without overwriting it', () => {
  assert.match(source, /if\(type==='month'\)\{const otherInvalid=\[\.\.\.root\.querySelectorAll\(':invalid'\)\]\.find\(node=>node!==input\)/);
  assert.match(source, /if\(otherInvalid\)\{input\.value=active\(\)\.startMonth;[\s\S]*?otherInvalid\.focus\(\);return;/);
});

test('actual UI uses shared safe confirmed aggregate and explicit monthly coverage',()=>{
 assert.match(source,/const presentation=actualSummaryPresentation\(r\)/);
 for(const key of ['coverage','completeness','confirmation'])assert.ok(source.includes(`presentation.${key}`));
 assert.doesNotMatch(source,/money\(actual\.confirmedNet\)/);
 assert.match(source,/if\(factEconomicsChanged\(previous,next\)\)n\.overlap\.confirmed=false/);
});


test('normalization input does not impose an arbitrary positive-volume floor beyond the model',()=>{
 assert.doesNotMatch(source,/baseVolume'\?0\.000000001/);
 assert.match(source,/type:'number',min:0,max:1000000000000,step:'any',id:`pm-fact-/);
});
