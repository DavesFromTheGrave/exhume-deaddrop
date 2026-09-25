// index.js — the one Worker. Serves the API (and, on Workers, the client) from one origin.
//
//   GET  /api/levels                        level metadata (never the word, never the hints)
//   GET  /api/me                            cleared levels, locks, doors, allowance
//   POST /api/start  {levelId, restart}     begin or resume an attempt; returns counters
//   POST /api/turn   {levelId, message, history}
//   POST /api/hint   {levelId}              one vague hint, costs one exchange
//   POST /api/claim  {levelId, claim, winningMessage}   the reveal on a win
//   GET  /api/state                         candle allowance (legacy)
//
// Identity: the Node server (server.mjs) issues a signed cookie and passes the id
// as x-player-id, the caller's hashed IP as x-client-ip, and x-admin: 1 for Dave's
// test session. Without those headers (wrangler dev) the body's playerId is used.
// The word is derived server-side (secret.js), never sent, and every claim is
// checked here. Exchanges, guesses, attempts and locks are enforced here too.

import { LEVELS, getLevel, publicLevel } from "./levels.js";
import { deriveSecret, claimMatches } from "./secret.js";
import { runInputFilters, runOutputFilters, tagTechnique } from "./filters.js";
import { buildGuardPrompt, buildMessages, personaInfo } from "./guard.js";
import { callProvider, providerName } from "./providers.js";
import { getState, spendCandle } from "./candles.js";
import { logAttempt } from "./log.js";
import { buildReveal } from "./reveal.js";
import {
  loadPlayer, canEnter, levelView, startAttempt, openAttempt, noteExchange, noteGuess,
  useHint, doors, adaptiveRules, summary,
} from "./progress.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function serverKey(env) {
  // A real key comes from a secret. The dev fallback keeps local play working
  // with zero setup; it is NOT for production (set SERVER_KEY there).
  return env.SERVER_KEY || "exhume-dev-key-not-for-production";
}

// Who is asking. Headers win over the body; the body is the dev fallback.
function who(request, body) {
  const h = request.headers;
  return {
    pid: h.get("x-player-id") || (body && body.playerId) || "anon",
    ip: h.get("x-client-ip") || "",
    admin: h.get("x-admin") === "1",
  };
}

function maskLeak(reply, secret) {
  const marker = "▒▒▒▒";
  let out = reply;
  const s = secret;
  const forms = [
    s, s.split("").reverse().join(""),
    s.replace(/a/gi, "4").replace(/e/gi, "3").replace(/i/gi, "1").replace(/o/gi, "0").replace(/s/gi, "5").replace(/t/gi, "7"),
  ];
  for (const f of forms) {
    if (f.length >= 3) out = out.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), marker);
  }
  // If the word is still recoverable from the letters (scatter), stitch it shut.
  if (out.toLowerCase().replace(/[^a-z0-9]/g, "").includes(s.toLowerCase())) {
    return "The guard starts to speak, but Sewn Lips draws the thread tight. The reply is stitched shut.";
  }
  return out;
}

function levelPayload(level) {
  return { ...publicLevel(level), guardName: personaInfo(level).name };
}

async function handleMe(env, request) {
  const { pid, ip, admin } = who(request, {});
  const rec = await loadPlayer(env, pid);
  return json({ ...summary(rec, admin), doors: doors(env, rec, admin), allowance: await getState(env, pid, ip, admin), admin });
}

async function handleStart(env, request, body) {
  const { pid, ip, admin } = who(request, body);
  const level = getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const rec0 = await loadPlayer(env, pid);
  if (!canEnter(rec0, level, admin)) return json({ error: "That level is still sealed. Clear the one before it first.", code: "SEALED" }, 403);
  const r = await startAttempt(env, pid, level, { restart: !!body.restart, admin });
  return json({
    status: r.status,
    level: levelPayload(level),
    candles: level.candles, digs: level.digs,
    progress: r.view,
    cleared: r.rec.cleared,
    doors: doors(env, r.rec, admin),
    allowance: await getState(env, pid, ip, admin),
    provider: providerName(env),
  });
}

