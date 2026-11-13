import { createProgramP2Controller } from './program-p2-ui.js';
import { createProgramAiController } from './program-ai-ui.js';
import { createPilotLibraryController } from './pilot-library-ui.js';
import { createProgramCollaborationController } from './program-collaboration-ui.js';
import { recordProgramChange } from './program-collaboration.js';
import { PROGRAM_SCHEMA_VERSION, PROGRAM_STORAGE_KEY } from './program-storage.js';
import { factEconomicsChanged } from './program-model.js';
import { actualSummaryPresentation } from './program-report.js';
import { measures } from './data.js';
import { fields } from './calculation-report.js';
import { createProgram, createProgramMeasure, validateProgram, calculateProgram, calculateActual, updateFact, confirmFact } from './program-model.js';
import { createProgramStore, exportProgramJson, importProgramJson, cloneProgramScenario } from './program-storage.js';

const money = n => typeof n === 'number' && Number.isFinite(n) ? new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 10 }).format(n) : '—';
const payback = n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits:2 }).format(n);
const statuses = {hypothesis:'Гипотеза',review:'Проверка',pilot:'Пилот',implementation:'Внедрение',confirmation:'Подтверждение'};
const statusMessages = {saved:'Сохранено в этом браузере',empty:'Пока нет сохранённых программ',corrupt:'Сохранённые данные повреждены. Исходная запись не перезаписана.',unavailable:'Хранилище браузера недоступно. Изменения остаются только в памяти: экспортируйте JSON.',quota:'Хранилище заполнено. Последние изменения не сохранены: экспортируйте JSON.',conflict:'Программа изменена в другой вкладке. Автосохранение остановлено: экспортируйте JSON перед продолжением.'};
const element = (tag, text, className) => { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node; };
const button = (text, action, className='pm-button') => {const b=element('button',text,className);b.type='button';b.addEventListener('click',action);return b;};
const clone = value => JSON.parse(JSON.stringify(value));
const download = (blob,filename) => {const url=URL.createObjectURL(blob);const a=element('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);};
const monthLabel = (start,index) => {const [year,month]=start.split('-').map(Number);const date=new Date(Date.UTC(year,month-1+index,1));return date.toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'});};

export function initProgramWorkspace(root,{onSelectionChange=()=>{},requestAi=async()=>{throw new Error('AI не подключен.');},getAiAvailability=()=>({enabled:false,reason:'AI не подключен.'})}={}) {
  const store=createProgramStore();
  const loaded=store.load();
  let state=loaded.state || {schemaVersion:PROGRAM_SCHEMA_VERSION,activeId:null,programs:[]};
  let storageStatus=loaded.status || {code:'empty'};
  let factMeasureId=null, factMonth=0, reportBusy=false;
  let notice,saveStatus,summary,measureList,factArea,programSelect;
  let rawInvalid=false, workspaceRevision=0, ai;
  const invalidateAi=reason=>{workspaceRevision++;ai?.invalidate(reason);};
  if(!state.programs.length){const p=createProgram();state={schemaVersion:PROGRAM_SCHEMA_VERSION,activeId:p.id,programs:[p]};}
  if(!state.programs.some(p=>p.id===state.activeId))state.activeId=state.programs[0].id;
  const active=()=>state.programs.find(p=>p.id===state.activeId);
  const announce=text=>{if(notice)notice.textContent=text;};
  function showStatus(){if(saveStatus){saveStatus.textContent=statusMessages[storageStatus.code] || storageStatus.message || 'Состояние сохранения неизвестно';saveStatus.dataset.state=storageStatus.code;}}
  let saveSequence=0;
  async function save(){
    const sequence=++saveSequence;
    storageStatus={code:'saving',message:'Сохранение...'};showStatus();
    const result=await store.save(state);
    if(sequence===saveSequence){storageStatus=result.status;showStatus();}
    if(!result.ok)invalidateAi('Сохранение не подтверждено. Экспортируйте JSON и устраните конфликт перед работой с AI.');
    return result.ok;
  }
  function selection(){onSelectionChange(getSelectedIds());}
  function apply(mutator,{refresh=false,financial=false}={}) {
    const next=clone(active());
    try{mutator(next);next.updatedAt=new Date().toISOString();if(financial)next.overlap.confirmed=false;const valid=recordProgramChange(active(),validateProgram(next));exportProgramJson(valid);state.programs=state.programs.map(p=>p.id===valid.id?valid:p);invalidateAi('Программа изменена. Подготовьте AI-контекст заново.');rawInvalid=!!root.querySelector(':invalid');save();selection();if(refresh)render();else updateSummary();return true;}
    catch(error){announce(error.message || 'Проверьте введённые значения. Изменения не сохранены.');return false;}
  }
  function field(labelText,value,onChange,{type='text',maxLength=4000,min,max,step,id,help}={}) {
    const wrapper=element('label',undefined,'pm-field');const caption=element('span',labelText);wrapper.append(caption);
    const input=element(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;
    input.value=value??'';if(id)input.id=id;if(type==='textarea')input.rows=3;
    if(type==='text'||type==='textarea')input.maxLength=maxLength;
    if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);if(step!==undefined)input.step=String(step);
    input.addEventListener('input',()=>{
      input.setCustomValidity('');
      if(!input.checkValidity()){rawInvalid=true;announce('Некорректное поле не сохранено. Исправьте значение перед переключением или экспортом.');input.reportValidity();return;}
      if(type==='month'){const otherInvalid=[...root.querySelectorAll(':invalid')].find(node=>node!==input);if(otherInvalid){input.value=active().startMonth;rawInvalid=true;announce('Месяц программы не изменён. Сначала исправьте другое некорректное поле: его введённое значение сохранено на экране.');otherInvalid.focus();return;}}
      const value=type==='number'?(input.value===''?null:Number(input.value)):input.value;
      const ok=onChange(value);
      if(ok!==false&&type==='month'){renderMeasures();renderFacts();updateSummary();}
      if(ok===false){rawInvalid=true;input.setCustomValidity('Проверьте значение. Оно не сохранено.');}else{input.setCustomValidity('');}
    });
    wrapper.append(input);if(help)wrapper.append(element('small',help));return wrapper;
  }
  function checkbox(text,checked,onChange,id){const label=element('label',undefined,'pm-check');const input=element('input');input.type='checkbox';if(id)input.id=id;input.checked=checked;let previous=checked;input.addEventListener('change',()=>{if(!canNavigate()){input.checked=previous;return;}onChange(input.checked);previous=input.checked;});label.append(input,element('span',text));return label;}
  function select(label,options,value,onChange,id){const wrapper=element('label',undefined,'pm-field');wrapper.append(element('span',label));const input=element('select');if(id)input.id=id;options.forEach(([v,t])=>{const o=element('option',t);o.value=v;input.append(o);});input.value=String(value);let previous=String(value);input.addEventListener('change',()=>{if(!canNavigate()){input.value=previous;return;}onChange(input.value);previous=input.value;});wrapper.append(input);return wrapper;}
  function canNavigate(){rawInvalid=!!root.querySelector(':invalid');if(rawInvalid){announce('Сначала исправьте некорректное поле: его значение ещё не сохранено.');root.querySelector(':invalid')?.focus();return false;}return true;}
  function activate(id){if(!canNavigate())return;invalidateAi('Выбрана другая программа.');state.activeId=id;factMeasureId=null;factMonth=0;save();render();selection();}
  function addProgram(program){try{exportProgramJson(program);}catch(e){announce('Программа слишком велика для безопасного JSON-экспорта: '+e.message);return false;}if(state.programs.length>=20){announce('Достигнут предел: 20 программ. Сохраните нужные программы в JSON.');return false;}invalidateAi('Рабочая программа изменена.');state.programs.push(program);state.activeId=program.id;factMeasureId=null;factMonth=0;save();render();selection();return true;}
  function addMeasure(id){if(!canNavigate())return false;if(!measures.some(m=>m.id===id))return false;const p=active(),existing=p.measures.find(m=>m.id===id);if(existing?.included)return true;return apply(next=>{const m=next.measures.find(m=>m.id===id);if(m)m.included=true;else next.measures.push(createProgramMeasure(id));},{refresh:true,financial:true});}
  function toggleMeasure(id){if(!canNavigate())return false;const found=active().measures.find(m=>m.id===id);if(!found)return addMeasure(id);return apply(next=>{next.measures.find(m=>m.id===id).included=!found.included;},{refresh:true,financial:true});}
  function getSelectedIds(){return active().measures.filter(m=>m.included).map(m=>m.id);}
  const p2 = createProgramP2Controller({getProgram:()=>clone(active()),mutate:apply,canNavigate,announce,refreshP1:render});
  function canUseContextualTools(){
    if(!canNavigate())return false;
    const current=store.checkCurrent();
    if(!current.ok){storageStatus=current.status;showStatus();invalidateAi('Контекст заблокирован: данные изменены в другой вкладке или хранилище недоступно. Сохраните JSON.');announce(storageStatus.message||'Сначала устраните конфликт сохранения.');return false;}
    return true;
  }
  ai=createProgramAiController({getProgram:()=>clone(active()),getRevision:()=>workspaceRevision,mutate:apply,canNavigate:canUseContextualTools,announce,requestAi,getAiAvailability});
  const pilots=createPilotLibraryController({getProgram:()=>clone(active()),getRevision:()=>workspaceRevision,mutate:apply,canNavigate:canUseContextualTools,announce,refreshP1:render});
  const collaboration=createProgramCollaborationController({getProgram:()=>clone(active()),mutate:apply,canNavigate:canUseContextualTools,announce,refreshP1:render});
  // Invalidate even an unsaved invalid edit and a later change-back. AI's own
  // draft/consent controls are not program mutations. No text is sent here.
  // Draft/preview consent is not program data. Actual application still uses
  // central apply(), which advances the monotonic revision and invalidates drafts.
  root.addEventListener('input',event=>{if(!event.target.closest('#pm-context-ai, #pm-pilot-library .pm-pilot-preview'))invalidateAi('Ввод изменен. Перед AI заново проверьте контекст.');},true);
  window.addEventListener('storage',event=>{if(event.key!==null&&event.key!==PROGRAM_STORAGE_KEY)return;const current=store.checkCurrent();if(!current.ok){storageStatus=current.status;showStatus();invalidateAi('Данные изменены в другой вкладке. Экспортируйте текущую работу и перезагрузите страницу.');}});
  function render(){
    root.replaceChildren();root.classList.add('program-workspace');
    const heading=element('div',undefined,'section-heading');const headingText=element('div');headingText.append(element('div','Рабочее пространство','eyebrow'),element('h2','Управляйте программой, а не списком идей'));heading.append(headingText,element('p','Сохраните меры, назначьте ответственных и сравнивайте план с фактом. Быстрый калькулятор ниже остаётся отдельным учебным инструментом.'));root.append(heading);
    const privacy=element('p','Программы хранятся только в этом браузере и на этом адресе сайта (origin). На другом устройстве или адресе они не появятся. Делайте резервные копии JSON. После очистки данных браузера программы могут исчезнуть. GitHub Pages и Scout — разные origin и разные хранилища. Программы не отправляются AI автоматически; ключи, код доступа и чат не сохраняются.','pm-notice');root.append(privacy);
    saveStatus=element('p',undefined,'pm-save-status');saveStatus.setAttribute('role','status');showStatus();root.append(saveStatus);
    notice=element('p','','pm-message');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');root.append(notice);
    const toolbar=element('div',undefined,'pm-toolbar');
    const picker=select('Текущая программа',state.programs.map(p=>[p.id,p.name || 'Без названия']),state.activeId,activate,'pm-program-select');programSelect=picker.querySelector('select');toolbar.append(picker);
    toolbar.append(button('Новая программа',()=>{if(canNavigate())addProgram(createProgram());}));
    toolbar.append(button('Копия сценария',()=>{if(canNavigate()){addProgram(cloneProgramScenario(active()));announce('Создана копия плана и карточек. Факты и подтверждения очищены.');}}));
    toolbar.append(button('Скачать JSON',()=>{if(canNavigate()){download(new Blob([exportProgramJson(active())],{type:'application/json;charset=utf-8'}),'cost-reduction-program.json');announce('JSON подготовлен. Сохраните файл в надёжном месте.');}}));
    const file=element('input');file.type='file';file.accept='.json,application/json';file.id='pm-import-file';file.hidden=true;
    file.addEventListener('change',async()=>{const f=file.files?.[0];file.value='';if(!f||!canNavigate())return;if(f.size>2*1024*1024){announce('Файл слишком большой. Максимум 2 МБ.');return;}try{const p=importProgramJson(await f.text());if(addProgram(p))announce('Импортировано как новая программа. Прежняя программа не заменена. Подтверждения требуют повторной проверки.');}catch(e){announce('Импорт отклонён: '+e.message);}});
    toolbar.append(button('Импорт JSON',()=>{if(canNavigate())file.click();}),file);root.append(toolbar);
    if(['corrupt','conflict','unavailable','quota'].includes(storageStatus.code)){const recovery=element('details',undefined,'pm-recovery');recovery.append(element('summary','Восстановление сохранения'));recovery.append(element('p','Сначала скачайте текущую программу в JSON. Перечитать хранилище можно перезагрузкой страницы после экспорта. Для повреждённой записи кнопка ниже явно разрешает замену текущими программами из памяти. При конфликте с другой вкладкой замена запрещена: экспортируйте работу и перезагрузите страницу.'));if(storageStatus.code!=='conflict')recovery.append(button('Разрешить замену сохранённой записи',async()=>{if(!canNavigate())return;if(!window.confirm('Вы сохранили резервную копию? Заменить запись браузера текущими программами из памяти?'))return;invalidateAi('Восстановление хранилища меняет версию контекста.');const result=await store.recover(state);storageStatus=result.status;render();announce(result.ok?'Сохранение восстановлено.':'Восстановление не удалось. Скачайте JSON.');}));root.append(recovery);}
    const p=active();const meta=element('div',undefined,'pm-panel pm-grid');
    meta.append(field('Название программы',p.name,v=>{const ok=apply(n=>{n.name=v;});if(ok){const option=[...programSelect.options].find(o=>o.value===p.id);if(option)option.textContent=v||'Без названия';}return ok;},{maxLength:160,id:'pm-name'}));
    meta.append(field('Первый месяц программы',p.startMonth,v=>{const changed=active().startMonth!==v;const ok=apply(n=>{n.startMonth=v;if(changed)n.measures.forEach(m=>m.facts.forEach(f=>{f.confirmed=false;}));},{financial:true});if(ok&&changed)announce('Месяцы программы изменены. Подтверждения факта сброшены: проверьте соответствие записей новым датам.');return ok;},{type:'month',min:'1900-01',max:'9999-12',id:'pm-start-month'}));
    const notes=field('Заметки программы',p.notes,v=>apply(n=>{n.notes=v;}),{type:'textarea',id:'pm-notes'});notes.classList.add('pm-full');meta.append(notes);root.append(meta);
    const pilotArea=element('div');root.append(pilotArea);pilots.mount(pilotArea);
    const p2Area=element('div');root.append(p2Area);p2.mount(p2Area);
    const aiArea=element('div');root.append(aiArea);ai.mount(aiArea);
    const collaborationArea=element('div');root.append(collaborationArea);collaboration.mount(collaborationArea);
    const add=element('div',undefined,'pm-toolbar');const available=measures.filter(m=>!p.measures.some(x=>x.id===m.id&&x.included));
    const addSelect=select('Добавить меру из библиотеки',[['','Выберите меру'],...available.map(m=>[m.id,m.title])],'',id=>{if(id)addMeasure(id);},'pm-add-measure');add.append(addSelect,element('p','Поля каждой меры заполняются самостоятельно. Общая база быстрого калькулятора не копируется.','pm-help'));root.append(add);
    measureList=element('div',undefined,'pm-measures');root.append(measureList);renderMeasures();
    summary=element('div',undefined,'pm-panel pm-summary');summary.id='pm-program-summary';summary.setAttribute('aria-live','polite');root.append(summary);updateSummary();
    factArea=element('div',undefined,'pm-panel pm-facts');root.append(factArea);renderFacts();
    const approval=element('details',undefined,'pm-panel pm-p3-approval');approval.id='pm-approval-request';approval.append(element('summary','Запрос решения: отчет для согласования'));
    approval.append(element('p','Это текстовый запрос решения, не подпись, утверждение или общее серверное пространство. Ответственные и получатель указываются вами. Отчет создается локально.','pm-notice'));
    const approvalGrid=element('div',undefined,'pm-grid');
    for(const [key,label,options] of [['requestedDecision','Решение, которое требуется',{type:'textarea'}],['decisionOwner','Кто принимает решение',{maxLength:160}],['decisionDueDate','Срок решения',{type:'date'}],['dataLimitations','Ограничения исходных данных',{type:'textarea'}]])approvalGrid.append(field(label,p.approvalRequest[key],v=>apply(n=>{n.approvalRequest[key]=v;}),{...options,id:'pm-approval-'+key}));
    approval.append(approvalGrid);root.append(approval);
    const exports=element('div',undefined,'pm-panel pm-export');exports.append(element('h3','Отчёт по рабочей программе'),element('p','В отчёт войдут реальные поля карточек, отдельные расчёты и введённые факты. Неполнота и неподтверждённые пересечения будут видны.','pm-help'));
    let exportFormat='txt';exports.append(select('Формат отчёта',[['txt','TXT'],['html','HTML'],['pdf','PDF'],['docx','DOCX']],exportFormat,v=>{exportFormat=v;},'pm-report-format'));
    const exportButton=button('Скачать отчёт программы',async()=>{if(reportBusy||!canNavigate())return;reportBusy=true;exportButton.disabled=true;exportButton.setAttribute('aria-busy','true');const snapshot=clone(active()),format=exportFormat;try{const {exportProgramReport}=await import('./program-report.js');const result=await exportProgramReport(snapshot,format);download(result.blob,result.filename);announce('Отчёт подготовлен для скачивания.');}catch(e){announce('Не удалось подготовить отчёт: '+e.message);}finally{reportBusy=false;exportButton.disabled=false;exportButton.removeAttribute('aria-busy');}});exports.append(exportButton);root.append(exports);
  }
  function renderMeasures(){
    measureList.replaceChildren();const p=active();if(!p.measures.length){measureList.append(element('p','Пока нет мер. Добавьте первую меру из библиотеки.','pm-empty'));return;}
    p.measures.forEach(m=>{
      const source=measures.find(x=>x.id===m.id);const card=element('details',undefined,'pm-measure');card.open=p.measures.length<=2;
      const title=element('summary');title.append(element('span',source.title),element('span',m.included?'В расчёте':'Исключена из итогов','pm-badge'));card.append(title);
      const body=element('div',undefined,'pm-measure-body');body.append(checkbox('Включать эту меру в сводные итоги',m.included,v=>apply(n=>{n.measures.find(x=>x.id===m.id).included=v;},{refresh:true,financial:true})));
      body.append(element('p',source.brief,'pm-help'));body.append(field('Область расходов этой меры',m.costScope,v=>apply(n=>{n.measures.find(x=>x.id===m.id).costScope=v;},{financial:true}),{type:'textarea',id:`pm-${m.id}-scope`,help:'Укажите контур затрат, позиции или процесс. Сопоставьте его с другими мерами для исключения двойного счёта.'}));
      const grid=element('div',undefined,'pm-grid');
      Object.entries(fields).forEach(([key,spec])=>grid.append(field(spec.label,m.inputs[key],v=>apply(n=>{n.measures.find(x=>x.id===m.id).inputs[key]=v;},{financial:true}),{type:'number',min:0,max:spec.max,step:'any',id:`pm-${m.id}-${key}`})));
      grid.append(select('Месяц начала меры',Array.from({length:12},(_,i)=>[i+1,`${i+1}. ${monthLabel(p.startMonth,i)}`]),m.inputs.startMonth,v=>apply(n=>{n.measures.find(x=>x.id===m.id).inputs.startMonth=Number(v);},{financial:true}),`pm-${m.id}-start`));body.append(grid);const ownResult=element('div',undefined,'pm-own-result');ownResult.dataset.pmResult=m.id;body.append(ownResult);
      body.append(element('p','Пустое поле означает «нет данных», а не ноль. Внедрение списывается в начале месяца старта; поддержка начисляется с этого месяца.','pm-help'));
      const executionNotice=element('p',undefined,'pm-notice');executionNotice.dataset.pmExecution=m.id;body.append(executionNotice);const execution=element('details',undefined,'pm-execution');execution.append(element('summary','Карточка исполнения и подсказки'));const exGrid=element('div',undefined,'pm-grid');
      const ex=(key,value)=>apply(n=>{n.measures.find(x=>x.id===m.id).execution[key]=value;});
      exGrid.append(field('Ответственный',m.execution.owner,v=>ex('owner',v),{maxLength:160,id:`pm-${m.id}-owner`,help:'Если не задан, в отчёте будет «Не задан».'}),field('Срок',m.execution.dueDate,v=>ex('dueDate',v),{type:'date',id:`pm-${m.id}-due`}));
      exGrid.append(select('Статус работы',Object.entries(statuses),m.execution.status,v=>ex('status',v),`pm-${m.id}-status`),field('Следующий шаг',m.execution.nextStep,v=>ex('nextStep',v),{id:`pm-${m.id}-next`}));
      exGrid.append(field('Критерий успеха',m.execution.successCriterion,v=>ex('successCriterion',v),{type:'textarea',help:source.metric,id:`pm-${m.id}-success`}),field('Показатель качества',m.execution.qualityMetric,v=>ex('qualityMetric',v),{type:'textarea',help:source.guard,id:`pm-${m.id}-quality`}));
      const exNotes=field('Заметки по мере',m.execution.notes,v=>ex('notes',v),{type:'textarea'});exNotes.classList.add('pm-full');exGrid.append(exNotes);execution.append(exGrid,element('p','Статус «Подтверждение» описывает этап работы, но не подтверждает деньги. Фактический эффект подтверждается отдельно для каждого месяца.','pm-notice'));
      const hints=element('ol');source.steps.forEach(s=>hints.append(element('li',s)));execution.append(element('h4','Подсказки библиотеки'),hints);body.append(execution);card.append(body);measureList.append(card);
    });
  }
  function updateSummary(){
    if(!summary)return;const focused=summary.contains(document.activeElement)?document.activeElement:null;const focusId=focused?.id;const caret=focused?.selectionStart;const planOpen=!!summary.querySelector('.pm-action-plan')?.open;summary.replaceChildren();const p=active();let r;try{r=calculateProgram(p);}catch(e){summary.append(element('p','Не удалось рассчитать программу: '+e.message));return;}
    summary.append(element('h3','Сводный план на 12 месяцев'));summary.append(element('p','Обновлено: '+(p.updatedAt?new Date(p.updatedAt).toLocaleString('ru-RU'):'не указано'),'pm-help'));
    p.measures.forEach(m=>{const row=r.measures.find(x=>x.id===m.id);const target=root.querySelector(`[data-pm-result="${m.id}"]`);if(target){target.replaceChildren(element('strong',row?.complete?'Расчёт отдельной меры':'Расчёт меры не заполнен'));if(row?.complete){target.append(element('p',`Первые 12 месяцев от старта меры: ${money(row.calculation.firstYearNet)} млн ₽; полный год: ${money(row.calculation.annualNet)} млн ₽; окупаемость от старта меры: ${row.calculation.paybackMonths===null?'не достигнута за 120 месяцев':payback(row.calculation.paybackMonths)+' мес.'}`));}}const ex=root.querySelector(`[data-pm-execution="${m.id}"]`);if(ex){const overdue=m.execution.dueDate&&m.execution.dueDate<new Date().toISOString().slice(0,10);ex.textContent=`Ответственный: ${m.execution.owner.trim()||'не задан'}. Срок: ${m.execution.dueDate||'не задан'}. Следующий шаг: ${m.execution.nextStep.trim()||'не задан'}.${overdue?' СРОК ПРОШЁЛ: проверьте исполнение действия.':''}`;ex.classList.toggle('pm-warning',!!overdue);}});
    const included=p.measures.filter(m=>m.included);
    if(included.length>1){summary.append(checkbox('Я проверил(а) базы всех включённых мер: двойной счёт исключён. Пересекающиеся меры скорректированы или исключены.',p.overlap.confirmed,v=>apply(n=>{n.overlap.confirmed=v;}),'pm-overlap-confirm'));summary.append(field('Как устранены пересечения',p.overlap.note,v=>apply(n=>{n.overlap.note=v;}),{type:'textarea',id:'pm-overlap-note',help:'Любое изменение параметров, состава или старта мер сбрасывает подтверждение.'}));}
    const safe=r.reliable&&included.length>0;
    summary.append(element('p',safe?(included.length>1?'Расчёт полный, отсутствие двойного счёта подтверждено пользователем. Это сценарий, не гарантия результата.':'Расчёт одной меры полный. Это сценарий, не гарантия результата.'):'Общий итог не подтверждён. Ниже только предварительная сумма заполненных мер, не полный достоверный результат.',safe?'pm-notice':'pm-warning'));
    if(r.incompleteMeasureIds?.length)summary.append(element('p','Не заполнены меры: '+r.incompleteMeasureIds.map(id=>measures.find(m=>m.id===id)?.title||id).join(', '),'pm-warning'));
    const metrics=element('div',undefined,'pm-metrics');
    [['Первый год, млн ₽',r.firstYearNet],['Годовой эффект на полном ходу, млн ₽',r.annualNet]].forEach(([label,value])=>{const c=element('div');c.append(element('span',(safe?'':'Предварительно: ')+label),element('strong',money(value)));metrics.append(c);});
    const pay=element('div');pay.append(element('span','Общая окупаемость'),element('strong',safe?(r.paybackMonths===null?'Не достигнута':`${payback(r.paybackMonths)} мес.`):'Не подтверждена'));metrics.append(pay);summary.append(metrics);
    summary.append(element('p','Окупаемость рассчитана из общей суммы потоков, не из среднего срока мер. Горизонт поиска — 120 месяцев от начала программы.','pm-help'));
    const table=element('table');const thead=element('thead');const tr=element('tr');['Месяц','Экономия','Поддержка','Внедрение','Чистый поток','Накоплено'].forEach(t=>tr.append(element('th',t)));thead.append(tr);table.append(thead);const tbody=element('tbody');r.series.forEach(row=>{const tr=element('tr');tr.append(element('th',`${row.month}. ${monthLabel(p.startMonth,row.month-1)}`));['gross','support','implementation','net','accumulated'].forEach(k=>tr.append(element('td',money(row[k]))));tbody.append(tr);});table.append(tbody);const scroll=element('div',undefined,'pm-table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','План по месяцам, все суммы в миллионах рублей');scroll.append(table);summary.append(element('p','Все суммы в таблице — млн ₽.','pm-help'),scroll);
    const actual=r.actual;if(actual){const a=element('div',undefined,'pm-actual-summary');a.append(element('h4','План-факт: только заполненные записи'));const presentation=actualSummaryPresentation(r);a.append(element('p',presentation.coverage));a.append(element('p',presentation.completeness,presentation.partial?'pm-warning':'pm-help'));const prefix=actual.reliable?'':'Предварительно: нет данных или пересечения не разрешены. ';if(actual.filledCells>0)a.append(element('p',`${prefix}Факт: ${money(actual.net)} млн ₽. План за те же записи: ${actual.comparisonComplete?money(actual.matchedPlan):'неполный план'} млн ₽. Отклонение: ${money(actual.variance)} млн ₽.`));else a.append(element('p','Нет данных: факт и отклонение не рассчитаны. Годовой план показан отдельно выше.'));a.append(element('p',presentation.confirmation,r.overlapResolved?'pm-help':'pm-warning'));summary.append(a);}
    const roadmap=element('details',undefined,'pm-action-plan');roadmap.open=planOpen;roadmap.append(element('summary','План действий 30 / 60 / 90 дней из карточек'));const start=Date.parse(p.startMonth+'-01T00:00:00Z');const groups=[['1–30 дней',[]],['31–60 дней',[]],['61–90 дней',[]],['Позже 90 дней или до старта программы',[]],['Срок не задан',[]]];p.measures.filter(m=>m.included).forEach(m=>{const due=m.execution.dueDate;const day=due?Math.floor((Date.parse(due+'T00:00:00Z')-start)/86400000)+1:null;const index=day===null?4:day>=1&&day<=30?0:day<=60&&day>=31?1:day<=90&&day>=61?2:3;groups[index][1].push(m);});groups.forEach(([title,items])=>{roadmap.append(element('h4',title));if(!items.length)roadmap.append(element('p','Действия на этот период не заданы.','pm-help'));else{const list=element('ul');items.forEach(m=>{const source=measures.find(x=>x.id===m.id);list.append(element('li',`${source.title}: ${m.execution.nextStep.trim()||'следующий шаг не задан'}; ответственный: ${m.execution.owner.trim()||'не задан'}; срок: ${m.execution.dueDate||'не задан'}; статус: ${statuses[m.execution.status]}.`));});roadmap.append(list);}});summary.append(roadmap);
    p2.refreshDerived();pilots.refreshDerived();collaboration.refreshDerived();
    if(focusId){const restored=document.getElementById(focusId);restored?.focus({preventScroll:true});if(caret!==null&&caret!==undefined)restored?.setSelectionRange?.(caret,caret);}
  }
  function renderFacts(){
    factArea.replaceChildren();factArea.append(element('h3','План-факт по мере и месяцу'));
    const p=active();if(!p.measures.length){factArea.append(element('p','Добавьте меру, чтобы записать фактические расходы.','pm-help'));return;}
    if(!p.measures.some(m=>m.id===factMeasureId))factMeasureId=p.measures[0].id;
    const grid=element('div',undefined,'pm-grid');grid.append(select('Мера',p.measures.map(m=>[m.id,measures.find(x=>x.id===m.id).title+(m.included?'':' (исключена)')]),factMeasureId,v=>{if(canNavigate()){factMeasureId=v;renderFacts();}},'pm-fact-measure'));
    grid.append(select('Месяц',Array.from({length:12},(_,i)=>[i,`${i+1}. ${monthLabel(p.startMonth,i)}`]),factMonth,v=>{if(canNavigate()){factMonth=Number(v);renderFacts();}},'pm-fact-month'));factArea.append(grid);
    const m=p.measures.find(m=>m.id===factMeasureId),fact=m.facts[factMonth];
    const info=element('p','Фактические расходы указывайте без отдельно введённых внедрения и поддержки: они вычитаются один раз. Пропуск означает «нет данных», явный ноль допустим. Отрицательный эффект не обнуляется.','pm-notice');factArea.append(info);
    const factResult=element('div',undefined,'pm-fact-result');factResult.setAttribute('aria-live','polite');
    const refreshResult=()=>{const f=active().measures.find(m=>m.id===factMeasureId).facts[factMonth];const r=calculateActual(f);factResult.replaceChildren(element('strong',r.complete?`Чистый фактический эффект: ${money(r.net)} млн ₽`:'Факт не рассчитан: заполните все денежные поля и параметры нормализации.'),element('p',f.confirmed?'Эффект подтверждён пользователем. Это оценка, не аудит.':'Эффект не подтверждён. Нужны источник, проверка качества и отдельное подтверждение.'));};
    const changeFact=(patch,rerender=false)=>{const ok=apply(n=>{const row=n.measures.find(m=>m.id===factMeasureId);const previous=row.facts[factMonth];const next=updateFact(previous,patch);row.facts[factMonth]=next;if(factEconomicsChanged(previous,next))n.overlap.confirmed=false;});if(ok){if(rerender)renderFacts();else refreshResult();}return ok;};
    const amounts=element('div',undefined,'pm-grid');[['baseline','База расходов без изменений, млн ₽'],['actualSpend','Фактические расходы, млн ₽'],['implementationCost','Фактическое внедрение, млн ₽'],['monthlyCost','Фактическая поддержка, млн ₽']].forEach(([key,label])=>amounts.append(field(label,fact[key],v=>changeFact({[key]:v}),{type:'number',min:0,max:key==='monthlyCost'?100000:1000000,step:'any',id:`pm-fact-${key}`})));factArea.append(amounts);
    factArea.append(checkbox('Нормализовать базу по фактическому объёму',fact.normalization.enabled,v=>changeFact({normalization:{enabled:v}},true)));
    if(fact.normalization.enabled){const normalization=element('div',undefined,'pm-grid');[['baseVolume','Базовый объём'],['actualVolume','Фактический объём']].forEach(([key,label])=>normalization.append(field(label,fact.normalization[key],v=>{const f=active().measures.find(m=>m.id===factMeasureId).facts[factMonth];return changeFact({normalization:{...f.normalization,[key]:v}});},{type:'number',min:0,max:1000000000000,step:'any',id:`pm-fact-${key}`})));normalization.append(field('Единица объёма',fact.normalization.unit,v=>{const f=active().measures.find(m=>m.id===factMeasureId).facts[factMonth];return changeFact({normalization:{...f.normalization,unit:v}});},{maxLength:80,id:'pm-fact-unit'}));factArea.append(normalization,element('p','Сопоставимая база = базовые расходы / базовый объём × фактический объём. Базовый объём должен быть больше нуля.','pm-help'));}
    factArea.append(field('Источник / пояснение факта',fact.source,v=>changeFact({source:v}),{type:'textarea',id:'pm-fact-source'}));
    factArea.append(checkbox('Я проверил(а), что качество, сроки и сопоставимость данных не ухудшены',fact.qualityChecked,v=>changeFact({qualityChecked:v})));
    factArea.append(factResult);refreshResult();
    factArea.append(button('Подтвердить эффект этого месяца',()=>{if(!canNavigate())return;const ok=apply(n=>{const row=n.measures.find(m=>m.id===factMeasureId);row.facts[factMonth]=confirmFact(row.facts[factMonth]);});if(ok){refreshResult();announce('Месячный эффект подтверждён как оценка пользователя, не аудит. Изменение данных сбросит подтверждение.');}}));
  }
  render();selection();
  return {invalidateAi,refreshAiAvailability:()=>ai.refreshAvailability(),addMeasure,toggleMeasure,hasMeasure:id=>getSelectedIds().includes(id),getSelectedIds,getProgram:()=>clone(active())};
}
