#!/usr/bin/env node
// Compile a private scenario source (plaintext answers) into the public
// scenario.json (hashed answers, encrypted reveals). Keep sources out of
// the public repo: they ARE the answer key.
//
//   node tools/build-scenario.mjs <source.json> <out/scenario.json> <passphrase-file> [other public files to leak-check...]
//
// Source format = scenario.json format, plus:
//   question.answers   accepted answers (text) or the correct option id (choice)
//   question.reveal    explanation shown once answered (encrypted)
//   debrief.chain[].text  (encrypted; .by = question id that unlocks it)
// The build fails if any answer text survives anywhere in the output.
import { readFile, writeFile } from "node:fs/promises";
import { answerHash, answerKeyMaterial, instructorKeyMaterial, lock, normalise } from "../js/crypto.js";

const KILL_CHAIN = ["recon", "weaponization", "delivery", "exploitation", "installation", "c2", "actions"];
const DIAMOND = ["adversary", "capability", "infrastructure", "victim"];

const [src, out, passFile] = process.argv.slice(2);
if (!src || !out || !passFile) {
  console.error("usage: build-scenario.mjs <source.json> <out/scenario.json> <passphrase-file>");
  process.exit(2);
}
const s = JSON.parse(await readFile(src, "utf8"));
const passphrase = (await readFile(passFile, "utf8")).split("\n")[0].trim();
const errors = [];
const salt = s.salt;
if (!salt || salt.length < 12) errors.push("salt missing or too short");

const instructor = instructorKeyMaterial(salt, passphrase);
const answersOf = new Map();

// Lock text under every accepted answer of question `by`, and the instructor key.
async function lockAll(text, by) {
  const locks = [];
  for (const ans of answersOf.get(by) || []) locks.push(await lock(answerKeyMaterial(salt, by, ans), by, text));
  locks.push(await lock(instructor, "instructor", text));
  return locks;
}

const ids = new Set();
const techniques = new Set((s.techniques || []).map((t) => t.id));
for (const q of s.questions) {
  if (ids.has(q.id)) errors.push(`duplicate question id ${q.id}`);
  ids.add(q.id);
  if (q.type === "text" || q.type === "choice") {
    if (!q.answers || !q.answers.length) errors.push(`${q.id}: no answers`);
    if (q.type === "choice" && !q.answers.every((a) => q.options.some((o) => o.id === a))) errors.push(`${q.id}: answer is not an option id`);
    answersOf.set(q.id, q.answers);
  }
  if (q.card) {
    const r = q.card.ref || {};
    if (r.diamond && !DIAMOND.includes(r.diamond)) errors.push(`${q.id}: bad diamond ${r.diamond}`);
    if (r.killchain && !KILL_CHAIN.includes(r.killchain)) errors.push(`${q.id}: bad killchain ${r.killchain}`);
    if (r.attack && !techniques.has(r.attack)) errors.push(`${q.id}: technique ${r.attack} not in techniques list`);
  }
}

const outQ = [];
for (const q of s.questions) {
  const { answers, reveal, ...rest } = q;
  if (answers) rest.accept = await Promise.all(answers.map((a) => answerHash(salt, q.id, a)));
  if (reveal) rest.reveal = await lockAll(reveal, q.id);
  outQ.push(rest);
}
const chain = [];
for (const item of s.debrief?.chain || []) {
  const { text, ...rest } = item;
  if (item.by && !answersOf.has(item.by)) errors.push(`chain item at ${item.time}: unknown question ${item.by}`);
  chain.push({ ...rest, locks: await lockAll(text, item.by) });
}

const built = {
  ...s,
  questions: outQ,
  debrief: { ...(s.debrief || {}), chain },
  instructor_check: await lock(instructor, "instructor", "ok"),
};
const json = JSON.stringify(built, null, 1);

// Leak check: no accepted text answer may appear in the public file, or in
// the scenario's other public files given after the passphrase file (e.g.
// intel.json), as a whole token. "batman" inside "imreallynotbatman" is fine.
const extra = await Promise.all(process.argv.slice(5).map((f) => readFile(f, "utf8")));
const hay = [json, ...extra].map(normalise).join("\n");
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const q of s.questions) {
  if (q.type !== "text") continue;
  for (const a of q.answers) {
    const n = normalise(a);
    const forms = [n, n.replace(/\\/g, "\\\\")];
    if (n.length >= 4 && forms.some((f) => new RegExp(`(?<![a-z0-9])${esc(f)}(?![a-z0-9])`).test(hay)))
      errors.push(`LEAK: answer "${a}" (${q.id}) appears in a public file`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => "  " + e).join("\n"));
  process.exit(1);
}
await writeFile(out, json + "\n");
console.log(`${out}: ${outQ.length} questions, ${chain.length} chain entries`);
