// SIEM panel: search box, time histogram, field sidebar, expandable results.
import { h, clear, add, fmtTime, asList, bus } from "./util.js";
import { compile, term, QueryError } from "./query.js";

const PAGE = 50;
const BINS = 60;
const HIDDEN_FIELDS = new Set(["_time", "_raw"]);

export class Siem {
  constructor(root, events, fieldIndex, intel) {
    this.root = root;
    this.events = events; // sorted ascending by _time
    this.fieldIndex = fieldIndex;
    this.intel = intel;
    this.results = [];
    this.range = null; // [t0, t1) selected on the histogram
    this.page = 0;
    this.open = new Set();
    this.build();
    this.run("");
  }

  build() {
    this.input = h("input", {
      class: "search-input", type: "search", spellcheck: "false", autocomplete: "off",
      placeholder: 'e.g. sourcetype=stream:http dest_ip=192.168.250.70 NOT status=200',
      "aria-label": "Search",
      onkeydown: (e) => { if (e.key === "Enter") this.run(this.input.value); },
    });
    this.msg = h("div", { class: "search-msg", role: "status" });
    this.hist = h("div", { class: "hist" });
    this.rangeBar = h("div", { class: "range-bar" });
    this.fields = h("aside", { class: "fields", "aria-label": "Fields" });
    this.list = h("div", { class: "results" });
    this.pager = h("div", { class: "pager" });
    clear(this.root,
      h("div", { class: "search-row" },
        this.input,
        h("button", { class: "btn primary", onclick: () => this.run(this.input.value) }, "Search")),
      this.msg,
      h("div", { class: "hist-wrap" }, this.hist, this.rangeBar),
      h("div", { class: "siem-body" }, this.fields, h("section", { class: "results-col" }, this.list, this.pager)));
  }

  run(query, { keepRange = false } = {}) {
    this.input.value = query;
    if (!keepRange) this.range = null;
    let pred;
    try {
      pred = compile(query, this.fieldIndex);
    } catch (err) {
      if (!(err instanceof QueryError)) throw err;
      this.msg.className = "search-msg error";
      this.msg.textContent = err.message;
      return;
    }
    this.matched = this.events.filter(pred);
    this.applyRange();
    bus.emit("search", query, this.matched.length);
  }

  applyRange() {
    const r = this.range;
    this.results = r ? this.matched.filter((e) => e._time >= r[0] && e._time < r[1]) : this.matched;
    this.results = this.results.slice().reverse(); // newest first, like Splunk
    this.page = 0;
    this.open.clear();
    this.msg.className = "search-msg";
    this.msg.textContent = `${this.results.length.toLocaleString()} events` +
      (r ? ` between ${fmtTime(r[0], false).slice(0, 8)} and ${fmtTime(r[1], false).slice(0, 8)} UTC` : "");
    this.renderHist();
    this.renderFields();
    this.renderList();
  }

  addTerm(field, value, negate = false) {
    const t = (negate ? "NOT " : "") + term(field, value);
    const q = this.input.value.trim();
    this.run(q ? `${q} ${t}` : t, { keepRange: true });
  }

  // ---- histogram ----------------------------------------------------------
  renderHist() {
    const evs = this.matched;
    clear(this.rangeBar);
    if (!evs.length) { clear(this.hist); return; }
    const t0 = Math.floor(evs[0]._time), t1 = Math.ceil(evs[evs.length - 1]._time) + 1;
    const step = Math.max(1, Math.ceil((t1 - t0) / BINS));
    const n = Math.ceil((t1 - t0) / step);
    const counts = new Array(n).fill(0);
    for (const e of evs) counts[Math.min(n - 1, Math.floor((e._time - t0) / step))]++;
    const max = Math.max(...counts);
    const bars = counts.map((c, i) => {
      const a = t0 + i * step, b = a + step;
      const sel = this.range && a >= this.range[0] && b <= this.range[1];
      return h("button", {
        class: "bar" + (sel ? " sel" : ""),
        style: `height:${c ? Math.max(4, (100 * c) / max) : 0}%`,
        title: `${fmtTime(a, false).slice(0, 8)}–${fmtTime(b, false).slice(0, 8)} UTC: ${c} events`,
        "aria-label": `${c} events from ${fmtTime(a, false).slice(0, 8)}`,
        onclick: () => { this.range = [a, b]; this.applyRange(); },
      });
    });
    clear(this.hist, ...bars);
    const span = step >= 60 ? `${Math.round(step / 60)} min` : `${step} s`;
    add(this.rangeBar, 
      h("span", {}, `${fmtTime(t0).slice(0, 19)} UTC`),
      h("span", { class: "muted" }, `one bar = ${span}; click a bar to zoom`),
      this.range ? h("button", { class: "link", onclick: () => { this.range = null; this.applyRange(); } }, "reset time") : null,
      h("span", {}, `${fmtTime(t1).slice(11, 19)} UTC`));
  }

