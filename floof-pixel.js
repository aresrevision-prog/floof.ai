/* Floof Micro-Pixel Studio — pixel art generation prompts + editable sprite canvas. */
(()=>{"use strict";
if(window.__floofPixelStudio)return;window.__floofPixelStudio=true;
const $=s=>document.querySelector(s);
const style=document.createElement("style");style.textContent=`
#floofPixel{display:none;position:fixed;inset:0;z-index:150;background:#050b18f5;padding:12px;align-items:center;justify-content:center;color:#f4f0ff}
#floofPixel.on{display:flex}#floofPixel .fp-card{width:min(1050px,100%);height:min(94vh,900px);display:flex;flex-direction:column;gap:10px;padding:14px;background:#111629;border:1px solid #46577e;border-radius:16px;box-sizing:border-box}
#floofPixel button,#floofPixel select,#floofPixel input{background:#202b45;color:#f4f0ff;border:1px solid #52648d;border-radius:8px;padding:7px 10px}
#floofPixel button{cursor:pointer}#floofPixel button.active{border-color:#8cf0c0;background:#24513f}
#floofPixel .fp-tools{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
#floofPixel .fp-main{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:12px;flex:1;min-height:0}
#floofPixel .fp-stage{min-height:0;display:grid;place-items:center;background:#090e1b;border:1px solid #34405f;border-radius:12px;padding:10px;overflow:auto}
#floofPixel canvas{width:min(100%,640px);height:auto;max-height:100%;aspect-ratio:1;object-fit:contain;image-rendering:pixelated;touch-action:none;background-color:#fff;background-image:linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
#floofPixel .fp-side{display:flex;flex-direction:column;gap:9px;overflow:auto}.fp-palette{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.fp-swatch{height:28px;padding:0!important;border-radius:6px!important}
#floofPixel textarea{width:100%;min-height:84px;resize:vertical;box-sizing:border-box;background:#090e1b;color:#f4f0ff;border:1px solid #46577e;border-radius:8px;padding:9px}
#floofPixel .fp-muted{font-size:12px;color:#b7c2df}
@media(max-width:700px){#floofPixel .fp-main{grid-template-columns:1fr;grid-template-rows:minmax(220px,1fr) auto}#floofPixel .fp-card{height:96vh;padding:9px}#floofPixel .fp-side{max-height:190px}}
`;document.head.appendChild(style);
const modal=document.createElement("section");modal.id="floofPixel";modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
modal.innerHTML=`<div class="fp-card"><header style="display:flex;align-items:center;gap:10px"><div style="flex:1"><b style="font-size:19px">🧩 Floof Micro-Pixel Studio</b><div class="fp-muted">Generate tiny-pixel art with Floof, then import it here to edit every pixel.</div></div><button id="fpClose">✕</button></header>
<div class="fp-tools"><label class="fp-muted">Canvas <select id="fpSize"><option>16</option><option>24</option><option selected>32</option><option>48</option><option>64</option><option>96</option></select> px</label><button id="fpBrush" class="active">✏️ Pencil</button><button id="fpErase">◻ Eraser</button><button id="fpFill">🪣 Fill</button><button id="fpClear">Clear</button><button id="fpUndo">Undo</button><button id="fpDownload" class="active">⬇ PNG</button></div>
<div class="fp-main"><div class="fp-stage"><canvas id="fpCanvas" width="32" height="32" aria-label="Pixel drawing canvas"></canvas></div><aside class="fp-side"><b>🎨 Colour palette</b><div class="fp-palette" id="fpPalette"></div><label class="fp-muted">Custom colour <input id="fpColor" type="color" value="#17213b" style="width:100%;height:36px;padding:2px"></label><label class="fp-muted">Describe your art for Floof image generation<textarea id="fpPrompt" placeholder="A tiny moonlit fox wizard, teal cloak, golden stars, clean 32-bit pixel sprite…"></textarea></label><button id="fpGenerate" class="active">✨ Generate micro-pixel art</button><button id="fpImport">Import latest generated image</button><div class="fp-muted" id="fpStatus" role="status">Draw with mouse, touch or stylus. Use Import after generating to turn an image into editable pixels.</div><button id="fpSend">Use this prompt in Image Studio</button></aside></div></div>`;
document.body.appendChild(modal);
const canvas=$("#fpCanvas"),ctx=canvas.getContext("2d",{willReadFrequently:true}),size=$("#fpSize"),color=$("#fpColor"),status=$("#fpStatus");
const palette=["#17213b","#293f66","#426b83","#70a6a0","#b6d7b0","#f4e6b5","#e8a66a","#d46b62","#9b527b","#eee9df","#ffffff","#000000","#5a3c8c","#e7cb45","#4b9b68"];
let tool="brush",drawing=false,history=[],pixels=new Array(32*32).fill("rgba(0,0,0,0)"),chosen=color.value;
const snapshot=()=>{history.push({size:canvas.width,pixels:[...pixels]});if(history.length>30)history.shift()};
function paint(){ctx.clearRect(0,0,canvas.width,canvas.height);pixels.forEach((c,i)=>{if(c&&c!=="rgba(0,0,0,0)"){ctx.fillStyle=c;ctx.fillRect(i%canvas.width,Math.floor(i/canvas.width),1,1)}})}
function reset(n){canvas.width=canvas.height=n;pixels=new Array(n*n).fill("rgba(0,0,0,0)");history=[];paint()}
function pos(e){const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(canvas.width-1,Math.floor((e.clientX-r.left)*canvas.width/r.width))),Math.max(0,Math.min(canvas.height-1,Math.floor((e.clientY-r.top)*canvas.height/r.height)))]}
function put(x,y,c){pixels[y*canvas.width+x]=c;paint()}
function flood(x,y,replacement){const target=pixels[y*canvas.width+x];if(target===replacement)return;const stack=[[x,y]],seen=new Set();while(stack.length){const [a,b]=stack.pop(),k=b*canvas.width+a;if(a<0||b<0||a>=canvas.width||b>=canvas.height||seen.has(k)||pixels[k]!==target)continue;seen.add(k);pixels[k]=replacement;stack.push([a+1,b],[a-1,b],[a,b+1],[a,b-1])}paint()}
function act(e){const [x,y]=pos(e);if(tool==="fill"){snapshot();flood(x,y,chosen);return}if(!drawing)return;put(x,y,tool==="erase"?"rgba(0,0,0,0)":chosen)}
canvas.addEventListener("pointerdown",e=>{e.preventDefault();canvas.setPointerCapture(e.pointerId);if(tool==="fill"){snapshot();act(e)}else{snapshot();drawing=true;act(e)}});
canvas.addEventListener("pointermove",e=>{if(drawing)act(e)});canvas.addEventListener("pointerup",()=>drawing=false);canvas.addEventListener("pointercancel",()=>drawing=false);
function chooseTool(t){tool=t;["fpBrush","fpErase","fpFill"].forEach((id,i)=>$("#"+id).classList.toggle("active",["brush","erase","fill"][i]===t))}
$("#fpBrush").onclick=()=>chooseTool("brush");$("#fpErase").onclick=()=>chooseTool("erase");$("#fpFill").onclick=()=>chooseTool("fill");
$("#fpPalette").innerHTML=palette.map(c=>'<button class="fp-swatch" type="button" data-color="'+c+'" style="background:'+c+'" aria-label="Select '+c+'"></button>').join("");
$("#fpPalette").addEventListener("click",e=>{const b=e.target.closest("[data-color]");if(!b)return;chosen=b.dataset.color;color.value=chosen;chooseTool("brush")});
color.oninput=()=>{chosen=color.value;chooseTool("brush")};
size.onchange=()=>reset(Number(size.value));
$("#fpClear").onclick=()=>{snapshot();pixels.fill("rgba(0,0,0,0)");paint()};
$("#fpUndo").onclick=()=>{const prev=history.pop();if(!prev)return;canvas.width=canvas.height=prev.size;pixels=prev.pixels;paint()};
$("#fpDownload").onclick=()=>{const out=document.createElement("canvas");out.width=out.height=canvas.width;const o=out.getContext("2d");o.imageSmoothingEnabled=false;pixels.forEach((c,i)=>{if(c!=="rgba(0,0,0,0)"){o.fillStyle=c;o.fillRect(i%canvas.width,Math.floor(i/canvas.width),1,1)}});const a=document.createElement("a");a.href=out.toDataURL("image/png");a.download="floof-micro-pixel-art.png";a.click()};
function importLatest(){const img=$("#flImagePreview");if(!img?.src||img.src==="") {status.textContent="Generate an image in Image Studio first.";return}if(!img.complete||!img.naturalWidth){status.textContent="No generated image is ready yet.";return}snapshot();const n=canvas.width,tmp=document.createElement("canvas");tmp.width=tmp.height=n;const t=tmp.getContext("2d",{willReadFrequently:true});t.imageSmoothingEnabled=false;t.drawImage(img,0,0,n,n);const d=t.getImageData(0,0,n,n).data;const colors=palette;pixels=Array.from({length:n*n},(_,i)=>{const a=d[i*4+3];if(a<30)return "rgba(0,0,0,0)";let best=colors[0],dist=Infinity;for(const c of colors){const rr=parseInt(c.slice(1,3),16),gg=parseInt(c.slice(3,5),16),bb=parseInt(c.slice(5,7),16),dr=d[i*4]-rr,dg=d[i*4+1]-gg,db=d[i*4+2]-bb,dd=dr*dr+dg*dg+db*db;if(dd<dist){dist=dd;best=c}}return best});paint();status.textContent="Imported and quantised to "+n+"×"+n+" editable pixels."}
$("#fpImport").onclick=importLatest;
const micro="micro-pixel art, ultra-crisp individually readable tiny square pixels, deliberate pixel clusters, finely detailed pixel shading and dithering, limited cohesive retro video-game palette, clean hard pixel edges, no anti-aliasing, no blur, no smooth gradients, polished sprite-art composition";
function fullPrompt(){return [micro,$("#fpPrompt").value.trim()].filter(Boolean).join(", ")}
function open(){modal.classList.add("on")}
$("#fpClose").onclick=()=>modal.classList.remove("on");modal.addEventListener("click",e=>{if(e.target===modal)modal.classList.remove("on")});document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.classList.contains("on"))modal.classList.remove("on")});
$("#fpGenerate").onclick=()=>{const p=fullPrompt();if(!$("#flImageButton")){status.textContent="Floof Image Studio has not loaded yet.";return}$("#input").value="Create a micro-pixel art image: "+p;$("#flImageButton").click();status.textContent="Image Studio opened with Floof's micro-pixel art prompt. Connect your image server and press Generate."};
$("#fpSend").onclick=()=>{const p=fullPrompt();if(!$("#flImageButton")){status.textContent="Floof Image Studio has not loaded yet.";return}$("#input").value="Create a micro-pixel art image: "+p;$("#flImageButton").click();status.textContent="Prompt sent to Floof Image Studio."};
function addButton(){const anchor=$("#artiCodeOpen")||$("#artiImage");if(!anchor||$("#floofPixelOpen"))return false;const b=document.createElement("button");b.id="floofPixelOpen";b.type="button";b.textContent="🧩 Micro-Pixel Studio";b.onclick=open;anchor.insertAdjacentElement("afterend",b);return true}
if(!addButton()){const obs=new MutationObserver(()=>{if(addButton())obs.disconnect()});obs.observe(document.body,{childList:true,subtree:true})}
reset(32);
})();