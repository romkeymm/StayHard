// Minimal Anthropic Messages API client (fetch only). Errors never include the key.

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export function createClaude({ apiKey, model = DEFAULT_MODEL, fetch: fetchImpl } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const doFetch = fetchImpl ?? globalThis.fetch;
  return {
    model,
    async messages(body) {
      const res = await doFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1500, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`Claude API ${res.status}: ${data?.error?.message ?? 'request failed'}`);
      return data;
    },
  };
}
