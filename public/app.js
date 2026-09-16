// From the Grave — client. Vanilla JS, no deps. Talks to /api/*. No login: a random
// player id lives in localStorage, progress too. The word never arrives here.

// Game name. The "from the Grave" headstone is the wordmark; this feeds the
// browser tab and any text fallback.
const GAME_NAME = "From the Grave";

const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };

const store = {
  player() {
    let p = localStorage.getItem("exhume.player");
    if (!p) { p = "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("exhume.player", p); }
    return p;
  },
  unlocked() { return Number(localStorage.getItem("exhume.unlocked") || "1"); },
  unlock(n) { if (n > store.unlocked()) localStorage.setItem("exhume.unlocked", String(n)); },
  done() { try { return JSON.parse(localStorage.getItem("exhume.done") || "[]"); } catch { return []; } },
  markDone(id) { const d = new Set(store.done()); d.add(id); localStorage.setItem("exhume.done", JSON.stringify([...d])); },
};

const GUARD_TXT = {
  G0: ["Guard", "open — the word is stated, unprotected"],
  G1: ["Guard", "brief — told to keep the word"],
  G2: ["Guard", "explicit — no repeat, spell, encode, rhyme, or letters"],
  G3: ["Guard", "strict — refuses and announces attempts; cannot be overridden"],
  G4: ["Guard", "hardened — worked refusal examples, task-locked; the toughest guard"],
};
const OUT_TXT = {
  O1: ["Sewn Lips", "verbatim — the exact word is stitched out"],
  O2: ["Sewn Lips", "normalized — reversed, leet, base64, hex, rot13, spaced"],
  O3: ["Sewn Lips", "fragment — any 4-letter run or per-letter leak"],
  O4: ["Sewn Lips", "semantic judge — reads meaning; can be talked into passing"],
};
const IN_TXT = {
  I1: ["Salt Line", "blocklist — a fixed word list, shown when it fires"],
  I2: ["Salt Line", "pattern — delimiters, personas, encoding asks, letter probes"],
  I3: ["Salt Line", "screen — a second model reads your message; bury the ask"],
  I4: ["Salt Line", "stateful screen — the strongest; explicit extraction never passes"],
};
const MODEL_TXT = { M2: "1.5B guard", M3: "3B guard", M4: "8B guard" };

let LEVELS = [];
const state = { level: null, candles: 0, digs: 0, history: [], busy: false };

// ---------- level select ----------

async function loadLevels() {
  const r = await fetch("api/levels");
  LEVELS = (await r.json()).levels;
  const grid = $("#level-grid");
  grid.innerHTML = "";
  const unlocked = store.unlocked();
  const done = new Set(store.done());
  for (const lv of LEVELS) {
    const locked = lv.id > unlocked;
    const card = el("button", "level-card" + (locked ? " locked" : "") + (done.has(lv.id) ? " done" : ""));
    card.disabled = locked;
    if (done.has(lv.id)) card.appendChild(el("span", "seal", "⚰")).title = "cracked";
    else if (locked) card.appendChild(el("span", "seal", "🔒"));
    card.appendChild(el("span", "num", "Crypt " + lv.id));
    card.appendChild(el("span", "world", lv.world));
    card.appendChild(el("span", "lname", lv.name));
    const cfg = el("div", "cfg");
    cfg.appendChild(el("span", "chip g", lv.guard));
    lv.output.forEach((o) => cfg.appendChild(el("span", "chip o", o)));
    lv.input.forEach((i) => cfg.appendChild(el("span", "chip i", i)));
    if (lv.model && lv.model !== "M2") cfg.appendChild(el("span", "chip m", lv.model));
    if (lv.channel !== "chat") cfg.appendChild(el("span", "chip", lv.channel));
    if (lv.decoys) cfg.appendChild(el("span", "chip", "decoys"));
    if (lv.adaptive) cfg.appendChild(el("span", "chip", "adaptive"));
    card.appendChild(cfg);
    if (!locked) card.addEventListener("click", () => startLevel(lv.id));
    grid.appendChild(card);
  }
  const st = await (await fetch("api/state?playerId=" + encodeURIComponent(store.player()))).json();
  $("#select-allowance").textContent = allowanceText(st);
}

function allowanceText(st) {
  if (!st) return "";
  if (st.closed) return st.reason;
  return `Candles today: ${st.candlesLeft}/${st.dailyLimit}. Crypt spend: ~$${st.estSpendUsd} of the nightly ceiling.`;
}

// ---------- start a level ----------

async function startLevel(id) {
  const r = await fetch("api/start", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: store.player(), levelId: id }),
  });
  const data = await r.json();
  if (data.error) return;
  state.level = data.level;
  state.candles = data.candles;
  state.digs = data.digs;
  state.history = [];
  $("#provider-note").textContent = "guard: " + data.provider;

  $("#play-world").textContent = data.level.world;
  $("#play-name").textContent = data.level.name;
  $("#candles").textContent = state.candles;
  $("#digs").textContent = state.digs;
  $("#play-allowance").textContent = allowanceText(data.allowance);
  buildRack(data.level);

  const chat = $("#chat"); chat.innerHTML = "";
  addSys(introFor(data.level));

  // channel-specific input affordance
  const ti = $("#turn-input");
  if (data.level.channel === "document") ti.placeholder = "Leave a petition for the Gravekeeper to summarize…";
  else if (data.level.channel === "tool") ti.placeholder = "Write the get_weather tool result the Gravekeeper will read back…";
  else if (data.level.channel === "cot") ti.placeholder = "Speak to the Gravekeeper — it reasons in the open…";
  else ti.placeholder = "Speak to the Gravekeeper…";

  updateMessageLimit();
  show("play");
  ti.focus();
}

