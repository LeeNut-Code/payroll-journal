const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const PALETTES = new Set(['cream', 'sakura', 'retro', 'mint']);
const MAX_STATE_BYTES = 4096;
const MAX_ITEMS = 12;
const TTL_SECONDS = 604800;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

function makeCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % 32];
  return code;
}

// Whitelist + clamp every field so a shared payload can never smuggle anything
// the client would not render itself.
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const items = Array.isArray(raw.items) ? raw.items.slice(0, MAX_ITEMS) : [];
  const cleanItems = items.map((item) => ({
    name: String(item && item.name != null ? item.name : '').slice(0, 20),
    amount: clamp(item && item.amount, 0, 1e7, 0),
  }));
  if (!cleanItems.length) cleanItems.push({ name: '底薪', amount: 0 });

  const notes = String(raw.notes == null ? '' : raw.notes).slice(0, 500);
  const theme = PALETTES.has(raw.theme) ? raw.theme : 'cream';

  return {
    items: cleanItems,
    fundRate: clamp(raw.fundRate, 5, 12, 12),
    special: clamp(raw.special, 0, 1e7, 0),
    cost: clamp(raw.cost, 0, 1e7, 4000),
    goal: clamp(raw.goal, 0, 1e7, 3000),
    mood: clamp(raw.mood, 0, 7, 0),
    notes,
    theme,
  };
}

async function publish(request, env) {
  if (!env.JOURNAL_KV) return json({ error: 'kv_unavailable' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_state' }, 400);
  }

  const raw = body && body.state;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return json({ error: 'invalid_state' }, 400);
  }
  if (new TextEncoder().encode(JSON.stringify(raw)).length > MAX_STATE_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  const state = normalize(raw);
  if (!state) return json({ error: 'invalid_state' }, 400);

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = makeCode();
      const exists = await env.JOURNAL_KV.get(`share:${code}`);
      if (exists) continue;
      await env.JOURNAL_KV.put(`share:${code}`, JSON.stringify({ v: 1, state }), {
        expirationTtl: TTL_SECONDS,
      });
      return json({ code, path: `/s/${code}` });
    }
    return json({ error: 'kv_unavailable' }, 500);
  } catch {
    return json({ error: 'kv_unavailable' }, 500);
  }
}

async function read(env, code) {
  if (!env.JOURNAL_KV) return json({ error: 'kv_unavailable' }, 500);
  try {
    const stored = await env.JOURNAL_KV.get(`share:${code}`);
    if (!stored) return json({ error: 'not_found' }, 404);
    const parsed = JSON.parse(stored);
    return json({ state: parsed.state || parsed });
  } catch {
    return json({ error: 'kv_unavailable' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/share') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return publish(request, env);
    }

    if (path.startsWith('/api/share/')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const code = path.slice('/api/share/'.length).toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: 'not_found' }, 404);
      return read(env, code);
    }

    if (path.startsWith('/api/')) return json({ error: 'not_found' }, 404);

    return env.ASSETS.fetch(request);
  },
};
