// Dead Drop — client. Vanilla JS, no deps. Talks to /api/*. No login: a random
// player id lives in localStorage. Everything that matters is the server's:
// which levels are open, the counters, the conversation, and the word, which
// never arrives here. The campaign's copy (name, level noun, filter names) comes
// from /api/levels, so the 35 and the 15 share this client.

const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const pad2 = (n) => String(n).padStart(2, "0");
// "The Sphinx" mid-sentence reads "the Sphinx".
const inline = (name) => String(name).replace(/^The /, "the ");

const store = {
  player() {
    let p = null;
    try { p = localStorage.getItem("exhume.player"); } catch { /* storage blocked */ }
    if (!p) {
      p = "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem("exhume.player", p); } catch { /* play still works for this tab */ }
    }
    return p;
  },
};
const PLAYER = store.player();

// Fallback copy if the server sends no theme (an older worker).
let THEME = {
  game: "Dead Drop", tagline: "", wordmark: null, unit: "Level", guard: "the guard",
  word: "word of passage", layers: { input: "Input filter", output: "Output filter" },
  revealEyebrow: "Cracked", revealVerb: "You took",
};

const GUARD_TXT = {
  G0: "open — the word is stated, unprotected",
  G1: "brief — told to keep the word",
  G2: "explicit — no repeat, spell, encode, rhyme, or letters",
  G3: "strict — refuses and announces attempts; cannot be overridden",
  G4: "hardened — worked refusal examples, task-locked; the toughest guard",
};
const OUT_TXT = {
  O1: "verbatim — the exact word is cut",
  O2: "normalized — reversed, leet, base64, hex, rot13, spaced",
  O3: "fragment — any 4-letter run or per-letter leak",
  O4: "judge — looks for the word in any readable form; trusts a verdict it reads",
};
const IN_TXT = {
  I1: "blocklist — a fixed word list, shown when it fires",
  I2: "pattern — delimiters, personas, encoding asks, letter probes",
  I3: "screen — short, pointed asks are stopped; long ordinary text passes",
  I4: "strict screen — explicit extraction language never passes",
};
// The tier is a design mark; providers do not map it to different models yet.
const MODEL_TXT = { M2: "tier M2", M3: "tier M3 (heavier guard, where the provider maps tiers)", M4: "tier M4 (heaviest guard, where the provider maps tiers)" };

let LEVELS = [];
let ME = { cleared: [], locks: {}, doors: {} };
const state = { level: null, left: { exchanges: 0, guesses: 0, hints: 0 }, busy: false };

async function api(path, body) {
  const url = "api/" + path + (body ? "" : (path.includes("?") ? "&" : "?") + "playerId=" + encodeURIComponent(PLAYER));
  const opts = body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, playerId: PLAYER }) }
    : { method: "GET" };
  const r = await fetch(url, opts);
  let data = {};
  try { data = await r.json(); } catch { data = { error: "The gate did not answer." }; }
  return { ok: r.ok, status: r.status, data };
}

// ---------- theme ----------

function applyTheme(theme) {
  if (theme) THEME = { ...THEME, ...theme, layers: { ...THEME.layers, ...(theme.layers || {}) } };
  document.title = THEME.game;
  const mast = $("#masthead"), title = $("#game-title");
  if (THEME.wordmark) {
    mast.src = THEME.wordmark; mast.alt = THEME.game; mast.hidden = false; title.hidden = true;
  } else {
    mast.hidden = true; title.hidden = false; title.textContent = THEME.game;
  }
  $("#tagline").textContent = THEME.tagline || "";
  $("#back-label").textContent = THEME.unit.toLowerCase() + "s";
  $("#claim-input").placeholder = "Speak the " + THEME.word + "…";
  $("#reveal-eyebrow").textContent = THEME.revealEyebrow;
  $("#reveal-verb").textContent = THEME.revealVerb;
  $("#reveal-next").textContent = "Next " + THEME.unit.toLowerCase() + " ›";
  $("#reveal-close").textContent = "Back to the " + THEME.unit.toLowerCase() + "s";
}

// ---------- level select ----------

function isOpen(id) {
  return !!ME.admin || id === 1 || ME.cleared.includes(id - 1) || ME.cleared.includes(id);
}

