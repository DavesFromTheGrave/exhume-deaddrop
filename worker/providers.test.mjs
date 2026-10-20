// providers.test.mjs — the real-provider adapters in providers.js, offline. Each
// test stubs the transport (env.AI for Workers AI, globalThis.fetch for Groq,
// Google and Ollama) and checks what is sent, how the reply is read, and what the
// router does with the result. The 25 s timeout runs on a hand-fired clock:
// AbortSignal.timeout is replaced, so no test waits for real time.
// Run: npm test (or node --test worker/providers.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";
import { callProvider } from "./providers.js";

const SYSTEM = "You guard the word.";
// A guard request as the router builds it: the system prompt, then the conversation.
const REQ = { system: SYSTEM, messages: [{ role: "user", content: "earlier" }, { role: "assistant", content: "An earlier answer." }, { role: "user", content: "hello" }] };

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
// A successful answer in each provider's reply shape.
const REPLY = {
  "workers-ai": (text) => ({ response: text }),
  groq: (text) => json({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] }),
  google: (text) => json({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] }),
  ollama: (text) => json({ message: { role: "assistant", content: text }, done: true, done_reason: "stop" }),
};
const FETCH_ENVS = {
  groq: { PROVIDER: "groq", GROQ_API_KEY: "test-key" },
  google: { PROVIDER: "google", GOOGLE_API_KEY: "test-key" },
  ollama: { PROVIDER: "ollama" },
};

// Run fn with globalThis.fetch answered by reply(url, init); fn gets the requests seen.
async function withFetch(reply, fn) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init, body: JSON.parse(init.body) });
    return reply(String(url), init);
  };
  try { return await fn(seen); } finally { globalThis.fetch = real; }
}

// Run fn(env) with the named provider's transport answering through send(signal).
async function withTransport(name, send, fn) {
  if (name === "workers-ai") return fn({ PROVIDER: "workers-ai", AI: { run: (model, inputs, options) => send(options && options.signal) } });
  return withFetch((url, init) => send(init.signal), () => fn(FETCH_ENVS[name]));
}

// A hand-fired clock for the provider timeout. While it is installed,
// AbortSignal.timeout(ms) records ms and returns a signal that aborts, with the
// TimeoutError the real one uses, only when the test calls fire().
async function withClock(fn) {
  const real = AbortSignal.timeout;
  const asked = [], live = [];
  AbortSignal.timeout = (ms) => { asked.push(ms); const c = new AbortController(); live.push(c); return c.signal; };
  const fire = () => { for (const c of live.splice(0)) c.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")); };
  try { return await fn({ asked, fire }); } finally { AbortSignal.timeout = real; }
}

// A call that never answers. Like fetch and the Workers AI binding, it settles only
// by rejecting when its signal aborts; a call sent without a signal hangs, and the
// test's own timeout reports it.
function stalled(signal, events, name) {
  events.push(name + " sent");
  return new Promise((_, reject) => {
    if (signal) signal.addEventListener("abort", () => { events.push(name + " cancelled"); reject(signal.reason); }, { once: true });
  });
}

const tick = () => new Promise((r) => setImmediate(r));
async function ticks(n) { for (let i = 0; i < n; i++) await tick(); }
async function until(cond) {
  for (let i = 0; i < 1000 && !cond(); i++) await tick();
  assert.ok(cond(), "the condition never held");
}

// The Worker router with an in-memory store and a stub attempt log (rows). Each
// test plays as its own player, so a turn left hanging by a failed test cannot
// hold the next test's lock.
function router(env, playerId) {
  const rows = [];
  const full = { SERVER_KEY: "providers-test", LADDER: "35", EXHUME_DB: { prepare: () => ({ bind: (...row) => ({ run: async () => { rows.push(row); } }) }) }, ...env };
  async function post(path, body) {
    const r = await worker.fetch(new Request("https://test.invalid/api/" + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId, ...body }),
    }), full);
    const text = await r.text();
    return { status: r.status, text, data: JSON.parse(text) };
  }
  return { rows, post };
}

// ---------- the 25 s timeout ----------

