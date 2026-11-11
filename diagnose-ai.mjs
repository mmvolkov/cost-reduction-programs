// Run from the project root, or send this file to Node's stdin in /app.
// This imports the installed application's payload builder; it never copies it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server.mjs';

// Never return provider text, headers, URLs, codes or parameters verbatim.
export function errorCategory(status, data) {
  if (status === 401) return 'authentication';
  if (status === 403) return 'access_denied';
  if (status === 429) return 'provider_rate_or_quota';
  if (status >= 500) return 'provider_server_error';
  if (status >= 300 && status < 400) return 'redirect_rejected';
  // OpenAI-style wrappers and vLLM-style top-level errors are both common.
  const error = data?.error && typeof data.error === 'object' ? data.error : data;
  const field = key => typeof error?.[key] === 'string' ? error[key].slice(0, 4096).toLowerCase() : '';
  const code = field('code'), param = field('param'), message = field('message');
  if (code === 'context_length_exceeded') return 'context_length';
  if (code === 'model_not_found' || param === 'model') return 'model_parameter';
  if (param === 'max_tokens' || param === 'max_completion_tokens') return 'output_token_parameter';
  if (param === 'temperature') return 'temperature_parameter';
  if (param === 'stream') return 'stream_parameter';
  if (/^messages(?:\[\d+\])?(?:\.(?:role|content))?$/.test(param)) return 'message_parameter';
  // Hints only: provider prose is untrusted and is never printed, even in errors.
  if (/roles? must alternate|system role (?:is )?not supported|(?:unexpected|unsupported) role.{0,20}system|(?:multiple|consecutive|only one|single) system message|only supports? (?:a )?single system/.test(message)) return 'message_format_hint';
  if (/maximum context length|context length.{0,60}exceed|too many input tokens/.test(message)) return 'context_length_hint';
  if (/max_tokens|max_completion_tokens/.test(message)) return 'output_token_hint';
  if (status === 404) return 'route_or_model_not_found';
  if (status === 400 || status === 422) return 'request_rejected';
  return 'provider_http_error';
}

async function boundedError(response) {
  let size = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > 16384) return null;
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return null; }
}

export async function diagnoseAI({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let app, calls = 0;
  const result = { upstream_http: null, application_http: null, category: 'local_configuration' };
  try {
    app = createApp({ env, fetchImpl: async (url, options) => {
      // No retry or fallback, even if application code later gains one.
      if (++calls !== 1) throw new Error('diagnostic_single_call_guard');
      try {
        const response = await fetchImpl(url, options);
        result.upstream_http = response.status;
        if (!response.ok) {
          result.category = errorCategory(response.status, await boundedError(response));
          return new Response(null, { status: response.status });
        }
        result.category = 'upstream_response_invalid';
        return response; // Let the installed app validate the complete response.
      } catch {
        result.category = options.signal?.aborted ? 'upstream_timeout' : 'upstream_transport';
        throw new Error('diagnostic_upstream_failure');
      }
    } });
    await new Promise((resolve, reject) => {
      app.once('error', reject);
      app.listen(0, '127.0.0.1', resolve);
    });
    const localOrigin = `http://127.0.0.1:${app.address().port}`;
    const response = await fetch(`${localOrigin}${(env.BASE_PATH || '').replace(/\/$/, '')}/api/chat`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55000),
      headers: { 'Content-Type': 'application/json', Origin: env.PUBLIC_ORIGIN || localOrigin },
      body: JSON.stringify({
        providerId: 'softline', consent: true, accessCode: env.AI_ACCESS_CODE || '',
        messages: [{ role: 'user', content: 'Ответь одним словом: OK' }],
        context: {}, temperature: 0.5,
      }),
    });
    result.application_http = response.status;
    // Do not read/print the response. App status 200 means its validation passed.
    await response.body?.cancel();
    if (!calls) result.category = response.status === 429 ? 'local_limit' : response.status === 503 ? 'local_not_ready' : 'local_request_rejected';
    else if (response.status === 200) result.category = 'ok';
    else if (response.status === 504) result.category = 'upstream_timeout';
  } catch {
    if (calls === 0) result.category = 'local_configuration';
    else if (result.category === 'upstream_response_invalid') result.category = 'local_diagnostic_failure';
  } finally {
    if (app?.listening) await new Promise(resolve => { app.close(resolve); app.closeAllConnections(); });
  }
  return result;
}

if (!process.argv[1] || process.argv[1] === '-' || path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await diagnoseAI();
  console.log(JSON.stringify(result));
  process.exitCode = result.category === 'ok' ? 0 : 1;
}
