# From the Grave

A browser prompt-injection game. The model guards a benign nonsense word; the
player makes it leak, then claims it. Gandalf-style secret extraction with a
Revenant Systems undead skin, built as the qualifier for the red-team chapter
and, later, the instrument for a research study.

**Name: From the Grave.** The jade headstone is the wordmark; the browser-tab
title reads from one constant, `GAME_NAME` in [`public/app.js`](public/app.js).
The project folder is still `Exhume` internally (not user-facing); rename it if
you want, it is just a path.

The word is derived and verified **server-side**. It never reaches the browser.
Winning is a claim: the player types the word into the claim box and the Worker
checks it by exact match after normalization. Detecting the word in the guard's
reply is an output *filter* (Sewn Lips), never the referee.

The 35 levels (six worlds) and their design targets are in [`LADDER.md`](LADDER.md).

## Run it locally

Needs Node 18+ (built on Node 26). No Cloudflare account, no API keys, no GPU:
the default guard is a deterministic offline stand-in.

```bash
npm install
npm run dev
```

Open the URL Wrangler prints (defaults to `http://127.0.0.1:8787`; this machine
reserves that port, so a fixed free port is used instead):

```bash
npx wrangler dev --port 4321 --ip 127.0.0.1 --inspector-port 0
```

Then open `http://127.0.0.1:4321`. First play needs no login; a random player id
lives in the browser.

Verify the whole loop without a browser:

```bash
npm test          # offline: derivation, filters, all 10 intended cracks, naive-ask failures
```

## The guard (providers)

Set `PROVIDER` in [`wrangler.toml`](wrangler.toml). Free-tier pools first.

| PROVIDER | What it is | Needs |
|---|---|---|
| `mock` (default) | Deterministic offline stand-in. Makes each level winnable by its intended technique. Not a real model. | nothing |
| `workers-ai` | Cloudflare Workers AI, `@cf/meta/llama-3.1-8b-instruct` | a Cloudflare account; uncomment `[ai]` |
| `groq` | Groq API, `llama-3.1-8b-instant` | `GROQ_API_KEY` |
| `google` | Google AI Studio, `gemini-1.5-flash` | `GOOGLE_API_KEY` |
| `ollama` | Local Ollama. Spends the GPU, so never the default. | Ollama running; `OLLAMA_URL` |

Keys go in `.dev.vars` locally (copy from [`.dev.vars.example`](.dev.vars.example),
never committed) and as Worker secrets in production. `SERVER_KEY` keys the word
derivation; set a real one before any real deployment.

The mock is the stand-in used to build and test the plumbing. Real guard
behavior, and the P0 calibration that tunes the crack rates in `LADDER.md`, needs
one of the real providers.

## The cost ceiling

Two caps, both in the `[vars]` block of [`wrangler.toml`](wrangler.toml):

- `DAILY_CANDLES` (default 60): turns per player per day. Spent, the player waits
  for midnight UTC.
- `GLOBAL_DAILY_TURNS` (default 5000): total inference turns per day across
  everyone. Hit, the crypt closes for all until midnight and says so. At roughly
  `$0.00005` per 8B turn, 5000 is about `$0.25` a day.

Only real inference spends a candle. A message stopped by an input filter does no
inference and does not touch the cost cap (it still costs a level candle, which
the client counts). None of the free-tier provider accounts take a card, so
overage is impossible, not merely unlikely.

Counters live in a KV namespace (binding `EXHUME_KV`) when one is bound, else in
memory (fine for local; resets on reload). Attempt logs go to a D1 table
(`EXHUME_DB`, schema in [`schema.sql`](schema.sql)) when bound, else one JSON line
per attempt to the console.

## What is and is not enforced

Server-side, and trustworthy: the word is derived from `SERVER_KEY` and never
sent; every claim is checked on the Worker; the daily and global cost caps.
Client-side, and unverified by design: the per-level candle and dig counters are
game pacing, not security. The word space plus the dig limit make brute force
hopeless regardless. A verified leaderboard belongs to a later elite tier where
the guard and word live only on the server.

## Add a level

One entry in [`worker/levels.js`](worker/levels.js). Everything else (level
select, defense rack, reveal) reads from it.

```js
{
  id: 11, world: "Sewn Lips", name: "Double Stitch",
  guard: "G3", output: ["O2", "O3"], input: ["I2"],
  candles: 10, digs: 2, stateful: true, channel: "chat",
  probeFamily: "side_channel", targetCrack: 0.30,
  lesson: "One sentence shown on the reveal.",
  mockLeakTriggers: [/regex the MOCK leaks on/i], // real providers ignore this
}
```

- `guard` `G0`–`G3` are in [`worker/guard.js`](worker/guard.js) (ported from
  `role-boundary-plasticity/defenses.py`).
- `output` `O1`/`O2`/`O3` and `input` `I1`/`I2` are in
  [`worker/filters.js`](worker/filters.js).
- `channel` `chat` | `document` | `tool` chooses how the player's text enters
  (`worker/guard.js`).
- `probeFamily` is a tag from `Gungnir-Red/probes.yaml` plus the game-specific
  ones; it drives the scout log and the reveal card in
  [`worker/reveal.js`](worker/reveal.js).
- Add a matching reveal card in `worker/reveal.js` if the family is new.

Run `npm test` after; the self-test only covers the shipped ten, so extend
[`worker/selftest.mjs`](worker/selftest.mjs) with the new level's intended crack.

## Deploy

Not done here (deploying is a separate decision). When you do:

```bash
wrangler kv namespace create EXHUME_KV     # then paste the id into wrangler.toml
wrangler d1 create exhume                  # then the id, then:
wrangler d1 execute exhume --file=schema.sql
wrangler secret put SERVER_KEY             # a long random string
npm run deploy
```

Set `PROVIDER` to a real provider and put its key in as a secret. The static
client is served by the same Worker, so one deploy ships both.

## Layout

```
LADDER.md            the ten levels and their design targets
wrangler.toml        Worker config, cost caps, optional bindings
schema.sql           D1 attempt-log schema
worker/
  index.js           router: /api/start, /api/turn, /api/claim, /api/state, /api/levels
  levels.js          the ten-level spec (single source of truth)
  guard.js           guard prompts (G0-G3) + per-channel context assembly
  providers.js       mock | workers-ai | groq | google | ollama
  filters.js         input (Salt Line) + output (Sewn Lips) filters + technique tagger
  secret.js          deterministic word derivation + claim check
  candles.js         per-player daily allowance + global ceiling
  log.js             structured per-attempt log (D1 or console)
  reveal.js          the crack reveal (guard prompt, config, technique card)
  selftest.mjs       offline proof the loop works
public/              the browser client (index.html, style.css, app.js)
  curriculum/        the two training pages, linked from each reveal
```

## Status

35-level campaign across six worlds (Gravekeeper, Sewn Lips, Salt Line,
Catacombs, The Lich, Necropolis). Local mock guard; full loop verified: `npm test`
(42 checks) passes and every level is crackable by its intended technique; the
client plays start to reveal on desktop and mobile. `O4`/`I3`/`I4` and the
adaptive boss are deterministic prototypes (see LADDER.md); their full teeth and
the calibrated crack rates come with a real provider. Not deployed.

Deferred: endless mode, the scout dashboard, and Baldur as a live adaptive final
boss.
