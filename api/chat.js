// Floof Cloud — the studio's own AI server for MagicWinter accounts (no key needed by users).
// Vercel env: GEMINI_KEY (required). Uses Google's Gemini with several models as backups.
// Only signed-in MagicWinter accounts can use it; ⭐ Pro accounts get the strongest model first
// and more backup models, so they keep working when the free ones are busy.
const SB = "https://lakjmdyzuqrwcncxybcw.supabase.co", SB_KEY = "sb_publishable__m0zTZ3-ThJVk0pktI65Ag_yDFPPD5s";
let _models = { t: 0, list: null }; const _bad = {}; const _hits = new Map();

async function withTimeout(url, opts, ms) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
async function models(key) {
  if (_models.list && Date.now() - _models.t < 600000) return _models.list;
  try {
    const d = await (await withTimeout("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + key, {}, 4000)).json();
    const v = n => parseFloat((n.match(/gemini-([\d.]+)/) || [0, 0])[1]);
    const names = (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace("models/", ""))
      .filter(n => /^gemini-[\d.]+-(pro|flash|flash-lite)(-latest)?$/.test(n)).sort((a, b) => v(b) - v(a));
    if (names.length) { _models = { t: Date.now(), list: names }; return names; }
  } catch (e) {}
  return ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
}
async function account(token) { // checks the MagicWinter sign-in token with the account server
  if (!token || typeof token !== "string" || token.length > 100) return null;
  try {
    const r = await withTimeout(SB + "/rest/v1/rpc/mw_status", { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY }, body: JSON.stringify({ p_token: token }) }, 5000);
    const j = await r.json(); if (!j || !j.ok) return null;
    return { user: j.username, pro: !!(j.pro_until && new Date(j.pro_until) > new Date()) };
  } catch (e) { return null; }
}
function tooMany(user, pro) { // gentle per-user limit (per server instance): 20/min free, 60/min Pro
  const now = Date.now(), h = (_hits.get(user) || []).filter(t => now - t < 60000); h.push(now); _hits.set(user, h);
  return h.length > (pro ? 60 : 20);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  const key = process.env.GEMINI_KEY;
  if (req.method === "GET") return res.status(200).json({ ok: !!key });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!key) return res.status(500).json({ error: "Floof Cloud isn't set up yet (the studio needs to add GEMINI_KEY in Vercel)." });

  let b = {}; try { b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); } catch (e) {}
  const acc = await account(b.token);
  if (!acc) return res.status(401).json({ error: "Sign in with a MagicWinter account to use Floof Cloud." });
  if (tooMany(acc.user.toLowerCase(), acc.pro)) return res.status(429).json({ error: "You're sending messages very fast — wait a few seconds." });

  const sys = String(b.system || "").slice(0, 60000);
  const msgs = (Array.isArray(b.messages) ? b.messages : []).slice(-60).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: (typeof m.img === "string" && m.img.startsWith("data:image/") && m.img.length < 6e6 ? [{ inline_data: { mime_type: m.img.slice(5, m.img.indexOf(";")), data: m.img.split(",")[1] } }] : [])
      .concat([{ text: String(m.content || "").slice(0, 120000) }])
  }));
  if (!msgs.length) return res.status(400).json({ error: "No message." });

  // Pro: strongest model first and every backup; free: fast models, fewer backups
  const all = await models(key);
  const fresh = m => !(_bad[m] && Date.now() - _bad[m] < 120000);
  let order = acc.pro ? all.filter(fresh).concat(all.filter(m => !fresh(m))) : all.filter(m => !/-pro/.test(m)).filter(fresh);
  if (!order.length) order = all.filter(m => !/-pro/.test(m));
  order = order.slice(0, acc.pro ? 6 : 3);

  const t0 = Date.now(), DEADLINE = acc.pro ? 55000 : 40000, errs = [];
  for (const m of order) {
    const left = DEADLINE - (Date.now() - t0); if (left < 4000) break;
    try {
      const r = await withTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: msgs, generationConfig: { maxOutputTokens: Math.min(parseInt(b.maxTokens) || 8192, acc.pro ? 16384 : 8192) } })
      }, Math.min(left, 30000));
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || "error " + r.status);
      const c = (d.candidates || [])[0] || {};
      const text = (c.content && c.content.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join("");
      if (!text) { errs.push(m + ": empty (" + (c.finishReason || d.promptFeedback?.blockReason || "?") + ")"); if (/SAFETY|BLOCK|PROHIBITED/.test(c.finishReason || d.promptFeedback?.blockReason || "")) return res.status(200).json({ text: "", finish: "SAFETY", via: m }); continue; }
      return res.status(200).json({ text, via: m, pro: acc.pro, usage: d.usageMetadata || null });
    } catch (e) { _bad[m] = Date.now(); errs.push(m + ": " + (e.name === "AbortError" ? "timeout" : e.message)); }
  }
  const busy = errs.some(e => /quota|exhaust|rate|429|overload|unavailable|timeout/i.test(e));
  return res.status(busy ? 503 : 502).json({ error: busy ? (acc.pro ? "Floof Cloud is overloaded right now — try again in a minute." : "Floof Cloud is busy right now. ⭐ Pro accounts get priority — or try again in a minute.") : "Floof Cloud couldn't answer: " + errs.slice(-2).join(" | ").slice(0, 200), busy });
}
