import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, listenOptions } from '../server.mjs';
import { profilesFrom } from '../lib/server-security.mjs';
import { measures as measureLibrary } from '../public/data.js';
const env = { AI_API_KEY: 'test-only-not-a-real-key', AI_ACCESS_CODE: 'test-code' };
const payload = { providerId: 'softline', accessCode: 'test-code', consent: true, messages: [{ role: 'user', content: 'Как снизить затраты?' }], context: { calculator: { annualSpend: 100 } } };
async function fixture(t, overrides = {}, mock) {
  const server = createApp({ env: { ...env, ...overrides }, fetchImpl: mock || (async () => Response.json({ choices: [{ message: { content: 'Проверьте базу затрат.' } }] })) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, post: (body = payload, headers = {}) => fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url, ...headers }, body: JSON.stringify(body) }) };
}
test('valid flow uses only configured endpoint/model/key and bounded context', async t => {
  let seen;
  const { post, url } = await fixture(t, {}, async (url, options) => { seen = { url, options }; return Response.json({ choices: [{ message: { content: 'Ответ' } }] }); });
  const response = await post(); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { content: 'Ответ', model: 'qwen3.8-27b-nvfp4' });
  assert.equal(seen.url, 'https://api.ai-assistants.softline.com/v1/chat/completions'); assert.equal(seen.options.redirect, 'error');
  assert.equal(JSON.parse(seen.options.body).max_tokens, 1000);
  const config = await (await fetch(url + '/api/config')).json(); assert.equal(config.enabled, true); assert.deepEqual(Object.keys(config.providers[0]), ['id', 'label', 'model']); assert.ok(!JSON.stringify(config).includes(env.AI_API_KEY));
});
test('wrong access and missing consent are rejected', async t => { const { post } = await fixture(t); assert.equal((await post({ ...payload, accessCode: 'wrong' })).status, 401); assert.equal((await post({ ...payload, consent: false })).status, 400); });
test('disabled unless both access code and key are configured', async t => { const { post, url } = await fixture(t, { AI_ACCESS_CODE: '' }); assert.equal((await post()).status, 503); assert.equal((await (await fetch(url + '/api/config')).json()).enabled, false); });
test('unknown provider and client endpoint overrides fail closed', async t => { const { post } = await fixture(t); assert.equal((await post({ ...payload, providerId: 'other' })).status, 400); assert.equal((await post({ ...payload, baseUrl: 'https://evil.example' })).status, 400); assert.equal((await post({ ...payload, model: 'other' })).status, 400); });
test('oversized requests rejected', async t => { const { post } = await fixture(t); assert.equal((await post({ ...payload, junk: 'a'.repeat(50000) })).status, 413); });
test('unsafe origin rejected', async t => { const { post } = await fixture(t); assert.equal((await post(payload, { Origin: 'https://evil.example' })).status, 403); });
test('rate limit precedes authentication', async t => { const { post } = await fixture(t, { AI_IP_REQUESTS_PER_MINUTE: '1' }); assert.equal((await post({ ...payload, accessCode: 'bad' })).status, 401); assert.equal((await post()).status, 429); });
test('provider allowlist rejects unsafe profiles', () => { const profiles = profilesFrom({ AI_ALLOWED_HOSTS: 'localhost,127.0.0.1,good.example', AI_PROVIDERS_JSON: JSON.stringify([{ id: 'bad', label: 'Bad', model: 'model', apiKeyEnv: 'KEY', baseUrl: 'https://127.0.0.1/v1' }, { id: 'bad2', label: 'Bad', model: 'model', apiKeyEnv: 'KEY', baseUrl: 'https://evil.example/v1' }]) }); assert.equal(profiles.length, 1); });
test('static traversal and dotfiles are blocked; headers applied', async t => { const { url } = await fixture(t); for (const path of ['/..%2f.env', '/%2e%2e%2fserver.mjs', '/.env', '/%5c..%5cserver.mjs']) assert.equal((await fetch(url + path)).status, 404); const health = await fetch(url + '/api/health'); assert.equal(health.status, 200); assert.match(health.headers.get('content-security-policy'), /script-src 'self'/); });
test('upstream error text is never exposed', async t => { const { post } = await fixture(t, {}, async () => new Response('secret upstream diagnostic', { status: 401 })); const r = await post(); assert.equal(r.status, 502); assert.ok(!(await r.text()).includes('secret')); });
test('selected measures use authoritative library content, never client-supplied descriptions', async t => {
  let sent;
  const { post } = await fixture(t, {}, async (_url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: 'Ответ' } }] });
  });
  const response = await post({ ...payload, context: {
    ...payload.context,
    measureIds: ['procurement', 'process', 'procurement'],
    measures: [{ id: 'procurement', title: 'UNTRUSTED CLIENT TITLE', steps: ['UNTRUSTED CLIENT STEP'], guard: 'UNTRUSTED CLIENT GUARD' }],
  } });
  assert.equal(response.status, 200);
  const contextMessage = sent.messages[1].content;
  const context = JSON.parse(contextMessage.slice(contextMessage.indexOf('{')));
  assert.deepEqual(context.measureIds, ['procurement', 'process']);
  assert.deepEqual(context.measures, ['procurement', 'process'].map(id => {
    const { title, category, brief, driver, steps, metric, guard } = measureLibrary.find(measure => measure.id === id);
    return { id, title, category, brief, driver, steps, metric, guard };
  }));
  assert.deepEqual(context.calculator, { annualSpend: 100 });
  assert.ok(!JSON.stringify(sent).includes('UNTRUSTED CLIENT'));
  assert.ok(!JSON.stringify(sent).includes(env.AI_ACCESS_CODE));
});
test('unknown selected measure is rejected before contacting provider', async t => {
  let requests = 0;
  const { post } = await fixture(t, {}, async () => { requests++; return Response.json({ choices: [{ message: { content: 'Ответ' } }] }); });
  const response = await post({ ...payload, context: { measureIds: ['unknown_measure'] } });
  assert.equal(response.status, 400);
  assert.equal(requests, 0);
});
test('listen CLI honors preview flags, env precedence and safe defaults', () => {
  assert.deepEqual(listenOptions([], {}), { host: '127.0.0.1', port: 3000 });
  assert.deepEqual(listenOptions([], { HOST: '0.0.0.0', PORT: '8080' }), { host: '0.0.0.0', port: 8080 });
  assert.deepEqual(listenOptions(['--host', '127.0.0.1', '--port', '4173', '--strictPort'], { HOST: '0.0.0.0', PORT: '8080' }), { host: '127.0.0.1', port: 4173 });
  assert.deepEqual(listenOptions(['--host=::1', '--port=4173'], {}), { host: '::1', port: 4173 });
});
test('listen CLI rejects invalid ports, hosts and unknown options', () => {
  for (const port of ['0', '65536', '-1', 'abc', '1.5', '', '1e3']) assert.throws(() => listenOptions(['--port', port], {}));
  for (const host of ['', 'http://localhost', '127.0.0.1/path', 'bad host', '999.999.999.999', '-host']) assert.throws(() => listenOptions(['--host', host], {}));
  assert.throws(() => listenOptions(['--unknown'], {}));
  assert.throws(() => listenOptions([], { PORT: 'bad' }));
});
test('complete calculator context includes server-owned results, partial context does not invent them', async t => {
  let sent;
  const { post } = await fixture(t, {}, async (_url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: 'Ответ' } }] });
  });
  const contextFrom = () => { const message = sent.messages[1].content; return JSON.parse(message.slice(message.indexOf('{'))); };
  const calculator = { annualSpend: 120, savingsPercent: 8, implementationCost: 2, monthlyCost: .1, rampMonths: 4 };
  assert.equal((await post({ ...payload, context: { calculator, computedCalculator: { firstYearNet: 9999 } } })).status, 200);
  const context = contextFrom();
  assert.deepEqual(context.calculator, calculator);
  assert.equal(context.computedCalculator.firstYearNet, 4.8);
  assert.equal(context.computedCalculator.firstYearGross, 8);
  assert.equal(context.computedCalculator.annualNet, 8.4);
  assert.equal(context.computedCalculator.unit, 'млн ₽');
  assert.equal(context.computedCalculator.series.length, 12);
  assert.equal((await post(payload)).status, 200);
  assert.ok(!Object.hasOwn(contextFrom(), 'computedCalculator'));
});
test('calculator context enforces the same bounds as the public calculator', async t => {
  let requests = 0;
  const { post } = await fixture(t, {}, async () => { requests++; return Response.json({ choices: [{ message: { content: 'Ответ' } }] }); });
  for (const [field, value] of Object.entries({ annualSpend: 1000001, implementationCost: 1000001, monthlyCost: 100001, rampMonths: 37 })) {
    const response = await post({ ...payload, context: { calculator: { [field]: value } } });
    assert.equal(response.status, 400, field);
  }
  assert.equal(requests, 0);
});
