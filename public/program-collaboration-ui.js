import { measures } from './data.js';
import { calculateProgram } from './program-model.js';
import { collaborationRoles, collaborationLimits, addParticipant, updateParticipant, selectParticipant, addComment, addDecision, decisionStatus, historyActionLabel } from './program-collaboration.js';

export const localCollaborationNotice='Имя и роль введены вручную, личность не проверена. Это не контроль доступа, не электронная подпись и не серверная синхронизация.';
const roleLabels={owner:'Организатор',editor:'Редактор',reviewer:'Проверяющий',viewer:'Наблюдатель'};
const decisionLabels={approve:'Согласовать', 'changes-requested':'Запросить изменения',reject:'Отклонить'};
const statusLabels={'received-unverified':'Получено из JSON, не проверено','stale':'Устарело: содержание программы изменилось','current-local':'Относится к текущей версии, автор указан вручную'};
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const number=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6}).format(value);
const authorText=author=>`${author?.name||'Автор не указан'}${author?.role?' / '+(roleLabels[author.role]||author.role):''} (введено вручную)`;
const received=item=>item.provenance==='received-unverified'?'Получено из JSON, не проверено. ':'';

export function createProgramCollaborationController({getProgram,mutate,canNavigate,announce,refreshP1}){
 let host,panel,programId,status,participantsArea,commentsArea,decisionsArea,historyArea,authorSelect,editSelect,nameInput,roleSelect,commentScope,commentMeasure,commentText,decisionSelect,noteInput,reviewArea,confirmInput,applyButton,versionLabel;
 let editingId='',review=null,sectionNodes=[];
 const button=(text,fn)=>{const b=el('button',text,'pm-button');b.type='button';b.addEventListener('click',fn);return b;};
 const message=text=>{if(status)status.textContent=text;announce?.(text);};
 const field=(label,id,{textarea=false,maxLength=2000}={})=>{const wrap=el('label',undefined,'pm-field'),input=el(textarea?'textarea':'input');input.id=id;input.maxLength=maxLength;if(textarea)input.rows=3;else input.type='text';wrap.append(el('span',label),input);return {wrap,input};};
 const select=(label,id,options,onChange)=>{const wrap=el('label',undefined,'pm-field'),input=el('select');input.id=id;options.forEach(([v,t])=>{const o=el('option',t);o.value=v;input.append(o);});input.value=options[0]?.[0]||'';input.addEventListener('change',()=>onChange?.(input.value));wrap.append(el('span',label),input);return {wrap,input};};
 function clearReview(){review=null;if(reviewArea)reviewArea.replaceChildren();if(confirmInput)confirmInput.checked=false;if(applyButton)applyButton.disabled=true;}
 function available(){if(canNavigate())return true;clearReview();message('Сначала исправьте некорректный ввод или конфликт сохранения. JSON-экспорт остается доступным.');return false;}
 function replace(next,text){if(!available())return false;const result=mutate(p=>Object.assign(p,next),{refresh:true});if(result!==false){message(text);return true;}return false;}
 const active=()=>getProgram().collaboration.participants.find(p=>p.id===getProgram().collaboration.activeParticipantId);
 function saveParticipant(){
  if(!available())return;
  try{const p=getProgram(),name=nameInput.value,role=roleSelect.value;const next=editingId?updateParticipant(p,{id:editingId,name,role}):addParticipant(p,{name,role});if(replace(next,'Участник сохранен как введенная вручную организационная метка.'))editingId='';}catch(e){message(e.message);}
 }
 function saveComment(){
  if(!available())return;
  if(!active()){message('Явно выберите автора комментария. Имя не подтверждает личность.');return;}
  try{replace(addComment(getProgram(),{scope:commentScope.value,measureId:commentScope.value==='measure'?commentMeasure.value:null,text:commentText.value}),'Комментарий сохранен локально. Он не отправлен другим участникам.');}catch(e){message(e.message);}
 }
 function previewDecision(){
  clearReview();if(!available())return;
  const p=getProgram(),author=active();if(!author){message('Выберите автора решения. Это только ручная метка, не проверка личности.');return;}
  if(!Object.hasOwn(decisionLabels,decisionSelect.value)){message('Выберите решение.');return;}
  if(noteInput.value.length>collaborationLimits.text){message('Слишком длинное пояснение решения.');return;}
  const result=calculateProgram(p);
  review={programId:p.id,revision:p.collaboration.revision,authorId:author.id,decision:decisionSelect.value,note:noteInput.value};
  reviewArea.append(el('h4','Проверьте запись решения'),el('p',`Программа: ${p.name||'Без названия'}. Версия содержания: ${review.revision}.`),el('p','Автор: '+authorText(author)),el('p','Решение: '+decisionLabels[review.decision]),el('p','Запрос решения: '+(p.approvalRequest.requestedDecision||'Не заполнен')),el('p',`План первого года: ${number(result.firstYearNet)} млн руб. ${result.reliable?'Сценарный расчет, не гарантия.':'Данные неполны или не проверены пересечения: '+result.reasons.join('; ')+'.'}`),el('p','Пояснение: '+(review.note||'Не указано')),el('p','Эта запись не подтверждает денежный эффект. После изменения содержания она станет устаревшей.','pm-warning'));
  message('Проверьте содержание программы и запись выше, затем отдельно подтвердите сохранение решения.');
 }
 function commitDecision(){
  if(!available()||!review||!confirmInput.checked)return;
  const p=getProgram();if(p.id!==review.programId||p.collaboration.revision!==review.revision||p.collaboration.activeParticipantId!==review.authorId){clearReview();message('Предпросмотр устарел. Проверьте новую версию и автора.');return;}
  try{replace(addDecision(p,{revision:review.revision,decision:review.decision,note:review.note,confirmed:true}),'Решение записано для проверенной версии. Денежный эффект этим не подтвержден.');clearReview();}catch(e){message(e.message);clearReview();}
 }
 function renderRecords(){
  const p=getProgram(),c=p.collaboration;versionLabel.textContent=`Версия содержания: ${c.revision}. Комментарии и организационные метки не являются проверенной подписью.`;
  participantsArea.replaceChildren();const list=el('ul');c.participants.forEach(person=>list.append(el('li',received(person)+authorText(person))));participantsArea.append(list);if(!c.participants.length)participantsArea.append(el('p','Участников пока нет. Добавьте ручную метку имени и роли.','pm-help'));
  commentsArea.replaceChildren();c.comments.forEach(comment=>{const card=el('article',undefined,'pm-local-record');card.append(el('h4',comment.scope==='program'?'Комментарий к программе':'Комментарий к мере: '+(measures.find(m=>m.id===comment.measureId)?.title||comment.measureId)),el('p',received(comment)+authorText(comment.author)+' · '+comment.at,'pm-help'),el('p',comment.text,'pm-local-text'));commentsArea.append(card);});if(!c.comments.length)commentsArea.append(el('p','Комментариев пока нет.','pm-help'));
  decisionsArea.replaceChildren();c.decisions.forEach(decision=>{const card=el('article',undefined,'pm-local-record'),state=decisionStatus(p,decision);card.append(el('h4',decisionLabels[decision.decision]||decision.decision),el('p',`Версия ${decision.revision}. ${statusLabels[state]||state}.`,'pm-warning'),el('p',authorText(decision.author)+' · '+decision.at,'pm-help'),el('p',decision.note||'Без пояснения','pm-local-text'));decisionsArea.append(card);});if(!c.decisions.length)decisionsArea.append(el('p','Решений пока нет. Согласование не происходит автоматически.','pm-help'));
  historyArea.replaceChildren();historyArea.append(el('p',`История локальная и редактируема через JSON, не защищенный аудит. Старых записей вне текущего журнала: ${c.historyDropped}.`,'pm-help'));const history=el('ol');c.history.forEach(entry=>{const row=el('li');row.append(el('p',received(entry)+`${entry.at} · версия ${entry.revision} · ${historyActionLabel(entry.action)}`),el('p',authorText(entry.author),'pm-help'),el('p',entry.summary||'','pm-local-text'));history.append(row);});historyArea.append(history);
 }
 function mount(root){
  const openPanel=!!panel?.open,openSections=sectionNodes.map(section=>!!section.open);const p=getProgram();editingId='';programId=p.id;host=root;host.replaceChildren();host.classList.add('pm-p3');review=null;
  panel=el('details',undefined,'pm-panel pm-collaboration-panel');panel.id='pm-local-collaboration';panel.open=openPanel;panel.append(el('summary','Локальные участники, комментарии и решения'),el('p',localCollaborationNotice,'pm-warning'),el('p','Все записи находятся в JSON текущей программы. Обмена в реальном времени и общей серверной копии нет. Импорт создает отдельную копию, полученные записи не подтверждают их подлинность.','pm-notice'));versionLabel=el('p','','pm-help');panel.append(versionLabel);status=el('p','','pm-message');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.id='pm-local-status';panel.append(status);
  const participants=el('details',undefined,'pm-local-section');participants.append(el('summary','Участники и организационные роли'));
  const edit=select('Изменить существующую метку участника','pm-local-edit',[['','Новый участник'],...p.collaboration.participants.map(x=>[x.id,x.name])],id=>{editingId=id;const selected=getProgram().collaboration.participants.find(x=>x.id===id);nameInput.value=selected?.name||'';roleSelect.value=selected?.role||'';});editSelect=edit.input;
  const name=field('Имя (вводится вручную)','pm-local-name',{maxLength:160});nameInput=name.input;
  const role=select('Организационная роль, не право доступа','pm-local-role',[['','Выберите метку роли'],...collaborationRoles.map(r=>[r,roleLabels[r]||r])]);roleSelect=role.input;const grid=el('div',undefined,'pm-grid');grid.append(edit.wrap,name.wrap,role.wrap);participants.append(grid,button('Сохранить участника',saveParticipant));participantsArea=el('div');participants.append(participantsArea);panel.append(participants);
  const author=select('Автор следующих записей (указан вручную)','pm-local-author',[['','Автор не выбран'],...p.collaboration.participants.map(x=>[x.id,x.name+' / '+(roleLabels[x.role]||x.role)])],id=>{if(!available()){authorSelect.value=getProgram().collaboration.activeParticipantId||'';return;}try{replace(selectParticipant(getProgram(),id||null),'Выбор ручной метки автора сохранен. Это не вход в систему.');}catch(e){message(e.message);}});authorSelect=author.input;authorSelect.value=p.collaboration.activeParticipantId||'';panel.append(author.wrap,el('p','Организационная роль не ограничивает кнопки и не дает привилегий. Любой человек с этой JSON-копией может изменить данные.','pm-help'));
  const comments=el('details',undefined,'pm-local-section');comments.append(el('summary','Комментарии'));
  const scope=select('Область комментария','pm-local-comment-scope',[['program','Вся программа'],['measure','Выбранная мера']],v=>{commentMeasure.parentElement.hidden=v!=='measure';});commentScope=scope.input;
  const measure=select('Мера комментария','pm-local-comment-measure',[['','Выберите меру'],...p.measures.map(m=>[m.id,measures.find(x=>x.id===m.id)?.title||m.id])]);commentMeasure=measure.input;measure.wrap.hidden=true;
  const text=field('Комментарий','pm-local-comment-text',{textarea:true,maxLength:collaborationLimits.text});commentText=text.input;comments.append(scope.wrap,measure.wrap,text.wrap,button('Добавить локальный комментарий',saveComment));commentsArea=el('div');comments.append(commentsArea);panel.append(comments);
  const decisions=el('details',undefined,'pm-local-section');decisions.append(el('summary','Решение по точной версии'));
  const decision=select('Решение','pm-local-decision',[['','Выберите явно'],...Object.entries(decisionLabels)],()=>clearReview());decisionSelect=decision.input;
  const note=field('Пояснение решения','pm-local-decision-note',{textarea:true,maxLength:collaborationLimits.text});noteInput=note.input;noteInput.addEventListener('input',clearReview);decisions.append(decision.wrap,note.wrap,button('Предпросмотр решения',previewDecision));reviewArea=el('div');reviewArea.id='pm-local-decision-preview';decisions.append(reviewArea);
  const confirm=el('label',undefined,'pm-check');confirmInput=el('input');confirmInput.type='checkbox';confirmInput.id='pm-local-decision-confirm';confirmInput.addEventListener('change',()=>{applyButton.disabled=!review||!confirmInput.checked;});confirm.append(confirmInput,el('span','Я просмотрел(а) эту версию программы и подтверждаю запись указанного решения. Это не электронная подпись и не подтверждение экономии.'));applyButton=button('Записать подтвержденное решение',commitDecision);applyButton.id='pm-local-decision-save';applyButton.disabled=true;decisions.append(confirm,applyButton);decisionsArea=el('div');decisions.append(decisionsArea);panel.append(decisions);
  const journal=el('details',undefined,'pm-local-section');journal.append(el('summary','Локальная история действий'));historyArea=el('div');journal.append(historyArea);panel.append(journal);sectionNodes=[participants,comments,decisions,journal];sectionNodes.forEach((section,index)=>{section.open=!!openSections[index];});host.append(panel);renderRecords();
 }
 function refreshDerived(){if(!host)return;const p=getProgram();if(p.id!==programId){mount(host);return;}if(review&&(review.revision!==p.collaboration.revision||review.authorId!==p.collaboration.activeParticipantId)){clearReview();message('Версия или автор изменились. Предпросмотр решения сброшен.');}renderRecords();}
 return {mount,refreshDerived,getAuthorId:()=>getProgram().collaboration.activeParticipantId};
}
