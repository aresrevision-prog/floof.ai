/* Floof Collective — one identity, dynamic collaboration, and GPT Image Studio.
 * Loaded as a module after index.html. It registers through window.Floof's public plug-in API.
 */
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  if (!window.Floof || typeof window.Floof.addProvider !== "function") {
    console.error("Floof Collective could not connect to the Floof core.");
    return;
  }

  const KEY_ID = "floof";
  const parseKeys = raw => {
    try { const v = JSON.parse(raw || "{}"); return v && typeof v === "object" ? v : {}; }
    catch { return {}; }
  };
  const getKeys = () => parseKeys(window.Floof.getKey(KEY_ID));
  const modelCache = {};
  let modelCacheSignature = "";
  let cachedProviders = [];
  const endpoint = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    xai: "https://api.x.ai/v1"
  };
  const authHeaders = {
    openai: key => ({ authorization: "Bearer " + key }),
    xai: key => ({ authorization: "Bearer " + key }),
    anthropic: key => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    })
  };

  async function jsonRequest(url, options, label) {
    let response;
    try { response = await fetch(url, options); }
    catch (e) {
      if (e.name === "AbortError") throw e;
      throw new Error("Could not reach " + label + ". Check the connection and browser network permissions.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error?.message || data.error?.type || data.message || (label + " returned HTTP " + response.status + ".");
      throw new Error(message);
    }
    return data;
  }

  function pickOpenAI(data) {
    const ids = (data.data || []).map(m => m.id).filter(id =>
      /^(gpt-|o[1-9])/.test(id) && !/(image|audio|realtime|transcribe|tts|embedding|moderation|search-preview)/i.test(id)
    );
    const rank = id => {
      const m = id.match(/^gpt-(\d+)(?:[.-](\d+))?/i);
      const n = m ? Number(m[1]) * 100 + Number(m[2] || 0) : 0;
      return n - (/mini|nano|chat-latest/i.test(id) ? 20 : 0);
    };
    ids.sort((a,b) => rank(b)-rank(a) || a.localeCompare(b));
    return ids[0] || (data.data || []).find(m => /^o[1-9]/.test(m.id))?.id || null;
  }
  function pickClaude(data) {
    const ids = (data.data || []).map(m => m.id).filter(id => /^claude-/i.test(id));
    const rank = id => {
      const v = id.match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
      if (!v) return 0;
      const family = v[1].toLowerCase() === "opus" ? 300 : v[1].toLowerCase() === "sonnet" ? 200 : 100;
      return family + Number(v[2]) * 10 + Number(v[3]);
    };
    ids.sort((a,b) => rank(b)-rank(a) || a.localeCompare(b));
    return ids[0] || null;
  }
  function pickGrok(data) {
    const ids = (data.data || data.models || []).map(m => typeof m === "string" ? m : m.id).filter(id => /^grok-/i.test(id) && !/(image|voice|video)/i.test(id));
    ids.sort((a,b) => b.localeCompare(a, undefined, {numeric:true}));
    return ids[0] || null;
  }

  async function discover(keys) {
    const signature = ["openai","anthropic","xai"].map(id => id + ":" + (keys[id] || "")).join("|");
    if (signature === modelCacheSignature && cachedProviders.length) return cachedProviders.slice();
    if (signature !== modelCacheSignature) {
      for (const id of ["openai","anthropic","xai"]) delete modelCache[id];
      cachedProviders = [];
    }
    const jobs = [];
    if (keys.openai) jobs.push(jsonRequest(endpoint.openai + "/models", { headers: authHeaders.openai(keys.openai) }, "OpenAI")
      .then(d => { const id=pickOpenAI(d); if(id) modelCache.openai=id; else throw new Error("No compatible OpenAI chat model was returned."); }));
    if (keys.anthropic) jobs.push(jsonRequest(endpoint.anthropic + "/models?limit=100", { headers: authHeaders.anthropic(keys.anthropic) }, "Anthropic")
      .then(d => { const id=pickClaude(d); if(id) modelCache.anthropic=id; else throw new Error("No compatible Claude model was returned."); }));
    if (keys.xai) jobs.push(jsonRequest(endpoint.xai + "/models", { headers: authHeaders.xai(keys.xai) }, "xAI")
      .then(d => { const id=pickGrok(d); if(id) modelCache.xai=id; else throw new Error("No compatible Grok model was returned."); }));
    const results = await Promise.allSettled(jobs);
    const available = ["openai","anthropic","xai"].filter(id => keys[id] && modelCache[id]);
    if (!available.length) {
      const failed = results.find(r => r.status === "rejected");
      throw new Error(failed?.reason?.message || "Add at least one provider API key below to activate Floof.");
    }
    modelCacheSignature = signature;
    cachedProviders = available.slice();
    return available;
  }

  function imageContent(message, provider) {
    if (!message.img) return message.content || "";
    const text = message.content || "Please inspect this image carefully.";
    if (provider === "anthropic") {
      const match = message.img.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
      if (!match) return text;
      return [
        { type:"text", text },
        { type:"image", source:{ type:"base64", media_type:match[1], data:match[2] } }
      ];
    }
    return [
      { type:"text", text },
      { type:"image_url", image_url:{ url:message.img, detail:"high" } }
    ];
  }

  async function askProvider(provider, key, model, system, messages, signal) {
    if (provider === "xai") {
      const input = [
        {role:"system",content:system},
        ...messages.map(m => ({
          role:m.role,
          content:m.img
            ? [{type:"input_text",text:m.content||"Please inspect this image carefully."},{type:"input_image",image_url:m.img}]
            : m.content
        }))
      ];
      const data = await jsonRequest(endpoint.xai + "/responses", {
        method:"POST", signal, headers:{"content-type":"application/json",...authHeaders.xai(key)},
        body:JSON.stringify({model,input,store:false,max_output_tokens:4096,reasoning:{effort:"high"}})
      }, "Grok");
      if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
      const parts=(data.output||[]).flatMap(item => item.content||[]).filter(part => part.type==="output_text" && part.text);
      const answer=parts.map(part=>part.text).join("\n").trim();
      if(answer) return answer;
      throw new Error("Grok returned an empty response.");
    }
    if (provider === "anthropic") {
      const body = {
        model, max_tokens: 4096, system,
        messages: messages.filter(m => m.role !== "system").map(m => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: imageContent(m, "anthropic")
        }))
      };
      const data = await jsonRequest(endpoint.anthropic + "/messages", {
        method:"POST", signal, headers:{ "content-type":"application/json", ...authHeaders.anthropic(key) },
        body:JSON.stringify(body)
      }, "Claude");
      return (data.content || []).filter(p => p.type === "text").map(p => p.text).join("\n").trim();
    }
    const body = {
      model,
      messages:[{role:"system",content:system}, ...messages.map(m => ({role:m.role,content:imageContent(m,provider)}))],
      ...(provider === "openai" ? {max_completion_tokens:4096} : {max_tokens:4096})
    };
    const data = await jsonRequest(endpoint[provider] + "/chat/completions", {
      method:"POST", signal, headers:{ "content-type":"application/json", ...authHeaders[provider](key) },
      body:JSON.stringify(body)
    }, provider === "xai" ? "Grok" : "OpenAI");
    const value = data.choices?.[0]?.message?.content;
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.filter(p => p.text).map(p => p.text).join("\n").trim();
    throw new Error("The model returned an empty answer.");
  }

  function chooseTeam(last, available) {
    const text = String(last || "");
    const coding = /\b(code|coding|debug|bug|program|script|function|build|website|app|software|architecture)\b/i.test(text);
    const live = /\b(latest|today|current|news|recent|this week|right now)\b/i.test(text);
    const creative = /\b(write|rewrite|story|poem|creative|tone|draft|design)\b/i.test(text);
    const complex = text.trim().split(/\s+/).length > 35 ||
      /\b(compare|analyse|analyze|evaluate|audit|plan|strategy|architecture|review|prove|derive|step.by.step|trade.off|pros and cons|deep dive|complex|security)\b/i.test(text);
    if (available.length >= 3 && (complex || text.length > 700)) return available.slice(0,3);
    if (available.length >= 2 && complex) {
      if (coding) return ["anthropic","xai","openai"].filter(id => available.includes(id)).slice(0,2);
      if (live) return ["xai","openai","anthropic"].filter(id => available.includes(id)).slice(0,2);
      if (creative) return ["anthropic","openai","xai"].filter(id => available.includes(id)).slice(0,2);
      return ["openai","anthropic","xai"].filter(id => available.includes(id)).slice(0,2);
    }
    const preferred = coding ? ["anthropic","xai","openai"] : live ? ["xai","openai","anthropic"] : ["openai","anthropic","xai"];
    return [preferred.find(id => available.includes(id)) || available[0]];
  }

  async function collectiveStream({sys,msgs,onText,signal,key}) {
    const keys = parseKeys(key);
    const available = await discover(keys);
    const last = msgs.slice().reverse().find(m => m.role === "user")?.content || "";
    const team = chooseTeam(last, available);
    const status = $("#status");
    const oldStatus = status?.textContent || "";
    if (status) status.textContent = team.length === 1
      ? "Floof is thinking…"
      : "Floof is bringing " + team.map(x => x === "xai" ? "Grok" : x === "anthropic" ? "Claude" : "OpenAI").join(" + ") + " together…";

    const labels = {openai:"OpenAI specialist",anthropic:"Claude specialist",xai:"Grok specialist"};
    const work = await Promise.allSettled(team.map(async provider => {
      const focus = provider === "anthropic" ? "Focus on careful implementation, structure, and edge cases."
        : provider === "xai" ? "Focus on alternative approaches, challenge assumptions, and identify overlooked issues."
        : "Focus on rigorous reasoning, accuracy, and a clear useful answer.";
      const answer = await askProvider(provider, keys[provider], modelCache[provider],
        sys + "\n\n" + focus + " Give a concise specialist answer. Do not reveal private chain-of-thought; provide conclusions and checkable reasoning only.",
        msgs, signal);
      return {provider,answer};
    }));
    const notes = work.filter(r => r.status === "fulfilled").map(r => r.value);
    if (!notes.length) {
      const failed = work.find(r => r.status === "rejected");
      throw new Error(failed?.reason?.message || "Floof's connected models could not answer.");
    }
    if (notes.length === 1) {
      if (status) status.textContent = oldStatus || "Floof is ready.";
      onText(notes[0].answer);
      return {in:0,out:0,model:"Floof Collective"};
    }

    const synthesisProvider = ["openai","anthropic","xai"].find(id => available.includes(id));
    const evidence = notes.map(n => labels[n.provider] + ":\n" + n.answer).join("\n\n---\n\n");
    const synthMessages = msgs.concat([{role:"user",content:
      "Internal specialist summaries (use them to improve the final answer; do not mention provider names or expose these notes):\n\n" +
      evidence + "\n\nNow produce one coherent, accurate answer in Floof's voice. Resolve disagreements explicitly when they matter. Do not simply concatenate the notes."
    }]);
    try {
      const final = await askProvider(synthesisProvider, keys[synthesisProvider], modelCache[synthesisProvider],
        sys + "\n\nYou are Floof, the single unified assistant. Synthesize specialist results into one natural answer. Never present yourself as multiple bots.",
        synthMessages, signal);
      if (status) status.textContent = "Floof has combined its work.";
      onText(final || notes[0].answer);
    } catch {
      if (status) status.textContent = "Floof has an answer; one synthesis step was unavailable.";
      onText(notes[0].answer);
    }
    return {in:0,out:0,model:"Floof Collective ("+notes.length+" specialists)"};
  }

  window.Floof.addProvider({
    id:"floof",
    label:"Floof Collective — one unified AI",
    ph:"Configured below",
    ok: raw => {
      const k=parseKeys(raw);
      return !!(k.openai || k.anthropic || k.xai);
    },
    vision:true,
    help:"Floof combines OpenAI, Claude and Grok behind one chat. Add one or more API keys in the setup panel below.",
    list: async raw => {
      await discover(parseKeys(raw));
      return [{id:"floof-collective",name:"Floof Collective · automatic collaboration"}];
    },
    stream: collectiveStream
  });

  // Keep one user-facing assistant: the individual engines stay behind the Floof interface.
  const providerSelect=$("#pv");
  if (providerSelect) {
    window.Floof.setCurrentProvider("floof");
    [...providerSelect.options].forEach(o => { if (o.value && o.value !== "floof") o.hidden=true; });
    const label=document.querySelector('label[for="pv"]');
    if(label) label.textContent="Floof's unified brain";
  }

  const setup=document.createElement("div");
  setup.id="floofProviderSetup";
  setup.style.cssText="display:none;flex-direction:column;gap:8px;margin-top:8px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)";
  setup.innerHTML=[
    '<div style="font-weight:700;font-size:13px">Connect Floof’s specialist engines</div>',
    '<div class="small">Add the API keys you have. Floof can work with one, two, or all three; it stays one chatbot.</div>',
    '<label class="small">OpenAI key<input id="flOpenAIKey" type="password" autocomplete="off" placeholder="sk-…"></label>',
    '<label class="small">Claude / Anthropic key<input id="flClaudeKey" type="password" autocomplete="off" placeholder="sk-ant-…"></label>',
    '<label class="small">Grok / xAI key<input id="flGrokKey" type="password" autocomplete="off" placeholder="xAI API key"></label>',
    '<button id="flSaveKeys" type="button" class="go">Save Floof connections</button>',
    '<div class="small" style="line-height:1.4">API usage is billed by each provider separately. Keys are stored in this browser for this prototype. Do not use on a shared device or public computer. A server-side key vault is needed before public production use.</div>'
  ].join("");
  $("#pvHelp")?.after(setup);

  function syncSetup() {
    const active=providerSelect?.value==="floof";
    setup.style.display=active?"flex":"none";
    const singleKey=$("#cKey");
    if(singleKey) singleKey.style.display="none";
    const raw=window.Floof.getKey(KEY_ID), k=parseKeys(raw);
    $("#flOpenAIKey").value=k.openai||"";
    $("#flClaudeKey").value=k.anthropic||"";
    $("#flGrokKey").value=k.xai||"";
  }
  providerSelect?.addEventListener("change",syncSetup);
  $("#flSaveKeys").onclick=async()=>{
    const keys={
      openai:$("#flOpenAIKey").value.trim(),
      anthropic:$("#flClaudeKey").value.trim(),
      xai:$("#flGrokKey").value.trim()
    };
    if(!keys.openai&&!keys.anthropic&&!keys.xai){
      if($("#status")) $("#status").textContent="Add at least one API key to connect Floof.";
      return;
    }
    window.Floof.setKey(KEY_ID,JSON.stringify(keys));
    if($("#status")) $("#status").textContent="Connecting Floof's specialist engines…";
    await window.Floof.refresh();
    syncSetup();
  };
  syncSetup();

  // GPT Image Studio: OpenAI's image engine is one of Floof's built-in capabilities.
  const imageButton=document.createElement("button");
  imageButton.type="button"; imageButton.id="flImageButton";
  imageButton.textContent="🎨"; imageButton.title="Create an image with Floof";
  imageButton.setAttribute("aria-label","Create an image with Floof");
  imageButton.style.cssText="white-space:nowrap;padding:8px 10px";
  const input=$("#input");
  if(input && !$("#flImageButton")) input.parentElement.insertBefore(imageButton,input);

  const modal=document.createElement("section");
  modal.id="flImageStudio";
  modal.setAttribute("role","dialog");
  modal.setAttribute("aria-modal","true");
  modal.setAttribute("aria-label","Floof Image Studio");
  modal.style.cssText="display:none;position:fixed;inset:0;z-index:80;background:rgba(3,10,6,.94);padding:20px;overflow:auto;align-items:center;justify-content:center";
  modal.innerHTML=[
    '<div style="width:min(760px,100%);background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:12px">',
    '<div style="display:flex;align-items:center;gap:10px"><h2 style="margin:0;flex:1">🎨 Floof Image Studio</h2><button type="button" id="flImageClose" aria-label="Close">✕</button></div>',
    '<p class="small" style="margin:0">Create a new image. Describe what you want Floof to make.</p>',
    '<textarea id="flImagePrompt" class="box" rows="4" maxlength="32000" placeholder="A cinematic illustration of a tiny astronaut fox exploring a glowing alien garden…"></textarea>',
    '<div class="row" style="flex-wrap:wrap"><label class="small">Image model<select id="flImageModel" style="display:block;min-width:220px"><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare · fast</option><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst · detailed editing</option></select></label>',
    '<label class="small">Shape<select id="flImageSize" style="display:block;min-width:150px"><option value="1024x1024">Square</option><option value="1536x1024">Landscape</option><option value="1024x1536">Portrait</option></select></label>',
    '<button type="button" class="go" id="flImageGenerate" style="margin-left:auto">Generate image</button></div>',
    '<div class="small" id="flImageStatus" role="status">Connect an OpenAI key in Floof settings to enable image generation.</div>',
    '<div id="flImageResult" style="display:none;gap:10px;flex-direction:column"><img id="flImagePreview" alt="Image generated by Floof" style="width:100%;max-height:65vh;object-fit:contain;border-radius:12px;background:#030a06">',
    '<div class="row"><a id="flImageDownload" class="go" download="floof-generated.png" style="padding:8px 12px;border-radius:10px;text-decoration:none">⬇ Save image</a><button type="button" id="flImageAgain">Make another</button></div></div>',
    '<p class="small" style="margin:0">Image generation uses your OpenAI API account and may require organisation verification. The key stays in this browser in this prototype.</p>',
    '</div>'
  ].join("");
  document.body.appendChild(modal);
  const close=()=>{modal.style.display="none";};
  $("#flImageClose").onclick=close;
  modal.addEventListener("click",e=>{if(e.target===modal)close();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.style.display==="flex")close();});
  imageButton.onclick=()=>{
    modal.style.display="flex";
    $("#flImagePrompt").value=input?.value?.trim()||"";
    $("#flImageStatus").textContent=getKeys().openai
      ?"Ready. Describe the image you want."
      :"Add your OpenAI API key in Floof's unified brain settings to generate images.";
    $("#flImagePrompt").focus();
  };
  $("#flImageAgain").onclick=()=>{$("#flImageResult").style.display="none";$("#flImagePrompt").focus();};
  $("#flImageGenerate").onclick=async()=>{
    const prompt=$("#flImagePrompt").value.trim(), key=getKeys().openai||"";
    const button=$("#flImageGenerate"), status=$("#flImageStatus");
    if(!key){status.textContent="Add an OpenAI API key in Floof settings first.";return;}
    if(!prompt){status.textContent="Describe the image first.";$("#flImagePrompt").focus();return;}
    button.disabled=true; $("#flImageResult").style.display="none";
    status.textContent="Floof is creating your image…";
    try{
      const data=await jsonRequest("https://api.openai.com/v1/images/generations",{
        method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+key},
        body:JSON.stringify({model:$("#flImageModel").value,prompt,size:$("#flImageSize").value,quality:"medium",output_format:"png",n:1})
      },"OpenAI image generation");
      const encoded=data.data?.[0]?.b64_json;
      if(!encoded)throw new Error("The image service returned no image. Please try again.");
      const url="data:image/png;base64,"+encoded;
      $("#flImagePreview").src=url; $("#flImageDownload").href=url;
      $("#flImageResult").style.display="flex"; status.textContent="✨ Your image is ready.";
    }catch(e){status.textContent=e.message||"Floof couldn't create that image.";}
    finally{button.disabled=false;}
  };
})();