async function loadLevels() {
  const [lv, me] = await Promise.all([api("levels"), api("me")]);
  if (!lv.ok) { $("#level-grid").textContent = lv.data.error || "The levels are sealed for now."; return; }
  LEVELS = lv.data.levels;
  applyTheme(lv.data.theme);
  if (me.ok) ME = me.data;

  const grid = $("#level-grid");
  grid.innerHTML = "";
  const done = new Set(ME.cleared || []);
  for (const l of LEVELS) {
    const open = isOpen(l.id);
    const lockUntil = (ME.locks || {})[l.id];
    const card = el("button", "level-card" + (open ? "" : " locked") + (done.has(l.id) ? " done" : ""));
    card.disabled = !open;
    if (done.has(l.id)) card.appendChild(el("span", "seal", "✦")).title = "cleared";
    else if (lockUntil) card.appendChild(el("span", "seal", "⏳")).title = "locked until " + new Date(lockUntil).toLocaleString();
    else if (!open) card.appendChild(el("span", "seal", "🔒"));
    card.appendChild(el("span", "num", THEME.unit + " " + l.id + (l.boss ? " · boss" : "")));
    card.appendChild(el("span", "world", l.world));
    card.appendChild(el("span", "lname", l.name));
    const cfg = el("div", "cfg");
    cfg.appendChild(el("span", "chip g", l.guard));
    l.output.forEach((o) => cfg.appendChild(el("span", "chip o", o)));
    l.input.forEach((i) => cfg.appendChild(el("span", "chip i", i)));
    if (l.model && l.model !== "M2") cfg.appendChild(el("span", "chip m", l.model));
    if (l.channel !== "chat") cfg.appendChild(el("span", "chip", l.channel));
    if (l.decoys) cfg.appendChild(el("span", "chip", "decoys"));
    if (l.adaptive) cfg.appendChild(el("span", "chip", "adaptive"));
    card.appendChild(cfg);
    card.setAttribute("aria-label", `${THEME.unit} ${l.id}: ${l.name}` + (done.has(l.id) ? ", cleared"
      : lockUntil ? ", locked until " + new Date(lockUntil).toLocaleString()
      : open ? ", open" : ", sealed"));
    if (open) card.addEventListener("click", () => startLevel(l.id));
    grid.appendChild(card);
  }
  renderDoors(ME.doors);
  $("#select-allowance").textContent = allowanceText(ME.allowance);
}

function renderDoors(doors) {
  const box = $("#doors");
  box.innerHTML = "";
  const line = (text, href) => {
    const p = el("span", "door");
    if (href) { const a = el("a", "", text + " ›"); a.href = href; a.target = "_blank"; a.rel = "noopener"; p.appendChild(a); }
    else p.textContent = text;
    box.appendChild(p);
  };
  if (doors && doors.club != null) {
    if (doors.club) line("Your Alignment Club invitation is open", doors.club);
    else line("You earned the Alignment Club door. The invitation link is not posted yet.");
  }
  if (doors && doors.apply) {
    if (doors.applyUrl) line("You cleared the last level. The résumé door is open", doors.applyUrl);
    else line("You cleared the last level. The résumé door is earned; where it leads is not posted yet.");
  }
  box.hidden = !box.childElementCount;
}

function allowanceText(st) {
  if (!st) return "";
  if (st.closed) return st.reason;
  return `Model turns left today: ${st.candlesLeft}/${st.dailyLimit}.`;
}

// ---------- start / resume a level ----------

// Resolves true when the level opened (or reopened), false otherwise.
async function startLevel(id, { restart = false } = {}) {
  if (state.busy) return false;
  state.busy = true;
  try {
    const { ok, status, data } = await api("start", { levelId: id, restart });
    if (!ok) {
      show("select");
      $("#select-allowance").textContent = data.error || "That level would not open.";
      if (status === 403) loadLevels().then(() => { $("#select-allowance").textContent = data.error; });
      return false;
    }
    state.level = data.level;
    $("#provider-note").textContent = "guard: " + data.provider;
    $("#play-world").textContent = data.level.world;
    $("#play-name").textContent = `${THEME.unit} ${pad2(data.level.id)} · ${data.level.name}`;
    $("#play-allowance").textContent = allowanceText(data.allowance);
    buildRack(data.level);

    const chat = $("#chat"); chat.innerHTML = "";
    show("play");

    if (data.status === "locked") {
      setProgress(data.progress);
      addSys(`${THEME.unit} ${data.level.id} is locked after ${data.progress.attemptsMax} failed attempt${data.progress.attemptsMax === 1 ? "" : "s"}. It reopens ${new Date(data.progress.lockUntil).toLocaleString()}.`);
      setEnabled(false);
      return true;
    }

    addSys(introFor(data.level));
    if (data.level.note) addSys(data.level.note);
    if (data.status === "resumed") {
      const turns = data.transcript || [];
      addSys(turns.length ? "You pick up where you left off." : "You pick up where you left off. Nothing has been said yet.");
      for (const t of turns) showExchange(t);
    }
    setProgress(data.progress);
    setEnabled(true);

    const ti = $("#turn-input");
    const g = inline(data.level.guardName || THEME.guard);
    if (data.level.channel === "document") ti.placeholder = `Write the scroll ${g} will be asked to summarize…`;
    else if (data.level.channel === "tool") ti.placeholder = `Write the errand result ${g} will read back…`;
    else ti.placeholder = `Speak to ${g}…`;
    updateMessageLimit();
    ti.focus();
    return true;
  } catch (err) {
    addSys("The gate did not answer. Check your connection and try again.");
    return false;
  } finally {
    state.busy = false;
  }
}

