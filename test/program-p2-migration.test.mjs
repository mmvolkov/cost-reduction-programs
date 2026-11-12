import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram,createProgramMeasure } from '../public/program-model.js';
import { createProgramStore,PROGRAM_STORAGE_KEY,validateProgramState,exportProgramJson,importProgramJson } from '../public/program-storage.js';
function locks(){let queue=Promise.resolve();return {request(name,options,callback){assert.equal(name,PROGRAM_STORAGE_KEY+'.writer');const result=queue.then(callback);queue=result.catch(()=>{});return result;}};}
function memory(initial){let raw=initial,writes=0;return {getItem(){return raw;},setItem(k,v){assert.equal(k,PROGRAM_STORAGE_KEY);raw=v;writes++;},get raw(){return raw;},get writes(){return writes;}};}
function legacy(){const p=createProgram({id:'legacy',name:'Старая программа'});p.measures.push(createProgramMeasure('procurement'));p.measures[0].execution.owner='Владелец';p.measures[0].facts[0]={baseline:1,actualSpend:.9,implementationCost:0,monthlyCost:0,source:'Регистр',qualityChecked:true,normalization:{enabled:false,baseVolume:null,actualVolume:null,unit:''},confirmed:true};p.overlap={confirmed:true,note:'Проверено'};delete p.diagnostic;delete p.expenses;delete p.scenarios;p.measures.forEach(m=>delete m.priority);return p;}
const state=p=>({schemaVersion:1,activeId:p.id,programs:[p]});
test('legacy load migrates only in memory and first successful save atomically emits v2',async()=>{
 const p=legacy(),original=JSON.stringify(state(p)),storage=memory(original),store=createProgramStore(storage,{locks:locks()}),loaded=store.load();assert.equal(loaded.ok,true);assert.equal(loaded.state.schemaVersion,2);assert.equal(storage.writes,0);assert.equal(storage.raw,original);assert.equal(loaded.state.programs[0].measures[0].facts[0].confirmed,true);assert.equal(loaded.state.programs[0].overlap.confirmed,true);assert.equal(loaded.state.programs[0].updatedAt,p.updatedAt);assert.equal(loaded.state.programs[0].measures[0].execution.owner,'Владелец');assert.equal((await store.save(loaded.state)).ok,true);assert.equal(JSON.parse(storage.raw).schemaVersion,2);
});
test('migration with quota or unavailable lock preserves exact original P1 raw bytes',async()=>{
 const original=JSON.stringify(state(legacy()));for(const mode of ['quota','lock']){const storage=memory(original),store=createProgramStore(storage,{locks:mode==='lock'?null:locks()}),loaded=store.load();if(mode==='quota')storage.setItem=()=>{const error=new Error('full');error.name='QuotaExceededError';throw error;};assert.equal((await store.save(loaded.state)).status.code,mode==='lock'?'locking':'quota');assert.equal(storage.raw,original);}
});
test('concurrent legacy migration writers and old-tab writes cannot silently overwrite newer version',async()=>{
 const original=JSON.stringify(state(legacy())),storage=memory(original),manager=locks(),a=createProgramStore(storage,{locks:manager}),b=createProgramStore(storage,{locks:manager});const one=a.load().state,two=b.load().state;one.programs[0].notes='A';two.programs[0].notes='B';const [first,second]=await Promise.all([a.save(one),b.save(two)]);assert.equal(first.ok,true);assert.equal(second.status.code,'conflict');assert.equal(JSON.parse(storage.raw).programs[0].notes,'A');
 // The shipped v1 writer performs this same lastRaw check while holding this same lock.
 const oldTab=await manager.request(PROGRAM_STORAGE_KEY+'.writer',{mode:'exclusive'},()=>storage.getItem(PROGRAM_STORAGE_KEY)===original?'would-write':'conflict');assert.equal(oldTab,'conflict');assert.equal((await b.recover(two)).status.code,'conflict');
});
test('malformed legacy data and hybrid schemas fail without writing; old JSON import retains values but clears attestations',async()=>{
 const p=legacy(),bad=JSON.stringify({...state(p),programs:[{...p,unknown:'reject'}]}),storage=memory(bad),store=createProgramStore(storage,{locks:locks()});assert.equal(store.load().status.code,'corrupt');assert.equal(storage.raw,bad);assert.equal(storage.writes,0);
 const imported=importProgramJson(JSON.stringify({schemaVersion:1,program:p}));assert.notEqual(imported.id,p.id);assert.equal(imported.measures[0].facts[0].baseline,1);assert.equal(imported.measures[0].facts[0].confirmed,false);assert.equal(imported.overlap.confirmed,false);assert.equal(imported.measures[0].execution.owner,'Владелец');assert.equal(JSON.parse(exportProgramJson(imported)).schemaVersion,2);
 assert.throws(()=>validateProgramState({...state(p),schemaVersion:2}));assert.throws(()=>validateProgramState({...state(p),programs:[imported]}));assert.throws(()=>importProgramJson(JSON.stringify({schemaVersion:3,program:p})));
});
