# HANDOFF: Dead Drop, 15-level recut

_Updated 2026-09-25 (cloud session). Supersedes the 2026-09-25 local handoff._

Boot order is unchanged (NOMOS-LOGOS, MACHINE-INDEX, MUNNIN, CLAUDE_MASTER, then
this file). A cloud session cannot see the M: drive, so anything not pushed to
GitHub does not exist for it. Push both repos before starting one.

## Where things stand

- **Both ladders run on one engine.** `LADDER` picks the campaign: `"35"`
  (`worker/levels.js`, default) or `"15"` (`worker/levels.15.js`). Nothing is
  deleted by switching, and progress is stored per ladder, so flipping back is
  the rollback. The swap the old handoff asked about is now one config value,
  still set to `"35"` until Dave says go.
- **Reveal cards** name the technique family, how it fell, and the defensive fix
  (`worker/reveal.js`). Concept level; the only payload a reveal shows is the
  player's own winning message.
- **`public/` client** reads its copy from `META.theme` via `/api/levels`, and
  its counters, transcript, locks and hints from the server.
- **Selftest** covers both ladders end to end through the router, plus the word
  staying server-side. `npm test` runs it and the message-limit tests.
- **Provider**: `PROVIDER = "groq"`, `GROQ_MODEL = "openai/gpt-oss-20b"` in
  `wrangler.toml`. The old handoff's picks are gone: Groq retired
  `llama-3.1-8b-instant` for free accounts on 2026-08-16, and Workers AI retired
  `@cf/meta/llama-3.1-8b-instruct` on 2026-05-30.

## Fixed along the way (engine bugs, not the recut)

- A fired output filter showed the leak anyway for every form except plain,
  reversed and leet (NATO initials, base64, hex, rot13, fragments). `redact()`
  now withholds the reply unless the mask removed the leak.
- The server took conversation history from the browser, unscreened: input
  filters were bypassable, guard turns forgeable, and size uncapped. The
  transcript now lives in the open attempt; client history is ignored.
- On Workers, a browser could send `x-admin: 1` and skip gating, locks and cost
  caps. Identity headers are trusted only behind the Node host (`env.STORE`) or
  with `TRUST_IDENTITY_HEADERS = "1"`.
- The attempt log called NATO/reversed leaks "miss". It now says "leak", and
  records which ladder (`ladder` column; one-line migration in `schema.sql`).
- Tests were red on the pushed build (renumbered cracks; turns without a start).

A review pass (4 lenses, each finding verified by a second agent, 34 of 35
confirmed) then found and this branch fixed:

- O3's filter reason printed 4 letters of the word to the browser; two turns
  gave the whole word with no reply ever shown.
- A reply with the word plus a second form the level does not filter was shown
  with only the first masked (and logged "blocked").
- Words and progress keys were not scoped per ladder: a same-day flip let a word
  from one campaign clear the other, and a crafted player id could reach the
  other ladder's record.
- Parallel requests got past per-attempt limits (boss one-shots) and lost cost
  counter increments. Handlers now run one at a time per player, counters one at
  a time globally (`worker/lock.js`); exact within one process.
- Provider errors spent candles and forwarded raw provider text (org ids).
  Failures now refund and map 429/413 to plain messages.
- History replay is capped at ~16k characters to fit Groq's free per-request
  token cap; the full transcript (blocked turns included) is kept for resume.
- The reveal's "winning move" and the adaptive boss's patches came from the
  browser; they now come from the server transcript.
- Workers per-IP cap never applied; it now uses cf-connecting-ip.
- Content: the Oracle (15-L13) now forgets, as its note says; both document
  levels' lessons now match where the word actually is; the adaptive finals get a
  layered-defense card; the client rack no longer claims a "second model".
- Client: eleven UX and accessibility fixes (hint cost, counters after a failed
  attempt, resume on every level, Enter on touch and IME, offline retry, modal
  focus, the résumé door, drafts, admin gating, locked labels).

## Not done: pick up here

1. **Flip to the 15**: set `LADDER = "15"` (wrangler.toml and the cPanel app's
   environment). Needs Dave's yes. Do not flip it on the live site until item 2.
2. **Site client (`revenant-deaddrop-site/main.js`)** hard-codes the 35: `TOTAL`,
   `WORLD_NAMES` (maps worlds by index, so The Village would display as a crypt
   name), the seal geometry, and the stage thresholds at 15 and 25. It needs to
   read `total`, `theme` and world names from `/api/levels`. The GitHub copy of
   that repo is older than Dave's local one, so push it first.
3. **Node host**: confirm `server.mjs` passes `env.STORE` (it should, per
   `store.js`). If it does not, add `TRUST_IDENTITY_HEADERS: "1"` to its env, or
   cookie identity stops being honoured.
4. **Re-run calibration** with the current provider settings. The 09-16 run
   measured a misconfigured provider, not the ladder (see README, Status).
   Targets were set for an 8B Llama; gpt-oss is a reasoning model and will
   resist harder, so expect to retune `targetCrack` or pick a weaker guard.
5. **Workers AI model**: if that provider is used, confirm a live id with
   `npx wrangler ai models list --search llama` and set `WORKERS_AI_MODEL`.
6. `site-preview/` hard-codes 35 levels; it works on the default ladder only.
7. **Decisions for Dave** (left as found):
   - Model tiers (M2/M3/M4) are not mapped to real models by any provider, yet
     lessons say "a stronger guard". Either map them (for example gpt-oss-20b /
     gpt-oss-120b on Groq) or soften those lessons. The Wire levels' hints name
     Llama 3 and ChatML templates; the default guard is gpt-oss.
   - In the 15, level names (Drunk Bard, Goblin Sentry, Oracle...) differ from
     the guardian the player actually talks to (Gatekeeper, Sphinx, Archmage).
     Per-level personas, or name the levels after the guardian.
   - `APPLY_URL` (new) is where the résumé door leads; unset, the client says it
     is earned but not posted. `CLUB_INVITE_URL` as before.
   - `GLOBAL_DAILY_TURNS` is 1000 in wrangler.toml, sized to Groq's free quota
     per third-party summaries; set it from your account's limits page.
   - Some lessons and hints describe the I3 screen and O4 judge as models ("A
     second model screens your message", "The judge is a model with the same
     blind spots", 35-L27 "The screener is real now"). In this engine both are
     deterministic rules standing in for a model. True of the real-world pattern
     the level teaches, not of this level. Reword, or build a model-backed
     screen/judge. (35: L9, L13, L27; 15: L7, L9.)
   - Workers is not the production host. If it becomes one, per-player limits
     and caps need a Durable Object (see README, enforcement).

## Constraints

- Ship the guardians and the defenses. No transferable offensive-payload
  cookbook; reveals stay at the concept and fix level.
- Personas are additive. Prune the five crypt personas from `guard.js` only after
  the 35 is retired.
- Do not brand anything "D&D" in player-facing copy; the tiers use generic
  fantasy names, which is what they should stay.
