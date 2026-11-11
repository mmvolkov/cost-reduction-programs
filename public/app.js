import { measures, cases, industries } from './data.js';
import { calculateSavings } from './calculator.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (n, digits = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);
const selected = new Set(['procurement', 'production']);
const defaults = { annualSpend:120, savingsPercent:8, implementationCost:2, monthlyCost:.1, rampMonths:4 };
let currentCalculation, baseRate = 8, currentContext = {}, messages = [], config = { enabled:false, providers:[] };
let settings = { providerId:'softline', accessCode:'', temperature:.5 };
let pending = false, requestController = null, requestVersion = 0, toastTimer;

function toast(text) {
  $('#toast').textContent = text; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function updateSelection() {
  const n = selected.size;
  $('#selected-count').textContent = `${n} ${n === 1 ? 'мера' : n < 5 && n > 1 ? 'меры' : 'мер'}`;
  $$('.measure-select').forEach(button => {
    const checked = selected.has(button.dataset.id);
    button.classList.toggle('selected', checked); button.setAttribute('aria-pressed', String(checked));
    button.replaceChildren(document.createTextNode(checked ? 'В программе' : 'Добавить в программу'));
    const symbol = document.createElement('span'); symbol.textContent = checked ? '✓' : '+'; button.append(symbol);
  });
}
function renderMeasures() {
  $('#measure-grid').innerHTML = measures.map(m => `<article class="measure-card" data-category="${m.category}"><div class="measure-top"><span class="measure-icon" aria-hidden="true">${m.icon}</span><span class="measure-category">${m.category}</span></div><h3>${m.title}</h3><p>${m.brief}</p><div class="measure-meta"><span>◷ ${m.time}</span><span><span class="tiny-dot"></span> ${m.risk === 'Низкий' ? 'Начать с пилота' : 'Нужна проверка рисков'}</span></div><details><summary>Что делать и как измерять <span>+</span></summary><p><strong>Драйвер:</strong> ${m.driver}</p><ol>${m.steps.map(s => `<li>${s}</li>`).join('')}</ol><p><strong>Контроль:</strong> ${m.metric}</p><p class="guardrail">${m.guard}</p></details><button class="measure-select" data-id="${m.id}" aria-pressed="false">Добавить в программу <span>+</span></button></article>`).join('');
  updateSelection();
}
function renderCases() {
  $('#case-grid').innerHTML = cases.map(c => {
    const r = calculateSavings({ annualSpend:c.spend, savingsPercent:c.rate, implementationCost:c.investment, monthlyCost:c.monthly, rampMonths:c.ramp });
    return `<article class="case-card"><div class="case-tag">${c.sector}<span>Условный пример</span></div><h3>${c.title}</h3><p>${c.description}</p><div class="case-result"><strong>${fmt(r.firstYearNet, 2)} <span>млн ₽</span></strong><span>чистый эффект за первый год</span></div><div class="case-inputs">База: <b>${fmt(c.spend)} млн ₽/год</b> · снижение: <b>${c.rate}%</b><br>Запуск: <b>${fmt(c.investment)} млн ₽</b> · разгон: <b>${c.ramp} мес.</b><br>Поддержка: <b>${fmt(c.monthly,2)} млн ₽/мес.</b></div><button class="case-button" data-case="${c.id}">Посмотреть расчёт <span class="arrow-diagonal" aria-hidden="true"></span></button></article>`;
  }).join('');
}
function readInputs() { return Object.fromEntries(Object.keys(defaults).map(key => [key, Number($('#'+key).value)])); }
function renderChart(series) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox','0 0 360 100'); svg.setAttribute('role','img'); svg.setAttribute('aria-label','Накопленный эффект за 12 месяцев, отрицательные значения серым ниже линии нуля');
  const vals = series.map(x => x.accumulated), min = Math.min(0,...vals), max = Math.max(0,...vals), range = max - min || 1;
  const y = v => 5 + (max - v) / range * 87, zero = y(0);
  const line = document.createElementNS(ns,'line'); Object.entries({x1:0,x2:360,y1:zero,y2:zero,class:'zero-line'}).forEach(([k,v])=>line.setAttribute(k,String(v))); svg.append(line);
  series.forEach((point,i) => {
    const rect = document.createElementNS(ns,'rect'); const valueY = y(point.accumulated);
    Object.entries({x:i*30+4,y:Math.min(zero,valueY),width:21,height:Math.max(1,Math.abs(zero-valueY)),rx:2,class:point.accumulated<0?'negative-bar':'positive-bar'}).forEach(([k,v])=>rect.setAttribute(k,String(v)));
    const title = document.createElementNS(ns,'title'); title.textContent = `Месяц ${point.month}: ${fmt(point.accumulated,2)} млн ₽`; rect.append(title); svg.append(rect);
  });
  $('#cash-chart').replaceChildren(svg);
}
function updateCalculation() {
  $('#savings-output').textContent = fmt(Number($('#savingsPercent').value)) + '%';
  if (!$('#calc-form').checkValidity()) { $('#calc-error').textContent = 'Проверьте значения: нужны неотрицательные числа в допустимых пределах.'; currentCalculation = null; $('#first-year').textContent = '—'; $('#annual-net').textContent = '—'; $('#payback').textContent = '—'; $('#cash-chart').replaceChildren(); return; }
  try {
    currentCalculation = calculateSavings(readInputs());
    $('#calc-error').textContent = '';
    $('#first-year').replaceChildren(document.createTextNode(fmt(currentCalculation.firstYearNet,2)+' '));
    const unit = document.createElement('span'); unit.textContent = 'млн ₽'; $('#first-year').append(unit);
    $('#annual-net').textContent = `${fmt(currentCalculation.annualNet,2)} млн ₽ / год`;
    $('#payback').textContent = currentCalculation.paybackMonths === null ? 'Не достигнута за 10 лет' : currentCalculation.paybackMonths === 0 ? 'Без вложений' : `${fmt(currentCalculation.paybackMonths)} мес.`;
    renderChart(currentCalculation.series);
  } catch { currentCalculation = null; $('#calc-error').textContent = 'Проверьте значения в расчёте.'; }
}
function fillInputs(values) {
  Object.entries(values).forEach(([key,value])=>{ if ($('#'+key)) $('#'+key).value = value; });
  baseRate = values.savingsPercent;
  $$('[data-scenario]').forEach(b => b.classList.toggle('active', b.dataset.scenario === 'base'));
  updateCalculation();
}
function setContext(type) {
  currentContext = type === 'free' ? {} : { measureIds:[...selected] };
  if (type === 'calculator' && currentCalculation) currentContext.calculator = readInputs();
  $('#chat-context span').textContent = type === 'free' ? 'Свободный диалог' : type === 'calculator' ? `Разбор расчёта · ${selected.size} мер · ${fmt(currentCalculation.firstYearNet,2)} млн ₽` : `Подбор программы · ${selected.size} мер`;
  $('#clear-context').hidden = type === 'free';
  $('#assistant').scrollIntoView({behavior:'smooth'});
}
function appendMessage(role, content, extra = '') {
  const div = document.createElement('div'); div.className = `message ${role} ${extra}`; div.textContent = content;
  $('#chat-messages').append(div); $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  return div;
}
function updateModelLabel() {
  const profile = config.providers.find(p => p.id === settings.providerId);
  $('#model-label').textContent = profile ? `${profile.label} · ${profile.model}` : 'Qwen · требуется настройка сервера';
}
async function loadConfig() {
  try {
    const response = await fetch('/api/config', { cache:'no-store' });
    if (!response.ok) throw new Error();
    config = await response.json();
    if (!Array.isArray(config.providers)) throw new Error();
    const select = $('#provider-select'); select.replaceChildren();
    config.providers.forEach(p => { const opt = document.createElement('option'); opt.value=p.id; opt.textContent=`${p.label} · ${p.model}`; select.append(opt); });
    if (!config.providers.length) { const opt=document.createElement('option'); opt.value=''; opt.textContent='Нет настроенных подключений'; select.append(opt); }
    settings.providerId = config.providers.some(p=>p.id===settings.providerId) ? settings.providerId : config.providers[0]?.id || '';
    select.value = settings.providerId;
    $('#ai-status').textContent = config.enabled ? 'Для первого сообщения введите код доступа в настройках ⚙.' : 'AI пока не подключён. Калькулятор и материалы доступны. Владельцу сервера: добавьте ключ API и код доступа по инструкции в репозитории.';
  } catch { $('#ai-status').textContent = 'Не удалось проверить AI. Материалы и калькулятор работают. Перезагрузите страницу после запуска сервера.'; }
  updateModelLabel();
}
async function sendMessage(event) {
  event.preventDefault(); if (pending) return;
  const content = $('#chat-input').value.trim(); if (!content) return;
  if (!config.enabled) { toast('AI ещё не подключён на сервере. Откройте настройки для инструкции.'); $('#settings-dialog').showModal(); return; }
  if (!settings.accessCode) { toast('Введите код доступа к ассистенту.'); $('#settings-dialog').showModal(); $('#access-code').focus(); return; }
  if (!$('#ai-consent').checked) { toast('Подтвердите передачу диалога и контекста модели.'); $('#ai-consent').focus(); return; }
  const nextMessages = [...messages, {role:'user',content}];
  // Bound history by both count and characters; never retain hidden longer history in requests.
  while (nextMessages.length > 19 || nextMessages.reduce((n,m)=>n+m.content.length,0)>22000) nextMessages.shift();
  appendMessage('user',content); $('#chat-input').value='';
  const loading = appendMessage('assistant','Проверяю допущения и готовлю ответ…');
  pending = true; $('#send-chat').disabled=true;
  const version=++requestVersion; requestController = new AbortController(); const timer=setTimeout(()=>requestController?.abort(),50000);
  try {
    const response = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:requestController.signal,body:JSON.stringify({providerId:settings.providerId,accessCode:settings.accessCode,consent:true,messages:nextMessages,context:currentContext,temperature:settings.temperature})});
    const data = await response.json();
    if(version!==requestVersion) return;
    if(!response.ok) throw new Error(typeof data.error==='string'?data.error:'Ответ модели недоступен.');
    if(typeof data.content!=='string') throw new Error('Модель вернула пустой ответ.');
    loading.textContent = data.content; messages = [...nextMessages,{role:'assistant',content:data.content}];
    $('#ai-status').textContent = ''; $('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;
  } catch(error) {
    if(version!==requestVersion) return;
    loading.classList.add('error-message'); loading.textContent = error.name==='AbortError'?'Время ожидания истекло. Попробуйте ещё раз.':error.message;
    $('#chat-input').value=content;
  } finally {
    clearTimeout(timer);
    if(version===requestVersion){pending=false;$('#send-chat').disabled=false;requestController=null;}
  }
}
function downloadPlan() {
  if(!currentCalculation){toast('Сначала исправьте параметры расчёта.');return;}
  const r=currentCalculation;
  const lines=['ПРОГРАММА СНИЖЕНИЯ ЗАТРАТ','Расчётный сценарий, не прогноз и не гарантия результата.','',`База расходов: ${fmt(r.annualSpend,2)} млн ₽/год`,`Снижение: ${fmt(r.savingsPercent)}%`,`Запуск: ${fmt(r.implementationCost,2)} млн ₽`,`Поддержка: ${fmt(r.monthlyCost,2)} млн ₽/месяц`,`Линейный разгон: ${fmt(r.rampMonths)} месяцев`,'',`Первый год: ${fmt(r.firstYearNet,2)} млн ₽`,`Чистый годовой эффект на полном ходу: ${fmt(r.annualNet,2)} млн ₽`,`Окупаемость: ${r.paybackMonths===null?'не достигнута за 120 месяцев':fmt(r.paybackMonths)+' месяцев'}`,'','ВЫБРАННЫЕ МЕРЫ',...measures.filter(m=>selected.has(m.id)).flatMap(m=>[m.title,...m.steps.map((s,i)=>`${i+1}. ${s}`),`Метрика: ${m.metric}`,`Ограничение: ${m.guard}`,'Владелец: __________  Срок: __________','']),'ПЛАН 30/60/90','1–30: база расходов, владельцы, 3–5 гипотез, ограничения качества.','31–60: пилот, сверка факта с базой, учёт внедрения и пересечений.','61–90: масштабирование подтверждённого результата и ежемесячная проверка.','','МЕСЯЧНЫЙ НАКОПЛЕННЫЙ ЭФФЕКТ',...r.series.map(p=>`${p.month}: ${fmt(p.accumulated,3)} млн ₽`),'','МЕТОДИКА','Экономия растёт линейно в период разгона; в месяце используется средняя точка. Поддержка оплачивается с первого месяца, затраты запуска возникают в начале. Налоги, сезонность, стоимость капитала и изменение объёмов не моделируются. Высвобождение запасов и часов считается отдельно. Проверьте влияние на выручку и маржу.','Сделано в проекте cost-reduction-programs.'];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.join('\n')],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='cost-reduction-plan.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Расчёт и план скачаны.');
}
renderMeasures();renderCases();updateCalculation();loadConfig();
$('#measure-grid').addEventListener('click',event=>{const b=event.target.closest('.measure-select');if(!b)return;selected.has(b.dataset.id)?selected.delete(b.dataset.id):selected.add(b.dataset.id);updateSelection();});
$$('[data-filter]').forEach(button=>button.addEventListener('click',()=>{$$('[data-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});$$('.measure-card').forEach(card=>{card.hidden=button.dataset.filter!=='Все'&&card.dataset.category!==button.dataset.filter;});}));
$('#case-grid').addEventListener('click',event=>{const b=event.target.closest('[data-case]');if(!b)return;const c=cases.find(x=>x.id===b.dataset.case);selected.clear();c.measures.forEach(id=>selected.add(id));updateSelection();fillInputs({annualSpend:c.spend,savingsPercent:c.rate,implementationCost:c.investment,monthlyCost:c.monthly,rampMonths:c.ramp});$('#calculator').scrollIntoView({behavior:'smooth'});toast('Условный сценарий загружен. Замените допущения своими.');});
$('#calc-form').addEventListener('submit',event=>event.preventDefault());
$('#calc-form').addEventListener('input',event=>{if(event.target.id==='savingsPercent'){baseRate=Number(event.target.value);$$('[data-scenario]').forEach(b=>b.classList.toggle('active',b.dataset.scenario==='base'));}updateCalculation();});
$('#reset-calc').addEventListener('click',()=>{fillInputs(defaults);toast('Параметры расчёта сброшены.');});
$$('[data-scenario]').forEach(button=>button.addEventListener('click',()=>{$('#savingsPercent').value=button.dataset.scenario==='conservative'?Math.round(baseRate*.6*2)/2:baseRate;$$('[data-scenario]').forEach(b=>b.classList.toggle('active',b===button));updateCalculation();}));
$('#discuss-selection').addEventListener('click',()=>{if(!selected.size){toast('Выберите хотя бы одну меру.');return;}setContext('measures');$('#chat-input').value='Помоги расставить приоритеты по выбранным мерам и составить план. Сначала уточни недостающие данные.';$('#chat-input').focus({preventScroll:true});});
$('#discuss-calc').addEventListener('click',()=>{if(!currentCalculation){toast('Исправьте параметры расчёта.');return;}setContext('calculator');$('#chat-input').value='Проверь мой расчёт и выбранные меры: реалистичность допущений, двойной счёт, риски и следующие шаги.';$('#chat-input').focus({preventScroll:true});});
$('#clear-context').addEventListener('click',()=>{setContext('free');toast('Новый контекст не передаётся. Чтобы удалить прежние данные из истории, очистите диалог.');});
$('#download-plan').addEventListener('click',downloadPlan);
$$('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{$('#chat-input').value=button.dataset.prompt;$('#chat-input').focus();}));
$('#open-settings').addEventListener('click',()=>{ $('#provider-select').value=settings.providerId; $('#access-code').value=settings.accessCode; $('#temperature').value=String(settings.temperature); $('#settings-dialog').showModal(); });
$('#close-settings').addEventListener('click',()=>$('#settings-dialog').close());
$('#settings-dialog').addEventListener('click',event=>{if(event.target===$('#settings-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
$('#settings-form').addEventListener('submit',event=>{event.preventDefault();settings={providerId:$('#provider-select').value,accessCode:$('#access-code').value,temperature:Number($('#temperature').value)};updateModelLabel();$('#settings-dialog').close();if(config.enabled)$('#ai-status').textContent=settings.accessCode?'Подключение выбрано. Проверьте согласие перед отправкой.':'Введите код доступа в настройках ⚙.';toast('Настройки сохранены в этой вкладке.');});
$('#chat-form').addEventListener('submit',sendMessage);
$('#chat-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#chat-form').requestSubmit();}});
$('#clear-chat').addEventListener('click',()=>{requestVersion++;requestController?.abort();pending=false;$('#send-chat').disabled=false;messages=[];currentContext={};$('#chat-messages').replaceChildren();appendMessage('assistant','Начинаем новый диалог. Расскажите, что хотите улучшить в экономике бизнеса.');$('#chat-context span').textContent='Свободный диалог';$('#clear-context').hidden=true;$('#chat-input').value='';$('#ai-consent').checked=false;toast('Диалог и контекст очищены из этой вкладки.');});

industries.forEach(item=>{ const option=document.createElement('option');option.value=item.id;option.textContent=item.title;$('#industry-select').append(option); });
$('#industry-select').addEventListener('change',()=>{const item=industries.find(i=>i.id===$('#industry-select').value);$('#apply-industry').hidden=!item;if(!item){$('#industry-note').textContent='Подберите направления для своей отрасли и проверьте их на ваших данных.';return;}const title=document.createElement('strong');title.textContent=item.focus;const p=document.createElement('p');p.textContent=item.guard+' Контроль: '+item.metric;$('#industry-note').replaceChildren(title,p);});
$('#apply-industry').addEventListener('click',()=>{const item=industries.find(i=>i.id===$('#industry-select').value);if(!item)return;selected.clear();item.measures.forEach(id=>selected.add(id));updateSelection();toast('Типовые меры выбраны. Это гипотезы для проверки, не готовый диагноз.');});
