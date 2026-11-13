import { measures } from './data.js';
import { aiTasks, aiTextFields, createAiSnapshot, assertAiSnapshotCurrent, applyAiTextDraft, normalizeAiDraftResponse } from './program-ai.js';

const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;if(tag==='pre'||className==='pm-ai-response')n.tabIndex=0;return n;};
const clone=value=>JSON.parse(JSON.stringify(value));

// The epoch also rejects responses when a provider ignores AbortSignal.
export function createAiRequestGuard(){
  let epoch=0,current=null;
  return {
    begin(){if(current)current.abort();current=new AbortController();const version=++epoch;return {version,signal:current.signal};},
    isCurrent(ticket){return !!ticket&&ticket.version===epoch&&!ticket.signal.aborted;},
    cancel(){epoch++;if(current)current.abort();current=null;}
  };
}

export function createProgramAiController({getProgram,getRevision,mutate,canNavigate,announce,requestAi,getAiAvailability}){
  const guard=createAiRequestGuard();
  let host,panel,selectedMeasure='',selectedTask='',includeText=false,snapshot=null,consent=false,busy=false,response='',draft='',target='',comparison=null,confirmed=false;
  let consentInput,sendButton,cancelButton,status,previewBox,responseBox,draftInput,targetSelect,reviewButton,comparisonBox,confirmInput,applyButton,availabilityText,includeInput;
  let renderedProgramId=null;
  const availability=()=>getAiAvailability?.()||{enabled:false,reason:'AI пока не подключен.'};
  const button=(text,action)=>{const b=node('button',text,'pm-button');b.type='button';b.addEventListener('click',action);return b;};
  const message=text=>{if(status)status.textContent=text;announce?.(text);};
  const select=(label,options,value,onChange,id)=>{const wrap=node('label',undefined,'pm-field'),s=node('select');s.id=id;s.append(...options.map(([value,text])=>{const o=node('option',text);o.value=value;return o;}));s.value=value;s.addEventListener('change',()=>onChange(s.value));wrap.append(node('span',label),s);return {wrap,input:s};};
  const check=(label,onChange,id)=>{const wrap=node('label',undefined,'pm-check'),input=node('input');input.type='checkbox';input.id=id;input.addEventListener('change',()=>onChange(input.checked));wrap.append(input,node('span',label));return {wrap,input};};
  function usable(){if(canNavigate())return true;invalidate('Действие остановлено: сначала исправьте ввод или конфликт сохранения.');return false;}
  function clearReview(){comparison=null;confirmed=false;if(comparisonBox)comparisonBox.replaceChildren();if(confirmInput)confirmInput.checked=false;}
  function updateButtons(){
    if(!host)return;
    const a=availability();availabilityText.textContent=a.enabled?`Модель: ${a.label||a.model||'выбрана в общих настройках'}. Температура: ${a.temperature??0}. Действуют общие ограничения AI.`:a.reason||'AI пока не подключен. Настройки находятся в разделе AI-ассистента.';
    sendButton.disabled=busy||!snapshot||!consent||!a.enabled;
    cancelButton.disabled=!busy;
    consentInput.disabled=!snapshot||busy;
    reviewButton.disabled=busy||!snapshot||!response||!target||!draft.trim()||draft.length>4000;
    confirmInput.disabled=!comparison;
    applyButton.disabled=busy||!comparison||!confirmed;
    panel.setAttribute('aria-busy',String(busy));
  }
  function invalidate(reason='Контекст изменился. Заново проверьте его и разрешите отправку.'){
    guard.cancel();snapshot=null;consent=false;busy=false;response='';draft='';target='';clearReview();
    if(previewBox)previewBox.replaceChildren();if(responseBox)responseBox.replaceChildren();if(draftInput)draftInput.value='';if(targetSelect)targetSelect.value='';if(consentInput)consentInput.checked=false;
    if(status)status.textContent=reason;updateButtons();
  }
  function selectionChanged(fn){if(!usable())return false;fn();invalidate();return true;}
  function prepare(){
    if(!usable())return;
    invalidate('');
    try{snapshot=createAiSnapshot(getProgram(),{measureId:selectedMeasure,task:selectedTask,includeText,revision:getRevision()});previewBox.append(node('h4','Точно этот контекст будет передан модели'),node('pre',snapshot.preview,'pm-ai-preview'));message('Проверьте весь контекст. Отправка произойдет только после отдельного согласия.');}
    catch(e){message(e.message||'Выберите меру и задачу.');}
    updateButtons();
  }
  async function send(){
    if(!usable()||busy||!snapshot||!consent||!availability().enabled)return;
    const captured=snapshot;
    try{assertAiSnapshotCurrent(captured,getProgram(),getRevision());}catch{invalidate();return;}
    const ticket=guard.begin();busy=true;response='';draft='';clearReview();responseBox.replaceChildren();draftInput.value='';message('Готовится текстовый черновик. Финансовые поля не изменяются.');updateButtons();
    try{
      const result=await requestAi(clone(captured.request),{signal:ticket.signal,consent:true});
      if(!guard.isCurrent(ticket))return;
      if(!usable())return;
      assertAiSnapshotCurrent(captured,getProgram(),getRevision());
      response=normalizeAiDraftResponse(result);
      responseBox.replaceChildren(node('h4','Непроверенный ответ AI'),node('p','Проверьте утверждения и числа. Это не финансовый расчет и не подтверждение экономии.','pm-warning'),node('div',response,'pm-ai-response'));
      draft=response.length<=4000?response:'';draftInput.value=draft;
      message(response.length<=4000?'Отредактируйте черновик и выберите текстовое поле. Применение требует отдельной проверки.':'Ответ длиннее 4000 символов. Перенесите нужную часть в черновик вручную, без автоматического обрезания.');
    }catch(error){
      if(!guard.isCurrent(ticket))return;
      try{assertAiSnapshotCurrent(captured,getProgram(),getRevision());}catch{invalidate();return;}
      message('Не удалось получить черновик. Проверьте доступность AI и настройки подключения.');
    }finally{if(guard.isCurrent(ticket)){busy=false;updateButtons();}}
  }
  function review(){
    if(!usable()||!snapshot||!response||!target||!draft.trim()||draft.length>4000)return;
    try{
      assertAiSnapshotCurrent(snapshot,getProgram(),getRevision());
      const m=getProgram().measures.find(m=>m.id===snapshot.measureId),field=aiTextFields.find(f=>f.id===target);
      if(!m||!field)throw new Error('Выберите текстовое поле.');
      comparison={field:target,text:draft};confirmed=false;confirmInput.checked=false;
      comparisonBox.replaceChildren(node('h4','Проверка замены: '+field.label),node('p','Было'),node('pre',m.execution[target]||'(пусто)','pm-ai-preview'),node('p','Станет'),node('pre',draft,'pm-ai-preview'));
      message('Будет заменено только выбранное текстовое поле. Финансы, факты и подтверждения останутся прежними.');
    }catch(e){invalidate(e.message);}
    updateButtons();
  }
  function apply(){
    if(!usable()||!snapshot||!comparison||!confirmed||busy)return;
    const captured=snapshot,chosen={...comparison};
    try{
      assertAiSnapshotCurrent(captured,getProgram(),getRevision());
      const revision=getRevision();
      const success=mutate(program=>{
        const checked=applyAiTextDraft(program,captured,{revision,field:chosen.field,text:chosen.text,confirmed:true});
        program.measures.find(m=>m.id===captured.measureId).execution[chosen.field]=checked.measures.find(m=>m.id===captured.measureId).execution[chosen.field];
      },{refresh:true});
      if(success!==false){invalidate('Текст применен после вашего подтверждения. Финансы и факты не менялись.');announce?.('Текст применен после вашего подтверждения. Финансы и факты не менялись.');}
    }catch(e){invalidate(e.message||'Черновик устарел. Получите новый контекст.');}
  }
  function mount(root){
    // A remount must never preserve invisible consent or a pending draft.
    invalidate('');if(renderedProgramId!==getProgram().id){selectedMeasure='';selectedTask='';includeText=false;}host=root;renderedProgramId=getProgram().id;host.replaceChildren();host.classList.add('pm-p3');
    panel=node('details',undefined,'pm-panel pm-ai-panel');panel.id='pm-context-ai';panel.append(node('summary','Контекстный AI: гипотеза и план пилота'));
    panel.append(node('p','Выберите одну меру и задачу. AI готовит только непроверенный текст. Расходы, поставщики, факты и другие программы не передаются. Финансы считает существующий калькулятор.','pm-notice'));
    availabilityText=node('p','','pm-help');panel.append(availabilityText);
    const p=getProgram();if(!p.measures.some(m=>m.id===selectedMeasure))selectedMeasure='';
    const controls=node('div',undefined,'pm-grid');
    const measure=select('Мера для обсуждения',[['','Выберите меру'],...p.measures.map(m=>[m.id,measures.find(x=>x.id===m.id)?.title||m.id])],selectedMeasure,value=>{if(!selectionChanged(()=>{selectedMeasure=value;}))measure.input.value=selectedMeasure;},'pm-ai-measure');
    const task=select('Задача AI',[['','Выберите задачу'],...aiTasks.map(x=>[x.id,x.label])],selectedTask,value=>{if(!selectionChanged(()=>{selectedTask=value;}))task.input.value=selectedTask;},'pm-ai-task');controls.append(measure.wrap,task.wrap);panel.append(controls);
    const include=check('Включить область расходов и текущие текстовые заметки только выбранной меры, а также отрасль. Сначала проверьте, что в них нет секретов и персональных данных.',value=>{if(!selectionChanged(()=>{includeText=value;}))include.input.checked=includeText;},'pm-ai-include-text');includeInput=include.input;includeInput.checked=includeText;panel.append(include.wrap);
    panel.append(button('Подготовить предпросмотр контекста',prepare));previewBox=node('div');previewBox.id='pm-ai-context-preview';panel.append(previewBox);
    const consentControl=check('Я просмотрел(а) контекст выше и разрешаю передать именно его провайдеру выбранной модели.',value=>{consent=value;updateButtons();},'pm-ai-consent');consentInput=consentControl.input;panel.append(consentControl.wrap);
    const actions=node('div',undefined,'pm-toolbar');sendButton=button('Отправить показанный контекст',send);sendButton.id='pm-ai-send';cancelButton=button('Отменить запрос',()=>invalidate('Запрос отменен. Для новой отправки снова проверьте контекст и согласие.'));cancelButton.id='pm-ai-cancel';actions.append(sendButton,cancelButton);panel.append(actions);
    status=node('p','','pm-message');status.id='pm-ai-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(status);
    responseBox=node('div');responseBox.id='pm-ai-response';panel.append(responseBox);
    const draftLabel=node('label',undefined,'pm-field');draftInput=node('textarea');draftInput.id='pm-ai-draft';draftInput.rows=6;draftInput.maxLength=4000;draftInput.addEventListener('input',()=>{draft=draftInput.value;clearReview();updateButtons();});draftLabel.append(node('span','Редактируемый текстовый черновик (до 4000 символов)'),draftInput);panel.append(draftLabel);
    const field=select('Поле для применения текста',[['','Выберите поле'],...aiTextFields.map(x=>[x.id,x.label])],target,value=>{target=value;clearReview();updateButtons();},'pm-ai-target');targetSelect=field.input;panel.append(field.wrap);
    reviewButton=button('Показать изменение перед применением',review);reviewButton.id='pm-ai-review';panel.append(reviewButton);comparisonBox=node('div');comparisonBox.id='pm-ai-comparison';panel.append(comparisonBox);
    const confirm=check('Я проверил(а) текст и подтверждаю замену только указанного поля. Это не подтверждает денежный эффект.',value=>{confirmed=value;updateButtons();},'pm-ai-apply-confirm');confirmInput=confirm.input;panel.append(confirm.wrap);applyButton=button('Применить подтвержденный текст',apply);applyButton.id='pm-ai-apply';panel.append(applyButton);host.append(panel);updateButtons();
  }
  function refreshAvailability(){if(host&&getProgram().id!==renderedProgramId)invalidate();updateButtons();}
  function destroy(){invalidate('');host=null;}
  return {mount,invalidate,refreshAvailability,destroy};
}
