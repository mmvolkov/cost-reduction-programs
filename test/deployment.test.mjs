import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('static asset URLs are relative for repository and server subpaths', async () => {
 const html=await readFile(new URL('../public/index.html', import.meta.url),'utf8');
 assert.ok(!/(?:src|href)="\/(?!\/)/.test(html));
 const app=await readFile(new URL('../public/app.js', import.meta.url),'utf8');
 assert.ok(!/fetch\(['"]\/api\//.test(app));
 assert.match(app,/deployment.mode === 'server'/);
});
