import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('dist-pages');
let apiBaseUrl = process.env.PUBLIC_API_BASE_URL?.trim() || null;
if (apiBaseUrl) {
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname !== 'scout-argument.ru' || url.pathname !== '/cost-reduction-programs/api/') throw new Error('Only the approved HTTPS backend path is allowed.');
  apiBaseUrl = url.href;
}
await mkdir(out, { recursive: true });
await cp('public', out, { recursive: true });
await writeFile(path.join(out, 'runtime-config.js'), `export const deployment = ${JSON.stringify({ mode: 'static', apiBaseUrl })};\n`);
await writeFile(path.join(out, '.nojekyll'), '');
console.log('Static Pages artifact prepared without server files or secrets.');
