// Floof Cloud — the studio's own AI server for MagicWinter accounts (no key needed by users).
// Vercel env: GEMINI_KEY (Google AI Studio key, free tier). Optional: FLOOF_ARES=1 turns ON the Ares backup (off by default,
// because the Ares server may use paid models — Floof must stay free).
// Only signed-in MagicWinter accounts can use it; ⭐ Pro accounts try a pro model first (falls back fast when
// the key has no pro quota) and get more backup models, so they keep working when the free ones are busy.
// If FLOOF_ARES=1 and every Gemini model fails (or GEMINI_KEY is missing), it asks the Ares Revision server as a last resort.
//
// POST {token, system, messages:[{role, content, img?}], maxTokens} → {text, via, pro, usage?, finish?, backup?}
// GET  → diagnostics {ok, hasKey, models, proModels, cooling, lastError, lastOk, ares}   (never contains the key)
// GET ?test=1 → also runs one tiny real test call (at most one every 5 minutes per instance; concurrent callers share it).
const SB = "https://lakjmdyzuqrwcncxybcw.supabase.co", SB_KEY = "sb_publishable__m0zTZ3-ThJVk0pktI65Ag_yDFPPD5s";
const API = "https://generativelanguage.googleapis.com/v1beta";
const ARES = "https://ares-revision.vercel.app/api/ai";
const VERSION = "floof-cloud 7";
// Used only when the live model list can't be fetched. Free-tier models first (checked against Google's
// pricing page, Nov 2026). gemini-2.5-* still work for keys that used them before, but new keys get
// 404 "no longer available", so they are last and get cached as bad on the first 404.
const FREE_FALLBACK = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
const PRO_FALLBACK = ["gemini-3.1-pro-preview", "gemini-2.5-pro"]; // pro has no free tier for new keys → expect fast 429 "limit: 0"
const T_TOTAL = 52000;      // whole request budget (vercel.json maxDuration is 60s)
const T_HARD = 57000;       // absolute cut-off, under Vercel's 60s
const T_ARES = 16000;       // time kept back for the Ares backup
const T_PRO = 12000;        // a pro attempt may not eat more than this
const T_CALL = 22000;       // max for any single Gemini call

let _models = { t: 0, list: null };
const _bad = {};            // model → { until, why }
const _noThink = {};        // models that rejected our thinkingConfig
const _hits = new Map();
let lastError = null, lastOk = null, lastTest = { t: 0, p: null };
const aresEnabled = () => process.env.FLOOF_ARES === "1"; // opt-in only

const now = () => Date.now();
const clean = (s, key) => { s = String(s || ""); if (key) s = s.split(key).join("***"); return s.replace(/key=[\w-]+/g, "key=***").replace(/AIza[\w-]{20,}/g, "***").slice(0, 300); };
const isPro = m => /-(pro|argon)\b/.test(m);
const isLite = m => /-lite\b/.test(m);
const ver = m => parseFloat((m.match(/^gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]) || 0;
function markBad(m, ms, why) { _bad[m] = { until: now() + ms, why }; }
const fresh = m => !(_bad[m] && _bad[m].until > now());

async function withTimeout(url, opts, ms) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), Math.max(1, ms));
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}

