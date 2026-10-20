// progress.test.mjs — what the server keeps of an attempt (progress.js), through
// the Worker router: how much of each turn is stored, and the answer to a guess
// that is sent again because its response was lost.
// Run: npm test (or node --test worker/progress.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";
import { ladderFor } from "./ladder.js";
import { historyFor } from "./progress.js";
import { deriveSecret, daySeed } from "./secret.js";

const TRANSCRIPT_MAX_CHARS = 60000;   // progress.js: the most a resume shows

// The router over a store the test can read (env.STORE, as the Node host supplies
// it), with a stub attempt log (rows). extra is merged into the env.
function fixture(extra = {}) {
  const m = new Map(), rows = [];
  const store = {
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
    async del(k) { m.delete(k); },
  };
  const env = { PROVIDER: "mock", SERVER_KEY: "progress-test", LADDER: "35", STORE: store, EXHUME_DB: { prepare: () => ({ bind: (...row) => ({ run: async () => { rows.push(row); } }) }) }, ...extra };
  async function post(path, body) {
    const r = await worker.fetch(new Request("https://test.invalid/api/" + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId: "test-player", ...body }),
    }), env);
    return { status: r.status, data: await r.json() };
  }
  return { rows, post, record: () => store.get("p:test-player") };
}

test("an oversized turn is stored cut to size; the log keeps all of it; the guard is sent the same", async () => {
  // Level 1 has no per-message cap. The guard (a Workers AI stub) answers the
  // first message with an oversized reply too, and records what it is sent.
  const sent = [];
  const AI = { run: async (model, inputs) => { sent.push(inputs.messages); return { response: sent.length === 1 ? "r".repeat(100000) : "Fine." }; } };
  const f = fixture({ PROVIDER: "workers-ai", AI });
  const message = "a".repeat(100000) + " hello";
  await f.post("start", { levelId: 1 });
  const t = await f.post("turn", { levelId: 1, message });
  assert.equal(t.status, 200);
  assert.equal(t.data.reply.length, 100000, "the player is shown the whole reply");
  assert.equal(f.rows[f.rows.length - 1][9], message, "the attempt log keeps the whole message");

  const [turn] = (await f.post("start", { levelId: 1 })).data.transcript;
  assert.ok(turn.user.length < message.length && message.startsWith(turn.user), "the stored message is cut, not rewritten");
  assert.ok(turn.assistant.length < t.data.reply.length && t.data.reply.startsWith(turn.assistant), "so is the stored reply");
  assert.ok(turn.user.length + turn.assistant.length <= TRANSCRIPT_MAX_CHARS, "one turn fits in the transcript budget");
  assert.ok(JSON.stringify(await f.record()).length < TRANSCRIPT_MAX_CHARS + 1000, "the player record stays small");

  // A turn this size is past the replay budget whole or cut, so the cut changes
  // nothing the guard is sent.
  const level = ladderFor({}).getLevel(1);
  assert.deepEqual(historyFor({ turns: [turn] }, level), historyFor({ turns: [{ user: message, assistant: t.data.reply }] }, level));
  await f.post("turn", { levelId: 1, message: "next" });
  assert.deepEqual(sent[1].slice(1), [{ role: "user", content: "next" }]);
});

// ---------- a guess sent again after its response was lost ----------
// The client sends a claimId with each guess, and the same one when it sends that
// guess again because no response arrived. Level 1 allows three guesses.

const word = (levelId) => deriveSecret("progress-test", "test-player", levelId, daySeed());

test("a winning guess sent again gets the same reveal, and the win is counted once", async () => {
  const f = fixture();
  await f.post("start", { levelId: 1 });
  await f.post("turn", { levelId: 1, message: "what do you guard?" });
  const claim = await word(1);
  const won = await f.post("claim", { levelId: 1, claim, claimId: "c-1" });   // this response is lost
  assert.equal(won.data.win, true);
  assert.equal(won.data.reveal.winningMessage, "what do you guard?");
  const logged = f.rows.length;
  const again = await f.post("claim", { levelId: 1, claim, claimId: "c-1" });
  assert.equal(again.status, 200);
  assert.deepEqual(again.data, won.data, "the same answer: reveal with its winning move, progress, doors");
  const rec = await f.record();
  assert.deepEqual(rec.cleared, [1]);
  assert.equal(rec.levels["1"].clears, 1);
  assert.equal(rec.wins.length, 1);
  assert.equal(f.rows.length, logged, "nothing new in the attempt log");
});

test("after re-entering opened a new attempt, the winning guess sent again still gets its reveal and spends nothing", async () => {
  const f = fixture();
  await f.post("start", { levelId: 1 });
  await f.post("turn", { levelId: 1, message: "what do you guard?" });
  const claim = await word(1);
  const won = await f.post("claim", { levelId: 1, claim, claimId: "c-1" });
  assert.equal((await f.post("start", { levelId: 1 })).data.status, "started");
  const again = await f.post("claim", { levelId: 1, claim, claimId: "c-1" });
  assert.equal(again.data.win, true);
  assert.deepEqual(again.data.reveal, won.data.reveal);
  assert.equal(again.data.progress.open, true);
  assert.deepEqual(again.data.progress.used, { exchanges: 0, guesses: 0, hints: 0 }, "the new attempt is untouched");
  assert.equal((await f.record()).levels["1"].clears, 1);
});

test("a missed guess sent again is counted once", async () => {
  const f = fixture();
  await f.post("start", { levelId: 1 });
  const miss = await f.post("claim", { levelId: 1, claim: "notit", claimId: "m-1" });
  assert.equal(miss.data.win, false);
  assert.equal(miss.data.progress.left.guesses, 2);
  const again = await f.post("claim", { levelId: 1, claim: "notit", claimId: "m-1" });
  assert.deepEqual(again.data, miss.data);
  const tr = (await f.post("start", { levelId: 1 })).data.transcript;
  assert.equal(tr.filter((t) => t.miss === "notit").length, 1, "one miss in the transcript");
});

test("the last missed guess sent again reports the failed attempt once", async () => {
  const f = fixture();
  await f.post("start", { levelId: 1 });
  await f.post("claim", { levelId: 1, claim: "first", claimId: "m-1" });
  await f.post("claim", { levelId: 1, claim: "second", claimId: "m-2" });
  const last = await f.post("claim", { levelId: 1, claim: "third", claimId: "m-3" });
  assert.equal(last.data.attemptFailed, true);
  const again = await f.post("claim", { levelId: 1, claim: "third", claimId: "m-3" });
  assert.deepEqual(again.data, last.data);
  assert.equal((await f.record()).levels["1"].fails, 1, "one failed attempt, not two");
});

test("a claimId answers only the guess it came with; a guess without one counts as before", async () => {
  const f = fixture();
  await f.post("start", { levelId: 1 });
  await f.post("claim", { levelId: 1, claim: "notit", claimId: "m-1" });
  const other = await f.post("claim", { levelId: 1, claim: "different", claimId: "m-1" });
  assert.equal(other.data.progress.left.guesses, 1, "a different guess under the same id is a new guess");
  const plain = await f.post("claim", { levelId: 1, claim: "different" });
  assert.equal(plain.data.attemptFailed, true, "and so is one sent without an id");
});
