import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, chmod, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createBudget, initializeBudget } from '../lib/ai-budget.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-budget-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'budget.json');
  await initializeBudget(path);
  let now = JSON.parse(await readFile(path, 'utf8')).lastSeenAt + 1;
  return { path, clock: () => now, advance: ms => { now += ms; }, set: value => { now = value; } };
}

test('durable reservations shared across instances; release never refunds daily attempts', async t => {
  const f = await fixture(t);
  const a = createBudget({ ...f, dailyLimit: 3 });
  const b = createBudget({ ...f, dailyLimit: 3 });
  const first = await a.acquire(); const second = await b.acquire();
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.equal((await a.acquire()).status, 'concurrent');
  assert.equal(JSON.parse(await readFile(f.path, 'utf8')).count, 2);
  await a.release(first.leaseId);
  const restarted = createBudget({ ...f, dailyLimit: 3 });
  const third = await restarted.acquire(); assert.equal(third.ok, true);
  await restarted.release(third.leaseId); await b.release(second.leaseId);
  assert.equal((await a.acquire()).status, 'daily');
  assert.equal((await a.inspect()).count, 3);
  assert.equal((await stat(f.path)).mode & 0o777, 0o600);
});

test('parallel acquisitions across instances cannot exceed two', async t => {
  const f = await fixture(t);
  const outcomes = await Promise.all(Array.from({ length: 16 }, () => createBudget(f).acquire()));
  assert.equal(outcomes.filter(result => result.ok).length, 2);
  assert.ok(outcomes.filter(result => !result.ok).every(result => result.status === 'concurrent'));
  assert.equal((await createBudget(f).inspect()).count, 2);
});

test('exclusive filesystem lock enforces cap across real processes', async t => {
  const f = await fixture(t);
  const moduleUrl = new URL('../lib/ai-budget.mjs', import.meta.url).href;
  const run = () => new Promise((resolve, reject) => {
    const source = `import {createBudget} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await createBudget({path:${JSON.stringify(f.path)}}).acquire()));`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source]);
    let out = ''; let err = '';
    child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject); child.on('exit', code => code ? reject(new Error(err)) : resolve(JSON.parse(out)));
  });
  const results = await Promise.all(Array.from({ length: 6 }, run));
  assert.equal(results.filter(result => result.ok).length, 2);
  assert.equal(JSON.parse(await readFile(f.path, 'utf8')).count, 2);
});

test('100 attempts is a hard cap, including upstream failures simulated by release', async t => {
  const f = await fixture(t); const budget = createBudget(f);
  for (let i = 0; i < 100; i++) {
    const acquired = await budget.acquire(); assert.equal(acquired.ok, true);
    await budget.release(acquired.leaseId);
  }
  assert.equal((await createBudget(f).acquire()).status, 'daily');
  assert.throws(() => createBudget({ ...f, dailyLimit: 101 }));
  assert.throws(() => createBudget({ ...f, maxConcurrent: 3 }));
  assert.throws(() => createBudget({ ...f, dailyLimit: 0 }));
  assert.throws(() => createBudget({ ...f, maxConcurrent: 1.5 }));
});

test('UTC rollover resets daily count but retains live prior-day leases', async t => {
  const f = await fixture(t);
  const midnight = Date.parse(`${new Date(f.clock()).toISOString().slice(0, 10)}T00:00:00Z`) + 86_400_000;
  f.set(midnight - 1000); const a = createBudget({ ...f, dailyLimit: 1 });
  const lease = await a.acquire(); assert.equal((await a.acquire()).status, 'daily');
  f.set(midnight + 1000);
  assert.equal((await a.inspect()).count, 0); assert.equal((await a.inspect()).active, 1);
  const next = await a.acquire(); assert.equal(next.ok, true);
  await a.release(lease.leaseId); assert.equal((await a.inspect()).count, 1);
});

test('crash leases expire at 120s without refund; clock rollback fails closed', async t => {
  const f = await fixture(t); const budget = createBudget(f);
  await budget.acquire(); await budget.acquire();
  f.advance(119_999); assert.equal((await budget.acquire()).status, 'concurrent');
  f.advance(1); const lease = await budget.acquire(); assert.equal(lease.ok, true);
  assert.equal((await budget.inspect()).count, 3);
  f.advance(-1); assert.equal((await budget.acquire()).status, 'unavailable');
  assert.equal((await budget.inspect()).ok, false);
});

test('unknown release is a byte-for-byte no-op', async t => {
  const f = await fixture(t); const budget = createBudget(f); await budget.acquire();
  const before = await readFile(f.path, 'utf8'); f.advance(5000);
  assert.deepEqual(await budget.release('unknown'), { ok: true, released: false });
  assert.equal(await readFile(f.path, 'utf8'), before);
});

test('missing/corrupt/unsafe state fails closed and explicit init never overwrites', async t => {
  const f = await fixture(t); const budget = createBudget(f);
  await assert.rejects(initializeBudget(f.path), { code: 'EEXIST' });
  await writeFile(f.path, '{broken'); assert.equal((await budget.acquire()).status, 'unavailable');
  assert.equal((await budget.inspect()).ok, false);
  await assert.rejects(initializeBudget(f.path), { code: 'EEXIST' });
  await rm(f.path); assert.equal((await budget.acquire()).status, 'unavailable');
  await initializeBudget(f.path); f.advance(10_000);
  await chmod(f.path, 0o644); assert.equal((await budget.acquire()).status, 'unavailable');
  assert.throws(() => createBudget({ path: 'relative.json' }));
  assert.throws(() => createBudget({ path: '/tmp/public/budget.json' }));
  const missingParent = createBudget({ path: join(f.path, 'missing', 'budget.json') });
  assert.equal((await missingParent.acquire()).status, 'unavailable');
});

test('stale lock fails closed and is not auto-evicted', async t => {
  const f = await fixture(t); const before = await readFile(f.path, 'utf8');
  await writeFile(`${f.path}.lock`, 'stale');
  assert.equal((await createBudget(f).acquire()).status, 'unavailable');
  assert.equal(await readFile(`${f.path}.lock`, 'utf8'), 'stale');
  assert.equal(await readFile(f.path, 'utf8'), before);
});


test('unwritable parent and symlinked state fail closed', async t => {
  const f = await fixture(t);
  const privateDir = join(f.path, '..', 'readonly');
  await mkdir(privateDir, { mode: 0o700 });
  const path = join(privateDir, 'state.json'); await initializeBudget(path);
  await chmod(privateDir, 0o500);
  try {
    if (process.getuid?.() !== 0) assert.equal((await createBudget({ path }).acquire()).status, 'unavailable');
  } finally { await chmod(privateDir, 0o700); }
  const alias = join(privateDir, 'alias.json'); await symlink(f.path, alias);
  assert.equal((await createBudget({ path: alias }).acquire()).status, 'unavailable');
  const publicDir = join(privateDir, 'public'); await mkdir(publicDir);
  const dirAlias = join(privateDir, 'innocent'); await symlink(publicDir, dirAlias);
  await assert.rejects(initializeBudget(join(dirAlias, 'state.json')), /public directory/);
});
