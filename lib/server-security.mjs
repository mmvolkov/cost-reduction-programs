import { timingSafeEqual, createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
export function equalSecret(actual, expected) {
  if (typeof actual !== 'string' || !expected || actual.length > 512) return false;
  const hash = x => createHash('sha256').update(x).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}
export function boundedInt(value, fallback, min, max) {
  const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
export function profilesFrom(env) {
  const allowed = new Set(['api.ai-assistants.softline.com', ...(env.AI_ALLOWED_HOSTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)]);
  let extra = [];
  try { extra = JSON.parse(env.AI_PROVIDERS_JSON || '[]'); } catch { /* Invalid administrator config fails closed. */ }
  if (!Array.isArray(extra)) extra = [];
  const profiles = [{ id: 'softline', label: 'Softline', baseUrl: 'https://api.ai-assistants.softline.com/v1', model: 'qwen3.8-27b-nvfp4', apiKeyEnv: 'AI_API_KEY' }, ...extra.slice(0, 12)];
  const seen = new Set();
  return profiles.filter(p => {
    if (!p || typeof p !== 'object' || !/^[a-z0-9_-]{1,40}$/.test(p.id || '') || seen.has(p.id)) return false;
    if (typeof p.label !== 'string' || p.label.length > 80 || !p.label.trim() || typeof p.model !== 'string' || !/^[\w./:@-]{1,100}$/.test(p.model) || !/^[A-Z][A-Z0-9_]{0,79}$/.test(p.apiKeyEnv || '')) return false;
    try {
      const u = new URL(p.baseUrl);
      if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.port && u.port !== '443') || !allowed.has(u.hostname) || isIP(u.hostname.replace(/[\[\]]/g, '')) || u.hostname === 'localhost' || u.hostname.endsWith('.localhost') || !u.hostname.includes('.')) return false;
      p.baseUrl = u.href.replace(/\/$/, '');
    } catch { return false; }
    seen.add(p.id); return true;
  });
}
export function normalizeInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.consent !== true) throw new Error('consent');
  const allowed = new Set(['providerId', 'accessCode', 'consent', 'messages', 'context', 'temperature']);
  if (Object.keys(body).some(k => !allowed.has(k))) throw new Error('input');
  if (typeof body.providerId !== 'string' || body.providerId.length > 40 || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 20) throw new Error('input');
  let total = 0;
  const messages = body.messages.map(m => {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 6000) throw new Error('input');
    total += m.content.length; return { role: m.role, content: m.content };
  });
  if (total > 24000 || messages.at(-1).role !== 'user') throw new Error('input');
  const context = {};
  if (body.context != null && (typeof body.context !== 'object' || Array.isArray(body.context))) throw new Error('input');
  if (body.context?.measureIds != null) {
    if (!Array.isArray(body.context.measureIds) || body.context.measureIds.length > 30 || body.context.measureIds.some(x => typeof x !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(x))) throw new Error('input');
    context.measureIds = [...new Set(body.context.measureIds)];
  }
  if (body.context?.calculator != null) {
    if (typeof body.context.calculator !== 'object' || Array.isArray(body.context.calculator)) throw new Error('input');
    context.calculator = {};
    for (const [key, max] of Object.entries({ annualSpend: 1e9, savingsPercent: 100, implementationCost: 1e9, monthlyCost: 1e9, rampMonths: 120 })) {
      const n = body.context.calculator[key];
      if (n !== undefined) {
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) throw new Error('input');
        context.calculator[key] = n;
      }
    }
  }
  const temperature = body.temperature ?? 0.4;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new Error('input');
  return { messages, context, temperature };
}
export function createLimiter(env) {
  const minuteCap = boundedInt(env.AI_IP_REQUESTS_PER_MINUTE, 8, 1, 100);
  const dailyIPCap = boundedInt(env.AI_IP_DAILY_REQUESTS, 100, 1, 10000);
  const dailyCap = boundedInt(env.AI_DAILY_REQUESTS, 500, 1, 100000);
  const ips = new Map(); let day = '', globalCount = 0;
  return ip => {
    const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
    if (day !== today) { day = today; globalCount = 0; ips.clear(); }
    if (globalCount >= dailyCap) return false;
    globalCount++;
    let record = ips.get(ip);
    if (!record) { if (ips.size >= 10000) return false; record = { start: now, minute: 0, daily: 0 }; ips.set(ip, record); }
    if (now - record.start >= 60000) { record.start = now; record.minute = 0; }
    record.minute++; record.daily++;
    return record.minute <= minuteCap && record.daily <= dailyIPCap;
  };
}
