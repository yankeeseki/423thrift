// Chattanooga Thrift Trail: Item Search photo reader (Cloudflare Worker).
// Takes one photo from https://423thrift.com/itemsearch and returns a short search name for it.
// The Google key lives ONLY in the secret GEMINI_API_KEY (Settings > Variables and Secrets). Never paste a key into this file.
// Optional variable GEMINI_MODEL to force one model. Otherwise it tries the models below in order,
// moving on only when Google says a model is retired or missing (404), so one retirement can't break the page.

const ALLOWED = ['https://423thrift.com', 'https://www.423thrift.com'];
const MODELS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest'];
const MAX_BYTES = 1500000;        // base64 text length; the page sends a ~1024px JPEG, far smaller
const SOFT_LIMIT_PER_MIN = 6;     // best-effort, per Worker instance; Google's own free limit is the real ceiling

let windowStart = 0, count = 0;

function cors(origin) {
  const ok = ALLOWED.includes(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : ALLOWED[0], 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
    if (!ALLOWED.includes(origin)) return json({ error: 'Not allowed' }, 403, origin);
    if (!env.GEMINI_API_KEY) return json({ error: 'Not set up' }, 500, origin);

    const now = Date.now();
    if (now - windowStart > 60000) { windowStart = now; count = 0; }
    if (++count > SOFT_LIMIT_PER_MIN) return json({ error: 'Slow down' }, 429, origin);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Bad request' }, 400, origin); }
    const image = body && body.image, mime = body && body.mime;
    if (typeof image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_BYTES || mime !== 'image/jpeg') return json({ error: 'Bad image' }, 400, origin);

    const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL] : MODELS;
    const prompt = 'This is a photo of a secondhand item found at a thrift store. Name it the way a reseller would type it into an eBay search box: brand, item type, pattern or model, color or material if it matters. Maximum 10 words. No punctuation except hyphens. If you cannot tell what it is, return an empty query. Reply as JSON: {"query": "..."}';
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: image } }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: 'application/json' }
    });

    let r, lastStatus = 0, lastDetail = '';
    for (const model of models) {
      try {
        r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: payload
        });
      } catch (e) { return json({ error: 'Upstream down' }, 502, origin); }
      if (r.ok) break;
      lastStatus = r.status;
      lastDetail = (await r.text().catch(() => '')).slice(0, 300);
      if (r.status !== 404) break;   // only skip ahead when the model itself is gone
    }

    if (!r.ok) {
      if (lastStatus === 429) return json({ error: 'Daily free limit reached' }, 429, origin);
      return json({ error: 'Upstream error', google_status: lastStatus, detail: lastDetail }, 502, origin);
    }
    let query = '';
    try {
      const d = await r.json();
      const text = d.candidates[0].content.parts.map(p => p.text || '').join('');
      query = String(JSON.parse(text).query || '').replace(/[^A-Za-z0-9 '&.\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    } catch (e) { query = ''; }
    if (!query) return json({ error: 'Could not tell' }, 422, origin);
    return json({ query }, 200, origin);
  }
};
