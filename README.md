# SOC Simulator

A browser-based Security Operations Centre exercise built for BSAD 495 at
StFX. Teams investigate real 2016 attack data in a SIEM search view, an XDR
process tree and an offline intel feed. They answer questions, place their
findings on a threat-picture board (Diamond Model, Cyber Kill Chain, MITRE
ATT&CK) and make a containment decision.

Static files only: no accounts, no backend, no build step. Progress (team name
and answers) stays in the browser's localStorage.

**Students:** the logs contain real public IP addresses and domains from 2016.
Don't look them up or visit them on the live internet. Use the Intel tab.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

(ES modules need a web server; opening `index.html` as a file won't work.)

## Layout

```
index.html, css/, js/          the engine
scenarios/index.json           registry: add an entry per scenario
scenarios/<id>/scenario.json   brief, questions (hashed answers), board refs, debrief
scenarios/<id>/events.json     event slice ({meta, events})
scenarios/<id>/intel.json      offline intel feed
tools/build-scenario.mjs       compile a private source into scenario.json
tools/hash.mjs                 print an answer hash by hand
tools/selftest.mjs             check built scenarios against their sources and data
```

## Search syntax

`field=value` or `field:value`, `field="quoted value"`, `*` wildcards,
`!=`, `>`, `<`, `>=`, `<=`, free text and `"quoted phrases"`, `AND`/`OR`/`NOT`
(implicit AND) and parentheses. Field names and values are case-insensitive.
Pipes are not supported; the field sidebar gives top values and distinct counts.

## How answers are protected

Answers are stored as `SHA-256(salt|questionId|normalised answer)`. Text that
would reveal answers (step explanations, the debrief timeline) is AES-GCM
encrypted under a key derived from the correct answer. It unlocks when the
team answers, or for everyone when the instructor enters the passphrase on
the debrief page. The build fails if any answer appears in plain text in a
public file.

This keeps answers out of view-source; it isn't a defence against a
determined student with a dictionary. The salt is public, and multiple-choice
answers can be brute-forced. That's fine for a classroom, and it makes a good
discussion point for the hashing session.

## Authoring a scenario

1. Cut an event slice (see the extraction pipeline, kept with the course materials).
2. Write `<id>.src.json`: the scenario.json format plus plaintext `answers`,
   `reveal` and debrief `text`. **Keep source files out of this repo: they
   are the answer key.**
3. Build and test:
   ```sh
   node tools/build-scenario.mjs path/to/<id>.src.json scenarios/<id>/scenario.json path/to/passphrase.txt scenarios/<id>/intel.json scenarios/index.json
   node tools/selftest.mjs path/to/private/scenarios path/to/passphrase.txt
   ```
4. Add the scenario to `scenarios/index.json`.

Question types: `text`, `choice`, `decision` (every option defensible, each
with its own feedback) and `reflection` (unscored multi-select with
feedback). Optional per question: `hints` (each with a point cost), `preset`
(`{query}` and/or `{xdr: host}`, shown in guided mode), and `card` (a label
plus reference Diamond vertex, Kill Chain phase and ATT&CK id).

## Data and licence

Event data: [Splunk Boss of the SOC v1](https://github.com/splunk/botsv1),
CC0-1.0, by Ryan Kovar, David Herrald and James Brodsky. Dedicated to the
public domain, credited with thanks. Some high-volume floods are sampled
1-in-N, and the page lists each sampling rule. A few offensive words in an
attacker's password list are masked.

Questions, explanations and code: © Dave Mattie. Licence for the code: TBD.
