import { constants } from 'node:fs';
import { open, rename, unlink, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Single-host filesystem only. All app processes must use the SAME private path.
// A crashed lock is never evicted automatically: stop all writers, inspect state,
// then remove the .lock manually. Missing/corrupt state is never reset implicitly.
// Abandoned leases expire after 120s; callers MUST terminate upstream requests
// within 45s and release only after completion/abort. Daily attempts are not refunded.
const LEASE_MS = 120_000;
const MAX_DAILY = 100;
const MAX_CONCURRENT = 2;
const unavailable = () => ({ ok: false, status: 'unavailable', reason: 'unavailable' });

function checkedPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new TypeError('AI_STATE_PATH must be absolute');
  const normalized = resolve(path);
  if (normalized.split(sep).some(part => part === 'public' || part === 'dist-pages')) {
    throw new TypeError('AI_STATE_PATH must not be in a public directory');
  }
  return normalized;
}
function dayAt(now) { return new Date(now).toISOString().slice(0, 10); }
function validTime(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000; }
function validate(state) {
  if (!state || state.version !== 1 || typeof state.day !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.day) ||
      new Date(`${state.day}T00:00:00.000Z`).toISOString().slice(0, 10) !== state.day ||
      !Number.isInteger(state.count) || state.count < 0 || state.count > MAX_DAILY ||
      !validTime(state.lastSeenAt) || dayAt(state.lastSeenAt) !== state.day ||
      !Array.isArray(state.leases) || state.leases.length > MAX_CONCURRENT) throw new Error('Invalid budget state');
  const ids = new Set();
  for (const lease of state.leases) {
    if (!lease || typeof lease.id !== 'string' || !/^[\da-f-]{36}$/.test(lease.id) || ids.has(lease.id) ||
        !validTime(lease.startedAt) || !validTime(lease.expiresAt) ||
        lease.expiresAt - lease.startedAt !== LEASE_MS || lease.startedAt > state.lastSeenAt) {
      throw new Error('Invalid budget lease');
    }
    ids.add(lease.id);
  }
  if (state.leases.filter(lease => dayAt(lease.startedAt) === state.day).length > state.count) {
    throw new Error('Invalid budget count');
  }
  return state;
}
async function syncDirectory(path) {
  const dir = await open(dirname(path), constants.O_RDONLY);
  try { await dir.sync(); } finally { await dir.close(); }
}
async function withLock(path, operation) {
  // Resolve parent symlinks too, so a private-looking alias cannot target public assets.
  checkedPath(`${await realpath(dirname(path))}${sep}${path.split(sep).at(-1)}`);
  let lock;
  for (let attempt = 0; attempt < 101; attempt++) {
    try { lock = await open(`${path}.lock`, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST' || attempt === 100) throw error;
      await delay(10);
    }
  }
  try { return await operation(); }
  finally {
    await lock.close();
    await unlink(`${path}.lock`);
  }
}
async function readState(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 16_384) throw new Error('Unsafe budget file');
    return validate(JSON.parse(await file.readFile('utf8')));
  } finally { await file.close(); }
}
async function writeState(path, state) {
  const temp = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temp, 'wx', 0o600);
    await file.writeFile(`${JSON.stringify(state)}\n`);
    await file.sync();
    await file.close(); file = undefined;
    await rename(temp, path);
    await syncDirectory(path);
  } finally {
    if (file) await file.close();
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

// Explicit administrative initialization only. Never overwrites an existing file,
// including a corrupt one. The private parent directory must already exist.
export async function initializeBudget(path) {
  path = checkedPath(path);
  return withLock(path, async () => {
    const now = Date.now();
    const state = { version: 1, day: dayAt(now), count: 0, lastSeenAt: now, leases: [] };
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(state)}\n`); await file.sync(); }
    finally { await file.close(); }
    await syncDirectory(path);
    return { ok: true };
  });
}

export function createBudget({ path, dailyLimit = MAX_DAILY, maxConcurrent = MAX_CONCURRENT, clock = Date.now } = {}) {
  path = checkedPath(path);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > MAX_DAILY ||
      !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_CONCURRENT || typeof clock !== 'function') {
    throw new TypeError('Budget limits must be integers within 1–100 daily and 1–2 concurrent');
  }
  async function transact(operation) {
    try {
      return await withLock(path, async () => {
        const state = await readState(path);
        const now = clock();
        if (!validTime(now) || now < state.lastSeenAt || state.day > dayAt(now)) throw new Error('Clock rollback');
        return operation(state, now);
      });
    } catch { return unavailable(); }
  }
  return {
    inspect() {
      return transact(async (state, now) => ({
        ok: true, day: dayAt(now), count: state.day === dayAt(now) ? state.count : 0,
        active: state.leases.filter(lease => lease.expiresAt > now).length,
      }));
    },
    acquire() {
      return transact(async (state, now) => {
        if (state.day !== dayAt(now)) { state.day = dayAt(now); state.count = 0; }
        state.leases = state.leases.filter(lease => lease.expiresAt > now);
        if (state.count >= dailyLimit) return { ok: false, status: 'daily' };
        if (state.leases.length >= maxConcurrent) return { ok: false, status: 'concurrent' };
        const leaseId = randomUUID();
        state.count++;
        state.lastSeenAt = now;
        state.leases.push({ id: leaseId, startedAt: now, expiresAt: now + LEASE_MS });
        await writeState(path, state); // Must succeed durably before any upstream call.
        return { ok: true, leaseId };
      });
    },
    release(leaseId) {
      return transact(async (state, now) => {
        const index = state.leases.findIndex(lease => lease.id === leaseId);
        if (index === -1) return { ok: true, released: false };
        state.leases.splice(index, 1);
        // Advance date without refunding attempts in the day they were made.
        if (state.day !== dayAt(now)) { state.day = dayAt(now); state.count = 0; }
        state.lastSeenAt = now;
        await writeState(path, state);
        return { ok: true, released: true };
      });
    },
  };
}