for (const name of ["workers-ai", "groq", "google", "ollama"]) {
  test(`${name}: a stalled guard is cancelled at 25 s; the turn fails, refunds, and holds the lock until then`, { timeout: 5000 }, async () => {
    await withClock(async ({ asked, fire }) => {
      const events = [];
      let calls = 0;
      const send = (signal) => {
        if (++calls === 1) return stalled(signal, events, "call 1");
        events.push("call 2 sent");
        return Promise.resolve(REPLY[name]("Second answer."));
      };
      await withTransport(name, send, async (env) => {
        const r = router(env, "stall-" + name);
        await r.post("start", { levelId: 1 });
        const first = r.post("turn", { levelId: 1, message: "hello" });
        await until(() => events.length === 1);
        const second = r.post("turn", { levelId: 1, message: "again" });
        await ticks(50);
        assert.deepEqual(events, ["call 1 sent"], "while the first call runs, the player's next turn waits for the lock");
        assert.deepEqual(asked, [25000], "the call asked for a 25 s timeout");

        fire();
        const a = await first, b = await second;
        assert.deepEqual(events, ["call 1 sent", "call 1 cancelled", "call 2 sent"], "the next turn starts only after the stalled call has stopped");
        assert.equal(a.status, 502);
        assert.equal(a.data.code, "PROVIDER_ERROR");
        assert.ok(!a.text.includes("TimeoutError") && !("detail" in a.data), "no provider error text reaches the browser");
        assert.equal(a.data.allowance.dailyUsed, 0, "the cancelled call is refunded");
        assert.equal(a.data.progress.left.exchanges, 12, "and spends no exchange");
        assert.equal(b.status, 200);
        assert.equal(b.data.reply, "Second answer.");
        assert.equal(b.data.allowance.dailyUsed, 1);
        assert.equal(b.data.progress.left.exchanges, 11);
        assert.deepEqual(asked, [25000, 25000]);
      });
    });
  });
}

// ---------- Ollama: an empty reply ----------

for (const [shape, reply] of [
  ["an empty reply", { message: { role: "assistant", content: "" }, done: true, done_reason: "length" }],
  ["a reply with only thinking", { message: { role: "assistant", content: "", thinking: "The visitor wants the word." }, done: true, done_reason: "length" }],
]) {
  test(`ollama: ${shape} is a billed empty completion, not a blank answer`, async () => {
    await withFetch(() => json(reply), async (seen) => {
      await assert.rejects(callProvider({ PROVIDER: "ollama" }, REQ), (e) => {
        assert.equal(e.billed, true);
        assert.equal(e.message, "llama3.1:8b returned an empty completion (finish_reason length)");
        return true;
      });
      assert.equal(seen[0].url, "http://127.0.0.1:11434/api/chat");
      assert.deepEqual(seen[0].body, { model: "llama3.1:8b", messages: [{ role: "system", content: SYSTEM }, ...REQ.messages], stream: false, options: { temperature: 0, num_predict: 200 } });
    });
  });
}

test("ollama: an empty reply through the router keeps the exchange, counts the call, and stores no blank turn", async () => {
  await withFetch(() => json({ message: { role: "assistant", content: "" }, done: true, done_reason: "length" }), async () => {
    const r = router({ PROVIDER: "ollama" }, "ollama-empty");
    await r.post("start", { levelId: 1 });
    const t = await r.post("turn", { levelId: 1, message: "hello" });
    assert.equal(t.status, 502);
    assert.equal(t.data.code, "PROVIDER_EMPTY");
    assert.equal(t.data.allowance.dailyUsed, 1, "the model ran, so the call counts toward the caps");
    assert.equal(t.data.progress.left.exchanges, 12, "the attempt keeps its exchange");
    assert.deepEqual((await r.post("start", { levelId: 1 })).data.transcript, [], "no blank turn is kept or replayed");
  });
});

// ---------- Workers AI: both reply shapes, and an empty one ----------

// An env.AI stub that records each run(model, inputs, options) and answers `out`.
function workersAI(out) {
  const runs = [];
  return { runs, env: { PROVIDER: "workers-ai", AI: { run: async (model, inputs, options) => { runs.push({ model, inputs, options }); return out; } } } };
}
const WORKERS_AI_DEFAULT = "@cf/meta/llama-3.1-8b-instruct-fp8";

