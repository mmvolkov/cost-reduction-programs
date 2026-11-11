import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = name => readFile(new URL('../'+name, import.meta.url),'utf8');
test('Docker runtime stays non-root and excludes secret material', async () => {
 const dockerfile=await read('Dockerfile'), ignore=await read('.dockerignore');
 assert.match(dockerfile,/USER node/); assert.match(dockerfile,/RUN npm run check/);
 assert.doesNotMatch(dockerfile,/COPY\s+\.\s/);
 assert.match(ignore,/^\*\*$/m); assert.doesNotMatch(ignore,/^!\.env/m);
});
test('Compose confines routing to the approved host and exact path prefix', async () => {
 const compose=await read('compose.yaml');
 assert.match(compose,/Host\(`scout-argument\.ru`\) && \(Path\(`\/cost-reduction-programs`\) \|\| PathPrefix\(`\/cost-reduction-programs\/`\)\)/);
 assert.match(compose,/priority: "100"/); assert.match(compose,/external: true/);
 assert.match(compose,/BASE_PATH: \/cost-reduction-programs/);
 assert.doesNotMatch(compose,/^\s+ports:|docker\.sock|privileged:\s*true|network_mode:\s*host/m);
 assert.match(compose,/read_only: true/); assert.match(compose,/no-new-privileges:true/);
});
