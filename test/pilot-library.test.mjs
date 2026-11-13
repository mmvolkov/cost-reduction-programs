import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measures} from '../public/data.js';
import {createProgram,createProgramMeasure,confirmFact} from '../public/program-model.js';
import {pilotLibrary,pilotLibraryNotice,getPilot,pilotTemplate,addPilotMeasure,previewPilotNotes,applyPilotNotes,discardPilotNotes} from '../public/pilot-library.js';

test('nine stable educational pilots reference known unchanged measure IDs with complete guidance',()=>{
 assert.equal(pilotLibrary.length,9);assert.equal(new Set(pilotLibrary.map(p=>p.id)).size,9);
 assert.deepEqual(pilotLibrary.map(p=>p.measureId),measures.map(m=>m.id));
 for(const p of pilotLibrary){assert.equal(p.kind,'educational');assert.match(p.id,/^pilot-[a-z-]+$/);assert.ok(Object.isFrozen(p));for(const key of ['title','applicability','baseline','metric','qualityGuard','stopRule','evidence'])assert.ok(p[key].length>30,key);assert.equal(p.actions.length,3);assert.ok(p.risks.length>=2);assert.ok(Object.isFrozen(p.actions));assert.ok(Object.isFrozen(p.risks));assert.equal(getPilot(p.id),p);const template=pilotTemplate(p.id);assert.ok(template.includes(pilotLibraryNotice));for(const value of [p.title,p.metric,p.stopRule,...p.actions,...p.risks])assert.ok(template.includes(value));assert.doesNotMatch(template,/\d+\s*%/);}
 assert.throws(()=>getPilot('__proto__'));assert.throws(()=>pilotTemplate('unknown'));
});
test('adding a pilot creates only its missing known measure with no guessed finances or facts',()=>{
 const p=createProgram({id:'pilot-test'}),old=JSON.stringify(p);p.overlap.confirmed=true;
 const {program:next,added,measureId}=addPilotMeasure(p,pilotLibrary[0].id);
 assert.equal(added,true);assert.equal(measureId,'procurement');assert.equal(next.measures.length,1);assert.equal(next.overlap.confirmed,false);
 assert.deepEqual(next.measures[0].inputs,{annualSpend:null,savingsPercent:null,implementationCost:null,monthlyCost:null,rampMonths:null,startMonth:1});assert.ok(next.measures[0].facts.every(f=>f.baseline===null&&f.confirmed===false));assert.ok(Object.values(next.measures[0].execution).every((v,k)=>v===''||v==='hypothesis'));
 assert.equal(p.measures.length,0);assert.equal(p.overlap.confirmed,true);assert.notEqual(JSON.stringify(next),old);
});
test('an existing excluded measure and confirmed facts are never overwritten or re-included',()=>{
 const p=createProgram({id:'preserve'}),m=createProgramMeasure('procurement');m.included=false;m.inputs={annualSpend:12,savingsPercent:10,implementationCost:.2,monthlyCost:.02,rampMonths:0,startMonth:1};m.execution.notes='<script>alert(1)</script>';m.execution.owner='Тестовый ответственный';m.facts[0]=confirmFact({...m.facts[0],baseline:1,actualSpend:.9,implementationCost:0,monthlyCost:0,source:'Искусственные данные',qualityChecked:true});p.measures.push(m);p.overlap.confirmed=true;const before=JSON.stringify(p);
 const result=addPilotMeasure(p,pilotLibrary[0].id);assert.equal(result.added,false);assert.equal(JSON.stringify(result.program),before);assert.equal(JSON.stringify(p),before);
 const additional=addPilotMeasure(p,pilotLibrary[1].id);assert.equal(additional.added,true);assert.deepEqual(additional.program.measures[0],m);assert.equal(JSON.stringify(p),before);
});
test('templates distinguish working capital and capacity from money, preserve safety and evidence caveats',()=>{
 assert.match(pilotTemplate('pilot-inventory-replenishment'),/Высвобожденные деньги не равны экономии расходов/);
 assert.match(pilotTemplate('pilot-process-single-entry'),/Высвобожденные часы/);
 assert.match(pilotTemplate('pilot-maintenance-critical-unit'),/Обязательные регламенты/);
 assert.match(pilotTemplate('pilot-procurement-total-cost'),/само по себе не подтверждает эффект/);
});
test('library UI stays local and text-only, with deliberate guarded additions and readable narrow layout',async()=>{
 const ui=await readFile(new URL('../public/pilot-library-ui.js',import.meta.url),'utf8'),css=await readFile(new URL('../public/pilot-library.css',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/innerHTML|insertAdjacentHTML|\bfetch\s*\(|localStorage|sessionStorage|eval\s*\(/);
 assert.match(ui,/n\.textContent=text/);assert.match(ui,/text\.readOnly=true/);assert.match(ui,/if\(!canNavigate\(\)\)return/);assert.match(ui,/if\(!result\.added\)/);assert.match(ui,/button\.disabled=exists/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);assert.match(css,/@media\(max-width:760px\)/);assert.match(css,/grid-template-columns:1fr/);assert.match(css,/font-size:16px/);assert.match(css,/min-height:48px/);
});


test('pilot note preview is immutable and read-only until separate confirmation',()=>{
 const p=createProgram({id:'preview'});p.measures.push(createProgramMeasure('procurement'));p.measures[0].execution.notes='<b>Исходный текст</b>';const before=JSON.stringify(p),preview=previewPilotNotes(p,pilotLibrary[0].id,7);
 assert.ok(Object.isFrozen(preview));assert.equal(preview.before,'<b>Исходный текст</b>');assert.equal(preview.after,pilotTemplate(pilotLibrary[0].id));assert.ok(preview.after.length<=4000);assert.equal(JSON.stringify(p),before);
 for(const confirmed of [false,undefined,1,'true'])assert.throws(()=>applyPilotNotes(p,preview,{confirmed,revision:7}));
 assert.throws(()=>applyPilotNotes(p,{...preview},{confirmed:true,revision:7}));assert.equal(JSON.stringify(p),before);
 assert.throws(()=>previewPilotNotes(createProgram({id:'empty'}),pilotLibrary[0].id));
 for(const pilot of pilotLibrary)assert.ok(pilotTemplate(pilot.id).length<=4000);
});
test('confirmed pilot applies only notes, including excluded measures with confirmed facts',()=>{
 const p=createProgram({id:'notes'}),m=createProgramMeasure('procurement');m.included=false;m.inputs={annualSpend:12,savingsPercent:10,implementationCost:.2,monthlyCost:.02,rampMonths:0,startMonth:1};m.execution.owner='Тест';m.execution.notes='Заменяемая заметка';m.facts[0]=confirmFact({...m.facts[0],baseline:1,actualSpend:.9,implementationCost:0,monthlyCost:0,source:'Учебный факт',qualityChecked:true});p.measures.push(m);p.overlap.confirmed=true;
 const before=JSON.stringify(p),preview=previewPilotNotes(p,pilotLibrary[0].id,1),result=applyPilotNotes(p,preview,{confirmed:true,revision:1});assert.equal(result.measures[0].execution.notes,preview.after);result.measures[0].execution.notes=m.execution.notes;assert.equal(JSON.stringify(result),before);assert.equal(JSON.stringify(p),before);
});
test('full-program and revision snapshots reject changed program, measure, other fields, and edit-revert',()=>{
 const p=createProgram({id:'stale'});p.measures.push(createProgramMeasure('procurement'));const preview=previewPilotNotes(p,pilotLibrary[0].id,2);
 for(const change of [n=>n.id='different',n=>n.name='Новое имя',n=>n.notes='Другая правка',n=>n.measures[0].execution.owner='Новый',n=>n.measures[0].inputs.annualSpend=3,n=>n.measures=[]]){const next=structuredClone(p);change(next);assert.throws(()=>applyPilotNotes(next,preview,{confirmed:true,revision:2}));}
 assert.throws(()=>applyPilotNotes(p,preview,{confirmed:true,revision:3}));
});

test('cancelled preview token can never be applied after cancellation',()=>{
 const p=createProgram({id:'cancel-token'});p.measures.push(createProgramMeasure('procurement'));const preview=previewPilotNotes(p,pilotLibrary[0].id);discardPilotNotes(preview);assert.throws(()=>applyPilotNotes(p,preview,{confirmed:true}));assert.equal(p.measures[0].execution.notes,'');
});
