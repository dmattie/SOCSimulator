// XDR panel: per-host process tree from Sysmon process creation (EID 1),
// with each process's network (EID 3), file-create (EID 11) and
// file-time-change (EID 2) events.
import { h, clear, fmtTime, bus } from "./util.js";

const SYSMON = "XmlWinEventLog:Microsoft-Windows-Sysmon/Operational";
const base = (p) => String(p || "").split("\\").pop();
const RELATED = { 3: "Network connections", 11: "Files created", 2: "File times changed" };

export class Xdr {
  constructor(root, events, intel) {
    this.root = root;
    this.intel = intel;
    this.byHost = new Map();
    for (const e of events) {
      if (e.sourcetype !== SYSMON) continue;
      if (!this.byHost.has(e.host)) this.byHost.set(e.host, []);
      this.byHost.get(e.host).push(e);
    }
    this.hosts = [...this.byHost.keys()].filter((hn) => this.byHost.get(hn).some((e) => e.EventID === "1")).sort();
    this.build();
  }

  build() {
    if (!this.hosts.length) { clear(this.root, h("p", { class: "muted pad" }, "No Sysmon process data in this scenario.")); return; }
    this.hostSel = h("select", { "aria-label": "Host", onchange: () => this.load(this.hostSel.value) },
      this.hosts.map((hn) => h("option", { value: hn }, hn)));
    this.filter = h("input", { type: "search", placeholder: "Find process, user, hash, command line…", "aria-label": "Filter processes", oninput: () => this.renderTree() });
    this.tree = h("div", { class: "ptree", role: "tree" });
    this.detail = h("div", { class: "pdetail" }, h("p", { class: "muted" }, "Select a process to see its details."));
    clear(this.root,
      h("div", { class: "xdr-bar" }, h("label", {}, "Host ", this.hostSel), this.filter),
      h("div", { class: "xdr-body" }, this.tree, this.detail));
    this.load(this.hosts[0]);
  }

  show(host, guid) {
    if (host && this.hosts.includes(host) && host !== this.host) { this.hostSel.value = host; this.load(host); }
    if (guid && this.nodes.has(guid)) this.select(guid);
  }

  load(host) {
    this.host = host;
    const evs = this.byHost.get(host);
    this.nodes = new Map();
    this.related = new Map();
    for (const e of evs) {
      if (e.EventID === "1") {
        this.nodes.set(e.ProcessGuid, { guid: e.ProcessGuid, ev: e, kids: [], parent: e.ParentProcessGuid });
      } else if (RELATED[e.EventID] && e.ProcessGuid) {
        if (!this.related.has(e.ProcessGuid)) this.related.set(e.ProcessGuid, []);
        this.related.get(e.ProcessGuid).push(e);
      }
    }
    // Parents that started before the slice (or are filtered out) become stubs.
    for (const n of [...this.nodes.values()]) {
      if (n.parent && !this.nodes.has(n.parent)) {
        this.nodes.set(n.parent, { guid: n.parent, stub: true, image: n.ev.ParentImage, cmd: n.ev.ParentCommandLine, kids: [] });
      }
    }
    this.roots = [];
    for (const n of this.nodes.values()) {
      const p = n.parent && this.nodes.get(n.parent);
      if (p) p.kids.push(n); else this.roots.push(n);
    }
    const t = (n) => (n.ev ? n.ev._time : Math.min(...n.kids.map(t)));
    const sortKids = (n) => { n.kids.sort((a, b) => t(a) - t(b)); n.kids.forEach(sortKids); };
    this.roots.sort((a, b) => t(a) - t(b)).forEach(sortKids);
    this.expanded = new Set(this.roots.map((r) => r.guid));
    this.selected = null;
    this.renderTree();
    clear(this.detail, h("p", { class: "muted" }, `${[...this.nodes.values()].filter((n) => !n.stub).length} processes started on ${host} in this slice. Select one for details.`));
  }

  matches(n, q) {
    if (!q) return false;
    const e = n.ev || {};
    return [n.image, n.cmd, e.Image, e.CommandLine, e.User, e.MD5, e.SHA256, e.ProcessId].some((v) => v && String(v).toLowerCase().includes(q));
  }

