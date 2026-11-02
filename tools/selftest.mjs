#!/usr/bin/env node
// Check built scenarios against their private sources and their event data:
//   node tools/selftest.mjs <private scenarios dir> <passphrase-file>
// For every question: the plaintext answer hashes into `accept`, reveals and
// debrief entries unlock with the answer and with the instructor passphrase,
// the answer is present in the event slice, and (guided mode) the preset
// query returns events that contain it. Also runs query-language unit tests.
import { readFile } from "node:fs/promises";
import { answerHash, answerKeyMaterial, instructorKeyMaterial, unlock, normalise } from "../js/crypto.js";
import { compile, prepare } from "../js/query.js";

const [srcDir, passFile] = process.argv.slice(2);
const pass = (await readFile(passFile, "utf8")).split("\n")[0].trim();
const registry = JSON.parse(await readFile("scenarios/index.json", "utf8"));
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  FAIL " + msg); } };

for (const entry of registry.scenarios) {
  const dir = `scenarios/${entry.id}/`;
  const src = JSON.parse(await readFile(`${srcDir}/${entry.id}.src.json`, "utf8"));
  const pub = JSON.parse(await readFile(dir + "scenario.json", "utf8"));
  const { events } = JSON.parse(await readFile(dir + "events.json", "utf8"));
  events.sort((a, b) => a._time - b._time);
  const index = prepare(events);
  console.log(`${entry.id}: ${events.length} events`);
  ok((await unlock([pub.instructor_check], instructorKeyMaterial(pub.salt, pass), "instructor")) === "ok", "instructor check");

  for (const q of src.questions) {
    const p = pub.questions.find((x) => x.id === q.id);
    if (!q.answers) continue;
    for (const a of q.answers) ok(p.accept.includes(await answerHash(pub.salt, q.id, a)), `${q.id}: "${a}" not accepted`);
    ok(!p.accept.includes(await answerHash(pub.salt, q.id, "wrong answer")), `${q.id}: accepts a wrong answer`);
    if (q.reveal) {
      for (const a of q.answers) ok((await unlock(p.reveal, answerKeyMaterial(pub.salt, q.id, a), q.id)) === q.reveal, `${q.id}: reveal doesn't unlock with "${a}"`);
      ok((await unlock(p.reveal, instructorKeyMaterial(pub.salt, pass), "instructor")) === q.reveal, `${q.id}: reveal doesn't unlock for instructor`);
      ok((await unlock(p.reveal, answerKeyMaterial(pub.salt, q.id, "nope"), q.id)) === null, `${q.id}: reveal unlocks with a wrong answer`);
    }
    if (q.type === "text") {
      const inData = q.answers.some((a) => events.some((e) => e._h.includes(normalise(a))));
      ok(inData || q.id === "actor", `${q.id}: no accepted answer appears in the event data`);
      if (pub.mode === "guided" && q.preset?.query) {
        const hits = events.filter(compile(q.preset.query, index));
        ok(hits.length > 0, `${q.id}: preset query returns nothing`);
        ok(q.answers.some((a) => hits.some((e) => e._h.includes(normalise(a)))), `${q.id}: answer not in preset results (${hits.length} events)`);
        console.log(`  ${q.id}: preset → ${hits.length} events`);
      }
    }
  }
  for (const [i, c] of (src.debrief.chain || []).entries()) {
    const locks = pub.debrief.chain[i].locks;
    const a = src.questions.find((q) => q.id === c.by).answers[0];
    ok((await unlock(locks, answerKeyMaterial(pub.salt, c.by, a), c.by)) === c.text, `chain ${c.time}: doesn't unlock with ${c.by}`);
    ok((await unlock(locks, instructorKeyMaterial(pub.salt, pass), "instructor")) === c.text, `chain ${c.time}: instructor unlock`);
  }
}

// Query language
const evs = [
  { _time: 1, sourcetype: "stream:http", host: "a", src_ip: "1.2.3.4", uri_path: "/joomla/x", status: 200, _raw: "GET C:\\Windows hello world" },
  { _time: 2, sourcetype: "suricata", host: "b", src_ip: "5.6.7.8", "alert.signature": "ET SCAN Acunetix", tags: ["x", "y"] },
  { _time: 3, sourcetype: "stream:http", host: "a", src_ip: "5.6.7.8", status: 404 },
];
const idx = prepare(evs);
const run = (q) => evs.filter(compile(q, idx)).map((e) => e._time).join(",");
const cases = [
  ["", "1,2,3"], ["sourcetype=stream:http", "1,3"], ["sourcetype:stream:http", "1,3"], ["SOURCETYPE=STREAM:HTTP", "1,3"],
  ["src_ip=5.6.7.8 status=404", "3"], ["src_ip=5.6.7.8 OR status=200", "1,2,3"], ["NOT src_ip=5.6.7.8", "1"],
  ["sourcetype=stream:http NOT (status=404)", "1"], ["uri_path=/joomla/*", "1"], ['alert.signature="ET SCAN*"', "2"],
  ["status>=300", "3"], ["status!=200", "3"], ["acunetix", "2"], ['"hello world"', "1"], ["C:\\Windows", "1"],
  ["tags=y", "2"], ["src_ip=*", "1,2,3"], ["hel*rld", "1"],
];
for (const [q, want] of cases) { const got = run(q); ok(got === want, `query ${JSON.stringify(q)}: got [${got}] want [${want}]`); }
for (const bad of ['"unclosed', "(a", "a )", "x | stats count"]) {
  let threw = false; try { compile(bad, idx); } catch { threw = true; } ok(threw, `query ${JSON.stringify(bad)} should be an error`);
}

console.log(fails ? `${fails} failures` : "all checks passed");
process.exit(fails ? 1 : 0);
