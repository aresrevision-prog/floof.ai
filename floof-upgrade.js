/* Floof Free / Chromebook — one identity with optional remote AI and image servers.
 * The Chromebook is the browser interface; Ollama and Stable Diffusion can run on another computer.
 * Remote endpoints must be reachable by this browser and configured with HTTPS/CORS as appropriate.
 * No paid provider keys, subscriptions, or remote image APIs are required by this module.
 */
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  if (!window.Floof || typeof window.Floof.addProvider !== "function") {
    console.error("Floof Free Local could not connect to the Floof core.");
    return;
  }

  const KEY_ID = "floof";
  const defaults = { ollamaUrl: "", imageUrl: "" };
  const parseConfig = raw => {
    try {
      const v = JSON.parse(raw || "{}");
      return { ...defaults, ...(v && typeof v === "object" ? v : {}) };
    } catch { return { ...defaults }; }
  };
  const getConfig = () => parseConfig(window.Floof.getKey(KEY_ID));
  const cleanUrl = value => String(value || "").trim().replace(/\/+$/, "");
  const apiError = async (response, label) => {
    let detail = "";
    try {
      const data = await response.json();
      detail = data.error?.message || data.detail || data.message || "";
    } catch {}
    return new Error(detail || label + " returned HTTP " + response.status + ".");
  };
  async function getJson(url, label, signal) {
    let response;
    try { response = await fetch(url, { signal }); }
    catch (e) {
      if (e.name === "AbortError") throw e;
      throw new Error("Can't reach " + label + ". Check that it is installed, running on this computer, and allows this website through CORS.");
    }
    if (!response.ok) throw await apiError(response, label);
    return response.json();
  }

  function imageMessage(message) {
    const result = { role: message.role === "assistant" ? "assistant" : "user", content: message.content || "" };
    if (message.img) {
      const match = String(message.img).match(/^data:image\/[^;]+;base64,(.+)$/);
      if (match) result.images = [match[1]];
    }
    return result;
  }

  window.Floof.addProvider({
    id: "floof",
    label: "Floof — free local brain",
    ph: "Local Ollama address",
    ok: raw => /^https?:\/\//i.test(parseConfig(raw).ollamaUrl),
    vision: true,
    help: "Free mode: connect this Chromebook to Ollama on another computer or a reachable hosted endpoint. Linux is not required on the Chromebook. Use a secure HTTPS address for internet connections and configure CORS on the AI server.",
    list: async raw => {
      const cfg = parseConfig(raw), base = cleanUrl(cfg.ollamaUrl);
      const data = await getJson(base + "/api/tags", "Ollama");
      const models = (data.models || []).filter(m => !/embed/i.test(m.name || ""));
      if (!models.length) throw new Error("Ollama is running but has no chat models. Open a terminal and run: ollama pull qwen3:8b");
      models.sort((a,b) => {
        const score = m => (/vision|llava|qwen.*vl|moondream/i.test(m.name) ? 2 : 0) + (m.details?.parameter_size ? parseFloat(m.details.parameter_size) / 100 : 0);
        return score(b) - score(a) || (b.size || 0) - (a.size || 0);
      });
      return models.map(m => ({ id: m.name, name: m.name + (m.details?.parameter_size ? " · " + m.details.parameter_size : "") }));
    },
    stream: async ({ model, sys, msgs, onText, signal, key }) => {
      const cfg = parseConfig(key), base = cleanUrl(cfg.ollamaUrl);
      const messages = [{ role: "system", content: sys || "You are Floof, a helpful and capable AI assistant." }]
        .concat(msgs.filter(m => m.role !== "system").map(imageMessage));
      let response;
      try {
        response = await fetch(base + "/api/chat", {
          method: "POST", signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, messages, stream: true, options: { temperature: 0.7 } })
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new Error("Can't reach Ollama. Make sure Ollama is running and its browser origins are allowed.");
      }
      if (!response.ok) throw await apiError(response, "Ollama");
      if (!response.body) throw new Error("Your browser does not support streaming from the local model.");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.error) throw new Error(event.error);
          const token = event.message?.content;
          if (token) onText(token);
        }
      }
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (event.error) throw new Error(event.error);
          if (event.message?.content) onText(event.message.content);
        } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; }
      }
      return { in: 0, out: 0, model: model + " · local" };
    }
  });

  // Keep the app as one Floof assistant. The original on-device WebGPU brain remains available.
  const providerSelect = $("#pv");
  if (providerSelect) {
    window.Floof.setCurrentProvider("floof");
    [...providerSelect.options].forEach(option => {
      if (option.value && option.value !== "floof") option.hidden = true;
    });
    const label = document.querySelector('label[for="pv"]');
    if (label) label.textContent = "Floof's free local brain";
  }

  const setup = document.createElement("div");
  setup.id = "floofLocalSetup";
  setup.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)";
  setup.innerHTML = [
    '<div style="font-weight:700;font-size:13px">🐾 Free Floof setup</div>',
    '<div class="small">Chromebook mode: this device is the screen and controls. The AI can run on another computer or a compatible hosted server — no Linux installation on the Chromebook is needed.</div>',
    '<label class="small">External chat AI URL (Ollama-compatible)<input id="flOllamaUrl" type="url" value="" spellcheck="false" placeholder="https://your-secure-ai-server.example"></label>',
    '<div class="row" style="flex-wrap:wrap"><button id="flSaveLocal" type="button" class="go">Save connection &amp; find models</button><button id="flTestRemote" type="button">Test connection</button></div>',
    '<div class="small" style="line-height:1.5"><b>Connect from your Chromebook:</b> run Ollama on a computer you control, then enter its reachable address here. For access outside your home Wi-Fi, use a private VPN/tunnel or a secured HTTPS gateway. Do not expose an unauthenticated Ollama port directly to the public internet. The AI server must allow this Floof website through CORS. A plain HTTP address on another device may be blocked by the browser when Floof is loaded over HTTPS; use HTTPS for remote connections.<br><br><b>Free option:</b> Ollama itself is free, but it needs to run on another computer (or a supported local environment). If you do not have another computer, use Floof’s built-in browser brain where your Chromebook supports it.</div>',
    '<div class="small" id="flLocalStatus" role="status">No Linux is required on this Chromebook. Save a reachable AI server address, then test it here.</div>'
  ].join("");
  $("#pvHelp")?.after(setup);
  $("#cKey") && ($("#cKey").style.display = "none");

  function syncSetup() {
    const cfg = getConfig();
    $("#flOllamaUrl").value = cfg.ollamaUrl;
  }
  async function saveChatConnection() {
    const cfg = getConfig();
    cfg.ollamaUrl = cleanUrl($("#flOllamaUrl").value) || defaults.ollamaUrl;
    window.Floof.setKey(KEY_ID, JSON.stringify(cfg));
    return cfg;
  }
  $("#flSaveLocal").onclick = async () => {
    const status = $("#flLocalStatus"), button = $("#flSaveLocal");
    button.disabled = true; status.textContent = "Saving connection and loading the AI model list…";
    try {
      await saveChatConnection();
      await window.Floof.refresh();
      status.textContent = "Connection saved and model list refreshed. Choose a model in Floof’s model selector.";
    } catch (e) { status.textContent = "Saved, but connection failed: " + (e.message || e) + " Check the server URL, CORS and HTTPS."; }
    finally { button.disabled = false; }
  };
  $("#flTestRemote").onclick = async () => {
    const status = $("#flLocalStatus"), button = $("#flTestRemote");
    button.disabled = true; status.textContent = "Testing the external AI connection…";
    try {
      const cfg = await saveChatConnection(), base = cleanUrl(cfg.ollamaUrl);
      if (!/^https?:\/\//i.test(base)) throw new Error("Enter a complete URL beginning with https:// (or http:// for localhost only).");
      const data = await getJson(base + "/api/tags", "External Ollama server");
      const count = Array.isArray(data.models) ? data.models.length : 0;
      status.textContent = count ? "Connected! Found " + count + " model(s). Save connection & find models to load them into Floof." : "Connected, but no models are installed on that server yet.";
    } catch (e) { status.textContent = "Could not connect: " + (e.message || e) + " Check the address, server CORS settings, HTTPS and network access."; }
    finally { button.disabled = false; }
  };
  syncSetup();

  // Free local image generation through Stable Diffusion WebUI Forge / AUTOMATIC1111.
  const imageButton = document.createElement("button");
  imageButton.type = "button";
  imageButton.id = "flImageButton";
  imageButton.textContent = "🎨";
  imageButton.title = "Create an image locally with Floof";
  imageButton.setAttribute("aria-label", "Create an image locally with Floof");
  imageButton.style.cssText = "white-space:nowrap;padding:8px 10px";
  const input = $("#input");
  if (input && !$("#flImageButton")) input.parentElement.insertBefore(imageButton, input);

  const modal = document.createElement("section");
  modal.id = "flImageStudio";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Floof Image Studio");
  modal.style.cssText = "display:none;position:fixed;inset:0;z-index:80;background:rgba(3,10,6,.94);padding:20px;overflow:auto;align-items:center;justify-content:center";
  modal.innerHTML = [
    '<div style="width:min(760px,100%);background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:12px">',
    '<div style="display:flex;align-items:center;gap:10px"><h2 style="margin:0;flex:1">🎨 Floof Image Studio</h2><button type="button" id="flImageClose" aria-label="Close">✕</button></div>',
    '<p class="small" style="margin:0">Generate images on your own computer. Nothing is sent to a paid image API.</p>',
    '<textarea id="flImagePrompt" class="box" rows="4" maxlength="12000" placeholder="A cinematic illustration of a tiny astronaut fox exploring a glowing alien garden…"></textarea>',
    '<textarea id="flImageNegative" class="box" rows="2" maxlength="4000" placeholder="Optional: things to avoid (blurry, text, watermark…)"></textarea>',
    '<div class="row" style="flex-wrap:wrap;gap:10px">',
    '<label class="small">Shape<select id="flImageSize" style="display:block;min-width:145px"><option value="512x512">Square · Chromebook friendly</option><option value="768x512">Landscape · lighter</option><option value="512x768">Portrait · lighter</option><option value="768x768">Square · detailed</option></select></label>',
    '<label class="small">Quality<select id="flImageSteps" style="display:block;min-width:130px"><option value="16">Fast · 16 steps</option><option value="22" selected>Balanced · 22 steps</option><option value="28">Detailed · 28 steps</option></select></label>',
    '<label class="small">External image server URL<input id="flImageUrl" type="url" value="" spellcheck="false" placeholder="https://your-secure-image-server.example"></label>',
    '<button type="button" id="flImageTest">Test image connection</button><button type="button" class="go" id="flImageGenerate" style="margin-left:auto">Generate free image</button></div>',
    '<div class="small" id="flImageStatus" role="status">Enter the address of an image server running on another computer or your own hosted machine. No Linux is required on this Chromebook.</div>',
    '<div id="flImageResult" style="display:none;gap:10px;flex-direction:column"><img id="flImagePreview" alt="Image generated locally by Floof" style="width:100%;max-height:65vh;object-fit:contain;border-radius:12px;background:#030a06">',
    '<div class="row"><a id="flImageDownload" class="go" download="floof-generated.png" style="padding:8px 12px;border-radius:10px;text-decoration:none">⬇ Save image</a><button type="button" id="flImageAgain">Make another</button></div></div>',
    '<div class="small" style="line-height:1.5"><b>Chromebook connection:</b> run <a href="https://github.com/lllyasviel/stable-diffusion-webui-forge" target="_blank" rel="noopener">Stable Diffusion WebUI Forge</a> on another computer you control, enable its API and allow this Floof website through CORS. Enter its reachable image-server URL above. For internet access use a private tunnel or secured HTTPS gateway; do not expose an unauthenticated image API publicly. Remote HTTP may be blocked when Floof is served over HTTPS. No Linux or paid image credits are required on the Chromebook.</div>',
    '</div>'
  ].join("");
  document.body.appendChild(modal);

  let currentImageUrl = "";
  // Ten successful images per UTC day, tracked locally in this browser.
  const imageQuotaKey = "floof.arti.images.v1";
  const utcDay = () => new Date().toISOString().slice(0, 10);
  function imageUsage() {
    try {
      const saved = JSON.parse(localStorage.getItem(imageQuotaKey) || "{}");
      return saved.day === utcDay() ? Math.max(0, Math.min(10, Number(saved.count) || 0)) : 0;
    } catch { return 0; }
  }
  function saveImageUsage(count) {
    try { localStorage.setItem(imageQuotaKey, JSON.stringify({ day: utcDay(), count })); } catch {}
  }
  function showImageQuota() {
    const remaining = Math.max(0, 10 - imageUsage());
    $("#flImageStatus").textContent = "Arti free image allowance: " + remaining + "/10 images left today (resets at 00:00 UTC).";
    $("#flImageGenerate").disabled = remaining === 0;
  }

  const close = () => { modal.style.display = "none"; };
  $("#flImageClose").onclick = close;
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && modal.style.display === "flex") close(); });
  imageButton.onclick = () => {
    modal.style.display = "flex";
    $("#flImagePrompt").value = input?.value?.trim() || "";
    $("#flImageUrl").value = getConfig().imageUrl;
    showImageQuota();
    $("#flImagePrompt").focus();
  };
  $("#flImageAgain").onclick = () => { $("#flImageResult").style.display = "none"; $("#flImagePrompt").focus(); };
  $("#flImageTest").onclick = async () => {
    const button = $("#flImageTest"), status = $("#flImageStatus");
    const base = cleanUrl($("#flImageUrl").value);
    if (!base || !(base.startsWith("https://") || base.startsWith("http://"))) { status.textContent = "Enter the full address of your external Forge/AUTOMATIC1111 image server first."; return; }
    const cfg = getConfig(); cfg.imageUrl = base; window.Floof.setKey(KEY_ID, JSON.stringify(cfg));
    button.disabled = true; status.textContent = "Checking the external image server…";
    try {
      const data = await getJson(base + "/sdapi/v1/sd-models", "External image server");
      status.textContent = Array.isArray(data) && data.length
        ? "Connected! Found " + data.length + " image model(s). You can generate now."
        : "Server responded, but no Stable Diffusion models were listed. Load a model in Forge/AUTOMATIC1111.";
    } catch (e) {
      status.textContent = (e.message || "Connection failed.") + " Check the URL, API access, CORS and HTTPS. This connector expects the Forge/AUTOMATIC1111 API.";
    } finally { button.disabled = false; }
  };
  $("#flImageGenerate").onclick = async () => {
    const prompt = $("#flImagePrompt").value.trim();
    if (imageUsage() >= 10) { showImageQuota(); return; }
    const negative = $("#flImageNegative").value.trim();
    const button = $("#flImageGenerate"), status = $("#flImageStatus");
    const base = cleanUrl($("#flImageUrl").value);
    const dimensions = $("#flImageSize").value.split("x").map(Number);
    const width = dimensions[0], height = dimensions[1];
    if (!prompt) { status.textContent = "Describe the image first."; $("#flImagePrompt").focus(); return; }
    if (!base || !/^https?:\/\//i.test(base)) { status.textContent = "Enter the external image server address first."; return; }
    const cfg = getConfig(); cfg.imageUrl = base; window.Floof.setKey(KEY_ID, JSON.stringify(cfg));
    button.disabled = true;
    $("#flImageResult").style.display = "none";
    status.textContent = "Floof is generating on your connected image server. This can take a few minutes…";
    try {
      const response = await fetch(base + "/sdapi/v1/txt2img", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt, negative_prompt: negative, width, height,
          steps: Number($("#flImageSteps").value), cfg_scale: 6.5,
          sampler_name: "DPM++ 2M Karras", batch_size: 1, n_iter: 1
        })
      });
      if (!response.ok) throw await apiError(response, "Local image generator");
      const data = await response.json();
      const encoded = data.images?.[0];
      if (!encoded) throw new Error("The local image generator returned no image. Check that a model is loaded.");
      const binary = atob(encoded.replace(/^data:image\/\w+;base64,/, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "image/png" });
      if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
      currentImageUrl = URL.createObjectURL(blob);
      $("#flImagePreview").src = currentImageUrl;
      $("#flImageDownload").href = currentImageUrl;
      $("#flImageResult").style.display = "flex";
      saveImageUsage(imageUsage() + 1);
      status.textContent = "✨ Image ready! " + (10 - imageUsage()) + "/10 free images left today.";
    } catch (e) {
      status.textContent = (e.message || "Floof couldn't create that image.") +
        " Check that Forge/AUTOMATIC1111 is running with --api and CORS enabled.";
    } finally { button.disabled = imageUsage() >= 10; }
  };
  showImageQuota();
})();