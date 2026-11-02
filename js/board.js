// Threat-picture board: each correct finding becomes a card that the team
// places on the Diamond Model, the Cyber Kill Chain and MITRE ATT&CK.
// Placements are scored against the scenario's reference at the debrief.
import { h, clear } from "./util.js";
import { KILL_CHAIN, DIAMOND } from "./game.js";

export class Board {
  constructor(root, game) {
    this.root = root;
    this.g = game;
    this.render();
  }

  render() {
    const cards = this.g.cards();
    const locked = !!this.g.p.boardSubmitted;
    const techniques = this.g.s.techniques || [];
    const sel = (card, key, options, label) => h("label", { class: "place" }, label,
      h("select", {
        disabled: locked,
        onchange: (e) => { (this.g.p.board[card.q.id] ||= {})[key] = e.target.value; this.g.save(); this.render(); },
      },
        h("option", { value: "" }, "—"),
        options.map(([v, t]) => h("option", { value: v, selected: card.place[key] === v }, t))),
      locked && card.ref[key] ? mark(card.place[key] === card.ref[key], options.find(([v]) => v === card.ref[key])?.[1]) : null);

    const cardEl = (c, compact) => h("div", { class: "card" + (compact ? " compact" : "") },
      h("div", { class: "card-label" }, c.label),
      h("div", { class: "card-value" }, c.value),
      compact ? null : h("div", { class: "card-places" },
        sel(c, "diamond", DIAMOND, "Diamond"),
        sel(c, "killchain", KILL_CHAIN, "Kill Chain"),
        sel(c, "attack", techniques.map((t) => [t.id, `${t.id} ${t.name}`]), "ATT&CK")));

    const placed = (key, v) => cards.filter((c) => c.place[key] === v);
    const diamond = h("div", { class: "diamond", "aria-label": "Diamond Model" },
      DIAMOND.map(([v, t]) => h("div", { class: `vertex v-${v}` }, h("h4", {}, t), placed("diamond", v).map((c) => cardEl(c, true)))));
    const chain = h("ol", { class: "chain", "aria-label": "Cyber Kill Chain" },
      KILL_CHAIN.map(([v, t]) => h("li", {}, h("h4", {}, t), placed("killchain", v).map((c) => cardEl(c, true)))));

    clear(this.root,
      h("p", { class: "muted" }, cards.length
        ? "Place each finding: which Diamond vertex it describes, which Kill Chain phase it belongs to, and the ATT&CK technique that fits best."
        : "Cards appear here as your team answers questions."),
      cards.length ? h("div", { class: "tray" }, cards.map((c) => cardEl(c, false))) : null,
      h("div", { class: "board-views" },
        h("section", {}, h("h3", {}, "Diamond Model"), diamond),
        h("section", {}, h("h3", {}, "Cyber Kill Chain"), chain)),
      locked ? h("p", { class: "feedback ok" }, `Board locked in: ${this.g.boardScore()} pts for placements.`) : null);
  }
}

function mark(ok, refText) {
  return h("span", { class: ok ? "mark ok" : "mark bad", title: ok ? "Matches the reference" : `Reference: ${refText}` }, ok ? "✓" : `✗ ${refText}`);
}