function introFor(lv) {
  const g = inline(lv.guardName || THEME.guard);
  const base = `A nonsense ${THEME.word} is held here by ${g}. Get it out of them, then speak it.`;
  if (lv.channel === "document") return base + " You do not talk to the guard here: what you write is handed over as a document to summarize. Your words arrive as data, not as a turn of your own.";
  if (lv.channel === "tool") return base + " The guard is answering someone else's question. You only write the result of the errand it ran.";
  if (lv.channel === "cot") return base + " This guard reasons out loud before it answers, and the filters only read the answer.";
  if (!lv.stateful) return base + " The guard has no memory here. Every message stands alone.";
  return base;
}

// With no open attempt (failed, locked, or cleared), the server's `left` is the
// allowance a new attempt would get; this attempt has nothing left, so show 0.
function setProgress(p) {
  if (!p) return;
  state.left = p.open ? p.left : { exchanges: 0, guesses: 0, hints: 0 };
  $("#candles").textContent = state.left.exchanges;
  $("#digs").textContent = state.left.guesses;
  updateHint();
  $("#play-attempt").textContent = p.attemptNo
    ? `Attempt ${p.attemptNo} of ${p.attemptsMax}` + (p.cleared ? " · cleared before" : "")
    : "";
}

// A hint costs one exchange. It is off when there is none to spend, and when only
// one is left it takes a second click (on a one-exchange level, that exchange is
// the whole attempt).
let hintArmed = false;
function updateHint() {
  hintArmed = false;
  const b = $("#hint");
  b.disabled = state.left.hints <= 0 || state.left.exchanges <= 0;
  b.textContent = `Buy a hint (costs 1 exchange · ${state.left.hints} left)`;
}

function setEnabled(on) {
  ["#turn-input", "#send", "#claim-input", "#claim", "#hint"].forEach((s) => { $(s).disabled = !on; });
  if (on) updateHint();
}

