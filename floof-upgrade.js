/* FLOOF AI — multimodal foundation upgrade
 * Adds OpenAI-compatible reasoning + vision and first-party GPT Image generation.
 * Existing grid, accounts, chats, local models and providers remain untouched.
 */
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  if (typeof PV === "undefined" || typeof cloud === "undefined") return;

  PV.openai = {
    ph: "OpenAI API key (sk-…)",
    ok: k => /^sk-/.test(k) && k.length > 20,
    vision: true,
    help: 'OpenAI API key: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" style="color:var(--accent)">platform.openai.com/api-keys</a>. API usage is billed separately; check pricing and set a usage limit. This browser-only prototype stores the key in this browser, so do not use it on a shared device.'
  };
  const providerSelect = $("#pv");
  if (providerSelect && ![...providerSelect.options].some(o => o.value === "openai")) {
    const opt = document.createElement("option");
    opt.value = "openai";
    opt.textContent = "OpenAI — reasoning + vision";
    providerSelect.add(opt);
  }

  const originalListModels = listModels;
  listModels = async function(pv, key) {
    if (pv === "xai") {
      const r = await fetch("https://api.x.ai/v1/models", { headers: { authorization: "Bearer " + key } });
      if (!r.ok) {
        let msg = "xAI model discovery failed (HTTP " + r.status + ").";
        try { msg = (await r.json()).error?.message || msg; } catch {}
        throw new Error(msg);
      }
      const j = await r.json();
      return (j.data || []).map(m => m.id).filter(id => /^grok-/i.test(id) && !/(image|voice|video)/i.test(id)).sort((a, b) => b.localeCompare(a)).map(id => ({ id, name: id }));
    }
    if (pv !== "openai") return originalListModels(pv, key);
    const r = await fetch("https://api.openai.com/v1/models", { headers: { authorization: "Bearer " + key } });
    if (!r.ok) {
      let msg = "Couldn't load OpenAI models (HTTP " + r.status + ").";
      try { msg = (await r.json()).error?.message || msg; } catch {}
      throw new Error(msg);
    }
    const j = await r.json();
    const preferred = id => /^gpt-5/.test(id) ? 5 : /^gpt-4\.1/.test(id) ? 4 : /^gpt-4o/.test(id) ? 3 : 0;
    return (j.data || []).map(m => m.id)
      .filter(id => /^(gpt-5|gpt-4\.1|gpt-4o)(-|$)/.test(id) && !/(audio|realtime|transcribe|tts|search-preview)/i.test(id))
      .sort((a, b) => preferred(b) - preferred(a) || a.localeCompare(b))
      .map(id => ({ id, name: id }));
  };

  const originalStreamOnce = streamOnce;
  streamOnce = async function(pv, model, sys, msgs, onText) {
    if (pv !== "openai" && pv !== "xai") return originalStreamOnce(pv, model, sys, msgs, onText);
    abortCtl = new AbortController();
    const key = cloud.keys[pv] || "";
    const endpoint = pv === "xai" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
    const messages = [
      { role: "system", content: sys },
      ...msgs.map(m => ({
        role: m.role,
        content: m.img
          ? [{ type: "text", text: m.content || "Please inspect this image carefully." },
             { type: "image_url", image_url: { url: m.img, detail: "high" } }]
          : m.content
      }))
    ];
    let r;
    try {
      r = await fetch(endpoint, {
        method: "POST", signal: abortCtl.signal,
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, max_completion_tokens: 8192, messages })
      });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      throw new Error("Couldn't reach OpenAI. Check your connection and browser network permissions.");
    }
    if (!r.ok) {
      let message = "OpenAI request failed (HTTP " + r.status + ").";
      try { message = (await r.json()).error?.message || message; } catch {}
      const err = new Error(message);
      err.quota = r.status === 429 || /quota|rate.limit|billing/i.test(message);
      throw err;
    }
    const usage = { in: 0, out: 0, model };
    for await (const ev of sse(r)) {
      if (ev.error) throw new Error(ev.error.message || "OpenAI stream error");
      const delta = ev.choices?.[0]?.delta?.content;
      if (typeof delta === "string") onText(delta);
      if (Array.isArray(delta)) for (const part of delta) if (part.text) onText(part.text);
      if (ev.usage) { usage.in = ev.usage.prompt_tokens || 0; usage.out = ev.usage.completion_tokens || 0; }
    }
    return usage;
  };

  const imageButton = document.createElement("button");
  imageButton.type = "button";
  imageButton.id = "flImageButton";
  imageButton.textContent = "🎨 Image";
  imageButton.title = "Generate an image with GPT Image";
  imageButton.style.cssText = "white-space:nowrap;padding:8px 10px";
  const input = $("#input");
  if (input && !$("#flImageButton")) input.parentElement.insertBefore(imageButton, input);

  const modal = document.createElement("section");
  modal.id = "flImageStudio";
  modal.setAttribute("aria-label", "Floof image studio");
  modal.style.cssText = "display:none;position:fixed;inset:0;z-index:80;background:rgba(3,10,6,.94);padding:20px;overflow:auto;align-items:center;justify-content:center";
  modal.innerHTML = [
    '<div style="width:min(760px,100%);background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:12px">',
    '<div style="display:flex;align-items:center;gap:10px"><h2 style="margin:0;flex:1">🎨 Floof Image Studio</h2><button type="button" id="flImageClose" aria-label="Close">✕</button></div>',
    '<p class="small" style="margin:0">Describe the image you want. GPT Image creates it from your prompt.</p>',
    '<textarea id="flImagePrompt" class="box" rows="4" maxlength="12000" placeholder="A cinematic illustration of a tiny astronaut fox exploring a glowing alien garden…"></textarea>',
    '<div class="row" style="flex-wrap:wrap"><label class="small">Image model<select id="flImageModel" style="display:block;min-width:220px"><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare · fast</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst · detailed</option></select></label>',
    '<label class="small">Shape<select id="flImageSize" style="display:block;min-width:150px"><option value="1024x1024">Square</option><option value="1536x1024">Landscape</option><option value="1024x1536">Portrait</option></select></label>',
    '<button type="button" class="go" id="flImageGenerate" style="margin-left:auto">Generate image</button></div>',
    '<div class="small" id="flImageStatus" role="status">Connect OpenAI in the sidebar to enable image generation.</div>',
    '<div id="flImageResult" style="display:none;gap:10px;flex-direction:column"><img id="flImagePreview" alt="Image generated by Floof AI" style="width:100%;max-height:65vh;object-fit:contain;border-radius:12px;background:#030a06">',
    '<div class="row"><a id="flImageDownload" class="go" download="floof-generated.png" style="padding:8px 12px;border-radius:10px;text-decoration:none">⬇ Save image</a><button type="button" id="flImageAgain">Make another</button></div></div>',
    '<p class="small" style="margin:0">Usage is billed by OpenAI and may require API organisation verification. Your API key is used directly by this browser and is stored in this browser’s existing provider settings. Don’t use this on a shared device.</p>',
    '</div>'
  ].join("");
  document.body.appendChild(modal);

  const close = () => { modal.style.display = "none"; };
  $("#flImageClose").onclick = close;
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  imageButton.onclick = () => {
    modal.style.display = "flex";
    $("#flImagePrompt").value = input?.value?.trim() || "";
    $("#flImagePrompt").focus();
    $("#flImageStatus").textContent = cloud.keys.openai
      ? "Ready. Choose a prompt and generate."
      : "First choose OpenAI in the sidebar, add your API key, and wait for models to load. The key remains saved when you switch providers.";
  };
  $("#flImageAgain").onclick = () => { $("#flImageResult").style.display = "none"; $("#flImagePrompt").focus(); };

  $("#flImageGenerate").onclick = async () => {
    const prompt = $("#flImagePrompt").value.trim();
    const key = cloud.keys.openai || "";
    const button = $("#flImageGenerate"), statusEl = $("#flImageStatus");
    if (!/^sk-/.test(key) || key.length < 20) { statusEl.textContent = "Add a valid OpenAI API key in the sidebar first."; return; }
    if (!prompt) { statusEl.textContent = "Write a description first."; $("#flImagePrompt").focus(); return; }
    button.disabled = true;
    $("#flImageResult").style.display = "none";
    statusEl.textContent = "Creating your image… this can take a little while.";
    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({ model: $("#flImageModel").value, prompt, size: $("#flImageSize").value, quality: "medium", output_format: "png", n: 1 })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Image generation failed (HTTP " + response.status + ").");
      const encoded = data.data?.[0]?.b64_json;
      if (!encoded) throw new Error("The image service returned no image. Try again.");
      const url = "data:image/png;base64," + encoded;
      $("#flImagePreview").src = url;
      $("#flImageDownload").href = url;
      $("#flImageResult").style.display = "flex";
      statusEl.textContent = "✨ Your image is ready.";
    } catch (e) { statusEl.textContent = e.message || "Couldn't generate the image."; }
    finally { button.disabled = false; }
  };

  if (typeof showPv === "function") showPv();
  if (typeof updateMode === "function") updateMode();
})();