// ----- model list -----
async function models(key) {
  if (_models.list && now() - _models.t < 600000) return _models.list;
  try {
    const r = await withTimeout(API + "/models?pageSize=1000&key=" + key, {}, 3500);
    const d = await r.json();
    if (d && d.error) throw new Error(d.error.message || "models " + r.status);
    const names = (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => String(m.name || "").replace("models/", ""))
      // text chat models only: gemini-<ver>-flash / -flash-lite / -pro (+ optional -preview), gemini-4-argon
      .filter(n => /^gemini-\d+(\.\d+)?-(flash|flash-lite|pro)(-preview)?$|^gemini-\d+(\.\d+)?-argon$/.test(n));
    if (names.length) {
      _models = { t: now(), list: names }; return names;
    }
  } catch (e) { lastError = { at: new Date().toISOString(), where: "model list", msg: clean(e.name === "AbortError" ? "timeout" : e.message, key) }; }
  return FREE_FALLBACK.concat(PRO_FALLBACK);
}
// Order: free → stable flash (newest first), then flash-lite, then previews; never pro.
// Pro accounts: one pro model first (short timeout), then the free order, then other pro models.
function plan(all, pro) {
  const rank = m => (/-preview$/.test(m) ? 2 : 0) + (isLite(m) ? 1 : 0);
  const free = all.filter(m => !isPro(m)).sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a));
  const pros = all.filter(isPro).filter(m => !/^gemini-4/.test(m) || pro).sort((a, b) => (/-preview$/.test(a) - /-preview$/.test(b)) || ver(b) - ver(a));
  let order = free.filter(fresh);
  if (pro) { const p = pros.filter(fresh); order = p.slice(0, 1).concat(order, p.slice(1)); }
  if (!order.length) order = free.slice(); // everything cooling down: try anyway
  return order.slice(0, pro ? 6 : 4);
}
// Thinking: answers must not be empty or slow. maxOutputTokens INCLUDES thought tokens.
function thinkCfg(m) {
  if (_noThink[m]) return null;
  if (/^gemini-2\.5-flash/.test(m)) return { thinkingBudget: 0 };          // 2.5 Flash / Flash-Lite: 0 = off
  if (/^gemini-2\.5-pro/.test(m)) return { thinkingBudget: 128 };          // 2.5 Pro can't turn thinking off; 128 is the minimum
  if (/^gemini-2\./.test(m)) return null;                                  // 2.0 etc: no thinking
  if (isPro(m) || /^gemini-3\.8-flash/.test(m)) return { thinkingLevel: "low" }; // 3.8 Flash / pro / 4: "minimal" is an error
  if (/^gemini-\d/.test(m)) return { thinkingLevel: "minimal" };           // 3 / 3.6 Flash, 3.x Flash-Lite
  return null;
}

// ----- accounts -----
async function account(token) { // checks the MagicWinter sign-in token with the account server
  if (!token || typeof token !== "string" || token.length > 100) return null;
  let j;
  try {
    const r = await withTimeout(SB + "/rest/v1/rpc/mw_status", { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY }, body: JSON.stringify({ p_token: token }) }, 5000);
    if (r.status >= 500) return { err: "net" };
    j = await r.json();
  } catch (e) { return { err: "net" }; } // account server slow/down: not the user's fault
  if (!j || !j.ok) return null;
  return { user: String(j.username || "?"), pro: !!(j.pro_until && new Date(j.pro_until) > new Date()) };
}
function tooMany(user, pro) { // gentle per-user limit (per server instance): 20/min free, 60/min Pro
  const t = now(), h = (_hits.get(user) || []).filter(x => t - x < 60000); h.push(t); _hits.set(user, h);
  if (_hits.size > 5000) _hits.clear();
  return h.length > (pro ? 60 : 20);
}

const _ipHits = new Map();
function ipOf(req) { const h = req.headers || {}; return String(h["x-real-ip"] || String(h["x-forwarded-for"] || "").split(",")[0] || "?").trim(); }
function ipTooMany(ip) { // per network (catches lots of throwaway accounts from one place): 60/min, 1500/day per server instance
  const t = now(), h = (_ipHits.get(ip) || []).filter(x => t - x < 86400000); h.push(t); _ipHits.set(ip, h);
  if (_ipHits.size > 20000) _ipHits.clear();
  return h.filter(x => t - x < 60000).length > 60 || h.length > 1500;
}