for (const [shape, out] of [
  ["the Llama `response` shape", { response: "The gate holds." }],
  ["the chat-completions shape", { id: "chatcmpl-1", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "The gate holds." }, finish_reason: "stop" }] }],
]) {
  test(`workers-ai: reads ${shape}`, async () => {
    const { env, runs } = workersAI(out);
    assert.equal(await callProvider(env, REQ), "The gate holds.");
    assert.equal(runs[0].model, WORKERS_AI_DEFAULT);
    assert.deepEqual(runs[0].inputs, { messages: [{ role: "system", content: SYSTEM }, ...REQ.messages], max_tokens: 600, temperature: 0 });
  });
}

for (const [shape, out, error] of [
  ["empty chat-completions content", { choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }] }, `${WORKERS_AI_DEFAULT} returned an empty completion (finish_reason length)`],
  ["reasoning with no content", { choices: [{ message: { role: "assistant", content: null, reasoning_content: "The visitor wants the word." }, finish_reason: "length" }] }, `${WORKERS_AI_DEFAULT} returned an empty completion (finish_reason length)`],
  ["a blank `response`", { response: " \n" }, `${WORKERS_AI_DEFAULT} returned an empty completion`],
]) {
  test(`workers-ai: ${shape} is a billed empty completion`, async () => {
    await assert.rejects(callProvider(workersAI(out).env, REQ), (e) => {
      assert.equal(e.billed, true);
      assert.equal(e.message, error);
      return true;
    });
  });
}

test("workers-ai: an empty chat-completions answer through the router keeps the exchange and counts the call", async () => {
  const r = router(workersAI({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }] }).env, "workers-ai-empty");
  await r.post("start", { levelId: 1 });
  const t = await r.post("turn", { levelId: 1, message: "hello" });
  assert.equal(t.status, 502);
  assert.equal(t.data.code, "PROVIDER_EMPTY");
  assert.equal(t.data.allowance.dailyUsed, 1, "the model ran, so the call counts toward the caps");
  assert.equal(t.data.progress.left.exchanges, 12, "the attempt keeps its exchange");
  const row = r.rows[r.rows.length - 1];
  assert.equal(row[5], "error");
  assert.match(row[10], /finish_reason length/, "the attempt log keeps the finish reason");
});

// ---------- Google: one request body per model family ----------

// [GOOGLE_MODEL (unset means the default), the model in the URL, the generationConfig sent]
for (const [setting, model, generationConfig] of [
  [undefined, "gemini-2.5-flash", { maxOutputTokens: 400, temperature: 0, thinkingConfig: { thinkingBudget: 0 } }],
  ["gemini-2.5-flash-lite", "gemini-2.5-flash-lite", { maxOutputTokens: 400, temperature: 0, thinkingConfig: { thinkingBudget: 0 } }],
  ["gemini-3-flash-preview", "gemini-3-flash-preview", { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } }],
  ["gemini-3-pro-preview", "gemini-3-pro-preview", { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } }],
  ["gemini-2.5-pro", "gemini-2.5-pro", { maxOutputTokens: 1024, temperature: 0, thinkingConfig: { thinkingBudget: 128 } }],
  ["gemini-2.0-flash", "gemini-2.0-flash", { maxOutputTokens: 400, temperature: 0 }],
  ["gemma-3-27b-it", "gemma-3-27b-it", { maxOutputTokens: 400, temperature: 0 }],
]) {
  test(`google: the request for ${model}${setting ? "" : " (the default)"}`, async () => {
    await withFetch(() => REPLY.google("The gate holds."), async (seen) => {
      const env = { PROVIDER: "google", GOOGLE_API_KEY: "test-key", ...(setting ? { GOOGLE_MODEL: setting } : {}) };
      assert.equal(await callProvider(env, REQ), "The gate holds.");
      const url = new URL(seen[0].url);
      assert.equal(url.origin + url.pathname, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
      assert.equal(url.searchParams.get("key"), "test-key");
      assert.equal(seen[0].init.method, "POST");
      assert.deepEqual(seen[0].body, {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [
          { role: "user", parts: [{ text: "earlier" }] },
          { role: "model", parts: [{ text: "An earlier answer." }] },
          { role: "user", parts: [{ text: "hello" }] },
        ],
        generationConfig,
      });
    });
  });
}
