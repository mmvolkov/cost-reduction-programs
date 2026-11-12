import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {readExpenseFile,parseExpenseCsv,parseExpenseNumber,parseExpensePeriod,previewExpenseImport,finalizeExpenseImport,expenseFingerprint,filterExpenseRecords,aggregateExpenseRecords,annualizeExpenseBase,IMPORT_LIMITS} from '../public/expense-import.js';
const enc=new TextEncoder(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const options={headerRow:1,mapping:{period:0,article:1,department:2,supplier:3,amount:4},unit:'rub',periodMode:'month',source:'synthetic.csv'};
const csv='Период;Статья;Отдел;Поставщик;Сумма\n2026-01;Сырье;Цех;ООО Пример;1 234,50\n';
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=b=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
function zip(files,{deflate=false,lieSize=false}={}){
 const parts=[],central=[];let offset=0;
 for(const[name,value]of Object.entries(files)){
  const n=enc.encode(name),data=enc.encode(value),packed=deflate?deflateRawSync(data):data,size=lieSize?Math.min(10,data.length):data.length,crc=crc32(data);
  const local=new Uint8Array(30+n.length+packed.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(8,deflate?8:0,true);v.setUint32(14,crc,true);v.setUint32(18,packed.length,true);v.setUint32(22,size,true);v.setUint16(26,n.length,true);local.set(n,30);local.set(packed,30+n.length);
  const c=new Uint8Array(46+n.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(6,20,true);cv.setUint16(10,deflate?8:0,true);cv.setUint32(16,crc,true);cv.setUint32(20,packed.length,true);cv.setUint32(24,size,true);cv.setUint16(28,n.length,true);cv.setUint32(42,offset,true);c.set(n,46);parts.push(local);central.push(c);offset+=local.length;
 }
 const size=central.reduce((s,b)=>s+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,parts.length,true);v.setUint16(10,parts.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
 const out=new Uint8Array(offset+size+22);let i=0;for(const b of [...parts,...central,end]){out.set(b,i);i+=b.length;}return out;
}
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function sheet(rows){return`<worksheet xmlns="${ns}"><sheetData>${rows.map((r,i)=>`<row r="${i+1}">${r.map((x,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}"${typeof x==='string'?' t="inlineStr"':''}>${typeof x==='string'?`<is><t>${xml(x)}</t></is>`:typeof x==='object'?x.xml:`<v>${x}</v>`}</c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;}
function workbook(overrides={}){return{'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>','xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Расходы" sheetId="1" r:id="rId1"/><sheet name="Второй" sheetId="2" r:id="rId2"/></sheets></workbook>`,'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/></Relationships>','xl/worksheets/sheet1.xml':sheet([['Пример'],['Период','Статья','Отдел','Поставщик','Сумма'],['2026-01','Сырье','Цех','ООО Пример',1234.5]]),'xl/worksheets/sheet2.xml':sheet([['Период','Статья','Отдел','Поставщик','Сумма'],['2026-02','Возврат','Цех','ООО Пример',-34.5]]),...overrides};}
const readX=(files,opts)=>readExpenseFile(zip(files,opts),{name:'synthetic.xlsx'});
test('CSV BOM, Russian amounts, delimiters, escaped quotes and embedded newlines remain local text',async()=>{
 const w=await readExpenseFile(enc.encode('\uFEFF'+csv),{name:'test.csv'});const p=previewExpenseImport(w.sheets[0],options);assert.equal(p.rows[0].record.amountRub,1234.5);assert.equal(p.validCount,1);
 assert.deepEqual(parseExpenseCsv('a,b\r\n"ООО ""А""","строка\nдва"',',').rows,[['a','b'],['ООО "А"','строка\nдва']]);
 assert.deepEqual(parseExpenseCsv('a\tb\n1\t2','\t').rows,[['a','b'],['1','2']]);
 for(const s of ['a;"broken','a;"b"c','a;b"c'])assert.throws(()=>parseExpenseCsv(s));
});
test('number and period formats are explicit, invalid and ambiguous values do not enter totals',()=>{
 for(const v of ['1 234,50','1\u00a0234.50','1\u202f234,5'])assert.equal(parseExpenseNumber(v),1234.5);
 for(const v of ['1,234.50','1.234,50','12 34','10 руб','1e3','0x10','',NaN,Infinity])assert.throws(()=>parseExpenseNumber(v));
 assert.equal(parseExpenseNumber('-0,25'),-.25);assert.equal(parseExpensePeriod('01.2026','month'),'2026-01');assert.equal(parseExpensePeriod('31.01.2026','date-dmy'),'2026-01');
 assert.throws(()=>parseExpensePeriod('31.02.2026','date-dmy'));assert.throws(()=>parseExpensePeriod('01/02/2026','month'));assert.throws(()=>parseExpensePeriod(46023,'month'));assert.throws(()=>parseExpensePeriod(60,'excel-date'));
 assert.equal(parseExpensePeriod(46023,'excel-date'),'2026-01');
 const p=previewExpenseImport(parseExpenseCsv(csv+'2026-01;Сырье;Цех;ООО;1,234.50'),options);assert.equal(p.rows[1].record,null);assert.equal(p.totalRub,1234.5);
 assert.throws(()=>previewExpenseImport(parseExpenseCsv(csv),{...options,unit:''}));assert.throws(()=>previewExpenseImport(parseExpenseCsv(csv),{...options,periodMode:''}));
});
test('formulas are rejected with row errors while HTML remains inert text',()=>{
 const p=previewExpenseImport(parseExpenseCsv(csv+'2026-01;"=HYPERLINK(""x"")";Цех;ООО;100\n2026-01;<img src=x onerror=x>;Цех;ООО;-10'),options);
 assert.equal(p.rows[1].record,null);assert.match(p.rows[1].errors.join(),/Формула/);assert.equal(p.rows[2].record.article,'<img src=x onerror=x>');assert.equal(p.rows[2].record.amountRub,-10);
});
test('all equal transactions require explicit decisions within file and repeated import; legitimate duplicates can stay',()=>{
 const p=previewExpenseImport(parseExpenseCsv(csv+csv.split('\n')[1]),options);assert.equal(p.rows.length,2);assert.ok(p.rows.every(r=>r.duplicateInFile));assert.equal(p.totalRub,0);assert.throws(()=>finalizeExpenseImport(p));
 const both=finalizeExpenseImport(p,{2:'include',3:'include'});assert.equal(both.length,2);assert.equal(expenseFingerprint(both[0]),expenseFingerprint(both[1]));
 const repeat=previewExpenseImport(parseExpenseCsv(csv),options,both);assert.equal(repeat.rows[0].duplicateExisting,true);assert.throws(()=>finalizeExpenseImport(repeat));assert.deepEqual(finalizeExpenseImport(repeat,{2:'skip'}),[]);
});
test('real OOXML XLSX has sheet/header selection, numeric cells and Cyrillic; no runtime npm needed',async()=>{
 const w=await readX(workbook(),{deflate:true});assert.equal(w.sheets.length,2);assert.equal(w.sheets[0].name,'Расходы');const p=previewExpenseImport(w.sheets[0],{...options,headerRow:2,unit:'thousand'});assert.equal(p.rows[0].row,3);assert.equal(p.rows[0].record.amountRub,1234500);
 const q=previewExpenseImport(w.sheets[1],options);assert.equal(q.rows[0].record.amountRub,-34.5);
});
test('XLSX shared strings and cached formulas never evaluate formulas',async()=>{
 const files=workbook({'xl/sharedStrings.xml':`<sst xmlns="${ns}"><si><t>Сырье</t></si></sst>`,'xl/worksheets/sheet1.xml':`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Заголовок</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>2026-01</t></is></c><c r="B2" t="s"><v>0</v></c><c r="C2" t="inlineStr"><is><t>Цех</t></is></c><c r="D2" t="inlineStr"><is><t>ООО</t></is></c><c r="E2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`});
 const w=await readX(files);assert.equal(w.sheets[0].rows[1][1],'Сырье');const p=previewExpenseImport(w.sheets[0],options);assert.equal(p.rows[0].record,null);assert.match(p.rows[0].errors.join(),/Формула/);
});
test('XLSX external relationships, macro files, DTD, invalid XML and old XLS fail closed',async()=>{
 await assert.rejects(readExpenseFile(enc.encode(csv),{name:'legacy.xls'}),/\.xls/);
 const variants=[{'xl/vbaProject.bin':'bad'},{'xl/worksheets/_rels/sheet1.xml.rels':'<Relationships><Relationship TargetMode="External" Target="https://evil.invalid/"/></Relationships>'},{'xl/sharedStrings.xml':'<!DOCTYPE s [<!ENTITY e SYSTEM "file:///etc/passwd">]><sst>&e;</sst>'},{'xl/workbook.xml':'<broken>'}];
 for(const extra of variants)await assert.rejects(readX(workbook(extra)));
 const normal=workbook();normal['xl/workbook.xml']=normal['xl/workbook.xml'].replace('<sheets>','<workbookPr date1904="1"/><sheets>');await assert.rejects(readX(normal),/1904/);
});
test('XLSX uses strict decimal/scientific numeric grammar, not JavaScript coercion',async()=>{
 for(const value of ['0x10',' ','Infinity','1_000'])await assert.rejects(readX(workbook({'xl/worksheets/sheet1.xml':sheet([['h'],[{xml:`<v>${value}</v>`}]])})),/число/);
 const w=await readX(workbook({'xl/worksheets/sheet1.xml':sheet([['h'],[{xml:'<v>1.2e3</v>'}]])}));assert.equal(w.sheets[0].rows[1][0],1200);
});
test('ZIP CRC tampering, traversal, encryption and forged output lengths are rejected',async()=>{
 const data=zip(workbook());const v=new DataView(data.buffer);v.setUint32(14,0,true);const firstCentral=data.findIndex((_,i)=>i+4<data.length&&v.getUint32(i,true)===0x02014b50);v.setUint32(firstCentral+16,0,true);await assert.rejects(readExpenseFile(data,{name:'bad.xlsx'}),/CRC/);
 await assert.rejects(readX(workbook({'../bad.xml':'x'})),/имя/);
 const encrypted=zip(workbook()),ev=new DataView(encrypted.buffer);ev.setUint16(6,1,true);const cp=encrypted.findIndex((_,i)=>i+4<encrypted.length&&ev.getUint32(i,true)===0x02014b50);ev.setUint16(cp+8,1,true);await assert.rejects(readExpenseFile(encrypted,{name:'bad.xlsx'}),/шифрование/);
 await assert.rejects(readX(workbook({'huge.xml':'x'.repeat(2*1024*1024)}),{deflate:true,lieSize:true}),/распаковк/);
});
test('file, inflated entry, rows, columns and cells have hard limits',async()=>{
 await assert.rejects(readExpenseFile(new Uint8Array(IMPORT_LIMITS.fileBytes+1),{name:'large.xlsx'}),/4 МиБ/);
 await assert.rejects(readX(workbook({'large.xml':'x'.repeat(IMPORT_LIMITS.entryBytes+1)}),{deflate:true}),/размер ZIP/);
 assert.throws(()=>parseExpenseCsv('a\n'.repeat(5001)),/строк/);assert.throws(()=>parseExpenseCsv(Array(65).fill('a').join(';')),/колонок/);
 await assert.rejects(readX(workbook({'xl/worksheets/sheet1.xml':`<worksheet xmlns="${ns}"><sheetData><row r="5001"><c r="A5001"><v>1</v></c></row></sheetData></worksheet>`})),/лимита/);
});
test('expense summaries and subset annualization never create facts or infer a full year',()=>{
 const p=previewExpenseImport(parseExpenseCsv(csv+'2026-02;Возврат;Офис;ООО;-34,5'),options),rs=finalizeExpenseImport(p);
 const agg=aggregateExpenseRecords(rs);assert.equal(agg.totalRub,1200);assert.equal(agg.byPeriod.length,2);assert.equal(agg.byArticle.length,2);assert.equal(agg.byDepartment.length,2);
 const subset=filterExpenseRecords(rs,{months:['2026-01'],articles:['Сырье'],departments:['Цех']});assert.equal(subset.length,1);
 assert.throws(()=>annualizeExpenseBase(rs,{months:['2026-01']}));assert.throws(()=>annualizeExpenseBase(rs,{months:['2026-01'],method:'exact-12'}));
 assert.equal(annualizeExpenseBase(rs,{months:['2026-01','2026-02'],method:'average-month'}).annualSpend,.0072);
 assert.equal(annualizeExpenseBase(rs,{months:Array.from({length:12},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`),method:'exact-12'}).annualSpend,.0012);
 assert.throws(()=>annualizeExpenseBase([rs[1]],{months:['2026-02'],method:'average-month'}));assert.ok(rs.every(r=>!Object.hasOwn(r,'facts')));
});
test('pinned local parser licenses and versions are present; source contains no network or evaluation',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../scripts/import-vendor/package.json',import.meta.url),'utf8'));assert.equal(pkg.dependencies.fflate,'0.8.3');assert.equal(pkg.dependencies.saxes,'6.0.0');
 for(const name of ['FFLATE-LICENSE.txt','SAXES-LICENSE.txt','XMLCHARS-LICENSE.txt'])assert.ok((await readFile(new URL('../public/vendor/import/'+name,import.meta.url),'utf8')).length>500);
 const source=await readFile(new URL('../public/expense-import.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\beval\s*\(|\.innerHTML\s*=/);
});

test('duplicate fingerprints are stable across explicit unit conversions without rounding genuine small amounts',()=>{
 const text=value=>'Период;Статья;Отдел;Поставщик;Сумма\n2026-01;Сырье;Цех;ООО;'+value;
 const rub=previewExpenseImport(parseExpenseCsv(text('4.1')),options).rows[0].record;
 const thousand=previewExpenseImport(parseExpenseCsv(text('0.0041')),{...options,unit:'thousand'},[rub]);
 assert.equal(thousand.rows[0].record.amountRub,4.1);assert.equal(thousand.rows[0].duplicateExisting,true);
 assert.equal(previewExpenseImport(parseExpenseCsv(text('0.000001')),options).rows[0].record.amountRub,.000001);
});

test('CSV shifted or missing columns are row errors rather than plausible but wrong totals',()=>{
 const p=previewExpenseImport(parseExpenseCsv(csv+'2026-01;Сырье;Цех;ООО;100;extra\n2026-01;Сырье;Цех;100'),options);
 assert.equal(p.rows[1].record,null);assert.equal(p.rows[2].record,null);assert.equal(p.totalRub,1234.5);
});
