import test from 'node:test';
import assert from 'node:assert/strict';
import { createReport, exportReport, reportText, reportHtml, exportFormats } from '../public/report-export.js';
import { measures } from '../public/data.js';
import { inflateSync } from 'node:zlib';
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
 assert.match(parts['word/document.xml'],/w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/);
 assert.match(parts['word/styles.xml'],/w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"\/><w:sz w:val="22"/);
 assert.doesNotMatch(parts['word/document.xml'],/[ёЁ\u2010-\u2015\u2212]/);
});
test('document defaults normalize presentation only and retain negative amounts and source data',async()=>{
 const {documentText}=await import('../public/document-text.js');
 const {buildDocx}=await import('../public/report-export-docx.js');
 const text='Ёлка, счёт: −0,25 ₽; 1–30; А—Б; non‑breaking; мяг\u00ADкий; A\uFE58B\uFE63C\uFF0DD.';
 const source={blocks:[{type:'paragraph',text}]};
 const parts=storedZipEntries(buildDocx(source));
 assert.equal(source.blocks[0].text,text);
 assert.equal(documentText(text),'Елка, счет: -0,25 ₽; 1-30; А-Б; non-breaking; мягкий; A-B-C-D.');
 assert.match(parts['word/document.xml'],/Елка, счет: -0,25 ₽; 1-30; А-Б; non-breaking; мягкий; A-B-C-D\./);
 const canonical=createReport(input,['procurement']);
 assert.ok(canonical.blocks.every(b=>!/[ёЁ\u2010-\u2015\u2212]/.test(b.text)));
 assert.equal(canonical.inputs.implementationCost,.2);
});
test('PDF is a true document with embedded Unicode fonts and no active actions',async()=>{
 const f=await exportReport(createReport(input,['procurement']),'pdf'),bytes=await getBytes(f),raw=new TextDecoder('latin1').decode(bytes);assert.equal(f.blob.type,'application/pdf');assert.match(raw,/^%PDF-/);assert.match(raw,/\/ToUnicode/);assert.match(raw,/\/FontFile2/);assert.ok(!/\/JavaScript|\/Launch|\/SubmitForm|\/GoToR|\/URI\b/.test(raw),'PDF must not contain active or external actions');assert.ok(bytes.length>10000);
});
test('export ignores tampered report prose and values and rejects unsupported formats',async()=>{
 const r=createReport(input,[]);const f=await exportReport({...r,blocks:[{text:'<script>secret</script>'}],calculation:{firstYearNet:999}},'html');const text=await f.blob.text();assert.match(text,/0,76 млн ₽/);assert.doesNotMatch(text,/secret|999/);await assert.rejects(exportReport(r,'exe'));
});
test('PDF heading keeps its trailing gap and following body lines together at a page boundary',async()=>{
 const {buildPdf}=await import('../public/report-export-pdf.js');
 // 28 body rows + three subtitles leave y=739pt with 36pt margins. A heading without its
 // trailing 8pt gap fits the old check, but its following paragraph does not.
 const blocks=[...Array.from({length:28},()=>({type:'paragraph',text:'Строка'})),
   {type:'subtitle',text:'Подпись'},{type:'subtitle',text:'Подпись'},{type:'subtitle',text:'Подпись'},
   {type:'heading',text:'Методика и ограничения'},
   {type:'paragraph',text:'Следующий абзац должен остаться вместе с заголовком. '.repeat(5)}];
 const raw=Buffer.from(await buildPdf({blocks})).toString('latin1');
 const contents=[...raw.matchAll(/\/Type \/Page\b[\s\S]*?\/Contents (\d+) 0 R/g)].map(m=>m[1]);
 assert.equal(contents.length,2);
 const stream=id=>{const body=raw.match(new RegExp('(?:^|\\n)'+id+' 0 obj\\n([\\s\\S]*?)\\nendobj'))[1];const bytes=body.match(/stream\n([\s\S]*?)\nendstream/)[1];return inflateSync(Buffer.from(bytes,'latin1')).toString('latin1');};
 // Only the heading uses 14pt; it must be on the second page with body text.
 assert.doesNotMatch(stream(contents[0]),/\s14 Tf/);
 assert.match(stream(contents[1]),/\s14 Tf/);
 assert.match(stream(contents[1]),/\s11 Tf/);
});

test('program exports remove soft hyphens and normalize compatibility dashes without changing saved JSON',async()=>{
 const {createProgram}=await import('../public/program-model.js');
 const {createProgramReport,exportProgramReport}=await import('../public/program-report.js');
 const p=createProgram({name:'Мяг\u00ADкий\uFE58переход\uFE63без\uFF0Dпотерь',startMonth:'2026-01'});
 p.notes='Исходный\u00AD текст: −0,25 и А\uFE58Б\uFE63В\uFF0DГ';
 const source=JSON.stringify(p),canonical=createProgramReport(p);
 const forbidden=/[\u00AD\uFE58\uFE63\uFF0D]/;
 assert.ok(canonical.blocks.every(b=>!forbidden.test(b.text)));
 for(const format of ['txt','html','docx','pdf']){
   const output=await exportProgramReport(p,format),bytes=await getBytes(output);
   if(format==='pdf'){
     const raw=Buffer.from(bytes).toString('latin1');assert.match(raw,/^%PDF-/);
     // Check the embedded Unicode character maps, not compressed font bytes.
     for(const match of raw.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gs)){
       let stream=Buffer.from(match[2],'latin1');if(/\/FlateDecode/.test(match[1]))stream=inflateSync(stream);
       const text=stream.toString('latin1');if(text.includes('beginbfchar'))assert.doesNotMatch(text,/>\s*<(?:00ad|fe58|fe63|ff0d)>/i);
     }
   }else{
     const text=format==='docx'?storedZipEntries(bytes)['word/document.xml']:await output.blob.text();
     assert.match(text,/Мягкий-переход-без-потерь/);assert.match(text,/А-Б-В-Г/);assert.doesNotMatch(text,forbidden);
   }
 }
 assert.equal(JSON.stringify(p),source);
 assert.match(p.name,/\u00AD/);assert.match(p.notes,/\uFE58/);
});

test('PDF uses A4 with 36pt body margins and 11pt embedded fallback text',async()=>{
 const {buildPdf}=await import('../public/report-export-pdf.js');
 const raw=Buffer.from(await buildPdf({blocks:[{type:'paragraph',text:'Проверка полей'}]})).toString('latin1');
 const box=raw.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);assert.ok(box);assert.ok(Math.abs(Number(box[1])-595.28)<.001);assert.ok(Math.abs(Number(box[2])-841.89)<.001);
 const contents=[...raw.matchAll(/\/Type \/Page\b[\s\S]*?\/Contents (\d+) 0 R/g)].map(m=>m[1]);
 const body=raw.match(new RegExp('(?:^|\\n)'+contents[0]+' 0 obj\\n([\\s\\S]*?)\\nendobj'))[1];
 const stream=inflateSync(Buffer.from(body.match(/stream\n([\s\S]*?)\nendstream/)[1],'latin1')).toString('latin1');
 assert.match(stream,/\s11 Tf/);assert.match(stream,/36\. 794\.88\d* Td/);assert.match(raw,/\/FontFile2/);
});
