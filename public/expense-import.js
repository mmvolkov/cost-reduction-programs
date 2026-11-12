// Local bounded CSV / OOXML reader. No formula evaluator, external requests or HTML rendering.
import { Unzip, UnzipInflate, SaxesParser } from './vendor/import/parser.js';
export const IMPORT_LIMITS=Object.freeze({fileBytes:4*1024*1024,unpackedBytes:16*1024*1024,entryBytes:8*1024*1024,entries:128,rows:5000,columns:64,cells:100000,sheets:20,records:2000,text:160});
const fail=message=>{throw new Error(message);};
const decoder=new TextDecoder('utf-8',{fatal:true});
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const clean=(value,max=160)=>{const s=String(value??'').trim();if(s.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(s))fail('Текст превышает лимит или содержит управляющие символы.');return s;};
const isMonth=s=>typeof s==='string'&&/^(19\d\d|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(s);
const formula=s=>typeof s==='string'&&(/^[\s]*[=@]/.test(s)||/^[\s]*[+-]/.test(s)&&!/^\s*[+-]?[\d\s.,\u00a0\u202f]+\s*$/.test(s));
export function parseExpenseNumber(value){
 if(typeof value==='number'){if(!Number.isFinite(value))fail('Сумма не является конечным числом.');return value;}
 const s=String(value??'').trim().replace(/[\u00a0\u202f]/g,' ');
 if(!s||!/^[-+]?(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d{1,6})?$/.test(s))fail('Неоднозначная сумма: используйте число без валюты, пробелы тысяч и запятую или точку дробной части.');
 const n=Number(s.replaceAll(' ','').replace(',','.'));if(!Number.isFinite(n))fail('Недопустимая сумма.');return n;
}
export function parseExpensePeriod(value,mode,fixedPeriod){
 if(mode==='fixed'){if(!isMonth(fixedPeriod))fail('Выберите явный месяц YYYY-MM.');return fixedPeriod;}
 let s=String(value??'').trim(), date;
 if(mode==='month'){if(/^\d{2}\.\d{4}$/.test(s))s=s.slice(3)+'-'+s.slice(0,2);if(!isMonth(s))fail('Период должен быть YYYY-MM или MM.YYYY.');return s;}
 if(mode==='date-dmy'&&/^\d{2}\.\d{2}\.\d{4}$/.test(s))s=s.slice(6)+'-'+s.slice(3,5)+'-'+s.slice(0,2);
 if(['date-dmy','date-iso'].includes(mode)){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!isMonth(s.slice(0,7)))fail('Дата не соответствует выбранному формату.');
  date=new Date(s+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==s)fail('Несуществующая дата.');return s.slice(0,7);
 }
 if(mode==='excel-date'){
  const serial=typeof value==='number'?value:Number(s);if(!/^\d+(?:\.\d+)?$/.test(s)||!Number.isFinite(serial)||serial<1||serial>=2958466||Math.floor(serial)===60)fail('Недопустимая дата Excel (система 1900).');
  date=new Date(Date.UTC(1899,11,31)+(Math.floor(serial)-(serial>=60?1:0))*86400000);const result=date.toISOString().slice(0,7);if(!isMonth(result))fail('Дата за пределами диапазона.');return result;
 }
 fail('Явно выберите формат периода.');
}
export function parseExpenseCsv(text,delimiter=';'){
 if(![';',',','\t'].includes(delimiter))fail('Выберите разделитель CSV: точка с запятой, запятая или табуляция.');
 if(typeof text!=='string'||new TextEncoder().encode(text).length>IMPORT_LIMITS.fileBytes)fail('CSV превышает 4 МиБ.');
 text=text.replace(/^\uFEFF/,'');let rows=[],row=[],cell='',quoted=false,closed=false,cells=0;
 const pushCell=()=>{if(cell.length>4000)fail('Ячейка превышает 4000 символов.');row.push(cell);cell='';closed=false;if(row.length>IMPORT_LIMITS.columns||++cells>IMPORT_LIMITS.cells)fail('Превышен лимит колонок или ячеек.');};
 const pushRow=()=>{pushCell();rows.push(row);row=[];if(rows.length>IMPORT_LIMITS.rows)fail('Превышен лимит строк.');};
 for(let i=0;i<text.length;i++){
  const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
  else if(c===delimiter)pushCell();else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();}
  else if(c==='"'){if(cell||closed)fail('Некорректные кавычки CSV.');quoted=true;}
  else{if(closed)fail('Лишние символы после закрывающей кавычки CSV.');cell+=c;}
  if(cell.length>4000)fail('Ячейка превышает 4000 символов.');
 }
 if(quoted)fail('Незакрытые кавычки CSV.');if(cell||row.length||closed)pushRow();
 return {kind:'csv',name:'CSV',rows,issues:[]};
}
function unzipBounded(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0||end+22+view.getUint16(end+20,true)!==bytes.length)fail('Некорректный ZIP XLSX.');
 const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
 if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||count!==view.getUint16(end+8,true)||!count||count>IMPORT_LIMITS.entries||offset+size!==end)fail('ZIP multipart/ZIP64 или превышен лимит файлов.');
 const expected=new Map();let p=offset,total=0;
 for(let i=0;i<count;i++){
  if(p+46>end||view.getUint32(p,true)!==0x02014b50)fail('Некорректный каталог ZIP.');
  const crc=view.getUint32(p+16,true),flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),compressed=view.getUint32(p+20,true),length=view.getUint32(p+24,true),nl=view.getUint16(p+28,true),el=view.getUint16(p+30,true),cl=view.getUint16(p+32,true),local=view.getUint32(p+42,true);
  if(p+46+nl+el+cl>end)fail('Некорректная длина ZIP.');
  const name=decoder.decode(bytes.subarray(p+46,p+46+nl));
  if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(x=>x==='..'||x==='.')||expected.has(name)||/[\u0000-\u001f]/.test(name))fail('Опасное или повторное имя в ZIP.');
  if(flags&1||![0,8].includes(method)||compressed===0xffffffff||length===0xffffffff||local>=offset||length>IMPORT_LIMITS.entryBytes||(total+=length)>IMPORT_LIMITS.unpackedBytes)fail('Недопустимый метод, шифрование или размер ZIP.');
  if(/vba|macros|externalLinks|embeddings|activeX/i.test(name))fail('Макросы, вложения и внешние связи XLSX не поддерживаются.');
  if(local+30>offset||view.getUint32(local,true)!==0x04034b50)fail('Некорректный локальный заголовок ZIP.');
  const lnl=view.getUint16(local+26,true),lel=view.getUint16(local+28,true);
  if(local+30+lnl+lel+compressed>offset||decoder.decode(bytes.subarray(local+30,local+30+lnl))!==name||view.getUint16(local+8,true)!==method||view.getUint16(local+6,true)!==flags)fail('Заголовки ZIP не совпадают.');
  expected.set(name,{length,compressed,crc});p+=46+nl+el+cl;
 }
 if(p!==end)fail('Некорректный каталог ZIP.');
 const result=new Map();let actualTotal=0,found=0,problem;
 const uz=new Unzip(file=>{
  const meta=expected.get(file.name);if(!meta||result.has(file.name))fail('Файл ZIP отсутствует в каталоге или повторяется.');
  const chunks=[];let actual=0,crc=0xffffffff;result.set(file.name,null);found++;
  file.ondata=(error,chunk,final)=>{if(error){problem=error;file.terminate();return;}actual+=chunk.length;actualTotal+=chunk.length;for(const b of chunk)crc=crcTable[(crc^b)&255]^(crc>>>8);if(actual>meta.length||actual>IMPORT_LIMITS.entryBytes||actualTotal>IMPORT_LIMITS.unpackedBytes){file.terminate();fail('Фактическая распаковка превышает лимит.');}chunks.push(chunk);if(final){if(actual!==meta.length||(crc^0xffffffff)>>>0!==meta.crc)fail('Размер или CRC распаковки не совпадает с каталогом.');const out=new Uint8Array(actual);let n=0;for(const c of chunks){out.set(c,n);n+=c.length;}result.set(file.name,out);}};
  file.start();
 });uz.register(UnzipInflate);
 for(let i=0;i<bytes.length;i+=512){uz.push(bytes.subarray(i,i+512),i+512>=bytes.length);if(problem)throw problem;}
 if(found!==expected.size||[...result.values()].some(v=>v===null))fail('Неполная распаковка ZIP.');return result;
}
function parseXml(bytes,handlers={}){
 if(!bytes)fail('Обязательная XML-часть XLSX отсутствует.');const s=decoder.decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(s))fail('DTD и сущности XML не поддерживаются.');
 let depth=0,nodes=0;const parser=new SaxesParser({xmlns:true});
 parser.on('error',e=>{throw e;});parser.on('doctype',()=>fail('DTD запрещен.'));
 parser.on('opentag',n=>{if(++depth>32||++nodes>500000)fail('XML превышает лимит вложенности или элементов.');handlers.open?.(n);});
 parser.on('closetag',n=>{handlers.close?.(n);depth--;});parser.on('text',t=>handlers.text?.(t));parser.on('cdata',t=>handlers.text?.(t));parser.write(s).close();
}
const attr=(n,name)=>Object.values(n.attributes).find(a=>a.name===name||a.local===name)?.value;
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function parseXlsx(bytes){
 const files=unzipBounded(bytes);const types=files.get('[Content_Types].xml');parseXml(types,{open:n=>{if(/macroEnabled|vbaProject/i.test(attr(n,'ContentType')||''))fail('Макросы не поддерживаются.');}});
 for(const [name,b]of files)if(name.endsWith('.rels'))parseXml(b,{open:n=>{if(n.local==='Relationship'&&(attr(n,'TargetMode')==='External'||/^(?:[a-z]+:|\/\/)/i.test(attr(n,'Target')||'')||/externalLink|vbaProject/i.test(attr(n,'Type')||'')))fail('Внешние связи XLSX запрещены.');}});
 const rels=new Map();parseXml(files.get('xl/_rels/workbook.xml.rels'),{open:n=>{if(n.local==='Relationship'){const target=attr(n,'Target');if(!target||target.includes('..')||target.includes('\\'))fail('Недопустимая ссылка на лист.');rels.set(attr(n,'Id'),target.startsWith('/')?target.slice(1):'xl/'+target);}}});
 const sheets=[];parseXml(files.get('xl/workbook.xml'),{open:n=>{if(n.uri!==MAIN)return;if(n.local==='workbookPr'&&['true','1'].includes(attr(n,'date1904')))fail('Система дат Excel 1904 не поддерживается: экспортируйте периоды текстом.');if(n.local==='sheet'){if(sheets.length>=IMPORT_LIMITS.sheets)fail('Слишком много листов.');sheets.push({name:clean(attr(n,'name')),path:rels.get(attr(n,'r:id'))});}}});
 if(!sheets.length)fail('В XLSX нет листов.');
 const shared=[];let item=null,capture=false;
 if(files.has('xl/sharedStrings.xml'))parseXml(files.get('xl/sharedStrings.xml'),{open:n=>{if(n.local==='si'){item='';if(shared.length>=IMPORT_LIMITS.cells)fail('Слишком много строк XLSX.');}if(n.local==='t')capture=true;},text:t=>{if(capture&&item!==null){item+=t;if(item.length>4000)fail('Слишком длинная ячейка.');}},close:n=>{if(n.local==='t')capture=false;if(n.local==='si'){shared.push(item);item=null;}}});
 let cellCount=0;return sheets.map(({name,path})=>{
  const rows=[],issues=[];let cell=null,part='',rowIndex=0;
  parseXml(files.get(path),{open:n=>{
   if(n.uri!==MAIN)return;
   if(n.local==='row'){rowIndex=Number(attr(n,'r'));if(!Number.isInteger(rowIndex)||rowIndex<1||rowIndex>IMPORT_LIMITS.rows)fail('Строка XLSX вне лимита.');}
   if(n.local==='c'){
    const ref=attr(n,'r'),m=/^([A-Z]+)(\d+)$/.exec(ref||'');if(!m)fail('Некорректный адрес ячейки.');let col=0;for(const c of m[1])col=col*26+c.charCodeAt(0)-64;const r=Number(m[2]);
    if(col>IMPORT_LIMITS.columns||r!==rowIndex||++cellCount>IMPORT_LIMITS.cells)fail('Превышен лимит ячеек или неверный адрес.');
    rows[r-1]??=[];if(Object.hasOwn(rows[r-1],col-1))fail('Повторный адрес ячейки.');cell={row:r,col:col-1,type:attr(n,'t')||'n',value:'',inline:'',formula:false};
   }
   if(cell&&n.local==='f')cell.formula=true;if(cell&&['v','t'].includes(n.local))part=n.local;
  },text:t=>{if(cell&&part){if(part==='v')cell.value+=t;else cell.inline+=t;if(cell.value.length+cell.inline.length>4000)fail('Слишком длинная ячейка.');}},close:n=>{
   if(n.local===part)part='';if(n.local==='c'&&cell){let value=null;
    if(cell.formula)issues.push({row:cell.row,column:cell.col,message:'Формула не импортируется. Замените ее проверенным значением.'});
    else if(cell.type==='s'){const i=Number(cell.value);if(!/^\d+$/.test(cell.value)||i>=shared.length)fail('Неизвестная общая строка XLSX.');value=shared[i];}
    else if(cell.type==='inlineStr')value=cell.inline;
    else if(cell.type==='str')value=cell.value;
    else if(cell.type==='n'&&cell.value!==''){if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell.value))fail('Некорректное число XLSX.');value=Number(cell.value);if(!Number.isFinite(value))fail('Некорректное число XLSX.');}
    else if(cell.type!=='n')issues.push({row:cell.row,column:cell.col,message:'Тип ячейки не поддерживается: '+cell.type});
    rows[cell.row-1][cell.col]=value;cell=null;
   }
  }});return{kind:'xlsx',name,rows:Array.from({length:rows.length},(_,i)=>rows[i]||[]),issues};
 });
}
export async function readExpenseFile(input,{name,delimiter=';'}={}){
 const bytes=input instanceof Uint8Array?input:input instanceof ArrayBuffer?new Uint8Array(input):fail('Передайте байты файла.');
 if(!bytes.length||bytes.length>IMPORT_LIMITS.fileBytes)fail('Файл пуст или превышает 4 МиБ.');
 if(/\.xls$/i.test(name||''))fail('Старый .xls не поддерживается. Сохраните настоящий .xlsx или CSV.');
 if(/\.csv$/i.test(name||''))return{kind:'csv',sheets:[parseExpenseCsv(decoder.decode(bytes),delimiter)]};
 if(/\.xlsx$/i.test(name||''))return{kind:'xlsx',sheets:parseXlsx(bytes)};
 fail('Поддерживаются только CSV и XLSX, без макросов.');
}
export const expenseFingerprint=r=>JSON.stringify([r.period,r.article,r.department,r.supplier,r.amountRub]);
export function previewExpenseImport(sheet,options,existingRecords=[]){
 const {headerRow,mapping,unit,periodMode,fixedPeriod}=options||{};const factor={rub:1,thousand:1000,million:1000000}[unit];
 if(!factor)fail('Явно выберите единицы суммы.');if(!Number.isInteger(headerRow)||headerRow<1||headerRow>sheet.rows.length)fail('Выберите строку заголовков.');
 const fields=['article','department','supplier','amount',...(periodMode==='fixed'?[]:['period'])];
 if(!mapping||fields.some(k=>!Number.isInteger(mapping[k])||mapping[k]<0||mapping[k]>=IMPORT_LIMITS.columns)||new Set(fields.map(k=>mapping[k])).size!==fields.length)fail('Сопоставьте разные колонки обязательных полей.');
 if(!['month','date-iso','date-dmy','excel-date','fixed'].includes(periodMode))fail('Явно выберите формат периода.');
 const source=clean(options.source||sheet.name,500), seen=new Map(),existing=new Set(existingRecords.map(expenseFingerprint));const rows=[];
 for(let i=headerRow;i<sheet.rows.length;i++){
  const raw=sheet.rows[i];if(!raw.some(v=>v!==null&&v!==undefined&&String(v).trim()!=='')&&!(sheet.issues||[]).some(x=>x.row===i+1))continue;
  const errors=(sheet.issues||[]).filter(x=>x.row===i+1).map(x=>x.message);let record=null;
  if(sheet.kind==='csv'&&raw.length!==sheet.rows[headerRow-1].length)errors.push('Число колонок не совпадает с заголовком. Проверьте разделитель и кавычки.');
  if(raw.some(formula))errors.push('Формула CSV/текста не импортируется.');
  try{
   const period=parseExpensePeriod(raw[mapping.period],periodMode,fixedPeriod);
   // Shift the decimal exponent before binary conversion: 0.0041 thousand equals 4.1 rub exactly as entered.
   const parsed=String(parseExpenseNumber(raw[mapping.amount])).split(/[eE]/);
   const amountRub=Number(parsed[0]+'e'+(Number(parsed[1]||0)+({rub:0,thousand:3,million:6}[unit])));
   if(!Number.isFinite(amountRub)||Math.abs(amountRub)>1e12)fail('Сумма вне диапазона +/-1 000 000 млн руб.');
   const article=clean(raw[mapping.article]),department=clean(raw[mapping.department]),supplier=clean(raw[mapping.supplier]);if(!article)fail('Статья расходов не заполнена.');
   record={id:globalThis.crypto.randomUUID(),period,article,department,supplier,amountRub,source};
  }catch(error){errors.push(error.message);}
  if(errors.length)record=null;
  const key=record?expenseFingerprint(record):null,duplicateInFile=key!==null&&seen.has(key),duplicateExisting=key!==null&&existing.has(key);
  const row={row:i+1,record,errors,duplicateInFile,duplicateExisting};
  if(key!==null){if(duplicateInFile)seen.get(key).duplicateInFile=true;else seen.set(key,row);}rows.push(row);
 }
 return{rows,validCount:rows.filter(r=>r.record).length,totalRub:rows.reduce((s,r)=>s+(r.record&&!r.duplicateInFile&&!r.duplicateExisting?r.record.amountRub:0),0)};
}
export function finalizeExpenseImport(preview,decisions={}){
 const records=[];for(const row of preview.rows){if(!row.record||row.errors.length)continue;const decision=decisions[row.row];if(decision!==undefined&&!['include','skip'].includes(decision))fail('Неизвестное решение по строке.');if((row.duplicateInFile||row.duplicateExisting)&&!decision)fail('Для каждой повторяющейся строки выберите включить или пропустить.');if(decision!=='skip')records.push({...row.record});}
 if(records.length>IMPORT_LIMITS.records)fail('Можно хранить не более 2000 операций.');return records;
}
export function filterExpenseRecords(records,{months=[],articles=[],departments=[],suppliers=[]}={}){return records.filter(r=>(!months.length||months.includes(r.period))&&(!articles.length||articles.includes(r.article))&&(!departments.length||departments.includes(r.department))&&(!suppliers.length||suppliers.includes(r.supplier)));}
export function aggregateExpenseRecords(records){
 const group=field=>{const m=new Map();for(const r of records){const x=m.get(r[field])||{key:r[field],totalRub:0,count:0};x.totalRub+=r.amountRub;x.count++;m.set(r[field],x);}return[...m.values()].sort((a,b)=>a.key.localeCompare(b.key,'ru'));};
 return{totalRub:records.reduce((s,r)=>s+r.amountRub,0),count:records.length,byPeriod:group('period'),byArticle:group('article'),byDepartment:group('department'),bySupplier:group('supplier')};
}
export function annualizeExpenseBase(records,{months,method}={}){
 if(!Array.isArray(months)||!months.length||months.length>12||months.some(m=>!isMonth(m))||new Set(months).size!==months.length)fail('Явно выберите от 1 до 12 разных месяцев.');
 const sorted=[...months].sort();if(!['exact-12','average-month'].includes(method))fail('Выберите способ годового пересчета.');
 if(method==='exact-12'){
  const ord=m=>Number(m.slice(0,4))*12+Number(m.slice(5));if(months.length!==12||ord(sorted[11])-ord(sorted[0])!==11)fail('Годовая сумма требует ровно 12 последовательных месяцев.');
 }
 const selectedTotalRub=records.filter(r=>months.includes(r.period)).reduce((s,r)=>s+r.amountRub,0),annualSpend=selectedTotalRub*(method==='average-month'?12/months.length:1)/1000000;
 if(!Number.isFinite(annualSpend)||annualSpend<0||annualSpend>1000000)fail('Годовая база должна быть от 0 до 1 000 000 млн руб.');
 return{annualSpend,selectedTotalRub,monthCount:months.length,method};
}
