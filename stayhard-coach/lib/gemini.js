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

export function createGemini({ apiKey, model = DEFAULT_GEMINI_MODEL, fetch: fetchImpl, retryDelayMs = 2000 } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const doFetch = fetchImpl ?? globalThis.fetch;
  let round = 0;

  async function post(body) {
    return doFetch(`${BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
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
      let res = await post(body);
      // Free tier rate limits: one polite retry on 429/503.
      if (res.status === 429 || res.status === 503) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        res = await post(body);
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const hint = res.status === 429 ? ' (free-tier rate limit; try again in a minute)' : '';
        throw new Error(`Gemini API ${res.status}: ${data?.error?.message ?? 'request failed'}${hint}`);
      }
      return fromGeminiResponse(data, round++);
    },
  };
}
