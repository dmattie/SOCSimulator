// Debrief: score, attack chain (unlocked by answers or instructor passphrase),
// board vs reference, the containment decision, and course connections.
import { h, clear } from "./util.js";
import { KILL_CHAIN, DIAMOND } from "./game.js";
import { Board } from "./board.js";

const phaseName = (v) => (KILL_CHAIN.find(([k]) => k === v) || [, v])[1];

export async function renderDebrief(root, game) {
  const s = game.s;
  const d = s.debrief || {};
  const sc = game.score();
  const chain = await Promise.all((d.chain || []).map(async (item) => ({ ...item, text: await game.open(item.locks, item.by) })));
  const decisionQ = s.questions.find((q) => q.type === "decision");
  const chosen = decisionQ && game.p.decision && decisionQ.options.find((o) => o.id === game.p.decision.option);
  const boardRoot = h("div", {});
  const pass = h("input", { type: "password", placeholder: "Instructor passphrase", "aria-label": "Instructor passphrase", autocomplete: "off" });
  const passMsg = h("span", { class: "muted", role: "status" });

  clear(root,
    h("div", { class: "debrief" },
      h("header", { class: "debrief-head" },
        h("h2", {}, `Debrief: ${s.title}`),
        h("p", { class: "muted" }, `Team ${game.team}`),
        h("div", { class: "scorebox" },
          stat("Questions", sc.questions), stat("Decision", sc.decision), stat("Board", game.p.boardSubmitted ? sc.board : "—"), stat("Total", sc.total, true))),

      h("section", {},
        h("h3", {}, "What happened"),
        h("ol", { class: "timeline" }, chain.map((c) => h("li", { class: c.text ? "" : "locked" },
          h("div", { class: "tl-time" }, c.time || ""),
          h("div", {},
            h("div", { class: "tl-tags" },
              c.phase ? h("span", { class: "chip" }, phaseName(c.phase)) : null,
              (c.attack || []).map((t) => h("span", { class: "chip" }, t))),
            c.text ? h("p", {}, c.text) : h("p", { class: "muted" }, c.by ? `Locked: answer ${qLabel(s, c.by)} to reveal.` : "Locked."))))),
        game.p.instructor ? null : h("div", { class: "row-actions" }, pass,
          h("button", { class: "btn", onclick: async () => {
            passMsg.textContent = (await game.instructorUnlock(pass.value)) ? "Unlocked." : "That passphrase didn't work.";
            if (game.p.instructor) renderDebrief(root, game);
          } }, "Instructor unlock"), passMsg)),

      h("section", {},
        h("h3", {}, "Threat-picture board"),
        game.p.boardSubmitted ? null : h("div", { class: "row-actions" },
          h("button", { class: "btn primary", onclick: () => { game.p.boardSubmitted = true; game.save(); renderDebrief(root, game); } }, "Lock in board and score placements"),
          h("span", { class: "muted" }, `${game.scoring.board} pts per placement that matches the reference.`)),
        boardRoot),

      chosen ? h("section", {},
        h("h3", {}, "Your containment decision"),
        h("p", {}, h("strong", {}, chosen.text)),
        game.p.decision.why ? h("blockquote", {}, game.p.decision.why) : null,
        h("p", {}, chosen.feedback),
        d.cfo ? h("p", { class: "notice" }, d.cfo) : null) : null,

      (d.connections || []).length ? h("section", {},
        h("h3", {}, "Course connections"),
        h("ul", {}, d.connections.map((c) => h("li", {}, h("strong", {}, c.session + ": "), c.text)))) : null,

      h("section", {},
        h("h3", {}, "Share with the class"),
        h("p", { class: "muted" }, "Copies your team's Diamond, score and decision as plain text for comparing in class."),
        h("button", { class: "btn", onclick: (e) => copySummary(game, e.target) }, "Copy team summary")),

      h("p", {}, h("a", { href: `#/play/${s.id}` }, "← Back to the investigation"), " · ", h("a", { href: "#/" }, "All scenarios"))));
  new Board(boardRoot, game);
}

function stat(label, v, big) {
  return h("div", { class: "stat" + (big ? " big" : "") }, h("span", { class: "muted" }, label), h("strong", {}, String(v)));
}

function qLabel(s, id) {
  const i = s.questions.findIndex((q) => q.id === id);
  return i >= 0 ? `Q${i + 1}` : id;
}

async function copySummary(game, btn) {
  const sc = game.score();
  const lines = [`${game.s.title} — Team ${game.team}`, `Score: ${sc.total} (questions ${sc.questions}, decision ${sc.decision}, board ${sc.board})`, ""];
  for (const [v, t] of DIAMOND) {
    const cs = game.cards().filter((c) => c.place.diamond === v);
    lines.push(`${t}: ${cs.map((c) => `${c.label}: ${c.value}`).join("; ") || "—"}`);
  }
  const dq = game.s.questions.find((q) => q.type === "decision");
  if (dq && game.p.decision) lines.push("", `Decision: ${dq.options.find((o) => o.id === game.p.decision.option)?.text}`, game.p.decision.why ? `Why: ${game.p.decision.why}` : "");
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Couldn't copy: your browser blocked clipboard access";
  }
}
