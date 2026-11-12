/* Arti AI 1.0 — Free-first Arti assistant panel with Floof's connected image studio. */
(() => {
  "use strict";
  if (window.__artiAI10Loaded) return;
  window.__artiAI10Loaded = true;
  const $ = s => document.querySelector(s);
  const style = document.createElement("style");
  style.textContent = `
  #artiLaunch{border-color:#9c83ff;color:#d8ceff}
  #artiModal{display:none;position:fixed;inset:0;z-index:120;background:rgba(3,7,18,.94);padding:14px;overflow:auto;align-items:center;justify-content:center}
  #artiModal.on{display:flex}
  #artiModal .arti-card{width:min(820px,100%);height:min(850px,94vh);min-height:520px;display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid #51427d;border-radius:18px;background:#101020;color:#f2efff;box-shadow:0 24px 80px #0009}
  #artiModal input,#artiModal textarea{background:#19182d;color:#f2efff;border:1px solid #51427d;border-radius:9px;padding:9px;width:100%;box-sizing:border-box}
  #artiModal button{background:#24213c;color:#f2efff;border:1px solid #51427d;border-radius:9px;padding:8px 11px;cursor:pointer}
  #artiModal button.primary{background:linear-gradient(120deg,#9c83ff,#d38bff);color:#171126;border:0;font-weight:800}
  #artiLog{flex:1;min-height:120px;overflow:auto;padding:12px;border:1px solid #383253;border-radius:12px;background:#0a0a16;display:flex;flex-direction:column;gap:12px}
  .arti-msg{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55;padding:10px 12px;border-radius:12px;max-width:94%}
  .arti-msg.user{align-self:flex-end;background:#292347}.arti-msg.assistant{align-self:flex-start;background:#19182d;border:1px solid #383253}
  #artiStatus{font-size:12px;color:#c0b7e8;min-height:18px}
  @media(max-width:600px){#artiModal .arti-card{height:94vh;min-height:0;padding:10px}}
  `;
  document.head.appendChild(style);
  const launch = document.createElement("button");
  launch.id = "artiLaunch"; launch.type = "button"; launch.textContent = "✨ Arti AI 1.0";
  launch.title = "Open Arti AI 1.0 — free-first assistant";
  const anchor = $("#flImageButton") || $("#flCreativeBar") || $("#form .inrow");
  if (anchor) anchor.insertAdjacentElement("afterend", launch);
  else document.body.appendChild(launch);

  const modal = document.createElement("section");
  modal.id = "artiModal"; modal.setAttribute("role","dialog"); modal.setAttribute("aria-modal","true");
  modal.innerHTML = `
    <div class="arti-card">
      <div style="display:flex;align-items:center;gap:10px"><div style="flex:1"><div style="font-size:20px;font-weight:800">✨ Arti AI 1.0</div><div style="font-size:12px;color:#c0b7e8">Claude-powered assistant · image studio connected</div></div><button type="button" id="artiClose">✕</button></div>
      <details>
        <summary style="cursor:pointer;color:#d8ceff">Optional Claude connection settings</summary>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px">
          <label style="font-size:12px">API endpoint<input id="artiEndpoint" type="url" value="https://api.anthropic.com/v1/messages" spellcheck="false"></label>
          <label style="font-size:12px">Claude model<input id="artiModel" type="text" value="claude-sonnet-4-5"></label>
          <label style="font-size:12px;grid-column:1/-1">Claude API key (kept in memory only)<input id="artiKey" type="password" autocomplete="off" placeholder="Paste your Anthropic API key for this session"></label>
        </div>
        <div style="font-size:11px;color:#c0b7e8;margin-top:6px">A Claude API key or your own Anthropic-compatible proxy is required. API usage may cost money. The key is not saved by Arti, but direct browser requests expose it to this browser session and are not recommended on shared devices. For safer use, enter your own secured proxy endpoint.</div>
      </details>
      <div id="artiLog" aria-live="polite"><div class="arti-msg assistant">Hey! I'm Arti AI 1.0. I use Floof's free brain by default — no Claude key needed. I can also send image prompts to Floof's connected image server.</div></div>
      <div style="display:flex;gap:8px;align-items:flex-end"><textarea id="artiInput" rows="3" maxlength="12000" placeholder="Ask Arti anything…" style="flex:1;resize:vertical"></textarea><button class="primary" id="artiSend" type="button">Send</button></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button id="artiImage" type="button">🎨 Generate an image</button><button id="artiClear" type="button">Clear chat</button><span id="artiStatus" role="status" style="flex:1">Free mode is ready — connect Floof to an Ollama server for AI replies.</span></div>
    </div>`;
  document.body.appendChild(modal);
  const log=$("#artiLog"), status=$("#artiStatus"), input=$("#artiInput");
  const history=[];
  const add=(role,content)=>{const el=document.createElement("div");el.className="arti-msg "+role;el.textContent=content;log.appendChild(el);log.scrollTop=log.scrollHeight;return el};
  const close=()=>modal.classList.remove("on");
  launch.onclick=()=>{modal.classList.add("on");input.focus()};
  $("#artiClose").onclick=close;
  modal.addEventListener("click",e=>{if(e.target===modal)close()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.classList.contains("on"))close()});
  $("#artiClear").onclick=()=>{history.length=0;log.innerHTML="";add("assistant","Chat cleared. I'm ready for a new task.")};
  const clean=s=>String(s||"").trim().replace(/\/+$/,"");
  async function send(){
    const text=input.value.trim();if(!text)return;
    const endpoint=clean($("#artiEndpoint").value),model=$("#artiModel").value.trim(),key=$("#artiKey").value.trim();
    if(!key){
      input.value=""; add("user",text);
      const floofInput=$("#input"), floofSend=$("#send");
      if(!floofInput||!floofSend){add("assistant","Floof chat is not available on this page.");status.textContent="Free brain unavailable.";return;}
      floofInput.value=text;
      floofSend.click();
      add("assistant","Sent to Floof free brain. Its reply will appear in the main Floof chat.");
      status.textContent="Using Floof free mode — no Claude key needed.";
      return;
    }
    if(!endpoint||!model){status.textContent="Enter a Claude endpoint and model.";return}
    input.value="";add("user",text);history.push({role:"user",content:text});
        const bubble=add("assistant","Arti is thinking…");$("#artiSend").disabled=true;status.textContent="Connecting to Claude…";
    try{
      const headers={"content-type":"application/json","anthropic-version":"2023-06-01"};
      if(key){headers["x-api-key"]=key;headers["anthropic-dangerous-direct-browser-access"]="true"}
      const response=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({model,max_tokens:4096,system:"You are Arti AI 1.0, the creative and capable assistant inside Floof. Be helpful, clear, friendly, and honest. You can help with writing, coding, reasoning, planning and creative work. If asked to create an image, describe a strong image prompt and tell the user to use the Generate an image button; do not claim an image was generated unless the connected image server actually returns one.",messages:history.slice(-20)})});
      if(!response.ok){let detail="";try{const j=await response.json();detail=j.error?.message||j.message||""}catch{}throw new Error(detail||"Claude endpoint returned HTTP "+response.status)}
      const data=await response.json();
      const answer=(data.content||[]).filter(x=>x.type==="text").map(x=>x.text).join("\n").trim()||"Claude returned no text.";
      bubble.textContent=answer;history.push({role:"assistant",content:answer});status.textContent="Arti is ready.";
    }catch(e){bubble.textContent="I couldn't reach Claude: "+(e.message||e);history.pop();status.textContent="Connection failed — check the key, endpoint, CORS and model name."}
    finally{$("#artiSend").disabled=false;log.scrollTop=log.scrollHeight}
  }
  $("#artiSend").onclick=send;
  input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});
  $("#artiImage").onclick=()=>{
    const prompt=input.value.trim()||history.filter(m=>m.role==="user").at(-1)?.content||"A beautiful imaginative scene";
    const imageButton=$("#flImageButton");
    if(!imageButton){status.textContent="Floof Image Studio isn't loaded. Make sure floof-upgrade.js is enabled.";return}
    const chatInput=$("#input");if(chatInput)chatInput.value="Create an image: "+prompt;
    imageButton.click();status.textContent="Image Studio opened. Check that an external image server is connected, then press Generate free image.";
  };
})();