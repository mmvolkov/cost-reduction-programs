import { initializeBudget } from '../lib/ai-budget.mjs';
// Deliberately explicit, never run from server startup or every deployment.
// Only prints status, no secrets or contents of the counter.
try {
  if (!process.env.AI_STATE_PATH) throw new Error('missing');
  await initializeBudget(process.env.AI_STATE_PATH);
  console.log('AI budget initialized once. Future restarts must reuse this file.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'AI budget already exists; left unchanged.' : 'AI budget initialization failed. Verify absolute private path, existing writable parent and permissions. Do not reset an existing budget.');
  process.exitCode = 1;
}
