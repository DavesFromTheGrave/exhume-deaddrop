# Dead Drop

A browser prompt-injection game. The model guards a benign nonsense word; the
player makes it leak, then claims it. Gandalf-style secret extraction with a
Revenant Systems skin, built as the qualifier for the red-team chapter and,
later, the instrument for a research study.

**Name: Dead Drop.** Each campaign's copy (game name, wordmark, what a level is
called, the filter names) lives in its `META.theme` block in `worker/levels.js`
or `worker/levels.15.js`; the client reads it from `/api/levels`. The 35 keeps
the jade "from the Grave" headstone as its wordmark. The project folder is still
`Exhume` internally (not user-facing).

The word is derived and verified **server-side**. It never reaches the browser.
Winning is a claim: the player types the word into the claim box and the Worker
checks it by exact match after normalization. Detecting the word in the guard's
reply is an output *filter* (Sewn Lips), never the referee.

## Two ladders, one engine

| `LADDER` | File | What it is |
|---|---|---|
| `35` (default) | [`worker/levels.js`](worker/levels.js) | The crypt campaign: eight worlds, five ring guards. Design targets in [`LADDER.md`](LADDER.md). |
| `15` | [`worker/levels.15.js`](worker/levels.15.js) | The fantasy recut: The Village, The Crypt, The Warded Halls, The Archmage's Tower, The Dragon's Hoard. Four guardians. |

Set `LADDER` in [`wrangler.toml`](wrangler.toml) `[vars]` on Workers, or as an
environment variable on the Node host. Switching deletes nothing: progress is
stored per ladder (the 35 keeps its original key), so flipping it back is the
rollback. [`worker/ladder.js`](worker/ladder.js) is the only place that knows
both exist.

## Run it locally

Needs Node 18+ (built on Node 26). Offline play needs no Cloudflare account, no
API keys and no GPU: pass `--var PROVIDER:mock` for the deterministic stand-in
guard. Without it, `wrangler.toml` uses Groq and needs `GROQ_API_KEY` in `.dev.vars`.

```bash
npm install
npx wrangler dev --var PROVIDER:mock     # offline; wrangler.toml defaults to groq
```

Open the URL Wrangler prints (defaults to `http://127.0.0.1:8787`; this machine
reserves that port, so a fixed free port is used instead):

```bash
npx wrangler dev --port 4321 --ip 127.0.0.1 --inspector-port 0 --var PROVIDER:mock
```

Then open `http://127.0.0.1:4321`. First play needs no login; a random player id
lives in the browser.

Verify the whole loop without a browser:

```bash
npm test          # offline, both ladders: every intended crack, naive asks, a full
                  # playthrough through the router, and the word never leaving the server
```

## The guard (providers)

Set `PROVIDER` in [`wrangler.toml`](wrangler.toml). Free-tier pools first.

| PROVIDER | What it is | Needs |
|---|---|---|
| `mock` | Deterministic offline stand-in. Makes each level winnable by its intended technique. Not a real model. | nothing |
| `groq` (wrangler.toml default) | Groq API, `openai/gpt-oss-20b` (`GROQ_MODEL`), falling back through a list | `GROQ_API_KEY` |
| `workers-ai` | Cloudflare Workers AI, `WORKERS_AI_MODEL` | a Cloudflare account; uncomment `[ai]` |
| `google` | Google AI Studio, `gemini-2.5-flash` (`GOOGLE_MODEL`) | `GOOGLE_API_KEY` |
| `ollama` | Local Ollama. Spends the GPU, so never the default. | Ollama running; `OLLAMA_URL` |

