// candles.js — the cost cap, in three layers. None of them can charge anyone a
// cent; they exist so a free-tier pool cannot be drained by one script.
//
//   Per player, per day:  DAILY_CANDLES model turns (default 300: a clean run of all
//                         35 levels fits in one sitting). Resets at UTC midnight.
//   Per IP, per hour:     IP_HOURLY_TURNS model turns (default 120).
//   Global, per day:      GLOBAL_DAILY_TURNS across everyone (default 5000). When
//                         hit, the crypt closes for all until midnight and says so.
//
// Only real inference spends a candle. Filter blocks and hints do not.
// An admin session (Dave testing) is never closed out, but still counts.

import { getStore } from "./store.js";
import { COST_PER_TURN_USD } from "./providers.js";

function day() { return new Date().toISOString().slice(0, 10); }
function hour() { return new Date().toISOString().slice(0, 13); }

export function limits(env) {
  return {
    daily: Number(env.DAILY_CANDLES || 300),
    global: Number(env.GLOBAL_DAILY_TURNS || 5000),
    ipHourly: Number(env.IP_HOURLY_TURNS || 120),
  };
}

// seconds until the next UTC midnight, for TTLs
function ttlToMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(60, Math.ceil((next - now) / 1000));
}

async function count(store, key) { return Number((await store.get(key)) || 0); }

export async function getState(env, playerId, ipKey, admin = false) {
  const store = getStore(env);
  const d = day();
  const { daily, global, ipHourly } = limits(env);
  const dailyUsed = await count(store, `cand:${playerId}:${d}`);
  const globalUsed = await count(store, `global:${d}`);
  const ipUsed = ipKey ? await count(store, `ip:${ipKey}:${hour()}`) : 0;
  const globalClosed = globalUsed >= global;
  const playerClosed = dailyUsed >= daily;
  const ipClosed = ipKey ? ipUsed >= ipHourly : false;
  const closed = !admin && (globalClosed || playerClosed || ipClosed);
  return {
    dailyUsed, dailyLimit: daily, candlesLeft: Math.max(0, daily - dailyUsed),
    globalUsed, globalLimit: global,
    ipUsed, ipLimit: ipHourly,
    estSpendUsd: +(globalUsed * COST_PER_TURN_USD).toFixed(4),
    closed,
    reason: !closed ? null
      : globalClosed ? "The crypt is full for today. Every candle in the store is spent. It reopens at midnight UTC."
      : playerClosed ? "Your candles are spent for the day. They return at midnight UTC."
      : "Too many turns from your connection this hour. The gate reopens shortly.",
  };
}

// Spend one candle for a real model turn. Returns {ok, state}. On !ok, state.reason
// explains which ceiling closed the door.
export async function spendCandle(env, playerId, ipKey, admin = false) {
  const pre = await getState(env, playerId, ipKey, admin);
  if (pre.closed) return { ok: false, state: pre };
  const store = getStore(env);
  const d = day();
  const ttl = ttlToMidnight();
  await store.set(`cand:${playerId}:${d}`, pre.dailyUsed + 1, ttl);
  await store.set(`global:${d}`, pre.globalUsed + 1, ttl);
  if (ipKey) await store.set(`ip:${ipKey}:${hour()}`, pre.ipUsed + 1, 3700);
  const post = await getState(env, playerId, ipKey, admin);
  return { ok: true, state: post };
}
