/* Arti Offline Code Builder — local editor, preview, save and export. */
(() => {
  "use strict";
  if (window.__artiCodeBuilderLoaded) return;
  window.__artiCodeBuilderLoaded = true;
  const $ = (s, root=document) => root.querySelector(s);
  const state = { active:"html", files:{html:"<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>My project</title>\n</head>\n<body>\n  <main>\n    <h1>Hello from Arti!</h1>\n    <p>Edit the HTML, CSS and JavaScript, then press Run.</p>\n    <button id=\"helloBtn\">Click me</button>\n  </main>\n</body>\n</html>","css":"body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n  background: #f5f3ff;\n  color: #241b3b;\n}\nmain { max-width: 42rem; margin: auto; }\nbutton { padding: .7rem 1rem; border: 0; border-radius: .6rem; background: #7654d6; color: white; cursor: pointer; }","js":"document.querySelector('#helloBtn')?.addEventListener('click', () => {\n  alert('Your offline project works!');\n});"},python:"# Python files can be edited and downloaded here.\n# Running Python needs a separate local Python runtime.\nprint('Hello from Arti!')"} };
  const style=document.createElement("style");
  style.textContent=`
  #artiCodeModal{display:none;position:fixed;inset:0;z-index:140;background:#050510f2;padding:12px;align-items:center;justify-content:center}
  #artiCodeModal.on{display:flex}
  #artiCodeModal .ac-card{width:min(1180px,100%);height:min(900px,96vh);display:flex;flex-direction:column;gap:9px;padding:14px;background:#111020;color:#f5f1ff;border:1px solid #594783;border-radius:16px;box-sizing:border-box}
  #artiCodeModal button,#artiCodeModal select{background:#292340;color:#f5f1ff;border:1px solid #5a4c80;border-radius:8px;padding:8px 11px;cursor:pointer}
  #artiCodeModal button.primary{background:#a58aff;color:#171126;font-weight:800}
  #artiCodeModal .ac-work{display:grid;grid-template-columns:1fr 1fr;gap:10px;flex:1;min-height:0}
  #artiCodeModal textarea{width:100%;height:100%;min-height:200px;resize:none;box-sizing:border-box;background:#090914;color:#e9e2ff;border:1px solid #40365e;border-radius:10px;padding:12px;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2}
  #artiCodeModal iframe{width:100%;height:100%;min-height:200px;background:white;border:1px solid #40365e;border-radius:10px}
  #artiCodeModal .ac-muted{font-size:12px;color:#c4b9e8}
  @media(max-width:700px){#artiCodeModal .ac-work{grid-template-columns:1fr;grid-template-rows:1fr 1fr}#artiCodeModal .ac-card{height:96vh;padding:9px}}
  `;
  document.head.appendChild(style);
  const modal=document.createElement("section");
  modal.id="artiCodeModal";modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
  modal.innerHTML=`<div class="ac-card">
    <header style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div style="flex:1"><b style="font-size:19px">⌨️ Arti Offline Code Builder</b><div class="ac-muted">Edits stay in this browser. No account or API required.</div></div><button id="acClose">✕ Close</button></header>
    <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
      <select id="acFile" aria-label="Choose file"><option value="html">index.html</option><option value="css">style.css</option><option value="js">script.js</option><option value="python">main.py</option></select>
      <select id="acTemplate" aria-label="Starter template"><option value="">Starter templates…</option><option value="blank">Blank web page</option><option value="landing">Landing page</option><option value="game">Clicker game</option></select>
      <button class="primary" id="acRun">▶ Run preview</button><button id="acSave">Save locally</button><button id="acDownload">Download current file</button><button id="acExport">Export project files</button>
    </div>
    <div class="ac-work"><div style="min-height:0;display:flex;flex-direction:column;gap:6px"><b id="acFilename">index.html</b><textarea id="acEditor" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></div><div style="min-height:0;display:flex;flex-direction:column;gap:6px"><b>Live preview</b><iframe id="acPreview" title="Project preview" sandbox="allow-scripts"></iframe></div></div>
    <div class="ac-muted" id="acStatus" role="status">Offline workspace ready. Python is editable/exportable, but not executable in this browser.</div>
    <div class="ac-muted">Safety: preview runs in a sandboxed frame. Avoid pasting secrets or untrusted code into projects.</div>
  </div>`;
  document.body.appendChild(modal);
  const editor=$("#acEditor",modal),file=$("#acFile",modal),status=$("#acStatus",modal),preview=$("#acPreview",modal);
  const storageKey="floof.arti.codebuilder.v1";
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||"null");if(saved?.files)Object.assign(state.files,saved.files)}catch{}
  function sync(){state.files[state.active]=editor.value}
  function showFile(){state.active=file.value;editor.value=state.files[state.active];$("#acFilename",modal).textContent=({html:"index.html",css:"style.css",js:"script.js",python:"main.py"})[state.active]}
  file.addEventListener("change",()=>{sync();showFile()});
  function run(){sync();const html=state.files.html.replace(/<\/head>/i,`<style>\n${state.files.css}\n</style>\n</head>`).replace(/<\/body>/i,`<script>\ntry {\n${state.files.js}\n} catch(e) { console.error(e); }\n${"</scr" + "ipt>"}\n</body>`);preview.srcdoc=html;status.textContent="Preview refreshed. External network resources may not work offline."}
  function save(){sync();try{localStorage.setItem(storageKey,JSON.stringify({files:state.files,savedAt:new Date().toISOString()}));status.textContent="✓ Project saved in this browser on this device."}catch(e){status.textContent="Could not save locally — browser storage may be full or blocked."}}
  function download(name,content){const blob=new Blob([content],{type:"text/plain;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  const templates={
    blank:{html:"<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>New project</title></head>\n<body><h1>New project</h1></body>\n</html>",css:"body { font-family: system-ui, sans-serif; padding: 2rem; }",js:""},
    landing:{html:"<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>My landing page</title></head>\n<body><header><h1>Build something brilliant.</h1><p>A simple page made with Arti.</p><a class=\"cta\" href=\"#about\">Learn more</a></header><section id=\"about\"><h2>About this project</h2><p>Replace this text with your idea.</p></section></body>\n</html>",css:"body{margin:0;font-family:system-ui,sans-serif;color:#211b35}header{padding:5rem 2rem;text-align:center;background:linear-gradient(135deg,#e7ddff,#f8e7ff)}h1{font-size:clamp(2rem,6vw,4rem)}.cta{display:inline-block;padding:.8rem 1.2rem;border-radius:2rem;background:#6545bd;color:white;text-decoration:none}section{max-width:48rem;margin:3rem auto;padding:0 1rem}",js:""},
    game:{html:"<!doctype html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Clicker game</title></head><body><main><h1>Clicker game</h1><p>Score: <strong id=\"score\">0</strong></p><button id=\"click\">Click me!</button></main></body></html>",css:"body{font-family:system-ui,sans-serif;text-align:center;padding:3rem;background:#f2edff}button{font-size:1.2rem;padding:1rem 2rem;border:0;border-radius:1rem;background:#704ed0;color:white;cursor:pointer}",js:"let score=0;document.querySelector('#click').addEventListener('click',()=>{score++;document.querySelector('#score').textContent=score})"}
  };
  $("#acRun",modal).onclick=run;
  $("#acSave",modal).onclick=save;
  $("#acDownload",modal).onclick=()=>{sync();const names={html:"index.html",css:"style.css",js:"script.js",python:"main.py"};download(names[state.active],state.files[state.active]);status.textContent="Downloaded "+names[state.active]};
  $("#acExport",modal).onclick=()=>{sync();Object.entries({ "index.html":state.files.html,"style.css":state.files.css,"script.js":state.files.js,"main.py":state.files.python,"README.txt":"Arti Offline Code Builder project.\nOpen index.html in a browser.\nPython source is included but requires Python to run.\n"}).forEach(([n,c])=>download(n,c));status.textContent="Exported project files as separate downloads."};
  $("#acTemplate",modal).onchange=e=>{const t=templates[e.target.value];if(!t)return;Object.assign(state.files,t);showFile();run();e.target.value="";status.textContent="Starter template loaded. Save when ready."};
  $("#acClose",modal).onclick=()=>{sync();modal.classList.remove("on")};
  modal.addEventListener("click",e=>{if(e.target===modal)modal.classList.remove("on")});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.classList.contains("on"))modal.classList.remove("on")});
  const addButton=()=>{const imageButton=$("#artiImage");if(!imageButton)return false;const b=document.createElement("button");b.type="button";b.id="artiCodeOpen";b.textContent="⌨️ Offline Code Builder";b.onclick=()=>{modal.classList.add("on");showFile();run()};imageButton.insertAdjacentElement("afterend",b);return true};
  if(!addButton()){const obs=new MutationObserver(()=>{if(addButton())obs.disconnect()});obs.observe(document.body,{childList:true,subtree:true})}
  showFile();
})();