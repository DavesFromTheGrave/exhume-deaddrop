// ladder.js — which campaign is live. One engine, two ladders:
//
//   LADDER = "35"  the crypt campaign in levels.js (default, what ships today)
//   LADDER = "15"  the D&D recut in levels.15.js
//
// Set LADDER in wrangler.toml [vars] on Workers, or as an environment variable in
// the cPanel Node app. Nothing is deleted by switching; flip it back to roll back.
// Player progress is stored per ladder (progress.js), so a switch starts everyone
// fresh on the new ladder and leaves their old progress intact.

import * as L35 from "./levels.js";
import * as L15 from "./levels.15.js";

const LADDERS = {
  "35": { LEVELS: L35.LEVELS, getLevel: L35.getLevel, publicLevel: L35.publicLevel, META: L35.META },
  "15": { LEVELS: L15.LEVELS, getLevel: L15.getLevel, publicLevel: L15.publicLevel, META: L15.META },
};

export const DEFAULT_LADDER = "35";
export const LADDER_IDS = Object.keys(LADDERS);

export function ladderId(env) {
  const v = env && env.LADDER != null ? String(env.LADDER).trim() : "";
  return LADDERS[v] ? v : DEFAULT_LADDER;
}

export function ladderFor(env) {
  return LADDERS[ladderId(env)];
}
