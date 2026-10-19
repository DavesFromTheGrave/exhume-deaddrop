// secret.js — the guarded word.
//
// The word is DERIVED, never stored and never sent to the browser. It is an
// HMAC of (serverKey, sessionId, levelId, daySeed) mapped to a pronounceable
// nonsense word. Verification recomputes it, so there is nothing to steal from
// the client and no word list in any database. (The only stored copies are replies
// a player earned: in their open attempt, and in the attempt log.) Every ladder
// but the 35 derives under its own key (ladder.js wordKey), so no player id can
// make two ladders share a word. Brute force is bounded by the per-level dig
// limit and the per-player candle allowance, both enforced server-side.

const CONS = "bcdfghjklmnprstvz".split("");
const VOWELS = "aeiou".split("");

// A tiny common-word guard so a derived word is never an ordinary English word
// (which would make the O3 fragment filter fire on innocent text). Extend freely.
const COMMON = new Set([
  "banana", "orange", "purple", "silver", "dragon", "coffee", "garden", "winter",
  "summer", "mother", "father", "sister", "wander", "hunter", "temple", "cellar",
  "marble", "pallor", "velvet", "sorrow", "hollow", "hallow", "raven", "grave",
]);

async function hmacBytes(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return new Uint8Array(sig);
}

function bytesToWord(bytes) {
  // 2 or 3 CVC syllables => 6 or 9 letters; trim to 6-8.
  const syllables = 2 + (bytes[0] % 2); // 2 or 3
  let w = "";
  let i = 1;
  for (let s = 0; s < syllables; s++) {
    w += CONS[bytes[i++ % bytes.length] % CONS.length];
    w += VOWELS[bytes[i++ % bytes.length] % VOWELS.length];
    w += CONS[bytes[i++ % bytes.length] % CONS.length];
  }
  if (w.length > 8) w = w.slice(0, 8);
  return w;
}

// daySeed lets a level re-roll daily (also resets any client tampering each day).
export function daySeed(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function deriveSecret(serverKey, sessionId, levelId, seed = daySeed()) {
  let msg = `${sessionId}:${levelId}:${seed}`;
  // Re-hash until the word is not an ordinary English word.
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = await hmacBytes(serverKey, attempt === 0 ? msg : `${msg}:${attempt}`);
    const w = bytesToWord(bytes);
    if (!COMMON.has(w)) return w;
  }
  return bytesToWord(await hmacBytes(serverKey, `${msg}:x`));
}

// Claim check: lowercase, trim, strip everything but a-z0-9, exact match.
export function normalizeClaim(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function claimMatches(claim, secret) {
  return normalizeClaim(claim) === normalizeClaim(secret);
}

// The guess check (Dave, 2026-10-18): exact, or one slip off the word: one letter
// wrong, missing or extra, or two neighbouring letters swapped. Small models
// misspell made-up words when they spell them out, so a player who really got
// the word out should not lose to the guard's typo. The per-attempt guess limit
// still bounds guessing. `near` marks a forgiven slip so the page can say so.
export function claimResult(claim, secret) {
  const a = normalizeClaim(claim), b = normalizeClaim(secret);
  if (!a || !b) return { win: false, near: false };
  if (a === b) return { win: true, near: false };
  return oneSlip(a, b) ? { win: true, near: true } : { win: false, near: false };
}

function oneSlip(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && diff.push(i) > 2) return false;
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];   // l has one letter more
  let i = 0, j = 0, skipped = false;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true; j++;
  }
  return true;
}