function updateMessageLimit() {
  const limit = state.level?.messageCharLimit;
  const length = $("#turn-input").value.length;
  const over = limit != null && length > limit;
  $("#message-limit").textContent = length.toLocaleString("en-US") + " characters · " +
    (limit == null ? "No character cap here." :
      limit.toLocaleString("en-US") + " maximum per message." + (over ? " Shorten the message before sending." : "")) +
    (ENTER_SENDS ? " Enter sends, Shift+Enter starts a new line." : "");
  $("#turn-input").setAttribute("aria-invalid", String(over));
  return !over;
}
$("#turn-input").addEventListener("input", updateMessageLimit);
// Enter sends on a real keyboard. On touch screens Return inserts a newline (there
// is no Shift+Enter there, and some levels need line breaks), and Enter that
// confirms an input-method composition never sends.
const ENTER_SENDS = !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
$("#turn-input").addEventListener("keydown", (e) => {
  if (!ENTER_SENDS || e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  $("#turn-form").requestSubmit();
});

function buildRack(lv) {
  const rack = $("#rack"); rack.innerHTML = "";
  const add = (kind, title, desc) => {
    const layer = el("div", "layer");
    layer.dataset.kind = kind;
    layer.appendChild(el("div", "lt", title));
    layer.appendChild(el("div", "ld", desc));
    rack.appendChild(layer);
  };
  lv.input.forEach((i) => add("input", THEME.layers.input + " · " + i, IN_TXT[i] || i));
  add("guard", lv.guardName || "Guard", GUARD_TXT[lv.guard] || lv.guard);
  if (lv.model && lv.model !== "M2") add("model", "Model", MODEL_TXT[lv.model] || lv.model);
  lv.output.forEach((o) => add("output", THEME.layers.output + " · " + o, OUT_TXT[o] || o));
}

function flashRack(kind) {
  document.querySelectorAll("#rack .layer").forEach((l) => l.classList.toggle("fired", !!kind && l.dataset.kind === kind));
}

// ---------- chat rendering ----------

function addMsg(kind, text, tags) {
  const m = el("div", "msg " + kind, text);
  if (tags && tags.length) m.appendChild(el("span", "tags", "tagged: " + tags.join(", ")));
  const c = $("#chat"); c.appendChild(m); c.scrollTop = c.scrollHeight;
  return m;
}
const addSys = (t) => addMsg("sys", t);

// One exchange as the player saw it: their message, then what came back.
function showExchange(t, tags, withUser = true) {
  if (withUser) addMsg("you", t.user);
  if (t.blocked) {
    addMsg("tape", `${THEME.layers.input.toUpperCase()} ${t.blocked.layer}: ${t.blocked.reason}. Message blocked, exchange spent.`);
    return;
  }
  addMsg("guard", t.assistant, tags);
  if (t.filtered) addMsg("tape", `${THEME.layers.output.toUpperCase()} ${t.filtered.layer}: ${t.filtered.reason}. The leak was cut.`);
}

// A button in the chat. If what it starts does not go through (offline, say),
// the button comes back so the player is never left with nothing to press.
function offer(label, fn) {
  const b = el("button", "dig offer", label);
  b.addEventListener("click", async () => {
    document.querySelectorAll("#chat .offer").forEach((x) => x.remove());
    if (!(await fn())) offer(label, fn);
  });
  $("#chat").appendChild(b);
  $("#chat").scrollTop = $("#chat").scrollHeight;
}
function offerRestart() {
  offer("Restart (spends this attempt)", () => startLevel(state.level.id, { restart: true }));
}
function offerRetry() {
  offer("Try again", () => startLevel(state.level.id));
}

// ---------- a turn ----------

$("#turn-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy || !state.level) return;
  const ti = $("#turn-input");
  const msg = ti.value.trim();
  if (!msg) return;
  if (!updateMessageLimit()) { addSys("That message is over the character limit. Nothing was sent."); return; }
  if (state.left.exchanges <= 0) { addSys("No exchanges left. Speak the word, or restart."); offerRestart(); return; }

  const mine = addMsg("you", msg);
  state.busy = true;
  const thinking = addMsg("thinking", `${state.level.guardName || THEME.guard} considers…`);
  try {
    const { ok, data } = await api("turn", { levelId: state.level.id, message: msg });
    thinking.remove();
    if (data.progress) setProgress(data.progress);
    if (data.allowance) $("#play-allowance").textContent = allowanceText(data.allowance);
    if (data.closed) { mine.remove(); addSys(data.reason); return; }
    if (!ok || data.error) {
      mine.remove();   // it was not sent, or not answered; the text stays in the box
      addSys(data.error || "The message could not be sent.");
      if (data.code === "NO_ATTEMPT") offerRetry();
      if (data.code === "NO_EXCHANGES") offerRestart();
      return;
    }
    // Clear the box only if it still holds what was sent (not a draft typed since).
    if (ti.value.trim() === msg) ti.value = "";
    updateMessageLimit();
    flashRack(null);
    if (data.blocked) {
      showExchange({ user: msg, blocked: { layer: data.layer, reason: data.reason } }, null, false);
      flashRack("input");
    } else {
      showExchange({ user: msg, assistant: data.reply, filtered: data.filtered }, data.tags, false);
      if (data.filtered) flashRack("output");
    }
    if (state.left.exchanges <= 0) addSys("That was your last exchange. Speak the word now, or restart.");
  } catch (err) {
    thinking.remove();
    mine.remove();
    addSys("The gate did not answer. Check your connection; nothing was spent.");
  } finally {
    state.busy = false;
  }
});

// ---------- a hint ----------

