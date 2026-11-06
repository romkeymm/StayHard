// Minimal Hevy API client (requires Hevy Pro; key from hevy.com → Settings → Developer).
// Works in Node 18+ and the browser. Errors never include the API key.

const BASE = 'https://api.hevyapp.com/v1';

export function createHevy({ apiKey, fetch: fetchImpl } = {}) {
  if (!apiKey) throw new Error('HEVY_API_KEY is not set');
  const doFetch = fetchImpl ?? globalThis.fetch;

  async function call(method, path, body) {
    const res = await doFetch(`${BASE}${path}`, {
      method,
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Hevy ${method} ${path.split('?')[0]} failed (${res.status}): ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  // Paginates every exercise template (built-in + custom). pageSize max is 100.
  async function listExerciseTemplates() {
    const all = [];
    for (let page = 1; ; page++) {
      const data = await call('GET', `/exercise_templates?page=${page}&pageSize=100`);
      all.push(...(data?.exercise_templates ?? []));
      if (!data || page >= (data.page_count ?? 1)) break;
    }
    return all;
  }

  // Hevy wraps responses inconsistently ({routine: [...]}, {routine: {...}}); unwrap both.
  const first = (v) => (Array.isArray(v) ? v[0] : v);

  return {
    listExerciseTemplates,
    listRoutineFolders: (page = 1) => call('GET', `/routine_folders?page=${page}&pageSize=10`),
    listRoutines: (page = 1) => call('GET', `/routines?page=${page}&pageSize=10`),
    listWorkouts: (page = 1, pageSize = 10) => call('GET', `/workouts?page=${page}&pageSize=${pageSize}`),
    async createFolder(title) {
      const res = await call('POST', '/routine_folders', { routine_folder: { title } });
      return first(res?.routine_folder ?? res);
    },
    async createRoutine(routine) {
      const res = await call('POST', '/routines', { routine });
      return first(res?.routine ?? res);
    },
    async updateRoutine(id, routine) {
      const { folder_id, ...rest } = routine; // folder can't change via PUT
      const res = await call('PUT', `/routines/${id}`, { routine: rest });
      return first(res?.routine ?? res);
    },
  };
}
