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
- The attempt log called NATO/reversed leaks "miss". It now says "leak".
- Tests were red on the pushed build (renumbered cracks; turns without a start).

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
   `npx wrangler ai models --search llama` and set `WORKERS_AI_MODEL`.
6. `site-preview/` hard-codes 35 levels; it works on the default ladder only.

## Constraints

- Ship the guardians and the defenses. No transferable offensive-payload
  cookbook; reveals stay at the concept and fix level.
- Personas are additive. Prune the five crypt personas from `guard.js` only after
  the 35 is retired.
- Do not brand anything "D&D" in player-facing copy; the tiers use generic
  fantasy names, which is what they should stay.
