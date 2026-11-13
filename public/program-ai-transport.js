// Uses only the site's existing protected backend. No model credentials or
// user-configurable endpoint are accepted by the contextual workspace.
export function createProgramAiTransport({ apiBase, getConfig, getSettings, fetchImpl=globalThis.fetch, timeoutMs=50000 }) {
  function availability() {
    const config=getConfig(), settings=getSettings();
    const provider=config.providers?.find(p=>p.id===settings.providerId);
    const label=provider ? `${provider.id==='softline'?'Local':provider.label} · ${provider.model}` : 'AI не подключен';
    const reason=!apiBase ? 'Защищенный AI-сервер не настроен. Материалы и отчеты доступны.' : !config.enabled||!provider ? 'AI пока не подключен. Материалы и отчеты доступны.' : config.requiresAccessCode!==false&&!settings.accessCode ? 'Введите код доступа в настройках AI ниже на странице.' : '';
    return {enabled:!reason,reason,label,temperature:settings.temperature};
  }
  async function requestAi(payload,{signal,consent=false}={}) {
    if(consent!==true)throw new Error('Подтвердите передачу показанного контекста модели.');
    const available=availability();if(!available.enabled)throw new Error(available.reason);
    if(!payload||typeof payload!=='object'||Object.keys(payload).sort().join(',')!=='context,messages')throw new Error('Некорректный контекст. Подготовьте предпросмотр заново.');
    if(!Array.isArray(payload.messages)||payload.messages.length!==1||payload.messages[0]?.role!=='user'||typeof payload.messages[0].content!=='string'||!payload.messages[0].content.trim()||payload.messages[0].content.length>6000||Object.keys(payload.messages[0]).sort().join(',')!=='content,role')throw new Error('Некорректное сообщение предпросмотра.');
    if(!payload.context||Object.keys(payload.context).join(',')!=='measureIds'||!Array.isArray(payload.context.measureIds)||payload.context.measureIds.length!==1||typeof payload.context.measureIds[0]!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(payload.context.measureIds[0]))throw new Error('Выберите одну меру.');
    const config=getConfig(), settings=getSettings();
    const body={providerId:settings.providerId,...(config.requiresAccessCode!==false?{accessCode:settings.accessCode}:{}),consent:true,messages:[{role:'user',content:payload.messages[0].content}],context:{measureIds:[payload.context.measureIds[0]]},temperature:settings.temperature};
    const controller=new AbortController();
    const abort=()=>controller.abort();
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,timeoutMs);
    try {
      if(controller.signal.aborted)throw new DOMException('Отменено','AbortError');
      const response=await fetchImpl(new URL('chat',apiBase).href,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify(body)});
      const data=await response.json();
      if(!response.ok){const messages={401:'Неверный код доступа. Проверьте настройки AI.',429:'Лимит AI исчерпан или все места заняты. Повторите позже.',503:'AI временно недоступен. Попробуйте позже.',504:'Время ожидания AI истекло.'};throw new Error(messages[response.status]||'Не удалось получить AI-черновик. Попробуйте позже.');}
      if(controller.signal.aborted)throw new DOMException('Отменено','AbortError');
      if(typeof data?.content!=='string'||data.content.length>24000)throw new Error('Некорректный ответ AI.');
      return {kind:data.kind,content:data.content};
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  return Object.freeze({availability,requestAi});
}