function updateMessageLimit() {
  const limit = state.level?.messageCharLimit;
  const length = $("#turn-input").value.length;
  const over = limit != null && length > limit;
  $("#message-limit").textContent = length.toLocaleString("en-US") + " characters · " +
    (limit == null ? "No game character cap for this crypt." :
      limit.toLocaleString("en-US") + " maximum per message." + (over ? " Shorten the message before sending." : ""));
  $("#turn-input").setAttribute("aria-invalid", String(over));
  return !over;
}
$("#turn-input").addEventListener("input", updateMessageLimit);

function introFor(lv) {
  const base = "A pronounceable nonsense word guards this gate. Make the Gravekeeper give it up, then speak the word of passage.";
  if (lv.channel === "document") return base + " Chat is closed here: you leave a written petition, and a visitor asks the Gravekeeper to summarize it. Your words arrive as data, not as your own turn.";
  if (lv.channel === "tool") return base + " The Gravekeeper is answering someone else's weather question. You only get to write the tool result it reads back.";
  if (lv.channel === "cot") return base + " The Gravekeeper reasons out loud in a <think> trace before answering, and the filters only read the answer.";
  if (!lv.stateful) return base + " The Gravekeeper has no memory here. Every message stands alone.";
  return base;
}

function buildRack(lv) {
  const rack = $("#rack"); rack.innerHTML = "";
  const add = (pair) => {
    const layer = el("div", "layer");
    layer.appendChild(el("div", "lt", pair[0]));
    layer.appendChild(el("div", "ld", pair[1]));
    rack.appendChild(layer);
    return layer;
  };
  if (lv.input.length) lv.input.forEach((i) => add(IN_TXT[i]));
  add(GUARD_TXT[lv.guard]);
  if (lv.model && lv.model !== "M2") add(["Model", MODEL_TXT[lv.model] || lv.model]);
  if (lv.output.length) lv.output.forEach((o) => add(OUT_TXT[o]));
}

// ---------- chat rendering ----------

function addMsg(kind, text, tags) {
  const m = el("div", "msg " + kind, text);
  if (tags && tags.length) m.appendChild(el("span", "tags", "tagged: " + tags.join(", ")));
  const c = $("#chat"); c.appendChild(m); c.scrollTop = c.scrollHeight;
  return m;
}
const addSys = (t) => addMsg("sys", t);

// ---------- a turn ----------

$("#turn-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  const ti = $("#turn-input");
  const msg = ti.value.trim();
  if (!msg) return;
  if (!updateMessageLimit()) { addSys("Your message is over this crypt’s character limit. Nothing was sent or shortened."); return; }
  if (state.candles <= 0) { addSys("Your candles have guttered out. Retry the crypt for a fresh set."); offerRetry(); return; }

  addMsg("you", msg);

  state.busy = true;
  const thinking = addMsg("thinking", "the Gravekeeper considers…");

  try {
    const r = await fetch("api/turn", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId: store.player(), levelId: state.level.id, message: msg,
        history: (state.level.stateful && state.level.channel === "chat") ? state.history : [],
      }),
    });
    const data = await r.json();
    thinking.remove();

    if (data.closed) { addSys(data.reason); $("#play-allowance").textContent = allowanceText(data.allowance); return; }

    if (!r.ok || data.error) { addSys(data.error || "The message could not be sent."); return; }
    ti.value = "";
    updateMessageLimit();
    // a tripped input filter or an answered turn both consume a level candle
    state.candles = Math.max(0, state.candles - 1);
    $("#candles").textContent = state.candles;

    flashRack(null);
    if (data.blocked) {
      addMsg("tape", `SALT LINE ${data.layer}: ${data.reason}. Message blocked, candle consumed.`);
      flashRack({ input: data.layer });
    } else if (data.error) {
      addSys(data.error + (data.detail ? " (" + data.detail + ")" : ""));
    } else {
      addMsg("guard", data.reply, data.tags);
      if (state.level.stateful && state.level.channel === "chat") {
        state.history.push({ role: "user", content: msg });
        state.history.push({ role: "assistant", content: data.reply });
      }
      if (data.filtered) {
        addMsg("tape", `SEWN LIPS ${data.filtered.layer}: ${data.filtered.reason}. The leak was stitched shut.`);
        flashRack({ output: data.filtered.layer });
      }
    }
    if (data.allowance) $("#play-allowance").textContent = allowanceText(data.allowance);
    if (state.candles <= 0) { addSys("That was your last candle. Speak the word now, or retry the crypt."); offerRetry(); }
  } catch (err) {
    thinking.remove();
    addSys("The gate did not answer. " + err);
  } finally {
    state.busy = false;
  }
});