  renderTree() {
    const q = this.filter.value.trim().toLowerCase();
    const hit = new Set();
    if (q) {
      const walk = (n) => { let any = this.matches(n, q); for (const k of n.kids) any = walk(k) || any; if (any) hit.add(n.guid); return any; };
      this.roots.forEach(walk);
    }
    const render = (n, depth) => {
      if (q && !hit.has(n.guid)) return null;
      const open = q ? true : this.expanded.has(n.guid);
      const e = n.ev;
      const img = base(e ? e.Image : n.image) || "(unknown parent)";
      const nRel = (this.related.get(n.guid) || []).length;
      const row = h("div", {
        class: "pnode" + (this.selected === n.guid ? " sel" : "") + (q && this.matches(n, q) ? " hit" : "") + (n.stub ? " stub" : ""),
        role: "treeitem", "aria-expanded": n.kids.length ? String(open) : null, style: `padding-left:${depth * 18 + 4}px`,
      },
        n.kids.length
          ? h("button", { class: "twisty", "aria-label": open ? "Collapse" : "Expand", onclick: () => { open ? this.expanded.delete(n.guid) : this.expanded.add(n.guid); this.renderTree(); } }, open ? "▾" : "▸")
          : h("span", { class: "twisty" }),
        h("button", { class: "pname", onclick: () => this.select(n.guid) },
          h("strong", {}, img),
          e ? h("span", { class: "muted" }, ` pid ${e.ProcessId} · ${fmtTime(e._time, false).slice(0, 8)}`) : h("span", { class: "muted" }, " started before this slice"),
          e && e.User ? h("span", { class: "chip" }, e.User) : null,
          nRel ? h("span", { class: "chip" }, `${nRel} related`) : null));
      return [row, open ? n.kids.map((k) => render(k, depth + 1)) : null];
    };
    const out = this.roots.map((r) => render(r, 0)).flat(Infinity).filter(Boolean);
    clear(this.tree, out.length ? out : h("p", { class: "muted pad" }, "No processes match."));
  }

  select(guid) {
    this.selected = guid;
    // expand ancestors so the node is visible
    let n = this.nodes.get(guid);
    while (n && n.parent && this.nodes.has(n.parent)) { this.expanded.add(n.parent); n = this.nodes.get(n.parent); }
    this.renderTree();
    const node = this.nodes.get(guid);
    const e = node.ev;
    if (!e) {
      clear(this.detail, h("h3", {}, base(node.image)), h("p", { class: "muted" }, "This process started before the slice begins; only what its children recorded about it is known."),
        h("dl", { class: "kv" }, h("dt", {}, "Image"), h("dd", {}, node.image || "?"), h("dt", {}, "Command line"), h("dd", {}, h("code", {}, node.cmd || "?"))));
      return;
    }
    const field = (label, v, code) => (v ? [h("dt", {}, label), h("dd", {}, code ? h("code", {}, v) : v, this.intel.has(v) ? h("button", { class: "mini intel", onclick: () => bus.emit("intel", v) }, "Intel") : null)] : null);
    const rel = this.related.get(guid) || [];
    const groups = Object.entries(RELATED).map(([eid, label]) => {
      const list = rel.filter((r) => r.EventID === eid);
      if (!list.length) return null;
      return h("details", { class: "rel", open: list.length <= 20 },
        h("summary", {}, `${label} (${list.length})`),
        h("ul", {}, list.slice(0, 100).map((r) => h("li", {},
          h("span", { class: "muted" }, fmtTime(r._time, false).slice(0, 12) + " "),
          eid === "3" ? `${r.Protocol || ""} ${r.SourceIp || ""}:${r.SourcePort || ""} → ${r.DestinationIp || ""}:${r.DestinationPort || ""}${r.DestinationHostname ? " (" + r.DestinationHostname + ")" : ""}` : r.TargetFilename || ""))),
        list.length > 100 ? h("p", { class: "muted" }, `…and ${list.length - 100} more`) : null);
    });
    clear(this.detail,
      h("h3", {}, base(e.Image)),
      h("dl", { class: "kv" },
        field("Started", fmtTime(e._time) + " UTC"),
        field("Image", e.Image, true),
        field("Command line", e.CommandLine, true),
        field("User", e.User),
        field("Integrity", e.IntegrityLevel),
        field("PID / parent PID", `${e.ProcessId} / ${e.ParentProcessId}`),
        field("Parent", e.ParentImage, true),
        field("Working directory", e.CurrentDirectory, true),
        field("MD5", e.MD5, true),
        field("SHA256", e.SHA256, true)),
      groups,
      h("div", { class: "row-actions" },
        h("button", { class: "btn", onclick: () => bus.emit("siem", `ProcessGuid="${guid}" OR ParentProcessGuid="${guid}"`) }, "Open in SIEM")));
  }
}
