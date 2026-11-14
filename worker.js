// Chattanooga Thrift Trail: Item Search photo reader (Cloudflare Worker).
// Takes one photo from https://423thrift.com/itemsearch and returns a short search name for it.
// Step 1: Google Cloud Vision "Web Detection" (Lens-style matching against the web) using the secret VISION_API_KEY.
// Step 2: if that finds nothing, Gemini names it from the photo alone, using the secret GEMINI_API_KEY.
// Keys live ONLY in Settings > Variables and Secrets. Never paste a key into this file.
// Optional variable GEMINI_MODEL to force one model. Otherwise it tries the models below in order,
// moving on when a model is retired (404), overloaded (500/503) or stalls, so one bad model can't break the page.

const ALLOWED = ['https://423thrift.com', 'https://www.423thrift.com'];
const MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
const PER_MODEL_MS = 7000;        // give up on a stalled model after 7s and try the next (page waits 30s total)
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

function clean(t) {
  return String(t || '').replace(/[^A-Za-z0-9 '&.\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Lens-style lookup. Returns { query, strong, clues }.
// strong = an exact eBay listing match or a specific multi-word name, safe to use as is.
// clues  = what Google found on the web (names and page titles), handed to Gemini when the match is weak.
function tidyTitle(t) {
  return clean(String(t || '').replace(/<[^>]*>/g, ' ').replace(/\s*[|\-–]\s*(eBay|Amazon\.com|Walmart\.com|Etsy|Mercari|Poshmark|Best Buy).*$/i, ''))
    .replace(/\b(new|used|nwt|nib|euc|tested|works|working|free shipping|fast shipping|lot|rare|great condition|good condition|preowned|pre-owned)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}
async function webDetect(image, key) {
  const none = { query: '', strong: false, clues: [] };
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ requests: [{ image: { content: image }, features: [{ type: 'WEB_DETECTION', maxResults: 15 }], imageContext: { webDetectionParams: { includeGeoResults: false } } }] }),
      signal: ctl.signal
    });
    clearTimeout(timer);
    if (!r.ok) return none;
    const w = ((await r.json()).responses || [{}])[0].webDetection || {};
    const pages = w.pagesWithMatchingImages || [];
    const titles = pages.map(pg => tidyTitle(pg.pageTitle)).filter(t => t.split(' ').length >= 2);
    const ents = (w.webEntities || []).filter(e => e.description).map(e => ({ name: clean(e.description), score: e.score || 0 })).filter(e => e.name);
    const clues = ents.slice(0, 8).map(e => e.name + ' (' + e.score.toFixed(2) + ')').concat(titles.slice(0, 6).map(t => 'page: ' + t));

    // Best: an eBay listing showing the same photo. Its title is a reseller's own name for the exact item.
    const ebay = pages.find(pg => /(^|\.)ebay\.[a-z.]+\/itm\//i.test(String(pg.url || '').replace(/^https?:\/\//, '')) && pg.pageTitle);
    if (ebay) {
      const t = tidyTitle(ebay.pageTitle);
      if (t.split(' ').length >= 2) return { query: t.split(' ').slice(0, 10).join(' ').slice(0, 100), strong: true, clues };
    }
    let guess = clean(((w.bestGuessLabels || [])[0] || {}).label);
    const strongEnt = ents.filter(e => e.score >= 0.5).map(e => e.name);
    if (guess.split(' ').length <= 2 && strongEnt.length) {
      const extra = strongEnt.find(e => !guess.toLowerCase().includes(e.toLowerCase()) && !e.toLowerCase().includes(guess.toLowerCase()));
      if (extra) guess = extra + ' ' + guess;
    }
    if (!guess && strongEnt.length) guess = strongEnt[0];
    guess = guess.split(' ').slice(0, 10).join(' ').slice(0, 100);
    // Three or more words (e.g. "wyze noise cancelling headphones") is specific enough; "headphones" is not.
    return { query: guess, strong: guess.split(' ').length >= 3, clues };
  } catch (e) { clearTimeout(timer); return none; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
    if (!ALLOWED.includes(origin)) return json({ error: 'Not allowed' }, 403, origin);
    if (!env.GEMINI_API_KEY && !env.VISION_API_KEY) return json({ error: 'Not set up' }, 500, origin);

    const now = Date.now();
    if (now - windowStart > 60000) { windowStart = now; count = 0; }
    if (++count > SOFT_LIMIT_PER_MIN) return json({ error: 'Slow down' }, 429, origin);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Bad request' }, 400, origin); }
    const image = body && body.image, mime = body && body.mime;
    if (typeof image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_BYTES || mime !== 'image/jpeg') return json({ error: 'Bad image' }, 400, origin);

    let web = { query: '', strong: false, clues: [] };
    if (env.VISION_API_KEY) {
      web = await webDetect(image, env.VISION_API_KEY);
      if (web.strong) return json({ query: web.query, source: 'web', clues: web.clues }, 200, origin);
    }
    // Weak or no web match: Gemini looks at the photo itself, with Google's web clues to help it spot the brand.
    if (!env.GEMINI_API_KEY) return web.query ? json({ query: web.query, source: 'web', clues: web.clues }, 200, origin) : json({ error: 'Could not tell' }, 422, origin);

    const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL] : MODELS;
    const prompt = [
      'You are helping a thrift store shopper look up what an item sells for on eBay. Look carefully at the whole photo, including any tags, labels, stickers, stamps, spines, screens or printing.',
      'Write the search phrase a skilled reseller would type into eBay to find this exact item.',
      'BRAND RULE (most important): include a brand or maker ONLY if you can actually read it in the photo (logo, label, tag, stamp, printed text), or the design is so iconic it could not be anything else. Never guess a brand from shape or style alone. A wrong brand ruins the search; leaving it out does not.',
      'Then add, in this order and only when you are confident: model, series or pattern name if readable; the specific item type (for example "over-ear wireless headphones", not just "headphones"); key style details (era such as 1970s or mid-century, material, finish); the main color.',
      'Books: title and author. Records, CDs, DVDs and games: artist or title plus format. Clothing: brand from the tag, garment type, material, color. Dishes and glass: maker, pattern name, piece type. Toys and collectibles: character or line, maker, year if printed.',
      'Use 4 to 10 words. No sizes unless printed, no condition words, no guesses written as facts, no punctuation except hyphens.',
      'If you truly cannot tell what the item is, return an empty query.',
      'Reply only as JSON: {"query": "..."}'
    ].join(' ') + (web.clues.length ? ' Clues from a Google reverse image search of this same photo (names with match scores, and titles of web pages showing the same or a very similar image): ' + web.clues.join('; ') + '. A brand that appears in these clues AND fits what you see counts as identified, even if no logo is visible. Ignore clues that do not fit the item.' : '');
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: image } }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024, responseMimeType: 'application/json' }
    });

    let r = null, lastStatus = 0, lastDetail = '';
    for (const model of models) {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), PER_MODEL_MS);
      try {
        r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: payload,
          signal: ctl.signal
        });
      } catch (e) { clearTimeout(timer); r = null; lastStatus = 504; lastDetail = model + ' did not answer in time'; continue; }
      clearTimeout(timer);
      if (r.ok) break;
      lastStatus = r.status;
      lastDetail = model + ': ' + (await r.text().catch(() => '')).slice(0, 300);
      if (![404, 429, 500, 503].includes(r.status)) break;   // retired, out of free reads, broken or overloaded: try the next model
    }

    if ((!r || !r.ok) && web.query) return json({ query: web.query, source: 'web', clues: web.clues }, 200, origin);
    if (!r || !r.ok) {
      if (lastStatus === 429) return json({ error: 'Daily free limit reached' }, 429, origin);
      return json({ error: 'Upstream error', google_status: lastStatus, detail: lastDetail }, 502, origin);
    }
    let query = '';
    try {
      const d = await r.json();
      const text = d.candidates[0].content.parts.map(p => p.text || '').join('');
      query = String(JSON.parse(text).query || '').replace(/[^A-Za-z0-9 '&.\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    } catch (e) { query = ''; }
    if (!query && web.query) return json({ query: web.query, source: 'web', clues: web.clues }, 200, origin);
    if (!query) return json({ error: 'Could not tell' }, 422, origin);
    return json({ query, source: 'gemini', clues: web.clues }, 200, origin);
  }
};
