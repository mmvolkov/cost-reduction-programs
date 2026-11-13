import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const ui=await readFile(new URL('../public/program-p2-ui.js',import.meta.url),'utf8');
const p1=await readFile(new URL('../public/program-ui.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/program-styles.css',import.meta.url),'utf8');

test('P2 integrates through validated P1 mutation and current schema, not a second store',()=>{
 assert.match(p1,/import \{ PROGRAM_SCHEMA_VERSION, PROGRAM_STORAGE_KEY \}/);
 assert.doesNotMatch(p1,/schemaVersion:1/);
 assert.match(p1,/createProgramP2Controller\(\{getProgram:\(\)=>clone\(active\(\)\),mutate:apply,canNavigate,announce,refreshP1:render\}\)/);
 assert.match(p1,/p2\.refreshDerived\(\)/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|\.setItem\(/);
});
test('P2 does not execute imported HTML or transmit program data',()=>{
 assert.doesNotMatch(ui,/\.innerHTML\s*=|\bfetch\s*\(|XMLHttpRequest|sendBeacon|eval\s*\(/);
 assert.match(ui,/n\.textContent=text/);
 assert.match(ui,/file\.accept='\.csv,\.xlsx'/);
 assert.match(ui,/f\.size>4\*1024\*1024/);
 assert.match(ui,/expected!==getProgram\(\)\.id\|\|version!==requestVersion/);
});
test('preview requires explicit units, period and duplicate decisions before commit',()=>{
 assert.match(ui,/if\(!unit\|\|!periodMode\)/);
 assert.match(ui,/previewExpenseImport\(sheet/);
 assert.match(ui,/finalizeExpenseImport\(preview,decisions\)/);
 assert.match(ui,/\['','Решите явно'\]/);
 assert.match(ui,/current\.expenses\.records\.length\+records\.length>MAX_EXPENSE_RECORDS/);
 assert.match(ui,/\[\['','Выберите явно'\],\['exact-12'/);
});
test('base application is explicit and only replaces selected measure annualSpend',()=>{
 assert.match(ui,/if\(!window\.confirm\(`/);
 assert.match(ui,/m\.inputs\.annualSpend=result\.annualSpend;n\.overlap\.confirmed=false/);
 assert.doesNotMatch(ui,/\.facts\s*=|\.facts\.push/);
 assert.match(ui,/expenseBaseForSelection\(getProgram\(\)\.expenses\.records,filter,\[\.\.\.selectedMonths\]\.sort\(\),annualMethod\)/);
});
test('scenarios and priority use shared pure domain and disclose uncertainty',()=>{
 for(const api of ['diagnoseProgram','addDiagnosticMeasures','createComparisonScenarios','updateComparisonScenario','compareProgramScenarios','rankProgramMeasures'])assert.ok(ui.includes(api));
 assert.match(ui,/compositionDifferences/);
 assert.match(ui,/priorityOptions\[key\]/);
 assert.match(ui,/r\.complete\?'Не достигнута':'Нет данных'/);
 assert.match(ui,/Факты и подтверждения не переносятся/);
});
test('P2 controls and tables remain scoped and keyboard accessible',()=>{
 assert.match(ui,/wrap\.tabIndex=0/);
 assert.match(ui,/wrap\.setAttribute\('aria-label',label\)/);
 assert.match(css,/\.pm-p2-panel>summary \{[^}]*min-height:48px/);
 assert.match(css,/@media\(max-width:420px\).*\.pm-step-nav \{ grid-template-columns:1fr;/s);
 assert.match(css,/\.program-workspace :is\(input,select,textarea\) \{ font-size:16px/);
});

import {expenseBaseForSelection,formatPaybackMonths} from '../public/program-p2-ui.js';
test('period filtering cannot silently shrink numerator while keeping unrelated denominator months',()=>{
 const records=[{period:'2026-01',article:'A',amountRub:100},{period:'2026-02',article:'A',amountRub:200}];
 assert.throws(()=>expenseBaseForSelection(records,{months:['2026-01']},['2026-01','2026-02'],'average-month'),/фильтром/);
 assert.equal(expenseBaseForSelection(records,{months:['2026-01']},['2026-01'],'average-month').annualSpend,0.0012);
 assert.equal(expenseBaseForSelection(records,{months:[]},['2026-01','2026-02'],'average-month').annualSpend,0.0018);
});
test('diagnostic and scenario edits cannot keep hidden recommendations or trap empty snapshots',()=>{
 assert.match(ui,/function changeDiagnostic[\s\S]*?chosen\.clear\(\)/);
 assert.match(ui,/Добавьте меры в программу перед созданием альтернатив/);
 assert.match(ui,/Обновить эту альтернативу из текущей базы/);
});

test('changing import settings invalidates both visible preview and pending parse',()=>{
 assert.match(ui,/function invalidatePreview\(\)\{preview=null;decisions=\{\};importBox\?\.querySelector\('#pm-import-preview'\)\?\.replaceChildren/);
 assert.match(ui,/delimiter=v;requestVersion\+\+;busy=false;book=null;invalidatePreview\(\)/);
});

test('a mutation cannot leave the current program too large for its recovery JSON export',()=>{
 assert.match(p1,/const valid=recordProgramChange\(active\(\),validateProgram\(next\)\);exportProgramJson\(valid\);state\.programs=/);
 assert.match(p1,/function addProgram\(program\)\{try\{exportProgramJson\(program\);\}/);
});

 test('payback presentation is concise without rounding a positive tiny period to zero',()=>{
 assert.equal(formatPaybackMonths(6.666666667),'6,67 мес.');
 assert.equal(formatPaybackMonths(2.5),'2,5 мес.');
 assert.equal(formatPaybackMonths(0.001),'< 0,01 мес.');
 assert.equal(formatPaybackMonths(0.01),'0,01 мес.');
 assert.equal(formatPaybackMonths(0),'0 мес.');
 for(const unknown of [null,undefined,NaN,Infinity,-1])assert.equal(formatPaybackMonths(unknown),'Нет данных');
 assert.match(ui,/formatPaybackMonths\(r\.paybackMonths\)/);
 assert.match(ui,/formatPaybackMonths\(r\.payback\)/);
 });

test('P2 table row headings retain readable widths inside scoped horizontal scroll',()=>{
 assert.match(css,/\.pm-p2 \.pm-table-scroll th \{[^}]*min-width:110px;[^}]*word-break:normal;[^}]*overflow-wrap:break-word;/);
 assert.match(css,/\.pm-p2 \.pm-table-scroll th:first-child \{ min-width:140px;/);
 assert.match(css,/\.pm-table-scroll \{ overflow-x:auto;[^}]*max-width:100%;/);
});
