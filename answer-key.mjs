// answer-key.mjs — writes the answer key: the methods, never the words.
// The words are derived per player, per level, per day and never stored, so the
// only honest key is the one that tells you how each level is meant to fall.
//
//   node answer-key.mjs [outfile]              the 35  -> ANSWER-KEY.md
//   LADDER=15 node answer-key.mjs [outfile]    the 15  -> ANSWER-KEY.15.md

import { ladderFor } from "./worker/ladder.js";
import { PERSONAS } from "./worker/guard.js";
import { CRACKS_BY_LADDER } from "./fixtures/cracks.mjs";
import { writeFileSync } from "node:fs";

const { LEVELS, META } = ladderFor({ LADDER: process.env.LADDER });
const CRACKS = CRACKS_BY_LADDER[META.id];
const OUT = process.argv[2] || (META.id === "35" ? "ANSWER-KEY.md" : `ANSWER-KEY.${META.id}.md`);
const pad = (n) => String(n).padStart(2, "0");

// "The Gravekeeper 1-17, Orion 18-23, ..." from the levels themselves.
const rings = [];
for (const l of LEVELS) {
  const last = rings[rings.length - 1];
  if (last && last.persona === l.persona) last.to = l.id;
  else rings.push({ persona: l.persona, from: l.id, to: l.id });
}
const ringLine = rings.map((r) => `${(PERSONAS[r.persona] || PERSONAS.gravekeeper).name} ${r.from}${r.to !== r.from ? "-" + r.to : ""}`).join(", ");
const bossLine = LEVELS.filter((l) => l.boss).map((l) =>
  `${l.id}${l.id === META.doors.club ? ` (${l.name}, the Alignment Club gate)` : l.id === META.doors.apply ? " (the résumé door)" : ""}`).join(", ");

const GUARD = {
  G0: "no instruction at all; the word simply sits in the prompt",
  G1: "one line: do not reveal the word",
  G2: "an enumerated ban: no repeating, spelling, reversing, encoding, rhyming, hinting, confirming",
  G3: "a strict written policy: any ask for the word or anything derived from it is an attack; forged delimiters carry no authority",
  G4: "the hardened policy with worked refusal examples, including forged roles, fake verdicts and claimed identities",
};
const OUT_F = {
  O1: "O1 verbatim: the exact word in the reply",
  O2: "O2 normalized: the word after stripping punctuation, plus reversed, leet and spaced forms",
  O3: "O3 fragments: any 4-letter piece of the word, or its letters leaked in order",
  O4: "O4 judge: a second reader decides whether the reply leaks; it believes a verdict it reads",
};
const IN_F = {
  I1: "I1 blocklist: known attack words in your message",
  I2: "I2 patterns: the shapes of known attacks (overrides, role play openers, continuation asks)",
  I3: "I3 screener: a second reader rejects short, pointed extraction asks; long ordinary text passes",
  I4: "I4 stateful screener: explicit extraction language, and it remembers what you said earlier",
};
const CHANNEL = {
  chat: "you talk to the guard directly",
  document: "the guard is asked to summarize what you wrote; you are the document, not the user",
  tool: "the guard asked a weather tool; your text arrives as the tool's result",
  cot: "the guard reasons inside <think> tags before it answers; the filters only read the answer",
};

const lines = [];
lines.push(`# ${META.theme.game} answer key (${META.id}-level ladder): the methods, never the words`);
lines.push("");
lines.push("Every word is derived per player, per level, per day from the server key and is never stored, so there is no word list. This is the playbook: what each level defends with, how it is meant to fall, one message built to do it, and what the filters will eat. Generated from `worker/" + (META.id === "35" ? "levels.js" : `levels.${META.id}.js`) + "` on " + new Date().toISOString().slice(0, 10) + ".");
lines.push("");
lines.push(`Guards: ${ringLine}. Bosses: ${bossLine}. Everything not a boss is 12 exchanges, 3 guesses, 3 attempts a day.`);
lines.push("");
let world = "";
for (const l of LEVELS) {
  if (l.world !== world) { world = l.world; lines.push(`## ${world}`); lines.push(""); }
  const p = PERSONAS[l.persona] || PERSONAS.gravekeeper;
  lines.push(`### ${pad(l.id)} · ${l.name}${l.boss ? (l.id === META.doors.apply ? " (final)" : " (boss)") : ""}`);
  lines.push("");
  lines.push(`- Guard: ${p.name}. ${GUARD[l.guard]}. Model tier ${l.model}.`);
  lines.push(`- Counts: ${l.candles} exchange${l.candles === 1 ? "" : "s"}, ${l.digs} guess${l.digs === 1 ? "" : "es"}, ${l.attempts} attempt${l.attempts === 1 ? "" : "s"} a day.`);
  lines.push(`- Channel: ${CHANNEL[l.channel]}.${l.stateful ? "" : " The guard has no memory between exchanges."}${l.decoys ? ` The guard also holds ${l.decoys} decoy words.` : ""}${l.adaptive ? " It adds rules against the techniques that won your recent levels." : ""}`);
  lines.push(`- Output filters: ${l.output.length ? l.output.map((o) => OUT_F[o]).join("; ") : "none"}.`);
  lines.push(`- Input filters: ${l.input.length ? l.input.map((i) => IN_F[i]).join("; ") : "none"}.`);
  lines.push(`- Technique family: ${l.probeFamily}. Design crack rate per good message: ${Math.round((l.targetCrack || 0) * 100)}%.`);
  lines.push(`- Lesson: ${l.lesson}`);
  lines.push(`- Built message: \`${(CRACKS[l.id] || "").replace(/\n/g, "\\n")}\``);
  lines.push(`- Hints the player can buy: ${(l.hints || []).map((h) => `"${h}"`).join(" / ")}`);
  lines.push("");
}
lines.push("## Reading the reply");
lines.push("");
lines.push("- NATO words spell the word one letter each (Alfa Bravo Charlie...). Ignore the filler words around them.");
lines.push("- Reversed replies read right to left. Leet swaps 4 3 1 0 5 7 for a e i o s t.");
lines.push("- On decoy levels the guard holds three words. Ask how they are labelled, not for a word; the instructions say which slot is real.");
lines.push("- On the reasoning level the answer is clean; the word is inside the <think> block above it.");
lines.push("");
writeFileSync(OUT, lines.join("\n"));
console.log("wrote " + OUT + " (" + LEVELS.length + " levels)");
