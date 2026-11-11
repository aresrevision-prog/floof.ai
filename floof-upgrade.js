/* Floof Free Local — one identity, local chat, and zero-cost local image generation.
 * Chat: Ollama on this computer (or the built-in WebGPU brain in the main app).
 * Images: Stable Diffusion WebUI Forge / AUTOMATIC1111 running locally with its API enabled.
 * No paid provider keys, subscriptions, or remote image APIs are used by this module.
 */
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  if (!window.Floof || typeof window.Floof.addProvider !== "function") {
    console.error("Floof Free Local could not connect to the Floof core.");
    return;
  }

  const KEY_ID = "floof";
  const defaults = { ollamaUrl: "http://localhost:11434", imageUrl: "http://127.0.0.1:7860" };
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
    help: "Free mode: connect to Ollama running on this Chromebook (Linux environment) or another computer you control. No API key, subscription, or paid cloud service is needed.",
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
    '<div class="small">Free-first and Chromebook-friendly: run the AI on this Chromebook if supported, or connect to another computer on your Wi-Fi. No paid API keys, subscriptions, or image credits.</div>',
    '<label class="small">Chat AI address (this Chromebook or another computer)<input id="flOllamaUrl" type="url" value="http://localhost:11434" spellcheck="false"></label>',
    '<button id="flSaveLocal" type="button" class="go">Save local setup &amp; find models</button>',
    '<div class="small" style="line-height:1.5"><b>On a Chromebook:</b> if your model supports it, enable the Linux development environment in ChromeOS Settings, install <a href="https://ollama.com/download" target="_blank" rel="noopener">Ollama for Linux</a>, then try <code>ollama pull qwen3:1.7b</code> (lighter) or <code>ollama pull qwen3:4b</code> (stronger, needs more memory). Linux/GPU support varies by Chromebook, so performance is not guaranteed.<br><br><b>Easy alternative:</b> install Ollama on another computer on your home Wi-Fi and enter that computer’s address here, e.g. <code>http://192.168.1.20:11434</code>. Configure Ollama to allow requests from Floof. The Chromebook is then just the screen and controls.</div>',
    '<div class="small" id="flLocalStatus" role="status">The built-in WebGPU brain in the sidebar is another free local option. If your Chromebook is low on memory, use a smaller model or connect to another computer.</div>'
  ].join("");
  $("#pvHelp")?.after(setup);
  $("#cKey") && ($("#cKey").style.display = "none");

  function syncSetup() {
    const cfg = getConfig();
    $("#flOllamaUrl").value = cfg.ollamaUrl;
  }
  $("#flSaveLocal").onclick = async () => {
    const cfg = getConfig();
    cfg.ollamaUrl = cleanUrl($("#flOllamaUrl").value) || defaults.ollamaUrl;
    window.Floof.setKey(KEY_ID, JSON.stringify(cfg));
    $("#flLocalStatus").textContent = "Checking Ollama and finding installed models…";
    await window.Floof.refresh();
    $("#flLocalStatus").textContent = "Saved. If no models appear, run: ollama pull qwen3:8b";
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
    '<label class="small">Image server (this Chromebook or another computer)<input id="flImageUrl" type="url" value="http://127.0.0.1:7860" spellcheck="false"></label>',
    '<button type="button" class="go" id="flImageGenerate" style="margin-left:auto">Generate free image</button></div>',
    '<div class="small" id="flImageStatus" role="status">Start the local image server on this Chromebook (if it has enough power) or on another computer. No account or paid key needed.</div>',
    '<div id="flImageResult" style="display:none;gap:10px;flex-direction:column"><img id="flImagePreview" alt="Image generated locally by Floof" style="width:100%;max-height:65vh;object-fit:contain;border-radius:12px;background:#030a06">',
    '<div class="row"><a id="flImageDownload" class="go" download="floof-generated.png" style="padding:8px 12px;border-radius:10px;text-decoration:none">⬇ Save image</a><button type="button" id="flImageAgain">Make another</button></div></div>',
    '<div class="small" style="line-height:1.5"><b>Chromebook tip:</b> most Chromebooks are not powerful enough to run Stable Diffusion comfortably. For free image generation, run <a href="https://github.com/lllyasviel/stable-diffusion-webui-forge" target="_blank" rel="noopener">Stable Diffusion WebUI Forge</a> on a more powerful computer you own, enable its API/CORS (<code>--api --cors-allow-origins=*</code>), then enter that computer’s image-server address above (for example <code>http://192.168.1.20:7860</code>). You can try it locally on a Chromebook with a supported Linux setup, but it may be very slow or unsupported. Your browser may require local-network permission and compatible HTTPS/CORS settings. No paid image service is involved.</div>',
    '</div>'
  ].join("");
  document.body.appendChild(modal);

  let currentImageUrl = "";
  const close = () => { modal.style.display = "none"; };
  $("#flImageClose").onclick = close;
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && modal.style.display === "flex") close(); });
  imageButton.onclick = () => {
    modal.style.display = "flex";
    $("#flImagePrompt").value = input?.value?.trim() || "";
    $("#flImageUrl").value = getConfig().imageUrl;
    $("#flImageStatus").textContent = "Ready when your local image server is running.";
    $("#flImagePrompt").focus();
  };
  $("#flImageAgain").onclick = () => { $("#flImageResult").style.display = "none"; $("#flImagePrompt").focus(); };
  $("#flImageGenerate").onclick = async () => {
    const prompt = $("#flImagePrompt").value.trim();
    const negative = $("#flImageNegative").value.trim();
    const button = $("#flImageGenerate"), status = $("#flImageStatus");
    const base = cleanUrl($("#flImageUrl").value);
    const dimensions = $("#flImageSize").value.split("x").map(Number);
    const width = dimensions[0], height = dimensions[1];
    if (!prompt) { status.textContent = "Describe the image first."; $("#flImagePrompt").focus(); return; }
    if (!base || !/^https?:\/\//i.test(base)) { status.textContent = "Enter the local image server address."; return; }
    button.disabled = true;
    $("#flImageResult").style.display = "none";
    status.textContent = "Floof is generating locally. This can take a few minutes…";
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
      status.textContent = "✨ Your image is ready — generated on your computer.";
    } catch (e) {
      status.textContent = (e.message || "Floof couldn't create that image.") +
        " Check that Forge/AUTOMATIC1111 is running with --api and CORS enabled.";
    } finally { button.disabled = false; }
  };
})();