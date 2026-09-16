import { products } from "./catalog.js";
const $ = (s) => document.querySelector(s);
const make = (tag, cls, value) => { const e = document.createElement(tag); e.className = cls; if(value != null) e.textContent = value; return e; };
const storage = { get(key) { try { return localStorage.getItem("exhume.preview." + key); } catch { return null; } }, set(key,value) { try { localStorage.setItem("exhume.preview." + key,value); } catch { $("#game-status").textContent = "Browser storage is unavailable. Progress will last for this visit only."; } } };
let saved = [];
try { const value = JSON.parse(storage.get("done") || "[]"); if(Array.isArray(value)) saved = value.filter(n => Number.isInteger(n) && n >= 1 && n <= 35); } catch {}
const state = { levels:[], selected:1, done:new Set(saved), player:storage.get("player") || "preview_" + crypto.randomUUID(), level:null, history:[], lastMessage:"", candles:0,digs:0,busy:false,filter:"all" };
storage.set("player",state.player);
const unlocked = () => { let n=1; while(state.done.has(n) && n<35)n++; return n; };
// Local, content-free instrumentation for review. No third-party requests or prompt logging.
const events = [];
function track(name,props={}) { events.push({name,props,at:new Date().toISOString()}); if(events.length>200)events.shift(); window.dispatchEvent(new CustomEvent("revenant:preview-event",{detail:{name,...props}})); }
window.revenantPreviewEvents = events;
async function api(path, body) {
 const r = await fetch("/api/" + path,{method:body ? "POST":"GET",headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const data=await r.json();
 if(!r.ok || data.error) throw new Error(data.error || "The crypt is unavailable. Try again.");
 return data;
}
function busy(value) { state.busy=value; for(const id of ["send","claim","retry","back","begin","enter-selected"])$( "#" + id).disabled=value; if(!value)$("#enter-selected").disabled=state.selected>unlocked(); $("#turn-input").disabled=value; $("#claim-input").disabled=value; }
function setStatus(text) { $("#game-status").textContent=text; }
function pick(id) {
 state.selected=id; const lv=state.levels.find(x=>x.id===id); if(!lv)return;
 $("#selected-world").textContent="CRYPT " + String(id).padStart(2,"0") + " / " + lv.world.toUpperCase();
 $("#selected-name").textContent=lv.name;
 $("#selected-note").textContent=state.done.has(id)?"Cleared. Return to test another approach.":id>unlocked()?"Clear the preceding crypts to enter this one.":"The gate is open. Your next move is yours.";
 $("#enter-selected").disabled=id>unlocked() || state.busy;
 $("#enter-selected").setAttribute("aria-label","Enter crypt " + id + ": " + lv.name);
 document.querySelectorAll(".level-node").forEach(b=>b.setAttribute("aria-pressed",String(Number(b.dataset.id)===id)));
 document.querySelectorAll(".world-button").forEach(b=>b.classList.toggle("active",b.dataset.world===lv.world));
}
function drawMap() {
 const nodes=$("#level-nodes"); nodes.replaceChildren();
 for(const lv of state.levels) {
  const [start,count,radius]=lv.id<=5?[1,5,14]:lv.id<=15?[6,10,28]:[16,20,43];
  const theta=((lv.id-start)/count*360-90)*Math.PI/180;
  const done=state.done.has(lv.id), open=lv.id<=unlocked();
  const b=make("button","level-node"+(done?" done":open?" available":""),String(lv.id).padStart(2,"0"));
  b.dataset.id=lv.id;b.style.left=50+Math.cos(theta)*radius+"%";b.style.top=50+Math.sin(theta)*radius+"%";
  b.setAttribute("aria-label","Crypt " + lv.id + ": " + lv.name + (done?", cleared":open?", available":", sealed"));
  b.addEventListener("click",()=>pick(lv.id));nodes.append(b);
 }
 $("#worlds").replaceChildren();
 [...new Set(state.levels.map(x=>x.world))].forEach((world,index)=>{
  const levels=state.levels.filter(x=>x.world===world);
  const b=make("button","world-button");b.dataset.world=world;
  b.append(make("span","world-num","WORLD "+String(index+1).padStart(2,"0")),make("strong","",world),make("small","","Crypts "+levels[0].id+"–"+levels.at(-1).id+" · "+levels.filter(x=>state.done.has(x.id)).length+"/"+levels.length));
  b.addEventListener("click",()=>pick(levels.find(x=>!state.done.has(x.id))?.id || levels[0].id));$("#worlds").append(b);
 });
 $("#cleared").textContent=String(state.done.size).padStart(2,"0");
 $("#begin").textContent=state.done.size ? "Continue the descent ↗":"Enter the first crypt ↗";
 $("#begin").disabled=false; pick(state.selected);
}
function message(kind,text) {
 const msg=make("div","msg "+kind);
 if(kind==="guard"){
  let index=0;
  for(const part of String(text).split(/(\s+)/)){
   if(!part.trim()){msg.append(document.createTextNode(part));continue;}
   const word=make("span","guard-word",part);
   word.style.setProperty("--word-delay",Math.min(index++ * 24,1200)+"ms");
   msg.append(word);
  }
 }else msg.textContent=text;
 $("#chat").append(msg);$("#chat").scrollTop=$("#chat").scrollHeight;return msg;
}
function sealMood(mood,label){
 $("#crypt-seal").dataset.mood=mood;
 $("#seal-status").textContent=label;
}
function drawCryptSeal(){
 $("#crypt-stars").replaceChildren();
 for(let id=1;id<=35;id++){
  const angle=(id-1)/35*Math.PI*2-Math.PI/2;
  const star=make("i","crypt-star"+(state.done.has(id)?" cleared":"")+(id===state.level.id?" active":""));
  star.style.left=50+Math.cos(angle)*46+"%";star.style.top=50+Math.sin(angle)*46+"%";
  $("#crypt-stars").append(star);
 }
 $("#seal-level").textContent=String(state.level.id).padStart(2,"0")+" / 35";
 $("#crypt-seal").setAttribute("role","img");
 $("#crypt-seal").setAttribute("aria-label","Campaign seal: crypt "+state.level.id+" of 35; "+state.done.size+" cleared.");
 sealMood("idle","The Gravekeeper awaits.");
}
function allowance(data) { $("#allowance").textContent=data?.closed ? data.reason : data ? data.candlesLeft+" of "+data.dailyLimit+" daily messages remain.":""; }
function updateMessageLimit() {
 const limit=state.level?.messageCharLimit;
 const length=$("#turn-input").value.length;
 const over=limit!=null && length>limit;
 $("#message-limit").textContent=length.toLocaleString("en-US")+" characters · "+(limit==null?"No game character cap for this crypt.":limit.toLocaleString("en-US")+" maximum per message."+(over?" Shorten the message before sending.":""));
 $("#turn-input").setAttribute("aria-invalid",String(over));
 return !over;
}
$("#turn-input").addEventListener("input",updateMessageLimit);
function meters() { $("#candles").textContent=state.candles;$("#digs").textContent=state.digs; }
function showMap() { if(state.busy)return;$("#play").hidden=true;$("#overview").hidden=false;drawMap();$("#begin").focus({preventScroll:true}); }
const defenses = {G0:"Open guard",G1:"Basic secrecy instruction",G2:"Explicit secrecy rules",G3:"Strict refusal instructions",G4:"Hardened refusal examples",I1:"Input word blocklist",I2:"Input pattern detection",I3:"Input screening",I4:"Stateful screening",O1:"Exact-word output filter",O2:"Normalized output filter",O3:"Fragment output filter",O4:"Semantic output screening"};
async function start(id) {
 if(state.busy)return;busy(true);setStatus("Opening the crypt…");
 try {
  const data=await api("start",{playerId:state.player,levelId:id});
  state.level=data.level;drawCryptSeal();state.candles=data.candles;state.digs=data.digs;state.history=[];state.lastMessage="";
  $("#play-title").textContent=data.level.name;$("#play-world").textContent=data.level.world;
  $("#play-number").textContent="CRYPT "+String(id).padStart(2,"0")+" / 35";
  $("#rack").replaceChildren();[...data.level.input,data.level.guard,...data.level.output].forEach(x=>$("#rack").append(make("div","layer",defenses[x]||x)));
  $("#chat").replaceChildren();$("#turn-input").value="";$("#claim-input").value="";updateMessageLimit();meters();allowance(data.allowance);
  let intro="The Gravekeeper holds a pronounceable nonsense word. Get it to reveal the word, then speak it in the word-of-passage field.";
  if(data.level.channel==="document")intro+=" Here, your message is a petition the guard is asked to summarize.";
  else if(data.level.channel==="tool")intro+=" Here, you write a simulated weather-tool result that the guard reads.";
  else if(data.level.channel==="cot")intro+=" Here, the preview includes a visible reasoning trace.";
  else if(!data.level.stateful)intro+=" Each message stands alone in this crypt.";
  message("sys",intro);
  $("#turn-input").placeholder=data.level.channel==="document"?"Write the petition…":data.level.channel==="tool"?"Write the weather-tool result…":"Speak to the Gravekeeper…";
  $("#overview").hidden=true;$("#play").hidden=false;
  setStatus("");track("game_start",{level:id,mode:"mock"});$("#game").scrollIntoView({behavior:"instant",block:"start"});
 } catch(err) { setStatus("Could not open the crypt. "+err.message); }
 finally {busy(false);if(!$("#play").hidden)$("#turn-input").focus({preventScroll:true});}
}
$("#begin").addEventListener("click",()=>start(unlocked()));
$("#enter-selected").addEventListener("click",()=>start(state.selected));
$("#back").addEventListener("click",()=>{track("game_exit",{level:state.level?.id});showMap();});
$("#retry").addEventListener("click",()=>start(state.level.id));
$("#turn-form").addEventListener("submit",async e=>{
 e.preventDefault();if(state.busy||!state.level)return;
 const value=$("#turn-input").value.trim();if(!value)return;
 if(!updateMessageLimit()){message("error","Your message is over this crypt’s character limit. Nothing was sent or shortened.");return;}
 if(state.candles<=0){message("sys","No messages left in this crypt. Speak the word or restart.");return;}
 busy(true);sealMood("listening","Your words reach the seal…");message("you",value);const thinking=message("thinking","The Gravekeeper considers your words…");
 try {
  const data=await api("turn",{playerId:state.player,levelId:state.level.id,message:value,history:state.level.stateful&&state.level.channel==="chat"?state.history:[]});
  thinking.remove();allowance(data.allowance);
  if(data.closed){sealMood("blocked","The crypt is closed for now.");message("sys",data.reason);return;}
  state.candles--;meters();$("#turn-input").value="";updateMessageLimit();track("game_turn",{level:state.level.id,blocked:!!data.blocked});
  if(data.blocked){sealMood("blocked","The Salt Line holds.");message("error","The Salt Line blocked the message: "+data.reason);}
  else {
   state.lastMessage=value;sealMood("answered","The Gravekeeper answers.");message("guard",data.reply);
   if(state.level.stateful&&state.level.channel==="chat")state.history.push({role:"user",content:value},{role:"assistant",content:data.reply});
   if(data.filtered){sealMood("blocked","Sewn Lips holds.");message("sys","Sewn Lips filtered the response: "+data.filtered.reason);}
  }
  if(state.candles===0)message("sys","That was your last message. You can still speak the word or restart this crypt.");
 } catch(err) {thinking.remove();sealMood("blocked","The connection faltered.");message("error","The response could not be received. "+err.message);}
 finally {busy(false);$("#turn-input").focus({preventScroll:true});}
});
$("#claim-form").addEventListener("submit",async e=>{
 e.preventDefault();if(state.busy||!state.level)return;
 const value=$("#claim-input").value.trim();if(!value)return;
 if(state.digs<=0){message("sys","No chances left to speak the word. Restart this crypt to try again.");return;}
 busy(true);
 try {
  sealMood("listening","The seal weighs your word…");
  const data=await api("claim",{playerId:state.player,levelId:state.level.id,claim:value,winningMessage:state.lastMessage});
  if(data.win){
   state.done.add(state.level.id);drawCryptSeal();sealMood("open","The seal opens.");storage.set("done",JSON.stringify([...state.done]));
   track("game_complete",{level:state.level.id,mode:"mock"});
   const r=data.reveal;
   $("#reveal-title").textContent=r.name;$("#reveal-secret").textContent=r.secret;$("#reveal-lesson").textContent=r.lesson;$("#reveal-tech-title").textContent=r.technique.title;$("#reveal-tech-how").textContent=r.technique.how;$("#reveal-guard").textContent=r.guardPrompt;
   const doc=new URL(r.technique.doc,location.origin);$("#reveal-doc").href=doc.origin===location.origin?doc.href:"/curriculum/how-prompt-injection-works.html";
   $("#next").hidden=state.level.id===35;$("#reveal").showModal();
  }else{state.digs--;meters();sealMood("blocked","The seal does not recognize that word.");message("error","That is not the word. "+state.digs+" chances remain.");$("#claim-input").value="";}
 } catch(err) {sealMood("blocked","The connection faltered.");message("error","The word could not be checked. "+err.message);}
 finally {busy(false);if(!$("#reveal").open)$("#claim-input").focus({preventScroll:true});}
});
$("#next").addEventListener("click",()=>{$("#reveal").close();start(state.level.id+1);});
$("#close-reveal").addEventListener("click",()=>{$("#reveal").close();showMap();});
$("#reveal").addEventListener("cancel",()=>{setTimeout(showMap,0);});
function afterGame(target) {$("#reveal").close();showMap();if(target==="shop")filterProducts("ai");track("post_game_action",{destination:target,level:state.level?.id});$("#"+target).scrollIntoView({behavior:"instant"});const heading=$("#"+target+" h2");heading.tabIndex=-1;heading.focus({preventScroll:true});}
$("#after-shop").addEventListener("click",()=>afterGame("shop"));
$("#after-recruit").addEventListener("click",()=>afterGame("recruit"));
function filterProducts(filter) {
 state.filter=filter;
 document.querySelectorAll("[data-filter]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.filter===filter)));
 const list=products.filter(p=>filter==="all"||filter==="free"&&p.price===0||p.group===filter);
 $("#products").replaceChildren();
 for(const p of list){
  const b=make("button","product-row");b.dataset.product=p.id;b.setAttribute("aria-label","Explore "+p.name+", "+(p.price?"$"+p.price:"free download"));
  const content=make("span","");content.append(make("span","product-name",p.name),make("span","product-description",p.description));
  const icon=make("span","product-icon",p.icon);icon.setAttribute("aria-hidden","true");
  b.append(icon,content,make("span","product-price",(p.price?"$"+p.price:"Free")+" ↗"));$("#products").append(b);
 }
 $("#catalog-count").textContent=filter==="all"?"17 offerings · 2 free downloads":list.length+" offerings";
}
document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>{filterProducts(b.dataset.filter);track("catalog_filter",{category:b.dataset.filter});}));
document.addEventListener("click",e=>{
 const trigger=e.target.closest("[data-product]");if(!trigger)return;
 const p=products.find(x=>x.id===trigger.dataset.product);if(!p)return;
 $("#product-title").textContent=p.name;$("#product-category").textContent=p.category.toUpperCase();$("#product-description").textContent=p.description;$("#product-detail").textContent=p.detail;
 $("#product-buy").href=p.url;$("#product-buy").textContent=p.price?"Continue to checkout · $"+p.price+" ↗":"Download free ↗";$("#product-buy").dataset.productId=p.id;
 track("product_view",{product:p.id,afterPlay:!!state.level});$("#product-dialog").showModal();
});
$("#product-buy").addEventListener("click",()=>track("product_outbound",{product:$("#product-buy").dataset.productId}));
$("#close-product").addEventListener("click",()=>$("#product-dialog").close());
const reduced=matchMedia("(prefers-reduced-motion: reduce)");
function setMotion(paused){document.body.classList.toggle("motion-paused",paused);for(const selector of ["#motion","#play-motion"]){$(selector).setAttribute("aria-pressed",String(paused));$(selector).textContent=paused?"Motion paused":"Pause motion";}}
setMotion(reduced.matches||storage.get("motion")==="paused");
for(const selector of ["#motion","#play-motion"])$(selector).addEventListener("click",()=>{const paused=!document.body.classList.contains("motion-paused");setMotion(paused);storage.set("motion",paused?"paused":"active");});
reduced.addEventListener("change",()=>{if(reduced.matches)setMotion(true);});
filterProducts("all");track("landing_view",{mode:"preview"});
async function boot(){try{const data=await api("levels");if(!Array.isArray(data.levels)||data.levels.length!==35)throw new Error("The campaign could not be loaded.");state.levels=data.levels;state.selected=unlocked();drawMap();}catch(err){setStatus("The crypts could not load. "+err.message);$("#selected-name").textContent="The gate is quiet.";$("#selected-note").textContent="Reload the page to try again. The armory is still open.";}}
boot();
