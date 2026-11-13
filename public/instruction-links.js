const base='https://docs.google.com/document/d/1diULCCIVJVuJsMt_yMYCfhMsmFJcEpv4kYd161N29zI/edit?tab=t.0#heading=';
const sections=Object.freeze({
  measures:['h.zcqmzhmv6a3p','Как выбрать меры'],
  approval:['h.kb73ptor3kau','Как согласовать программу'],
  json:['h.z6pzwfq2opv3','Как передать JSON'],
  facts:['h.zfrpcwgw9dmg','Как вести план-факт']
});

// A plain link, not an action: no program state, persistence or event handlers.
export function instructionLink(section){
  if(!Object.hasOwn(sections,section))throw new TypeError('Неизвестный раздел инструкции');
  const [heading,label]=sections[section],link=document.createElement('a');
  link.className='context-help';link.textContent=label+' ↗';
  link.href=base+heading;link.target='_blank';link.rel='noopener noreferrer';
  link.setAttribute('aria-label',label+'. Откроется в новой вкладке.');
  return link;
}
