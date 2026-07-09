// ─────────────────────────────────────────────
// Shared HTTP layer for every provider: request timeout (AbortSignal), automatic
// retry with backoff on 429 / 5xx (honoring Retry-After), and error classification
// so callers/users can tell an auth failure from a rate limit from a context overflow.
// ─────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(message, { kind = 'client', status = 0 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;     // auth | rate | context | server | transient | client
    this.status = status;
  }
}

// Map an HTTP status (and, for 400s, the body) to a coarse failure kind.
function classify(status, body = '') {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  if (status >= 500) return 'server';
  if (status === 400 && /context|maximum.*token|too many tokens|too long/i.test(body)) return 'context';
  return 'client';
}

// A short, actionable message per failure kind (no raw stack, body truncated).
function friendly(name, status, kind, body) {
  const hint = {
    auth: 'authentication failed — check the API key',
    rate: 'rate limited — slow down, or add credits/quota',
    context: 'request too large — reduce context or lower /tokens',
    server: 'provider server error (transient — retried and still failing)',
    client: 'request rejected',
  }[kind] || 'request failed';
  return `${name} API error (${status}): ${hint}${body ? ` · ${body.slice(0, 200)}` : ''}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff with jitter, capped; honors an explicit Retry-After (seconds) when given.
function backoffMs(attempt, retryAfterSec) {
  if (retryAfterSec && retryAfterSec > 0) return Math.min(retryAfterSec * 1000, 30000);
  return Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}

/**
 * POST a JSON body and return the parsed JSON response.
 * @param {string} url
 * @param {Object} o
 * @param {Object} o.headers
 * @param {Object} o.body            - serialized with JSON.stringify
 * @param {string} o.name            - provider name for error messages
 * @param {number} [o.timeoutMs=120000]
 * @param {number} [o.retries=2]     - extra attempts on 429/5xx/network
 * @throws {ProviderError}
 */
export async function postJSON(url, { headers, body, name, timeoutMs = 120000, retries = 2, signal }) {
  if (signal?.aborted) throw new ProviderError(`${name}: request aborted`, { kind: 'transient' });
  let attempt = 0;
  for (;;) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    // Fold an external abort (Ctrl+C in the TUI) into this request's controller.
    const onAbort = () => ac.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    } catch (e) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal?.aborted) throw new ProviderError(`${name}: request aborted`, { kind: 'transient' });
      const aborted = e.name === 'AbortError';
      if (attempt < retries && !aborted) { await sleep(backoffMs(attempt++)); continue; }
      throw new ProviderError(
        `${name}: ${aborted ? `request timed out after ${Math.round(timeoutMs / 1000)}s` : `network error: ${e.message}`}`,
        { kind: 'transient' }
      );
    }
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);

    if (res.ok) return await res.json();

    const text = await res.text().catch(() => '');
    const kind = classify(res.status, text);
    // Retry only the transient classes; auth/context/client won't get better on retry.
    if ((kind === 'rate' || kind === 'server') && attempt < retries) {
      const ra = parseInt(res.headers.get('retry-after'), 10);
      await sleep(backoffMs(attempt++, ra));
      continue;
    }
    throw new ProviderError(friendly(name, res.status, kind, text), { kind, status: res.status });
  }
}