  // ---- field sidebar ------------------------------------------------------
  renderFields() {
    const counts = new Map();
    for (const e of this.results) for (const k of Object.keys(e)) if (!HIDDEN_FIELDS.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
    const total = this.results.length || 1;
    const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const items = sorted.slice(0, 60).map(([k, c]) => {
      const detail = h("div", { class: "field-detail" });
      const btn = h("button", {
        class: "field-name", "aria-expanded": "false",
        onclick: () => {
          const openNow = btn.getAttribute("aria-expanded") !== "true";
          btn.setAttribute("aria-expanded", String(openNow));
          if (openNow) this.renderTopValues(k, detail); else clear(detail);
        },
      }, h("span", {}, k), h("span", { class: "pct" }, `${Math.round((100 * c) / total)}%`));
      return h("li", {}, btn, detail);
    });
    clear(this.fields,
      h("h3", {}, "Fields"),
      sorted.length ? h("ul", { class: "field-list" }, items) : h("p", { class: "muted" }, "No events."),
      sorted.length > 60 ? h("p", { class: "muted" }, `+${sorted.length - 60} more`) : null);
  }

  renderTopValues(field, into) {
    const vals = new Map();
    let n = 0;
    for (const e of this.results) {
      if (e[field] == null) continue;
      n++;
      for (const v of new Set(asList(e[field]).map(String))) vals.set(v, (vals.get(v) || 0) + 1);
    }
    const top = [...vals].sort((a, b) => b[1] - a[1]).slice(0, 10);
    clear(into,
      h("p", { class: "muted" }, `${vals.size.toLocaleString()} distinct value${vals.size === 1 ? "" : "s"} in ${n.toLocaleString()} events`),
      h("table", { class: "topvals" },
        h("tbody", {}, top.map(([v, c]) =>
          h("tr", {},
            h("td", {}, h("button", { class: "link val", title: "Add to search", onclick: () => this.addTerm(field, v) }, v.length > 80 ? v.slice(0, 80) + "…" : v)),
            h("td", { class: "num" }, c.toLocaleString()),
            h("td", { class: "num muted" }, `${Math.round((100 * c) / n)}%`))))));
  }

  // ---- results ------------------------------------------------------------
  renderList() {
    const start = this.page * PAGE;
    const rows = this.results.slice(start, start + PAGE).map((e, i) => this.row(e, start + i));
    clear(this.list, rows.length ? rows : h("p", { class: "muted pad" }, "No matching events."));
    const pages = Math.ceil(this.results.length / PAGE);
    clear(this.pager,
      pages > 1 ? [
        h("button", { class: "btn", disabled: this.page === 0, onclick: () => { this.page--; this.renderList(); } }, "‹ Newer"),
        h("span", {}, `Page ${this.page + 1} of ${pages}`),
        h("button", { class: "btn", disabled: this.page >= pages - 1, onclick: () => { this.page++; this.renderList(); } }, "Older ›"),
      ] : null);
  }

  row(e, idx) {
    const isOpen = this.open.has(idx);
    const body = h("div", { class: "ev-body" });
    const head = h("button", {
      class: "ev-head", "aria-expanded": String(isOpen),
      onclick: () => {
        const o = !this.open.has(idx);
        o ? this.open.add(idx) : this.open.delete(idx);
        head.setAttribute("aria-expanded", String(o));
        o ? this.renderEvent(e, body) : clear(body);
      },
    },
      h("span", { class: "ev-time" }, fmtTime(e._time)),
      h("span", { class: "ev-meta" }, h("span", { class: "chip" }, e.sourcetype), h("span", { class: "chip host" }, e.host)),
      h("span", { class: "ev-sum" }, summary(e)));
    if (isOpen) this.renderEvent(e, body);
    return h("article", { class: "ev" }, head, body);
  }

  renderEvent(e, into) {
    const keys = Object.keys(e).filter((k) => !HIDDEN_FIELDS.has(k)).sort(fieldOrder);
    const rows = keys.map((k) =>
      h("tr", {},
        h("th", {}, k),
        h("td", {}, asList(e[k]).map((v) =>
          h("span", { class: "fv" },
            h("button", { class: "link val", title: "Add to search", onclick: () => this.addTerm(k, v) }, String(v)),
            h("button", { class: "mini", title: "Exclude from search", "aria-label": `Exclude ${k}=${v}`, onclick: () => this.addTerm(k, v, true) }, "≠"),
            this.intel.has(v) ? h("button", { class: "mini intel", title: "Look up in Intel", onclick: () => bus.emit("intel", String(v)) }, "Intel") : null)))));
    const raw = e._raw != null ? e._raw : JSON.stringify(Object.fromEntries(keys.filter((k) => !["host", "source", "sourcetype"].includes(k)).map((k) => [k, e[k]])), null, 2);
    clear(into,
      h("table", { class: "kv" }, h("tbody", {}, rows)),
      h("details", { class: "raw", open: true },
        h("summary", {}, e._raw != null ? "_raw" : "Event (fields as JSON)"),
        h("pre", {}, raw)));
  }
}

const FIRST = ["host", "source", "sourcetype"];
function fieldOrder(a, b) {
  const ia = FIRST.indexOf(a), ib = FIRST.indexOf(b);
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return a.localeCompare(b);
}

// One-line summary for the results list.
function summary(e) {
  if (e._raw != null) return e._raw.replace(/\s+/g, " ").slice(0, 260);
  const skip = new Set(["host", "source", "sourcetype", "_time", "ProcessGuid", "ParentProcessGuid", "UtcTime", "Computer"]);
  const parts = [];
  for (const [k, v] of Object.entries(e)) {
    if (skip.has(k)) continue;
    parts.push(`${k}=${Array.isArray(v) ? v.join(",") : v}`);
    if (parts.join(" ").length > 260) break;
  }
  return parts.join(" ").slice(0, 260);
}
