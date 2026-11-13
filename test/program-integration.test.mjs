import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { measures, cases, industries } from '../public/data.js';
const read = path => readFile(new URL('../'+path, import.meta.url), 'utf8');
test('P1 preserves all original library measures, industries and teaching cases', () => {
  assert.equal(measures.length,9); assert.equal(industries.length,6); assert.equal(cases.length,3);
});
test('working programs are wired separately from teaching calculator and case changes', async () => {
  const app = await read('public/app.js'), html=await read('public/index.html');
  assert.match(html,/id="program-workspace"/); assert.match(html,/href="\.\/program-styles.css"/);
  assert.match(app,/initProgramWorkspace\(/); assert.match(app,/programWorkspace\.toggleMeasure\(b\.dataset\.id\)/);
  const caseHandler = app.match(/\$\('#case-grid'\)\.addEventListener\('click',[^\n]+/)[0];
  assert.match(caseHandler,/fillInputs/); assert.doesNotMatch(caseHandler,/selected\.clear|programWorkspace\./);
  assert.match(app,/item\.measures\.forEach\(id=>programWorkspace\.addMeasure\(id\)\)/);
});
test('program UI is browser-only and renders user values without HTML injection', async () => {
  for (const path of ['public/program-ui.js','public/program-model.js','public/program-storage.js','public/program-report.js']) {
    const source=await read(path);
    assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\.innerHTML\s*=/,path);
  }
  const app=await read('public/app.js');
  assert.match(app,/temperature:0/);
  assert.doesNotMatch(app,/currentContext\.program|currentContext\.facts|JSON\.stringify\(program/);
});
test('branch checks cover P1/P2/P3 without deploying review branches', async () => {
  const ci=await read('.github/workflows/ci.yml'), pages=await read('.github/workflows/pages.yml');
  assert.match(ci,/branches: \[main, codex\/program-management-p1, codex\/program-management-p2, codex\/program-management-p3\]/);
  assert.match(pages,/branches: \[main\]/); assert.doesNotMatch(pages,/program-management-p[123]/);
});
test('pilot previews use the workspace monotonic revision and cross-tab conflict gate', async () => {
  const source=await read('public/program-ui.js');
  const wiring=source.split('\n').find(line=>line.includes('const pilots=createPilotLibraryController('));
  assert.match(wiring,/getRevision:\(\)=>workspaceRevision/);
  assert.match(wiring,/canNavigate:canUseContextualTools/);
  assert.match(source,/function canUseContextualTools\(\)[\s\S]*?store\.checkCurrent\(/);
  // A pilot's own confirmation checkbox must not stale its preview. Inputs in
  // the actual program remain outside these two narrowly scoped review panels.
  assert.match(source,/root\.addEventListener\('input',event=>\{if\(!event\.target\.closest\('#pm-context-ai, #pm-pilot-library \.pm-pilot-preview'\)\)invalidateAi/);
});
