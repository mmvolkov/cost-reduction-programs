import test from 'node:test';
import assert from 'node:assert/strict';
import { createReport, exportReport, reportText, reportHtml, exportFormats } from '../public/report-export.js';
import { measures } from '../public/data.js';
const input={annualSpend:12,savingsPercent:10,implementationCost:.2,monthlyCost:.02,rampMonths:0};
const getBytes=async f=>new Uint8Array(await f.blob.arrayBuffer());
function storedZipEntries(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out={};let pos=0;while(v.getUint32(pos,true)===0x04034b50){assert.equal(v.getUint16(pos+8,true),0);const size=v.getUint32(pos+18,true),n=v.getUint16(pos+26,true),extra=v.getUint16(pos+28,true);const name=new TextDecoder().decode(bytes.subarray(pos+30,pos+30+n)),start=pos+30+n+extra;out[name]=new TextDecoder().decode(bytes.subarray(start,start+size));pos=start+size;}assert.equal(v.getUint32(pos,true),0x02014b50);assert.equal(v.getUint32(bytes.length-22,true),0x06054b50);return out;}

test('one canonical report recalculates correct values and includes every selected measure and month',()=>{
 const r=createReport(input,['procurement','production']);assert.ok(Math.abs(r.calculation.firstYearNet-.76)<1e-12);assert.ok(Math.abs(r.calculation.paybackMonths-2.5)<1e-12);
 const text=reportText(r);for(const value of ['0,76 млн ₽','0,96 млн ₽','2,5 месяцев','Закупки без переплаты','Выход годной продукции','План 30/60/90','Методика и ограничения','модель AI не участвовала'])assert.ok(text.includes(value),value);
 assert.equal(r.blocks.filter(b=>/^Месяц \d+:/.test(b.text)).length,12);
});
test('all five inputs must be explicit finite numbers; measures must be known IDs',()=>{
 for(const value of [null,undefined,'12',NaN,Infinity,-1])assert.throws(()=>createReport({...input,annualSpend:value}));
 const partial={...input};delete partial.rampMonths;assert.throws(()=>createReport(partial));assert.throws(()=>createReport({...input,secret:'not allowed'}));
 assert.throws(()=>createReport(input,['unknown']));assert.throws(()=>createReport(input,[{}]));assert.throws(()=>createReport(input,Array(10).fill('procurement')));
 assert.deepEqual(createReport(input,['procurement','procurement']).measureIds,['procurement']);
});
test('zero negative maximum and tiny scenarios retain truthful values without false rounding',()=>{
 const zero=createReport({annualSpend:0,savingsPercent:0,implementationCost:0,monthlyCost:0,rampMonths:0});assert.equal(zero.calculation.paybackMonths,null);assert.match(reportText(zero),/не достигнута за 120 месяцев/);assert.match(reportText(zero),/Меры не выбраны/);
 const max=createReport({annualSpend:1e6,savingsPercent:10,implementationCost:1e6,monthlyCost:1e5,rampMonths:0},measures.map(m=>m.id));assert.equal(max.calculation.firstYearNet,-2100000);assert.equal(max.measureIds.length,9);
 const tiny=createReport({...input,annualSpend:1e-12,savingsPercent:10,implementationCost:0,monthlyCost:0});assert.ok(tiny.calculation.firstYearNet>0);assert.match(reportText(tiny),/E[−-]13/);
});
test('TXT and HTML preserve Cyrillic and canonical data; HTML has no scripts or network resources',async()=>{
 const r=createReport(input,['procurement']);for(const format of ['txt','html']){const f=await exportReport(r,format),bytes=await getBytes(f),s=new TextDecoder().decode(bytes);assert.equal(f.filename,`cost-reduction-plan.${format}`);assert.equal(f.blob.type,exportFormats[format]);assert.match(s,/0,76 млн ₽/);assert.match(s,/Закупки без переплаты/);if(format==='txt')assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);else{assert.match(s,/<meta charset="utf-8">/);assert.doesNotMatch(s,/<script|<iframe|<img|<link|\son\w+=/i);assert.match(s,/default-src 'none'/);}}
 const escaped=reportHtml({blocks:[{type:'paragraph',text:'<script>alert("x")</script> &'}]});assert.match(escaped,/&lt;script&gt;/);assert.doesNotMatch(escaped,/<script>/);
});
test('DOCX is a real OOXML ZIP with editable Russian text and no external relationships',async()=>{
 const f=await exportReport(createReport(input,['procurement']),'docx'),parts=storedZipEntries(await getBytes(f));assert.equal(f.blob.type,exportFormats.docx);
 for(const p of ['[Content_Types].xml','_rels/.rels','word/document.xml','word/styles.xml','word/_rels/document.xml.rels'])assert.ok(parts[p],p);
 assert.match(parts['word/document.xml'],/0,76 млн ₽/);assert.match(parts['word/document.xml'],/Закупки без переплаты/);assert.match(parts['word/document.xml'],/w:pgSz w:w="11906" w:h="16838"/);assert.match(parts['word/styles.xml'],/w:lang w:val="ru-RU"/);
 for(const text of Object.values(parts))assert.doesNotMatch(text,/TargetMode="External"|vbaProject|altChunk/);
});
test('PDF is a true document with embedded Unicode fonts and no active actions',async()=>{
 const f=await exportReport(createReport(input,['procurement']),'pdf'),bytes=await getBytes(f),raw=new TextDecoder('latin1').decode(bytes);assert.equal(f.blob.type,'application/pdf');assert.match(raw,/^%PDF-/);assert.match(raw,/\/ToUnicode/);assert.match(raw,/\/FontFile2/);assert.ok(!/\/JavaScript|\/Launch|\/SubmitForm|\/GoToR|\/URI\b/.test(raw),'PDF must not contain active or external actions');assert.ok(bytes.length>10000);
});
test('export ignores tampered report prose and values and rejects unsupported formats',async()=>{
 const r=createReport(input,[]);const f=await exportReport({...r,blocks:[{text:'<script>secret</script>'}],calculation:{firstYearNet:999}},'html');const text=await f.blob.text();assert.match(text,/0,76 млн ₽/);assert.doesNotMatch(text,/secret|999/);await assert.rejects(exportReport(r,'exe'));
});