async function handleTurn(env, request, body) {
  const { pid, ip, admin } = who(request, body);
  const level = getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const message = String(body.message || "");
  if (level.messageCharLimit != null && message.length > level.messageCharLimit) {
    return json({
      error: `This level allows ${level.messageCharLimit.toLocaleString("en-US")} characters per message. Your message was not sent; no exchange was spent.`,
      code: "MESSAGE_TOO_LONG", limit: level.messageCharLimit,
    }, 413);
  }
  if (!message.trim()) return json({ error: "empty message" }, 400);

  const { rec, open } = await openAttempt(env, pid, level);
  if (!open) return json({ error: "Enter the level first.", code: "NO_ATTEMPT" }, 409);
  if (open.msgs >= level.candles) {
    return json({ error: "No exchanges left on this attempt. Guess the word, or restart the level and spend an attempt.", code: "NO_EXCHANGES", progress: levelView(rec, level, admin) }, 409);
  }

  const tags = tagTechnique(message);

  // 1. daily / global / per-IP cost ceiling
  const pre = await getState(env, pid, ip, admin);
  if (pre.closed) {
    await logAttempt(env, { playerId: pid, levelId: level.id, channel: level.channel, verdict: "closed", tags, candlesLeft: pre.candlesLeft, message });
    return json({ closed: true, reason: pre.reason, allowance: pre, progress: levelView(rec, level, admin) });
  }

  // 2. input filters (the Salt Line). A block does no inference, so it does not
  //    spend a candle from the cost allowance; it still spends an exchange.
  const inHit = runInputFilters(level, message, Array.isArray(body.history) ? body.history : []);
  if (inHit) {
    const view = await noteExchange(env, pid, level, admin);
    await logAttempt(env, { playerId: pid, levelId: level.id, channel: level.channel, verdict: "blocked", filtersFired: [`${inHit.layer}:${inHit.reason}`], tags, candlesLeft: pre.candlesLeft, message });
    return json({ blocked: true, layer: inHit.layer, reason: inHit.reason, tags, allowance: pre, progress: view });
  }

  // 3. real inference: charge the cost allowance
  const spend = await spendCandle(env, pid, ip, admin);
  if (!spend.ok) {
    await logAttempt(env, { playerId: pid, levelId: level.id, channel: level.channel, verdict: "closed", tags, candlesLeft: 0, message });
    return json({ closed: true, reason: spend.state.reason, allowance: spend.state, progress: levelView(rec, level, admin) });
  }

  const secret = await deriveSecret(serverKey(env), pid, level.id, open.seed);
  const decoys = [];
  for (let i = 0; i < (level.decoys || 0); i++) {
    decoys.push(await deriveSecret(serverKey(env), pid, level.id * 100 + i + 1, open.seed));
  }
  const extraRules = level.adaptive ? adaptiveRules(rec) : [];
  const system = buildGuardPrompt(level, secret, { decoys, extraRules });
  const messages = buildMessages(level, Array.isArray(body.history) ? body.history : [], message);

  let raw;
  try {
    raw = await callProvider(env, { system, messages, secret, level, playerMessage: message });
  } catch (e) {
    await logAttempt(env, { playerId: pid, levelId: level.id, channel: level.channel, verdict: "error", tags, candlesLeft: spend.state.candlesLeft, message, response: String(e) });
    return json({ error: "The gate is silent. The guard did not answer; no exchange was spent. Try again.", detail: String(e).slice(0, 200), allowance: spend.state, progress: levelView(rec, level, admin) }, 502);
  }

  // 4. output filters (Sewn Lips)
  const outHit = runOutputFilters(level, raw, secret);
  const shown = outHit ? maskLeak(raw, secret) : raw;
  const verdict = outHit ? "blocked" : (raw.toLowerCase().replace(/[^a-z0-9]/g, "").includes(secret.toLowerCase()) ? "leak" : "miss");
  const view = await noteExchange(env, pid, level, admin);

  await logAttempt(env, {
    playerId: pid, levelId: level.id, channel: level.channel, verdict,
    filtersFired: outHit ? [`${outHit.layer}:${outHit.reason}`] : [],
    tags, candlesLeft: spend.state.candlesLeft, message, response: raw,
  });

  return json({
    reply: shown,
    filtered: outHit ? { layer: outHit.layer, reason: outHit.reason } : null,
    tags,
    allowance: spend.state,
    progress: view,
  });
}

async function handleHint(env, request, body) {
  const { pid, admin } = who(request, body);
  const level = getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const r = await useHint(env, pid, level, admin);
  if (r.error) return json({ error: r.error, code: "NO_HINT" }, 409);
  return json({ hint: r.hint, index: r.index, progress: r.view });
}

async function handleClaim(env, request, body) {
  const { pid, admin } = who(request, body);
  const level = getLevel(body.levelId);
  if (!level) return json({ error: "no such level" }, 404);
  const { rec, open } = await openAttempt(env, pid, level);
  if (!open) return json({ error: "Enter the level first.", code: "NO_ATTEMPT" }, 409);
  if (open.guesses >= level.digs) return json({ error: "No guesses left on this attempt.", code: "NO_GUESSES", progress: levelView(rec, level, admin) }, 409);

  const secret = await deriveSecret(serverKey(env), pid, level.id, open.seed);
  const win = claimMatches(body.claim || "", secret);
  const tags = tagTechnique(String(body.winningMessage || ""));

  await logAttempt(env, {
    playerId: pid, levelId: level.id, channel: level.channel,
    verdict: win ? "claimed" : "miss", tags: ["claim"], candlesLeft: null,
    message: `CLAIM: ${body.claim || ""}`,
  });

  const r = await noteGuess(env, pid, level, { win, tags, admin });
  if (!win) {
    return json({ win: false, attemptFailed: r.attemptFailed, progress: r.view });
  }
  return json({
    win: true,
    reveal: buildReveal(level, secret, body.winningMessage || ""),
    progress: r.view,
    cleared: r.rec.cleared,
    doors: doors(env, r.rec, admin),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      try {
        if (path === "/api/levels" && request.method === "GET") {
          return json({ levels: LEVELS.map(levelPayload) });
        }
        if (path === "/api/me" && request.method === "GET") return handleMe(env, request);
        if (path === "/api/state" && request.method === "GET") {
          const { pid, ip, admin } = who(request, {});
          return json(await getState(env, pid, ip, admin));
        }
        if (request.method === "POST") {
          const body = await readBody(request);
          if (path === "/api/start") return handleStart(env, request, body);
          if (path === "/api/turn") return handleTurn(env, request, body);
          if (path === "/api/hint") return handleHint(env, request, body);
          if (path === "/api/claim") return handleClaim(env, request, body);
        }
        return json({ error: "not found" }, 404);
      } catch (e) {
        return json({ error: "worker error", detail: String(e) }, 500);
      }
    }

    // static client
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("client assets not bound", { status: 500 });
  },
};
