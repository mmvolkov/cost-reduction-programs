import { createProgram, createProgramMeasure, validateProgram } from './program-model.js';

export const PROGRAM_SCHEMA_VERSION = 1;
export const PROGRAM_STORAGE_KEY = 'scout.cost-reduction.programs.v1';
export const MAX_PROGRAM_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_PROGRAMS = 20;
const own = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Ожидался объект данных.');
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Неизвестные или отсутствующие поля файла.');
};
const emptyState = () => ({ schemaVersion: PROGRAM_SCHEMA_VERSION, activeId: null, programs: [] });
function checkSize(text) {
  if (typeof text !== 'string' || text.length > MAX_PROGRAM_JSON_BYTES || new TextEncoder().encode(text).length > MAX_PROGRAM_JSON_BYTES) throw new RangeError('Файл слишком большой: максимум 2 МБ.');
}
function parse(text) {
  checkSize(text);
  return JSON.parse(text, (key, value) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Недопустимое поле файла.');
    return value;
  });
}
export function validateProgramState(value) {
  own(value, ['schemaVersion', 'activeId', 'programs']);
  if (value.schemaVersion !== PROGRAM_SCHEMA_VERSION) throw new TypeError('Версия схемы не поддерживается.');
  if (!Array.isArray(value.programs) || value.programs.length > MAX_PROGRAMS) throw new RangeError('Допустимо не более 20 программ.');
  const programs = value.programs.map(program => validateProgram(program));
  if (new Set(programs.map(p => p.id)).size !== programs.length) throw new TypeError('Идентификаторы программ повторяются.');
  if ((programs.length === 0 && value.activeId !== null) || (programs.length && !programs.some(p => p.id === value.activeId))) throw new TypeError('Активная программа не найдена.');
  return { schemaVersion: PROGRAM_SCHEMA_VERSION, activeId: value.activeId, programs };
}
function serializedState(state) {
  const result = JSON.stringify(validateProgramState(state)); checkSize(result); return result;
}
const messages = {
  empty: 'Программ пока нет. Новые данные будут сохраняться только в этом браузере и origin.',
  saved: 'Сохранено в этом браузере и origin.',
  corrupt: 'Сохранённые данные повреждены или имеют неизвестную версию. Оригинал не перезаписан. Экспортируйте текущую работу; восстановление хранилища требует отдельного действия.',
  unavailable: 'Хранилище браузера недоступно. Изменения остаются только в памяти: экспортируйте JSON перед закрытием страницы.',
  quota: 'Недостаточно места в хранилище. Последняя сохранённая версия не заменена. Экспортируйте JSON с текущими изменениями.',
  conflict: 'Данные изменены в другой вкладке. Автосохранение остановлено. Экспортируйте текущую работу, затем перезагрузите страницу.',
  locking: 'Безопасное автосохранение недоступно: браузер не поддерживает блокировку между вкладками. Данные остаются в памяти; экспортируйте JSON.',
  invalid: 'Данные не прошли проверку или превышают размер 2 МБ. Изменения не сохранены.',
};
function status(code) { return { code, message: messages[code] }; }
function errorStatus(error) { return status(error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014 ? 'quota' : 'unavailable'); }
/** Storage is injected in tests. No access key, chat or AI settings are accepted by the strict schema. */
export function createProgramStore(storage, { locks = globalThis.navigator?.locks } = {}) {
  let target = storage, lastRaw, loaded = false, blocked = false;
  function getStorage() {
    if (target === undefined) target = globalThis.localStorage;
    if (!target || typeof target.getItem !== 'function' || typeof target.setItem !== 'function') throw new Error('Storage unavailable');
    return target;
  }
  function load() {
    loaded = true;
    try {
      lastRaw = getStorage().getItem(PROGRAM_STORAGE_KEY);
      if (lastRaw === null) { blocked = false; return { ok: true, state: emptyState(), status: status('empty') }; }
      try {
        const state = validateProgramState(parse(lastRaw)); blocked = false;
        return { ok: true, state, status: status('saved') };
      } catch { blocked = true; return { ok: false, state: emptyState(), status: status('corrupt') }; }
    } catch { blocked = true; lastRaw = undefined; return { ok: false, state: emptyState(), status: status('unavailable') }; }
  }
  function write(raw, explicitRecovery) {
    if (!loaded) return { ok: false, status: status('unavailable') };
    if (blocked && !explicitRecovery) return { ok: false, status: status(lastRaw === undefined ? 'unavailable' : 'corrupt') };
    try {
      const storage = getStorage(), current = storage.getItem(PROGRAM_STORAGE_KEY);
      if (lastRaw !== undefined && current !== lastRaw) return { ok: false, status: status('conflict') };
      // Explicit recovery after unavailable storage must not replace data that appeared meanwhile.
      if (lastRaw === undefined && current !== null) return { ok: false, status: status('conflict') };
      storage.setItem(PROGRAM_STORAGE_KEY, raw);
      lastRaw = raw; blocked = false;
      return { ok: true, status: status('saved') };
    } catch (error) { return { ok: false, status: errorStatus(error) }; }
  }
  async function guardedWrite(state, explicitRecovery) {
    // Snapshot before waiting: later UI edits must not mutate a queued write.
    let raw;
    try { raw = serializedState(state); } catch { return { ok: false, status: status('invalid') }; }
    // localStorage getItem + setItem is not a cross-tab compare-and-swap.
    // Every writer must hold the same origin-scoped Web Lock for the entire check/write.
    // Without this primitive we never silently fall back to an unsafe write.
    if (!locks || typeof locks.request !== 'function') return { ok: false, status: status('locking') };
    try {
      return await locks.request(PROGRAM_STORAGE_KEY + '.writer', { mode: 'exclusive' }, () => write(raw, explicitRecovery));
    } catch { return { ok: false, status: status('locking') }; }
  }
  return Object.freeze({ load, save: state => guardedWrite(state, false), recover: state => guardedWrite(state, true) });
}
export function exportProgramJson(program) {
  const raw = JSON.stringify({ schemaVersion: PROGRAM_SCHEMA_VERSION, program: validateProgram(program) }, null, 2);
  checkSize(raw); return raw;
}
export function importProgramJson(text) {
  const envelope = parse(text); own(envelope, ['schemaVersion', 'program']);
  if (envelope.schemaVersion !== PROGRAM_SCHEMA_VERSION) throw new TypeError('Версия схемы не поддерживается.');
  const program = validateProgram(envelope.program);
  const fresh = createProgram();
  program.id = fresh.id;
  program.updatedAt = fresh.updatedAt;
  program.name = (program.name + ' (импорт)').slice(0, 160);
  program.overlap.confirmed = false;
  program.measures.forEach(measure => measure.facts.forEach(fact => { fact.confirmed = false; }));
  return validateProgram(program);
}
export function cloneProgramScenario(source) {
  const program = validateProgram(source);
  const fresh = createProgram();
  program.id = fresh.id;
  program.updatedAt = fresh.updatedAt;
  program.name = (program.name + ' (копия сценария)').slice(0, 160);
  program.overlap.confirmed = false;
  program.measures.forEach(measure => { measure.facts = createProgramMeasure(measure.id).facts; });
  return validateProgram(program);
}
