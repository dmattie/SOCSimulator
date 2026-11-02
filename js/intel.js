// Intel panel: offline lookups against the scenario's intel.json only.
// Never calls a real service: the 2016 indicators are real public IPs and
// domains, and students must not look them up or visit them live.
import { h, clear, bus } from "./util.js";

export class Intel {
  constructor(root, data) {
    this.root = root;
    this.entries = (data && data.entries) || [];
    this.byIoc = new Map(this.entries.map((e) => [e.ioc.toLowerCase(), e]));
    this.build();
  }

  has(v) {
    return v != null && this.byIoc.has(String(v).toLowerCase());
  }

  build() {
    this.input = h("input", {
      type: "search", placeholder: "IP address, domain or file hash", "aria-label": "Indicator",
      onkeydown: (e) => { if (e.key === "Enter") this.lookup(this.input.value); },
    });
    this.out = h("div", { class: "intel-out" });
    clear(this.root,
      h("p", { class: "notice" }, "Offline training feed. Notes describe what was known in this 2016 dataset, not current reputation. Addresses may have been reassigned since. Don't look these indicators up or visit them on the live internet."),
      h("div", { class: "search-row" }, this.input, h("button", { class: "btn primary", onclick: () => this.lookup(this.input.value) }, "Look up")),
      this.out);
  }

  lookup(v) {
    const q = String(v || "").trim().toLowerCase();
    this.input.value = v || "";
    if (!q) { clear(this.out); return; }
    bus.emit("intel-lookup", q);
    const exact = this.byIoc.get(q);
    const host = q.replace(/:\d+$/, ""); // drop a port, then match parent domains
    const hits = exact ? [exact] : this.entries.filter((e) => {
      const ioc = e.ioc.toLowerCase();
      return ioc.includes(q) || host === ioc || host.endsWith("." + ioc) || (q.length >= 4 && (e.tags || []).some((t) => t.toLowerCase() === q));
    });
    clear(this.out, hits.length
      ? hits.map((e) => h("article", { class: "intel-card" },
          h("header", {}, h("code", {}, e.ioc), h("span", { class: "chip" }, e.type)),
          e.title ? h("h4", {}, e.title) : null,
          h("p", {}, e.note),
          (e.tags || []).length ? h("p", { class: "tags" }, e.tags.map((t) => h("span", { class: "chip" }, t))) : null))
      : h("p", { class: "muted" }, "No record in the training feed. An unknown indicator isn't proof that it's benign."));
  }
}
