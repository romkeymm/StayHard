// Gemini adapter with the same interface as lib/anthropic.js:
//   messages({ system, tools, messages }) → { stop_reason, content: [text | tool_use blocks] }
// so the agent loop works unchanged. Free tier key: aistudio.google.com → Get API key.
//
// Gemini 3 models attach a thoughtSignature to function calls and require it
// back on the next request; it rides along on our tool_use blocks.

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Gemini accepts a subset of JSON Schema; drop keywords it rejects.
const ALLOWED = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'nullable', 'format']);
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!ALLOWED.has(k)) continue;
    if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, toGeminiSchema(s)]));
    else if (k === 'items') out.items = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

// Anthropic-style messages → Gemini contents.
export function toGeminiContents(messages) {
  const nameById = {};
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    const parts = [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text) parts.push({ text: b.text, ...(b.signature ? { thoughtSignature: b.signature } : {}) });
      else if (b.type === 'image') parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
      else if (b.type === 'tool_use') {
        nameById[b.id] = b.name;
        parts.push({ functionCall: { name: b.name, args: b.input ?? {} }, ...(b.signature ? { thoughtSignature: b.signature } : {}) });
      } else if (b.type === 'tool_result') {
        let response;
        try { response = JSON.parse(b.content); } catch { response = { text: b.content }; }
        if (response === null || typeof response !== 'object' || Array.isArray(response)) response = { result: response };
        parts.push({ functionResponse: { name: nameById[b.tool_use_id] ?? 'unknown', response } });
      }
    }
    if (parts.length) contents.push({ role, parts });
  }
  return contents;
}

// Gemini response → Anthropic-style result.
export function fromGeminiResponse(data, round = 0) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const content = [];
  parts.forEach((p, i) => {
    if (p.functionCall) {
      content.push({ type: 'tool_use', id: `g${round}_${i}`, name: p.functionCall.name, input: p.functionCall.args ?? {}, signature: p.thoughtSignature });
    } else if (typeof p.text === 'string' && !p.thought) {
      content.push({ type: 'text', text: p.text, signature: p.thoughtSignature });
    }
  });
  const usesTools = content.some((b) => b.type === 'tool_use');
  return { stop_reason: usesTools ? 'tool_use' : 'end_turn', content };
}

// When the main model is busy (free tier 503/429), these are tried in order.
export const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const BUSY = new Set([429, 500, 503]);

export function createGemini({ apiKey, model = DEFAULT_GEMINI_MODEL, fallbacks = FALLBACK_MODELS, fetch: fetchImpl, retryDelayMs = 1500 } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const doFetch = fetchImpl ?? globalThis.fetch;
  const chain = [...new Set([model, ...fallbacks])];
  let round = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const postTo = (m, body) => doFetch(`${BASE}/${m}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Main model: up to 2 tries. Then each fallback once. A model that doesn't
  // exist for this key (404) is skipped. Returns the first non-busy response.
  async function post(body) {
    let last = null;
    for (const [i, m] of chain.entries()) {
      const tries = i === 0 ? 2 : 1;
      for (let t = 0; t < tries; t++) {
        const res = await postTo(m, body);
        if (res.ok) return res;
        last = res;
        if (res.status === 404) break;
        if (!BUSY.has(res.status)) return res; // real error: report it
        if (t < tries - 1) await wait(retryDelayMs);
      }
    }
    return last;
  }

  return {
    model,
    async messages({ system, tools = [], messages }) {
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: toGeminiContents(messages),
        tools: tools.length ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.input_schema) })) }] : undefined,
        generationConfig: { maxOutputTokens: 1500 },
      };
      const res = await post(body);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const hint = BUSY.has(res.status) ? ' (all free Gemini models are busy right now; try again in a minute)' : '';
        throw new Error(`Gemini API ${res.status}: ${data?.error?.message ?? 'request failed'}${hint}`);
      }
      return fromGeminiResponse(data, round++);
    },
  };
}
