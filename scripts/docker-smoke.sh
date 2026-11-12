#!/bin/sh
# Isolated local/CI smoke test. Does not join the production network or publish ports.
set -eu
image=${1:-cost-reduction-programs:check}
name="cost-reduction-smoke-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT INT TERM
# No real credentials: validates route/static health and disabled AI only.
docker run -d --name "$name" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --user 1000:1000 --pids-limit 128 --memory 256m \
  -e BASE_PATH=/cost-reduction-programs "$image" >/dev/null
attempt=0
until docker exec "$name" node -e "fetch('http://127.0.0.1:3000/cost-reduction-programs/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; do
  attempt=$((attempt+1))
  [ "$attempt" -lt 15 ] || exit 1
  sleep 1
done
docker exec "$name" node --input-type=module -e '
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
for (const file of [".env",".git",".github","test","compose.yaml"]) assert.equal(existsSync("/app/"+file),false,file);
const root="http://127.0.0.1:3000";
assert.equal(process.getuid(),1000);
for (const asset of ["/","/app.js","/styles.css","/runtime-config.js"]) {
 const r=await fetch(root+"/cost-reduction-programs"+asset); assert.equal(r.status,200,asset);
}
const config=await (await fetch(root+"/cost-reduction-programs/api/config")).json();
assert.equal(config.enabled,false); assert.deepEqual(config.providers,[]);
assert.equal((await fetch(root+"/api/health")).status,404);
assert.equal((await fetch(root+"/cost-reduction-programs/.env")).status,404);
console.log("Non-root Docker smoke checks passed; real AI not enabled.");'
# Exercise the explicit initializer on an isolated disposable tmpfs, never production state.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --user 1000:1000 --tmpfs /app/state:rw,noexec,nosuid,size=1m,uid=1000,gid=1000,mode=0700 \
  -e AI_STATE_PATH=/app/state/ai-budget.json "$image" node scripts/init-ai-budget.mjs
