// Floof research helper — fetches free, keyless sources that browsers can't read directly (no CORS):
//   ?src=ddg&q=…    DuckDuckGo Instant Answers (summaries from many sites, not only Wikipedia)
//   ?src=news&q=…   GDELT world news (latest headlines with links, many news sites)
// Answers: { results: [{ title, text, url, source }] }. Cached for 10 minutes. Nothing is stored about who asked.
const cache = new Map();
const hits = new Map(); let hitsMin = 0;
function tooMany(ip) { const m = Math.floor(Date.now() / 60000); if (m !== hitsMin) { hits.clear(); hitsMin = m; } const n = (hits.get(ip) || 0) + 1; hits.set(ip, n); return n > 40; }
const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

async function ddg(q) {
  const r = await fetch("https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&no_redirect=1&t=floofai&q=" + encodeURIComponent(q), { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "FloofAI/3.4 (MagicWinter Studio)" } });
  const j = await r.json(), out = [];
  if (j.AbstractText) out.push({ title: j.Heading || q, text: j.AbstractText, url: j.AbstractURL || "", source: j.AbstractSource || "DuckDuckGo" });
  if (j.Answer && typeof j.Answer === "string") out.push({ title: q, text: strip(j.Answer), url: "", source: "DuckDuckGo answer" });
  if (j.Definition) out.push({ title: q + " (definition)", text: j.Definition, url: j.DefinitionURL || "", source: j.DefinitionSource || "DuckDuckGo" });
  for (const t of (j.RelatedTopics || []).flatMap(t => t.Topics || [t]).slice(0, 4)) if (t.Text && t.Text.length > 40) out.push({ title: strip(t.Text).split(" - ")[0].slice(0, 80), text: strip(t.Text), url: t.FirstURL || "", source: "DuckDuckGo" });
  return out;
}
async function news(q) {
  const r = await fetch("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=8&sort=datedesc&timespan=7d&sourcelang=english&query=" + encodeURIComponent(q), { signal: AbortSignal.timeout(8000) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { return []; }
  return (j.articles || []).slice(0, 6).map(a => ({ title: strip(a.title).slice(0, 160), text: `${strip(a.title)} — ${a.domain || ""}, ${String(a.seendate || "").replace(/^(\d{4})(\d{2})(\d{2}).*/, "$3/$2/$1")}`, url: a.url, source: a.domain || "news" }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET"); return res.status(204).end(); }
  const q = String(req.query?.q || "").slice(0, 200).trim(), src = String(req.query?.src || "ddg");
  if (!q) return res.status(400).json({ error: "q missing" });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  if (tooMany(ip)) return res.status(429).json({ error: "Too many searches — wait a minute." });
  const key = src + "|" + q.toLowerCase(), c = cache.get(key);
  if (c && Date.now() - c.t < 600000) return res.status(200).json({ results: c.r, cached: true });
  let r = [];
  try { r = src === "news" ? await news(q) : await ddg(q); } catch (e) { r = []; }
  if (cache.size > 500) cache.clear(); cache.set(key, { t: Date.now(), r });
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({ results: r });
}
