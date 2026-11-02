#!/usr/bin/env node
// Print the answer hash for a scenario question, e.g. to check an accepted
// form by hand:  node tools/hash.mjs <salt> <questionId> "<answer>" ["<answer>" ...]
// Same algorithm as the browser: SHA-256("<salt>|<questionId>|<normalised answer>").
import { answerHash, normalise } from "../js/crypto.js";

const [salt, qid, ...answers] = process.argv.slice(2);
if (!salt || !qid || !answers.length) {
  console.error('usage: hash.mjs <salt> <questionId> "<answer>" [...]');
  process.exit(2);
}
for (const a of answers) console.log(`${await answerHash(salt, qid, a)}  ${JSON.stringify(normalise(a))}`);