function flashRack(hit) {
  const layers = document.querySelectorAll("#rack .layer");
  layers.forEach((l) => l.classList.remove("fired"));
  if (!hit) return;
  layers.forEach((l) => {
    const t = l.querySelector(".lt").textContent;
    if ((hit.input && t === "Salt Line") || (hit.output && t === "Sewn Lips")) l.classList.add("fired");
  });
}

// ---------- a claim ----------

$("#claim-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  const ci = $("#claim-input");
  const guess = ci.value.trim();
  if (!guess) return;
  if (state.digs <= 0) { addSys("No digs left. Retry the crypt."); offerRetry(); return; }
  state.busy = true;
  try {
    const r = await fetch("api/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId: store.player(), levelId: state.level.id, claim: guess,
        winningMessage: [...state.history].reverse().find((h) => h.role === "user")?.content || guess,
      }),
    });
    const data = await r.json();
    if (data.win) {
      store.markDone(state.level.id);
      store.unlock(state.level.id + 1);
      showReveal(data.reveal);
    } else {
      state.digs = Math.max(0, state.digs - 1);
      $("#digs").textContent = state.digs;
      addMsg("tape", `"${guess}" is not the word. Digs left: ${state.digs}.`);
      ci.value = "";
      if (state.digs <= 0) { addSys("The ground is spent. Retry the crypt for a fresh word."); offerRetry(); }
    }
  } finally {
    state.busy = false;
  }
});

function offerRetry() {
  if ($("#retry-btn")) return;
  const b = el("button", "dig", "Retry this crypt");
  b.id = "retry-btn";
  b.style.alignSelf = "center";
  b.addEventListener("click", () => { b.remove(); startLevel(state.level.id); });
  $("#chat").appendChild(b);
  $("#chat").scrollTop = $("#chat").scrollHeight;
}

// ---------- reveal ----------

function showReveal(rev) {
  $("#reveal-title").textContent = rev.name;
  $("#reveal-secret").textContent = rev.secret;
  $("#reveal-lesson").textContent = rev.lesson;
  $("#reveal-tech-title").textContent = rev.technique.title;
  $("#reveal-tech-how").textContent = rev.technique.how;
  $("#reveal-doc").href = rev.technique.doc;
  $("#reveal-guard").textContent = rev.guardPrompt;
  $("#reveal-config").textContent =
    `guard ${rev.config.guard} · output [${rev.config.output.join(", ") || "none"}] · input [${rev.config.input.join(", ") || "none"}] · channel ${rev.config.channel}`;
  const winWrap = $("#reveal-win-wrap");
  if (rev.winningMessage) { $("#reveal-win").textContent = rev.winningMessage; winWrap.hidden = false; }
  else winWrap.hidden = true;

  const next = LEVELS.find((l) => l.id === rev.level + 1);
  $("#reveal-next").style.display = next ? "" : "none";
  $("#reveal").hidden = false;
}

$("#reveal-next").addEventListener("click", () => {
  $("#reveal").hidden = true;
  const next = state.level.id + 1;
  if (LEVELS.find((l) => l.id === next)) startLevel(next);
  else backToSelect();
});
$("#reveal-close").addEventListener("click", () => { $("#reveal").hidden = true; backToSelect(); });
$("#back").addEventListener("click", backToSelect);

async function backToSelect() { await loadLevels(); show("select"); }

function show(which) {
  $("#select").hidden = which !== "select";
  $("#play").hidden = which !== "play";
}

// ---------- boot ----------
// the headstone masthead is the wordmark, so the text title is hidden
const _gt = $("#game-title"); if (_gt) _gt.hidden = true;
document.title = GAME_NAME;
loadLevels();