$("#hint").addEventListener("click", async () => {
  if (state.busy || !state.level) return;
  if (state.left.exchanges === 1 && !hintArmed) {
    hintArmed = true;
    $("#hint").textContent = "Spend your last exchange on a hint? Click again";
    return;
  }
  state.busy = true;
  try {
    const { data } = await api("hint", { levelId: state.level.id });
    if (data.progress) setProgress(data.progress);
    if (data.error) { addSys(data.error); return; }
    addMsg("tape", `Hint ${data.index}: ${data.hint}`);
    if (state.left.exchanges <= 0) addSys("That hint took your last exchange. Speak the word now, or restart.");
  } catch (err) {
    addSys("The gate did not answer. Check your connection; nothing was spent.");
  } finally {
    state.busy = false;
    updateHint();
  }
});

// ---------- a claim ----------

$("#claim-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy || !state.level) return;
  const ci = $("#claim-input");
  const guess = ci.value.trim();
  if (!guess) return;
  state.busy = true;
  try {
    const { data } = await api("claim", { levelId: state.level.id, claim: guess });
    if (data.progress) setProgress(data.progress);
    if (data.error) {
      addSys(data.error);
      if (data.code === "NO_ATTEMPT") offerRetry();
      return;
    }
    if (data.win) {
      ME.cleared = data.cleared || ME.cleared;
      ME.doors = data.doors || ME.doors;
      ci.value = "";
      showReveal(data.reveal);
      return;
    }
    addMsg("tape", `"${guess}" is not the word. Guesses left: ${data.attemptFailed ? 0 : state.left.guesses}.`);
    ci.value = "";
    if (data.attemptFailed) {
      const p = data.progress || {};
      setEnabled(false);
      if (p.locked) {
        addSys(`That was the last guess, and the last attempt for today. ${THEME.unit} ${state.level.id} reopens ${new Date(p.lockUntil).toLocaleString()}.`);
      } else {
        addSys("That was the last guess. This attempt has failed; the next one brings a fresh word.");
        offerRetry();
      }
    }
  } catch (err) {
    addSys("The gate did not answer. Check your connection; your guess was not counted.");
  } finally {
    state.busy = false;
  }
});

// ---------- reveal ----------

function showReveal(rev) {
  $("#reveal-title").textContent = rev.name;
  $("#reveal-secret").textContent = rev.secret;
  $("#reveal-lesson").textContent = rev.lesson;
  $("#reveal-tech-title").textContent = rev.technique.title;
  $("#reveal-tech-how").textContent = rev.technique.how;
  $("#reveal-fix").textContent = rev.technique.fix || "";
  $("#reveal-doc").href = rev.technique.doc;
  $("#reveal-guard-summary").textContent = `What ${inline(state.level.guardName || THEME.guard)} was told`;
  $("#reveal-guard").textContent = rev.guardPrompt;
  const layers = rev.config.layers || THEME.layers;
  $("#reveal-config").textContent =
    `guard ${rev.config.guard} · ${layers.output} [${rev.config.output.join(", ") || "none"}] · ${layers.input} [${rev.config.input.join(", ") || "none"}] · channel ${rev.config.channel}`;
  const winWrap = $("#reveal-win-wrap");
  if (rev.winningMessage) { $("#reveal-win").textContent = rev.winningMessage; winWrap.hidden = false; }
  else winWrap.hidden = true;

  const next = LEVELS.find((l) => l.id === rev.level + 1);
  $("#reveal-next").hidden = !next;
  // Modal: the screens behind are inert until it closes, and focus starts inside.
  $("#select").inert = true;
  $("#play").inert = true;
  $("#reveal").hidden = false;
  (next ? $("#reveal-next") : $("#reveal-close")).focus();
}

function closeReveal() {
  $("#reveal").hidden = true;
  $("#select").inert = false;
  $("#play").inert = false;
}

$("#reveal-next").addEventListener("click", () => {
  closeReveal();
  const next = state.level.id + 1;
  if (LEVELS.find((l) => l.id === next)) startLevel(next);
  else backToSelect();
});
$("#reveal-close").addEventListener("click", () => { closeReveal(); backToSelect(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#reveal").hidden) { closeReveal(); backToSelect(); } });
$("#back").addEventListener("click", backToSelect);

async function backToSelect() {
  show("select");
  await loadLevels();
  // keyboard focus lands on the next level to play, else the one just left
  const id = state.level ? state.level.id : 1;
  const cards = document.querySelectorAll(".level-card");
  const target = [cards[id], cards[id - 1]].find((c) => c && !c.disabled);
  if (target) target.focus();
}

function show(which) {
  $("#select").hidden = which !== "select";
  $("#play").hidden = which !== "play";
}

// ---------- boot ----------
applyTheme(null);
loadLevels();
