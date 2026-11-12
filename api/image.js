// Floof image server — free, good-quality pictures for MagicWinter accounts (used by 🎨 Arti).
// Tries, in order:
//   1. Google Gemini image model (free tier of GEMINI_KEY — the key Floof already uses; no card = can't be charged)
//   2. Cloudflare Workers AI FLUX-1-schnell (free daily allowance; optional env CF_ACCOUNT_ID + CF_AI_TOKEN)
// If neither can make it, it answers { fallback: true } and the app uses the keyless Pollinations service instead.
// GET ?test=1 → which picture makers are ready (no picture is made).
const SB = "https://lakjmdyzuqrwcncxybcw.supabase.co", SB_KEY = "sb_publishable__m0zTZ3-ThJVk0pktI65Ag_yDFPPD5s";
const DAY_MAX = 30;            // pictures per account per day (per server instance) — the app also limits to 25
const BAD = /\b(nude|naked|nsfw|porn|sex|sexy|sexual|explicit|erotic|hentai|lingerie|topless|genitals?|gore|gory|beheaded|dismember|suicide|self[- ]harm|swastika)\w*/i;
const now = () => Date.now();
const _bad = new Map(); // maker → time until which it's skipped (quota used up etc.)
const _hits = new Map(); let _hitsDay = "";
let _gModels = { t: 0, list: null };

async function account(token) {
  if (!token || typeof token !== "string" || token.length > 100) return null;
  try {
    const call = fn => fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY }, body: JSON.stringify({ p_token: token }), signal: AbortSignal.timeout(5000) });
    let r = await call("mw_status"); if (r.status === 404 || r.status === 400) r = await call("mw_whoami");
    if (r.status >= 500) return { err: "net" };
    const j = await r.json(); return j && j.ok ? { user: String(j.username || "?") } : null;
  } catch (e) { return { err: "net" }; }
}
function overDaily(user) {
  const d = new Date().toISOString().slice(0, 10); if (d !== _hitsDay) { _hits.clear(); _hitsDay = d; }
  const n = (_hits.get(user) || 0) + 1; _hits.set(user, n); return n > DAY_MAX;
}
async function geminiImageModels(key) {
  if (_gModels.list && now() - _gModels.t < 600000) return _gModels.list;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + encodeURIComponent(key), { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    const list = (j.models || []).filter(m => /image/i.test(m.name) && !/imagen|veo/i.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace(/^models\//, ""))
      .sort((a, b) => (/flash/.test(b) - /flash/.test(a)) || (/preview|exp/.test(a) - /preview|exp/.test(b)) || b.localeCompare(a));
    _gModels = { t: now(), list };
  } catch (e) { if (!_gModels.list) _gModels = { t: now() - 540000, list: [] }; }
  return _gModels.list;
}
async function viaGemini(prompt, aspect) {
  const key = (process.env.GEMINI_KEY || "").trim(); if (!key) return null;
  for (const m of await geminiImageModels(key)) {
    if ((_bad.get("g:" + m) || 0) > now()) continue;
    try {
      const body = { contents: [{ role: "user", parts: [{ text: "Create a picture: " + prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect } } };
      let r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(50000) });
      if (r.status === 400) { delete body.generationConfig.imageConfig; r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(50000) }); }
      if (r.status === 429 || r.status === 403) { _bad.set("g:" + m, now() + 15 * 60000); continue; } // free quota used up / not on the free tier
      if (!r.ok) { _bad.set("g:" + m, now() + 5 * 60000); continue; }
      const j = await r.json();
      const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData && /^image\//.test(p.inlineData.mimeType || ""));
      if (part) return { image: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, via: "Google " + m };
    } catch (e) { _bad.set("g:" + m, now() + 2 * 60000); }
  }
  return null;
}
async function viaCloudflare(prompt) {
  const e = process.env; if (!e.CF_ACCOUNT_ID || !e.CF_AI_TOKEN || (_bad.get("cf") || 0) > now()) return null;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${e.CF_ACCOUNT_ID.trim()}/ai/run/@cf/black-forest-labs/flux-1-schnell`, { method: "POST", headers: { Authorization: "Bearer " + e.CF_AI_TOKEN.trim(), "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 8 }), signal: AbortSignal.timeout(50000) });
    if (r.status === 429 || r.status === 403) { _bad.set("cf", now() + 30 * 60000); return null; }
    const j = await r.json(); const b64 = j?.result?.image;
    return b64 ? { image: "data:image/jpeg;base64," + b64, via: "Cloudflare FLUX" } : null;
  } catch (e) { _bad.set("cf", now() + 2 * 60000); return null; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    const key = (process.env.GEMINI_KEY || "").trim();
    const g = key && req.query && req.query.test ? await geminiImageModels(key) : [];
    return res.status(200).json({ ok: true, gemini: !!key, geminiImageModels: g, cloudflare: !!(process.env.CF_ACCOUNT_ID && process.env.CF_AI_TOKEN) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } } b = b || {};
  const prompt = String(b.prompt || "").slice(0, 1500).trim(), aspect = ["1:1", "16:9", "9:16"].includes(b.aspect) ? b.aspect : "1:1";
  if (!prompt) return res.status(400).json({ error: "No prompt" });
  if (BAD.test(prompt)) return res.status(400).json({ error: "That picture isn't allowed." });
  const acc = await account(b.token);
  if (!acc) return res.status(401).json({ error: "Sign in to MagicWinter to make pictures." });
  if (acc.err) return res.status(200).json({ fallback: true, why: "account server busy" });
  if (overDaily(acc.user)) return res.status(429).json({ error: "Daily picture limit reached — back tomorrow." });
  const out = (await viaGemini(prompt, aspect)) || (await viaCloudflare(prompt));
  if (!out) return res.status(200).json({ fallback: true, why: "free picture makers busy" });
  return res.status(200).json(out);
}
