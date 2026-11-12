import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, createProgramMeasure } from '../public/program-model.js';
import { createProgramStore as realCreateProgramStore, exportProgramJson, importProgramJson, cloneProgramScenario, validateProgramState, PROGRAM_STORAGE_KEY, MAX_PROGRAM_JSON_BYTES } from '../public/program-storage.js';
function lockManager() {
 let queue=Promise.resolve();
 return {request(name,options,callback){assert.equal(options.mode,'exclusive');const result=queue.then(callback);queue=result.catch(()=>{});return result;}};
}
const locks=lockManager();
const createProgramStore=storage=>realCreateProgramStore(storage,{locks});
const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), values }; };
function sample() { const p=createProgram({name:'Программа № 1'});p.measures.push(createProgramMeasure('procurement'));p.measures[0].execution.owner='Иван Петров';p.measures[0].execution.nextStep='Сверить цены';return p; }
const stateFor=p=>({schemaVersion:2,activeId:p.id,programs:[p]});
test('program store saves reloads and switches multiple programs without storing chat or credentials',async()=>{
 const storage=memory(),store=createProgramStore(storage);assert.equal(store.load().status.code,'empty');
 const p=sample(),q=createProgram({name:'Вторая'}),state={schemaVersion:2,activeId:q.id,programs:[p,q]};
 assert.equal((await store.save(state)).ok,true);const restored=createProgramStore(storage).load();assert.equal(restored.ok,true);assert.deepEqual(restored.state,state);
 for(const key of ['apiKey','accessCode','chat','messages'])assert.equal((await store.save({...state,[key]:'secret'})).status.code,'invalid');
 assert.doesNotMatch(storage.getItem(PROGRAM_STORAGE_KEY),/secret|accessCode/);
});
test('corrupt unknown-version and prototype files never overwrite the stored original automatically',async()=>{
 for(const original of ['{broken','{"schemaVersion":99,"activeId":null,"programs":[]}','{"__proto__":{"polluted":true}}']){
  const storage=memory();storage.setItem(PROGRAM_STORAGE_KEY,original);const store=createProgramStore(storage),loaded=store.load();assert.equal(loaded.status.code,'corrupt');
  assert.equal((await store.save(stateFor(sample()))).ok,false);assert.equal(storage.getItem(PROGRAM_STORAGE_KEY),original);
  assert.equal((await store.recover(stateFor(sample()))).ok,true);assert.equal(createProgramStore(storage).load().ok,true);
 }
 assert.equal({}.polluted,undefined);
});
test('unavailable quota and cross-tab conflicts are explicit and retain the previous saved bytes',async()=>{
 const blocked={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
 const a=createProgramStore(blocked);assert.equal(a.load().status.code,'unavailable');assert.equal((await a.save(stateFor(sample()))).status.code,'unavailable');
 const storage=memory(),store=createProgramStore(storage);store.load();const p=sample();await store.save(stateFor(p));const original=storage.getItem(PROGRAM_STORAGE_KEY);
 storage.setItem=()=>{const e=new Error('quota');e.name='QuotaExceededError';throw e;};p.notes='unsaved';assert.equal((await store.save(stateFor(p))).status.code,'quota');assert.equal(storage.getItem(PROGRAM_STORAGE_KEY),original);
 const shared=memory(),one=createProgramStore(shared),two=createProgramStore(shared);one.load();two.load();await one.save(stateFor(sample()));assert.equal((await two.save(stateFor(sample()))).status.code,'conflict');assert.equal((await two.recover(stateFor(sample()))).status.code,'conflict');
});
test('JSON import is a new program; current object is intact, facts retained and confirmations reset',async()=>{
 const source=sample();source.measures[0].facts[0]={baseline:1,actualSpend:.8,implementationCost:0,monthlyCost:0,source:'Счёт № 12',qualityChecked:true,normalization:{enabled:false,baseVolume:null,actualVolume:null,unit:''},confirmed:true};source.overlap={confirmed:true,note:'Проверено'};
 source.updatedAt='2020-01-01T00:00:00.000Z';const before=JSON.stringify(source),file=exportProgramJson(source),loaded=importProgramJson(file);
 assert.notEqual(loaded.id,source.id);assert.notEqual(loaded.updatedAt,source.updatedAt);assert.equal(JSON.stringify(source),before);assert.equal(loaded.measures[0].facts[0].baseline,1);assert.equal(loaded.measures[0].facts[0].confirmed,false);assert.equal(loaded.overlap.confirmed,false);assert.match(loaded.name,/импорт/);
 assert.equal(loaded.measures[0].execution.owner,'Иван Петров');
 const copied=cloneProgramScenario(source);assert.notEqual(copied.id,source.id);assert.notEqual(copied.updatedAt,source.updatedAt);assert.equal(copied.measures[0].facts[0].baseline,null);assert.equal(copied.measures[0].execution.nextStep,'Сверить цены');assert.equal(copied.overlap.confirmed,false);
});
test('strict import rejects oversized, unknown version, extra fields, duplicate IDs and prototype pollution',async()=>{
 const p=sample(),raw=exportProgramJson(p);assert.throws(()=>importProgramJson(' '.repeat(MAX_PROGRAM_JSON_BYTES+1)));
 assert.throws(()=>importProgramJson(JSON.stringify({schemaVersion:99,program:p})));assert.throws(()=>importProgramJson(JSON.stringify({schemaVersion:2,program:p,accessCode:'secret'})));
 assert.throws(()=>importProgramJson(raw.replace('"program": {','"program": {"__proto__":{"x":1},')));
 assert.throws(()=>validateProgramState({schemaVersion:2,activeId:p.id,programs:[p,p]}));assert.throws(()=>validateProgramState({schemaVersion:2,activeId:'missing',programs:[p]}));
 assert.throws(()=>validateProgramState({schemaVersion:2,activeId:p.id,programs:Array.from({length:21},()=>sample())}));
 const hostile=sample();hostile.name='<img src=x onerror=alert(1)>';const imported=importProgramJson(exportProgramJson(hostile));assert.match(imported.name,/<img/); // Plain text data, never HTML execution.
});


test('concurrent writers cannot interleave version check and write; loser keeps export',async()=>{
 const shared=memory(), seed=sample();shared.setItem(PROGRAM_STORAGE_KEY,JSON.stringify(stateFor(seed)));
 const manager=lockManager(), a=realCreateProgramStore(shared,{locks:manager}), b=realCreateProgramStore(shared,{locks:manager});a.load();b.load();
 const older=structuredClone(seed),newer=structuredClone(seed);older.notes='older edit from A';newer.notes='newer edit from B';
 let triggered=false,second;
 const get=shared.getItem;
 shared.getItem=k=>{const raw=get(k);if(!triggered){triggered=true;second=b.save(stateFor(newer));}return raw;};
 // B attempts a save precisely between A's read and write, but must queue for the lock.
 const first=await a.save(stateFor(older));const competing=await second;
 assert.equal(first.ok,true);assert.equal(competing.status.code,'conflict');
 assert.equal(JSON.parse(get(PROGRAM_STORAGE_KEY)).programs[0].notes,older.notes);
 assert.match(exportProgramJson(newer),/newer edit from B/);
 assert.equal((await b.recover(stateFor(newer))).status.code,'conflict');
});
test('missing or rejected Web Locks fail closed while JSON remains exportable',async()=>{
 for(const locks of [null,{request(){throw new Error('denied');}}]){
  const shared=memory(),store=realCreateProgramStore(shared,{locks});store.load();const p=sample();
  assert.equal((await store.save(stateFor(p))).status.code,'locking');assert.equal(shared.getItem(PROGRAM_STORAGE_KEY),null);
  assert.equal((await store.recover(stateFor(p))).status.code,'locking');assert.match(exportProgramJson(p),/schemaVersion/);
 }
});
test('queued writes capture their own snapshot and preserve order within one tab',async()=>{
 const shared=memory(),store=realCreateProgramStore(shared,{locks:lockManager()});store.load();const p=sample(),state=stateFor(p);
 p.notes='first';const first=store.save(state);p.notes='second';const second=store.save(state);p.notes='not queued';
 assert.equal((await first).ok,true);assert.equal((await second).ok,true);
 assert.equal(JSON.parse(shared.getItem(PROGRAM_STORAGE_KEY)).programs[0].notes,'second');
});