Model ids retire under you. Groq retired `llama-3.1-8b-instant` and
`llama-3.3-70b-versatile` for free and developer accounts on 2026-08-16 and names
`openai/gpt-oss-20b` as the replacement. Workers AI retired
`@cf/meta/llama-3.1-8b-instruct` on 2026-05-30; check the live catalog with
`npx wrangler ai models list --search llama` before setting `WORKERS_AI_MODEL`.
gpt-oss is a reasoning model: its reasoning shares the `max_tokens` budget, so
the Groq call sends `reasoning_effort: "low"`, and an empty completion is treated
as an error (the player's exchange is not spent) rather than a blank reply. The
ladder's crack-rate targets were set for an 8B Llama; a reasoning guard resists
harder, so the next calibration pass is what tells you whether the targets hold.

Keys go in `.dev.vars` locally (copy from [`.dev.vars.example`](.dev.vars.example),
never committed) and as Worker secrets in production. `SERVER_KEY` keys the word
derivation; set a real one before any real deployment.

The mock is the stand-in used to build and test the plumbing. Real guard
behavior, and the P0 calibration that tunes the crack rates in `LADDER.md`, needs
one of the real providers.

## The cost ceiling

Three caps, set in the `[vars]` block of [`wrangler.toml`](wrangler.toml) or the
Node app's environment:

- `DAILY_CANDLES` (default 300): model turns per player per day. Spent, the
  player waits for midnight UTC.
- `IP_HOURLY_TURNS` (default 120): model turns per connection per hour.
- `GLOBAL_DAILY_TURNS` (wrangler.toml: 1000): model turns per day across
  everyone. Hit, the game closes for all until midnight and says so. Set it at or
  below the provider's own daily request limit, so the game closes with a clear
  message before the provider starts refusing. Third-party summaries put Groq's
  free tier for `openai/gpt-oss-20b` at about 1,000 requests a day and 8,000
  tokens per minute; check your account's limits page.

Only real inference spends a candle. A message stopped by an input filter does no
inference and does not touch the cost cap (it still spends an exchange). A turn
the provider fails to answer is refunded and spends no exchange; a rate limit
(429) tells the player the guard is at capacity. None of the free-tier provider
accounts take a card, so overage is impossible, not merely unlikely.

Counts are kept one request at a time within a process (`worker/lock.js`), which
covers the Node host. On Workers, KV across isolates is eventually consistent,
so the caps there are close, not exact.

Counters live in a KV namespace (binding `EXHUME_KV`) when one is bound, else in
memory (fine for local; resets on reload). Attempt logs go to a D1 table
(`EXHUME_DB`, schema in [`schema.sql`](schema.sql)) when bound, else one JSON line
per attempt to the console.

## What is and is not enforced

Server-side, and trustworthy: the word is derived from `SERVER_KEY` and never
sent outside an earned reply and the reveal; every claim is checked on the
Worker; exchanges, guesses, attempts, locks and level gating
(`worker/progress.js`), one request at a time per player; the daily, per-IP and
global caps; and the conversation itself. "One at a time" is exact on the Node
host, where one process owns the store. On Workers it holds within an isolate
only; parallel requests landing in different isolates can still race, and a
Durable Object per player is the fix if Workers becomes the host. The transcript lives in the open
attempt on the server, so every turn the guard sees passed the input filters, and
a browser cannot add or forge turns. Each exchange is stored as the player saw
it, so a reply that earned the word holds it until the attempt closes. Words are
derived per ladder, so level N on the 35 and level N on the 15 never share one.

When an output filter fires, the reply is withheld unless masking provably
removed the leak (`redact()` in `worker/filters.js`).

Identity: behind the Node host, `x-player-id`, `x-client-ip` and `x-admin` come
from `server.mjs`, which rebuilds each request. On Workers nothing sits in front,
so those headers are ignored and the player id comes from the body (or
`?playerId=` on a GET). The Worker trusts the headers when `env.STORE` is present
(the Node host supplies it) or `TRUST_IDENTITY_HEADERS` is `"1"`.

## Add a level

One entry in [`worker/levels.js`](worker/levels.js) (or `levels.15.js`).
Everything else (level select, defense rack, reveal) reads from it.

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

Run `npm test` after. Add the new level's intended crack to
[`fixtures/cracks.mjs`](fixtures/cracks.mjs); the self-test fails on any level
without one. `node answer-key.mjs` (or `LADDER=15 node answer-key.mjs`)
regenerates the answer key from the same fixtures.

## Deploy

Not done here (deploying is a separate decision). When you do:

```bash
wrangler kv namespace create EXHUME_KV     # then paste the id into wrangler.toml
wrangler d1 create exhume                  # then the id, then:
wrangler d1 execute exhume --file=schema.sql
wrangler secret put SERVER_KEY             # a long random string
npm run deploy
```

Set `PROVIDER` to a real provider and put its key in as a secret
(`wrangler secret put GROQ_API_KEY`). The static client is served by the same
Worker, so one deploy ships both. On the cPanel Node host, copy `worker/` over
and set `LADDER`, `PROVIDER`, `GROQ_API_KEY` in the Node app's environment.

## Layout

```
LADDER.md            the 35 levels and their design targets
ANSWER-KEY*.md       generated: how each level is meant to fall (never the words)
wrangler.toml        Worker config, LADDER, provider, cost caps, optional bindings
schema.sql           D1 attempt-log schema
fixtures/cracks.mjs  the intended crack per level, for the mock (tests + answer key)
worker/
  index.js           router: /api/levels, /api/me, /api/start, /api/turn, /api/hint, /api/claim
  ladder.js          picks the 35 or the 15 from env.LADDER
  levels.js          the 35-level spec + its META (theme, doors)
  levels.15.js       the 15-level spec + its META
  progress.js        per-player, per-ladder progress, attempts, locks, hints, transcript
  store.js           key/value over env.STORE (Node host), KV, or memory
  guard.js           guard personas, prompts (G0-G4) + per-channel context assembly
  providers.js       mock | workers-ai | groq | google | ollama
  filters.js         input + output filters, redaction, leak detection, technique tagger
  secret.js          deterministic word derivation + claim check
  candles.js         per-player daily allowance + global ceiling
  log.js             structured per-attempt log (D1 or console)
  reveal.js          the crack reveal (guard prompt, config, technique card + fix)
  selftest.mjs       offline proof the loop works, both ladders
public/              the browser client (index.html, style.css, app.js)
  curriculum/        the two training pages, linked from each reveal
```

## Status

Two campaigns on one engine: the 35 (eight worlds, five ring guards, live by
default) and the 15-level fantasy recut (`LADDER = "15"` to switch). Offline
against the mock guard, `npm test` passes for both: every level is crackable by
its intended technique, a full playthrough runs through the router, and the word
never leaves the server outside an earned reply and the reveal. The client plays
start to reveal on desktop and mobile. `O4`/`I3`/`I4` and the adaptive boss are
deterministic prototypes (see LADDER.md); their full teeth come with a real
provider.

The one real-model calibration so far (`CALIBRATION-2026-09-16.md`) measured 0%
everywhere, and it is not a clean measurement of the ladder. The Groq fallback
landed on `openai/gpt-oss-20b`, a reasoning model, with a 200-token budget and no
`reasoning_effort`, so eleven levels got only empty replies; level 1's `G0`
prompt at the time did not contain the word at all; and 31-35 hit 429 rate
limits. The code causes are fixed. Re-run it before tuning anything.

Deferred: endless mode, the scout dashboard, and Baldur as a live adaptive final
boss.
