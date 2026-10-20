// progress.test.mjs — what the server keeps of an attempt (progress.js), through
// the Worker router: how much of each turn is stored.
// Run: npm test (or node --test worker/progress.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";
import { ladderFor } from "./ladder.js";
import { historyFor } from "./progress.js";

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
