// App shell: team sign-in (name only), scenario list, workspace, debrief.
import { h, clear, fetchJSON, bus } from "./util.js";
import { prepare } from "./query.js";
import { Siem } from "./siem.js";
import { Xdr } from "./xdr.js";
import { Intel } from "./intel.js";
import { Game } from "./game.js";
import { Stepper } from "./stepper.js";
import { Board } from "./board.js";
import { renderDebrief } from "./debrief.js";
import { getTeam, setTeam, resetProgress } from "./store.js";

const app = document.getElementById("app");
const teamEl = document.getElementById("team");
const scoreEl = document.getElementById("score");
const cache = new Map(); // scenario id -> loaded bundle

let registry;

async function loadScenario(id) {
  if (cache.has(id)) return cache.get(id);
  const entry = registry.scenarios.find((s) => s.id === id);
  if (!entry) throw new Error(`Unknown scenario "${id}"`);
  const dir = `scenarios/${entry.path || id}/`;
  const [scenario, intel, data] = await Promise.all([
    fetchJSON(dir + "scenario.json"), fetchJSON(dir + "intel.json").catch(() => ({ entries: [] })), fetchJSON(dir + "events.json")]);
  const events = data.events.sort((a, b) => a._time - b._time);
  const bundle = { scenario, intel, events, meta: data.meta, fieldIndex: prepare(events) };
  cache.set(id, bundle);
  return bundle;
}

function showTeam() {
  const t = getTeam();
  clear(teamEl, t ? [h("span", {}, `Team ${t}`), " ", h("button", { class: "link", onclick: () => { setTeam(""); route(); } }, "change")] : null);
}

function home() {
  scoreEl.textContent = "";
  const team = getTeam();
  if (!team) {
    const input = h("input", { type: "text", maxlength: 40, placeholder: "Team name (no personal names)", "aria-label": "Team name", autocomplete: "off" });
    const go = () => { const v = input.value.trim(); if (v) { setTeam(v); route(); } };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    clear(app, h("section", { class: "welcome" },
      h("h2", {}, "Security Operations Centre simulator"),
      h("p", {}, "Investigate real attack data from Splunk's Boss of the SOC (2016) dataset as a SOC team: search the SIEM, trace processes in the XDR view, check the offline intel feed and decide how to respond."),
      h("p", { class: "notice" }, "The 2016 logs contain real public IP addresses and domains. Don't look them up or visit them on the live internet. Use the Intel tab, which is offline."),
      h("div", { class: "search-row" }, input, h("button", { class: "btn primary", onclick: go }, "Start")),
      h("p", { class: "muted" }, "Progress is saved in this browser only. Nothing is sent anywhere.")));
    showTeam();
    return;
  }
  showTeam();
  clear(app, h("section", { class: "welcome" },
    h("h2", {}, "Choose a scenario"),
    h("div", { class: "scenario-list" }, registry.scenarios.map((s) => h("article", { class: "scenario" },
      h("h3", {}, s.title),
      h("p", {}, s.summary),
      h("p", { class: "muted" }, `${s.mode === "guided" ? "Guided" : "Open investigation"} · about ${s.minutes} min`),
      h("div", { class: "row-actions" },
        h("a", { class: "btn primary", href: `#/play/${s.id}` }, "Open"),
        h("button", { class: "link", onclick: () => { if (confirm(`Reset team ${team}'s progress on "${s.title}"?`)) resetProgress(team, s.id); } }, "reset progress")))))));
}

async function play(id, view) {
  const team = getTeam();
  if (!team) { location.hash = "#/"; return; }
  showTeam();
  clear(app, h("p", { class: "pad muted" }, "Loading events…"));
  const b = await loadScenario(id);
  const game = new Game(b.scenario, team);
  const updateScore = () => { scoreEl.textContent = `${game.score().total} pts`; };
  updateScore();
  bus.on("progress", updateScore);

  if (view === "debrief") { await renderDebrief(app, game); return; }

  const panes = { siem: h("div", { class: "pane" }), xdr: h("div", { class: "pane" }), intel: h("div", { class: "pane" }), board: h("div", { class: "pane" }) };
  const labels = { siem: "SIEM", xdr: "XDR", intel: "Intel", board: "Threat board" };
  const tabs = h("div", { class: "tabs", role: "tablist" }, Object.keys(panes).map((k) =>
    h("button", { role: "tab", id: `tab-${k}`, "aria-controls": `pane-${k}`, onclick: () => select(k) }, labels[k])));
  Object.entries(panes).forEach(([k, p]) => { p.id = `pane-${k}`; p.setAttribute("role", "tabpanel"); p.setAttribute("aria-labelledby", `tab-${k}`); });
  const stepRoot = h("aside", { class: "stepper", "aria-label": "Questions" });
  const sampling = (b.meta.sampling || []).filter((x) => x.kept_one_in > 1);

  clear(app, h("div", { class: "workspace" },
    stepRoot,
    h("main", { class: "panels" },
      h("div", { class: "panels-head" }, h("h2", {}, b.scenario.title), tabs),
      Object.values(panes),
      sampling.length ? h("details", { class: "sampling muted" },
        h("summary", {}, `About this data: ${b.events.length.toLocaleString()} events, some floods thinned`),
        h("ul", {}, sampling.map((x) => h("li", {}, `${x.what}: 1 in ${x.kept_one_in} kept (${x.kept.toLocaleString()} of ${x.true_count.toLocaleString()})`))),
        h("p", {}, "Source: Splunk Boss of the SOC v1 (CC0). Field names follow Splunk's add-ons; a few raw events were truncated by Splunk at index time.")) : null)));

  const intel = new Intel(panes.intel, b.intel);
  const siem = new Siem(panes.siem, b.events, b.fieldIndex, intel);
  const xdr = new Xdr(panes.xdr, b.events, intel);
  const board = new Board(panes.board, game);
  new Stepper(stepRoot, game);

  function select(k) {
    for (const [name, p] of Object.entries(panes)) {
      p.hidden = name !== k;
      document.getElementById(`tab-${name}`).setAttribute("aria-selected", String(name === k));
    }
    if (k === "board") board.render();
  }
  select("siem");
  bus.on("siem", (q) => { select("siem"); siem.run(q); });
  bus.on("intel", (v) => { select("intel"); intel.lookup(v); });
  bus.on("xdr", (target) => { select("xdr"); xdr.show(target.host || target, target.guid); });
  bus.on("tab", (k) => select(k));
}

async function route() {
  const [, view, id] = location.hash.split("/");
  // panels subscribe on each render; drop old subscribers between routes
  bus.reset();
  try {
    if (view === "play" && id) await play(id, "play");
    else if (view === "debrief" && id) await play(id, "debrief");
    else home();
  } catch (err) {
    clear(app, h("p", { class: "pad feedback bad" }, `Couldn't load: ${err.message}`));
    console.error(err);
  }
}

(async () => {
  // Answer checking uses Web Crypto, which browsers only expose on HTTPS or
  // localhost. Plain http:// to another machine's address won't work.
  if (!globalThis.crypto?.subtle) {
    clear(app, h("section", { class: "welcome" },
      h("h2", {}, "This page needs a secure connection"),
      h("p", {}, "Answer checking uses your browser's built-in cryptography, which browsers only allow on https:// pages or on localhost. You've opened the simulator over plain http:// from another address."),
      h("p", {}, "Open it from its https:// address (e.g. GitHub Pages), or from http://localhost on the machine running the web server.")));
    return;
  }
  registry = await fetchJSON("scenarios/index.json");
  window.addEventListener("hashchange", route);
  route();
})();