// ----- one Gemini call -----
class GErr extends Error { constructor(msg, code, status, kind) { super(msg); this.code = code; this.status = status; this.kind = kind; } }
async function gemini(m, key, body, ms) {
  const tc = thinkCfg(m);
  const gen = { ...body.generationConfig };
  if (tc) { gen.thinkingConfig = tc; if (!(tc.thinkingBudget === 0)) gen.maxOutputTokens = Math.min(gen.maxOutputTokens + 4096, 65536); }
  let r, d;
  try {
    r = await withTimeout(`${API}/models/${m}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, generationConfig: gen }) }, ms);
  } catch (e) { throw new GErr(e.name === "AbortError" ? "timeout" : "network: " + e.message, 0, "", e.name === "AbortError" ? "timeout" : "network"); }
  try { d = await r.json(); } catch (e) { d = null; }
  if (!d || d.error || !r.ok) {
    const er = (d && d.error) || {}, msg = er.message || "HTTP " + r.status, st = er.status || "", code = er.code || r.status;
    const det = JSON.stringify(er.details || "");
    let kind = "other";
    if (code === 404 || st === "NOT_FOUND" || /no longer available|not found|not supported for generateContent/i.test(msg)) kind = "gone";
    else if (code === 429 || st === "RESOURCE_EXHAUSTED") kind = /limit: ?0\b/.test(msg) ? "noquota" : "quota";
    else if (/API_KEY_INVALID|API key not valid|API key expired/i.test(msg + det) || (code === 403 && /key|leaked|PERMISSION_DENIED|SERVICE_DISABLED/i.test(msg + st + det))) kind = "key";
    else if (/FAILED_PRECONDITION/.test(st) && /free tier|location|region|billing/i.test(msg)) kind = "region";
    else if (code === 400 && /think/i.test(msg)) kind = "think";
    else if (code === 503 || code === 500 || code === 504 || /UNAVAILABLE|overload|INTERNAL|DEADLINE/i.test(st + msg)) kind = "busy";
    else if (code === 400) kind = "bad";
    const e = new GErr(msg, code, st, kind);
    const ra = det.match(/"retryDelay":"(\d+)/); if (ra) e.retry = +ra[1];
    throw e;
  }
  const c = (d.candidates || [])[0] || {};
  const text = ((c.content && c.content.parts) || []).filter(p => typeof p.text === "string" && !p.thought).map(p => p.text).join("");
  const why = c.finishReason || (d.promptFeedback && d.promptFeedback.blockReason) || "";
  return { text, why, blocked: /SAFETY|BLOCK|PROHIBITED|SPII|IMAGE_SAFETY/.test(why) || !!(d.promptFeedback && d.promptFeedback.blockReason), usage: d.usageMetadata || null };
}

// ----- Ares backup: one flat prompt -----
function flatten(sys, msgs) {
  const convo = msgs.slice(-20).map(m => (m.role === "assistant" ? "Floof: " : "User: ") + String(m.content || "").slice(0, 6000) + (m.img ? " [the user attached an image, which this backup brain can't see]" : "")).join("\n\n");
  return (sys ? String(sys).slice(0, 12000) + "\n\n" : "") + "--- Conversation so far ---\n" + convo.slice(-30000) + "\n\nFloof:";
}
async function ares(sys, msgs, maxTokens, ms) {
  const r = await withTimeout(ARES, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: flatten(sys, msgs), maxTokens: Math.min(Math.max(maxTokens, 300), 4096) }) }, ms);
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok || !d.text) throw new Error(d.error || "Ares HTTP " + r.status);
  return { text: String(d.text).replace(/^\s*Floof:\s*/i, ""), via: "ares" + (d.via ? ":" + d.via : "") };
}

function buildContents(rawMsgs) {
  const OK_IMG = /^data:image\/(png|jpeg|jpg|webp|heic|heif);base64,/;
  const out = [];
  for (const m of rawMsgs.slice(-60)) {
    const role = m && m.role === "assistant" ? "model" : "user";
    const parts = [];
    if (m && typeof m.img === "string" && m.img.length < 6e6 && OK_IMG.test(m.img)) {
      const mime = m.img.slice(5, m.img.indexOf(";")).replace("jpg", "jpeg");
      parts.push({ inlineData: { mimeType: mime, data: m.img.slice(m.img.indexOf(",") + 1) } });
    }
    const t = String((m && m.content) || "").slice(0, 120000);
    if (t.trim()) parts.push({ text: t }); // Google rejects empty text parts with 400
    if (!parts.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts); else out.push({ role, parts }); // merge same-role turns
  }
  while (out.length && out[0].role === "model") out.shift(); // conversation must start with the user
  return out;
}

async function runTest(key, models) { // one tiny real call on ONE model
  const t0 = now(), m = models[0];
  if (!m) return { ok: false, kind: "gone", error: "no models", ms: 0 };
  try {
    const g = await gemini(m, key, { contents: [{ role: "user", parts: [{ text: "Reply with just: OK" }] }], generationConfig: { maxOutputTokens: 64 } }, 9000);
    const res = { ok: !!g.text.trim(), model: m, reply: g.text.slice(0, 40), finish: g.why, ms: now() - t0 };
    if (res.ok) lastOk = { at: new Date().toISOString(), model: m };
    return res;
  } catch (e) {
    noteFail(m, e, key);
    return { ok: false, model: m, kind: e.kind, error: clean(e.message, key), ms: now() - t0 };
  }
}
async function diagnostics(key, test) {
  const aresOn = aresEnabled();
  const out = { ok: !!key || aresOn, hasKey: !!key, mode: key ? "gemini" + (aresOn ? "+ares-backup" : "") : aresOn ? "ares-only (GEMINI_KEY missing)" : "off", version: VERSION, ares: aresOn };
  if (key) {
    const all = await models(key);
    out.models = plan(all, false).slice(0, 4); out.proModels = plan(all.filter(isPro), true).slice(0, 2);
    out.listed = all.length;
  }
  const own = ownServers();
  const extra = extraServers();
  if (extra.length) { out.ok = true; out.backups = extra.map(x => ({ name: x.name, cooling: _ownBad[x.name] && _ownBad[x.name].until > now() ? _ownBad[x.name].why : null })); }
  if (own.length) { out.ok = true; out.own = own.map(x => ({ name: x.name, model: x.model, hasKey: !!x.key, cooling: _ownBad[x.name] && _ownBad[x.name].until > now() ? _ownBad[x.name].why : null })); out.mode = own.map(x => x.name).join("+") + (key ? "+gemini" : ""); }
  out.cooling = Object.fromEntries(Object.entries(_bad).filter(([, v]) => v.until > now()).map(([m, v]) => [m, { secs: Math.round((v.until - now()) / 1000), why: v.why }]));
  out.lastError = lastError; out.lastOk = lastOk;
  if (test && key) {
    // one shared in-flight/cached test; the timestamp is set BEFORE running so bursts can't start more
    let cached = true;
    if (!lastTest.p || now() - lastTest.t > 300000) { lastTest = { t: now(), p: runTest(key, out.models) }; cached = false; }
    const r = await lastTest.p;
    out.test = cached ? { ...r, cached: true } : r;
  }
  if (out.test && !out.test.ok) out.hint = hintFor(out.test.kind);
  else if (lastError && lastError.kind) out.hint = hintFor(lastError.kind);
  return out;
}
function hintFor(kind) {
  return ({ key: "Google rejected GEMINI_KEY — make a new key at aistudio.google.com/apikey, put it in Vercel → Settings → Environment Variables, then redeploy.",
    region: "Google's free tier isn't available for this key's project/region — check the AI Studio project.",
    noquota: "This key has no free quota for that model (limit: 0). Free models are used instead.",
    quota: "Free quota used up for now — it refills each minute/day. Pro gets more backups.",
    gone: "A model was retired (404) — Floof skips it automatically.",
    timeout: "Google was slow to answer — try again.",
    busy: "Google's models are overloaded right now — try again in a minute." })[kind] || undefined;
}
function noteFail(m, e, key) {
  const k = e.kind;
  if (k === "gone") { markBad(m, 6 * 3600e3, "retired/404"); _models.t = 0; }
  else if (k === "noquota") markBad(m, 3600e3, "no free quota (limit: 0)");
  else if (k === "quota") markBad(m, Math.min(Math.max((e.retry || 60) * 1000, 20000), 600000), "quota");
  else if (k === "timeout") markBad(m, 120000, "timeout");
  else if (k === "busy") markBad(m, 30000, "overloaded");
  else if (k === "bad" || k === "other" || k === "network") markBad(m, 60000, k);
  lastError = { at: new Date().toISOString(), model: m, kind: k, code: e.code || null, msg: clean(e.message, key) };
}

// ----- Floof's own AI machines (Oracle free VM first, Hugging Face Space as backup) — Ollama behind a secret -----
// Vercel env: OWN_AI_URL (+ OWN_AI_KEY, OWN_AI_MODEL) for Oracle, OWN_AI_URL2 (+ OWN_AI_KEY2, OWN_AI_MODEL2) for Hugging Face.
const T_OWN = 30000, T_OWN_FIRST = 15000; // own machines get 30 s in total; each must start answering within 15 s
const _ownBad = {};
function ownServers() {
  const e = process.env, list = [];
  if (e.OWN_AI_URL) list.push({ name: "oracle", url: e.OWN_AI_URL, key: e.OWN_AI_KEY, model: e.OWN_AI_MODEL || "qwen3:4b" });
  if (e.OWN_AI_URL2) list.push({ name: "huggingface", url: e.OWN_AI_URL2, key: e.OWN_AI_KEY2 || e.OWN_AI_KEY, model: e.OWN_AI_MODEL2 || "qwen3:1.7b" });
  return list.map(x => ({ ...x, url: String(x.url).trim().replace(/\/+$/, ""), key: String(x.key || "").trim() }));
}
function ownMessages(sys, raw) {
  const msgs = [];
  if (sys.trim()) msgs.push({ role: "system", content: sys.slice(0, 6000) }); // CPU machines: keep the prompt short so they start fast
  for (const m of raw.slice(-10)) {
    const t = String((m && m.content) || "").slice(-6000);
    if (t.trim()) msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content: t });
  }
  return msgs;
}
async function ownAI(sv, sys, raw, want, ms) {
  const ctl = new AbortController(), t0 = now();
  const killAll = setTimeout(() => ctl.abort(), ms);
  let first = setTimeout(() => ctl.abort(), Math.min(T_OWN_FIRST, ms));
  let text = "", done = false;
  try {
    const r = await fetch(sv.url + "/api/chat", { method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", ...(sv.key ? { Authorization: "Bearer " + sv.key } : {}) },
      body: JSON.stringify({ model: sv.model, messages: ownMessages(sys, raw), stream: true, think: false, keep_alive: -1,
        options: { num_predict: Math.min(want, 1500), num_ctx: 8192 } }) });
    if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 401 ? " (OWN_AI_KEY doesn't match the machine's secret)" : ""));
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    try {
      for (;;) {
        const { value, done: end } = await rd.read(); if (end) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
          let j; try { j = JSON.parse(line); } catch (e) { continue; }
          if (j.error) throw new Error(String(j.error).slice(0, 120));
          if (j.message && j.message.content) { if (first) { clearTimeout(first); first = null; } text += j.message.content; }
          if (j.done) done = true;
        }
      }
    } catch (e) { if (!(e.name === "AbortError" && text.trim())) throw e; } // out of time mid-answer → keep what we have
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!text) throw new Error("empty answer");
    return { text: done ? text : text + " …", via: sv.name + ":" + sv.model, cut: !done, secs: (now() - t0) / 1000 };
  } finally { clearTimeout(killAll); if (first) clearTimeout(first); }
}

// ----- extra free backups (no card needed): Groq, then Cloudflare Workers AI — OpenAI-style APIs -----
// Vercel env: GROQ_KEY (+ GROQ_MODEL), CF_ACCOUNT_ID + CF_AI_TOKEN (+ CF_MODEL)
const GROQ_PREFER = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen/qwen3-32b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
let _groqModels = { t: 0, list: null };
function extraServers() {
  const e = process.env, list = [];
  if (e.GROQ_KEY) list.push({ name: "groq", url: "https://api.groq.com/openai/v1/chat/completions", key: e.GROQ_KEY.trim(), model: e.GROQ_MODEL || "" });
  if (e.GH_MODELS_TOKEN) list.push({ name: "github", url: "https://models.github.ai/inference/chat/completions", key: e.GH_MODELS_TOKEN.trim(), model: e.GH_MODEL || "" });
  if (e.CF_ACCOUNT_ID && e.CF_AI_TOKEN) list.push({ name: "cloudflare", url: "https://api.cloudflare.com/client/v4/accounts/" + e.CF_ACCOUNT_ID.trim() + "/ai/v1/chat/completions", key: e.CF_AI_TOKEN.trim(), model: e.CF_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast" });
  return list;
}
async function groqModel(sv) {
  if (sv.model) return sv.model;
  if (!_groqModels.list || now() - _groqModels.t > 3600000) {
    try { const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + sv.key }, signal: AbortSignal.timeout(5000) });
      const d = await r.json(); if (r.ok && Array.isArray(d.data)) _groqModels = { t: now(), list: d.data.map(m => m.id) }; } catch (e) {}
  }
  const have = _groqModels.list || [];
  return GROQ_PREFER.find(m => have.includes(m)) || have.find(m => !/whisper|guard|tts|playai|compound|orpheus/i.test(m)) || GROQ_PREFER[1];
}
const GH_PREFER = ["openai/gpt-5-mini", "openai/gpt-4.1-mini", "openai/gpt-4.1", "openai/gpt-4o-mini", "meta/llama-4-scout-17b-16e-instruct", "meta/llama-3.3-70b-instruct"];
let _ghModels = { t: 0, list: null };
async function ghModel(sv) {
  if (sv.model) return sv.model;
  if (!_ghModels.list || now() - _ghModels.t > 3600000) {
    try { const r = await fetch("https://models.github.ai/catalog/models", { headers: { Authorization: "Bearer " + sv.key, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(5000) });
      const d = await r.json(); if (r.ok && Array.isArray(d)) _ghModels = { t: now(), list: d.filter(m => !m.supported_output_modalities || m.supported_output_modalities.includes("text")).map(m => m.id) }; } catch (e) {}
  }
  const have = _ghModels.list || [];
  return GH_PREFER.find(m => have.includes(m)) || have.find(m => /gpt|llama|mistral|phi/i.test(m) && !/embed|whisper|image|tts|audio/i.test(m)) || "openai/gpt-4.1-mini";
}
async function openaiStyle(sv, sys, raw, want, ms) {
  const model = sv.name === "groq" ? await groqModel(sv) : sv.name === "github" ? await ghModel(sv) : sv.model;
  const r = await fetch(sv.url, { method: "POST", signal: AbortSignal.timeout(ms),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + sv.key },
    body: JSON.stringify({ model, messages: ownMessages(sys, raw), max_tokens: Math.min(want, 4096), ...(/gpt-5|o\d/.test(model) ? {} : { temperature: 0.6 }) }) });
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok) { const m = (d.error && (d.error.message || d.error)) || (d.errors && d.errors[0] && d.errors[0].message) || ("HTTP " + r.status);
    const err = new Error(String(m).slice(0, 120)); err.status = r.status; throw err; }
  const c = d.choices && d.choices[0], text = String((c && c.message && c.message.content) || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new Error("empty answer");
  return { text, via: sv.name + ":" + model.replace(/^@cf\//, "").replace(/^openai\//, ""), cut: c.finish_reason === "length" };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  const key = (process.env.GEMINI_KEY || "").trim();
  const aresOn = aresEnabled();
  if (req.method === "GET") {
    const q = req.query || {}; const test = q.test === "1" || /[?&]test=1\b/.test(req.url || "");
    try { return res.status(200).json(await diagnostics(key, test)); } catch (e) { return res.status(200).json({ ok: !!key, hasKey: !!key, error: "diagnostics failed" }); }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const own = ownServers(), extra = extraServers();
  if (!key && !aresOn && !own.length && !extra.length) return res.status(500).json({ error: "Floof Cloud isn't set up yet (the studio needs to add GEMINI_KEY in Vercel)." });

  const t0 = now(), left = () => T_TOTAL - (now() - t0);
  let b = {}; try { b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); } catch (e) {}
  const acc = await account(b.token);
  if (acc && acc.err) return res.status(503).json({ error: "Can't check your MagicWinter sign-in right now — try again in a minute.", busy: true });
  if (!acc) return res.status(401).json({ error: "Sign in with a MagicWinter account to use Floof Cloud." });
  if (!acc.pro && ipTooMany(ipOf(req))) return res.status(429).json({ error: "Lots of messages are coming from your network — try again in a little while." });
  if (tooMany(acc.user.toLowerCase(), acc.pro)) return res.status(429).json({ error: "You're sending messages very fast — wait a few seconds." });

  const sys = String(b.system || "").slice(0, 60000);
  const raw = Array.isArray(b.messages) ? b.messages.filter(m => m && typeof m === "object") : [];
  const contents = buildContents(raw);
  if (!contents.length) return res.status(400).json({ error: "No message." });
  const want = Math.min(Math.max(parseInt(b.maxTokens) || 8192, 256), acc.pro ? 16384 : 8192);

  const errs = []; let stop = false, keyBad = false;
  const hasImg = raw.some(m => m && typeof m.img === "string" && m.img); // pictures need Gemini (the CPU models are text-only)
  const ownEnd = now() + (key ? T_OWN : T_TOTAL - 5000);
  for (const sv of hasImg ? [] : own) {
    const bad = _ownBad[sv.name]; if (bad && bad.until > now()) { errs.push(sv.name + ": cooling (" + bad.why + ")"); continue; }
    const ms = Math.min(ownEnd - now(), left() - 4000); if (ms < 5000) break;
    try {
      const o = await ownAI(sv, sys, raw, want, ms);
      lastOk = { at: new Date().toISOString(), model: o.via };
      return res.status(200).json({ text: o.text, via: o.via, pro: acc.pro, own: true, finish: o.cut ? "MAX_TOKENS" : "" });
    } catch (e) {
      const why = clean(e.name === "AbortError" ? "too slow / unreachable" : e.message, sv.key).slice(0, 100);
      _ownBad[sv.name] = { until: now() + 120000, why }; errs.push(sv.name + ": " + why);
      lastError = { at: new Date().toISOString(), model: sv.name, kind: "own", msg: why };
    }
  }
  if (key) {
    const order = plan(await models(key), acc.pro);
    const body = { contents, generationConfig: { maxOutputTokens: want } };
    if (sys.trim()) body.systemInstruction = { parts: [{ text: sys }] };
    for (const m of order) {
      if (stop) break;
      const reserve = (aresOn ? T_ARES : 0) + (extra.length ? 15000 : 0), budget = Math.min(left() - reserve, isPro(m) ? T_PRO : T_CALL);
      if (budget < 4000) { errs.push("out of time"); break; }
      for (let attempt = 0; attempt < 2; attempt++) { // 2nd attempt only if the model rejected our thinkingConfig
        try {
          const g = await gemini(m, key, body, attempt ? Math.min(budget, left() - reserve) : budget);
          if (g.blocked && !g.text.trim()) return res.status(200).json({ text: "", finish: "SAFETY", via: m, pro: acc.pro });
          if (!g.text.trim()) { errs.push(m + ": empty (" + (g.why || "?") + ")"); markBad(m, 60000, "empty " + (g.why || "")); break; }
          lastOk = { at: new Date().toISOString(), model: m };
          return res.status(200).json({ text: g.text, via: m, pro: acc.pro, usage: g.usage, finish: g.why && g.why !== "STOP" ? g.why : "" });
        } catch (e) {
          if (e.kind === "think" && !_noThink[m] && attempt === 0) { _noThink[m] = true; continue; }
          noteFail(m, e, key); errs.push(m + ": " + (e.kind || "") + " " + clean(e.message, key).slice(0, 80));
          if (e.kind === "key" || e.kind === "region") { stop = true; keyBad = e.kind === "key"; }
          break;
        }
      }
    }
  } else errs.push("no GEMINI_KEY");

  for (const sv of hasImg ? [] : extra) { // free backups when Gemini is used up
    const bad = _ownBad[sv.name]; if (bad && bad.until > now()) { errs.push(sv.name + ": cooling (" + bad.why + ")"); continue; }
    const ms = Math.min(T_HARD - (now() - t0) - 2000, 20000); if (ms < 4000) break;
    try {
      const o = await openaiStyle(sv, sys, raw, want, ms);
      lastOk = { at: new Date().toISOString(), model: o.via };
      return res.status(200).json({ text: o.text, via: o.via, pro: acc.pro, backup: true, finish: o.cut ? "MAX_TOKENS" : "" });
    } catch (e) {
      const why = clean(e.name === "TimeoutError" || e.name === "AbortError" ? "too slow" : e.message, sv.key).slice(0, 100);
      _ownBad[sv.name] = { until: now() + (e.status === 429 ? 60000 : 120000), why }; errs.push(sv.name + ": " + why);
    }
  }
  const hardLeft = T_HARD - (now() - t0);
  if (aresOn && hardLeft > 5000) { // last resort: Ares Revision's server (text only)
    try {
      const a = await ares(sys, raw, want, Math.min(hardLeft, 22000));
      return res.status(200).json({ text: a.text, via: a.via, pro: acc.pro, backup: true });
    } catch (e) { errs.push("ares: " + clean(e.name === "AbortError" ? "timeout" : e.message, key).slice(0, 80)); }
  }
  const busy = errs.some(x => /quota|noquota|busy|timeout|overload|out of time/i.test(x));
  if (keyBad) return res.status(502).json({ error: "Floof Cloud's Google key isn't working — the studio needs to fix GEMINI_KEY.", busy: false });
  return res.status(busy ? 503 : 502).json({ error: busy ? (acc.pro ? "Floof Cloud is overloaded right now — try again in a minute." : "Floof Cloud is busy right now. ⭐ Pro accounts get priority — or try again in a minute.") : "Floof Cloud couldn't answer: " + errs.slice(-2).join(" | ").slice(0, 200), busy });
}
