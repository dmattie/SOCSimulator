// Question stepper: brief, one question at a time, hints, containment decision.
import { h, clear, add, bus } from "./util.js";

export class Stepper {
  constructor(root, game) {
    this.root = root;
    this.g = game;
    this.guided = game.s.mode === "guided";
    this.render();
  }

  // Guided mode is sequential; open mode lets teams answer in any order.
  available(i) {
    if (!this.guided) return true;
    return this.g.s.questions.slice(0, i).every((q) => this.g.done(q));
  }

  go(i) {
    this.g.p.current = i;
    this.g.save();
    this.render();
  }

  render() {
    const qs = this.g.s.questions;
    const cur = Math.min(this.g.p.current || 0, qs.length - 1);
    const dots = qs.map((q, i) => h("button", {
      class: "dot" + (i === cur ? " cur" : "") + (this.g.done(q) ? (this.g.p.answers[q.id]?.skipped ? " skipped" : " done") : ""),
      disabled: !this.available(i),
      "aria-label": `Question ${i + 1}${this.g.done(q) ? " (done)" : ""}`,
      "aria-current": i === cur ? "step" : null,
      onclick: () => this.go(i),
    }, String(i + 1)));
    const allDone = qs.every((q) => this.g.done(q));
    clear(this.root,
      h("details", { class: "brief", open: !Object.keys(this.g.p.answers).length },
        h("summary", {}, "Briefing"),
        (this.g.s.brief || []).map((p) => h("p", {}, p))),
      h("nav", { class: "dots", "aria-label": "Questions" }, dots),
      this.question(qs[cur], cur),
      allDone ? h("a", { class: "btn primary block", href: `#/debrief/${this.g.s.id}` }, "Go to debrief →") : null);
  }

  question(q, i) {
    const box = h("section", { class: "qcard", "aria-labelledby": `q-${q.id}` });
    const a = this.g.p.answers[q.id] || {};
    const full = q.points ?? this.g.scoring.question;
    const kind = { text: "", choice: "", decision: "Decision", reflection: "Discussion" }[q.type] || "";
    add(box, 
      h("header", {},
        h("span", { class: "qnum" }, `Q${i + 1}${kind ? " · " + kind : ""}`),
        ["text", "choice"].includes(q.type) ? h("span", { class: "muted" }, a.correct ? `+${a.points} pts` : `${full} pts`) : null),
      h("h3", { id: `q-${q.id}` }, q.prompt),
      q.context ? h("p", { class: "muted" }, q.context) : null);

    if (q.preset && this.guided) {
      add(box, h("div", { class: "row-actions" },
        q.preset.query != null ? h("button", { class: "btn", onclick: () => bus.emit("siem", q.preset.query) }, "Open in SIEM") : null,
        q.preset.xdr ? h("button", { class: "btn", onclick: () => bus.emit("xdr", q.preset.xdr) }, "Open in XDR") : null,
        q.preset.intel ? h("button", { class: "btn", onclick: () => bus.emit("tab", "intel") }, "Open Intel") : null));
    }

    if (q.type === "text" || q.type === "choice") this.answerable(q, box, a);
    else if (q.type === "decision") this.decision(q, box);
    else if (q.type === "reflection") this.reflection(q, box);
    return box;
  }

  answerable(q, box, a) {
    const fb = h("p", { class: "feedback", role: "status" });
    let input;
    if (a.correct) {
      add(box, h("p", { class: "feedback ok" }, "✓ Correct: ", h("strong", {}, q.type === "choice" ? q.options.find((o) => o.id === a.value)?.text : a.value)));
      const reveal = h("div", { class: "reveal" });
      add(box, reveal);
      this.g.open(q.reveal, q.id).then((t) => { if (t) reveal.append(h("p", {}, t)); });
      if (q.card) add(box, h("p", { class: "muted" }, "Added to your threat-picture board. Place it there when you're ready."));
      add(box, this.nextButton());
      return;
    }
    if (q.type === "text") {
      input = h("input", { type: "text", class: "answer", "aria-label": "Answer", placeholder: q.placeholder || "Your answer", onkeydown: (e) => { if (e.key === "Enter") submit(); } });
      add(box, input);
    } else {
      input = h("fieldset", { class: "choices" }, h("legend", { class: "sr-only" }, "Options"),
        q.options.map((o) => h("label", {}, h("input", { type: "radio", name: `opt-${q.id}`, value: o.id }), " ", o.text)));
      add(box, input);
    }
    const submit = async () => {
      const value = q.type === "text" ? input.value.trim() : input.querySelector("input:checked")?.value;
      if (!value) { fb.className = "feedback bad"; fb.textContent = q.type === "text" ? "Type an answer first." : "Pick an option first."; return; }
      let ok;
      try {
        ok = await this.g.check(q, value);
      } catch (err) {
        fb.className = "feedback bad";
        fb.textContent = `Couldn't check the answer: ${err.message}`;
        console.error(err);
        return;
      }
      if (ok) this.render();
      else { fb.className = "feedback bad"; fb.textContent = `Not quite. −${this.g.scoring.wrong} pts. Check the evidence and try again.`; }
    };
    add(box, 
      h("div", { class: "row-actions" },
        h("button", { class: "btn primary", onclick: submit }, "Submit"),
        a.skipped ? h("span", { class: "muted" }, "Skipped (0 pts). You can still answer.") : h("button", { class: "link", onclick: () => { if (confirm("Skip this question for 0 points?")) { this.g.skip(q); this.render(); } } }, "Skip")),
      fb,
      this.hints(q, a),
      a.skipped ? this.nextButton() : null);
  }

  hints(q, a) {
    if (!q.hints || !q.hints.length) return null;
    const used = a.hints || [];
    return h("div", { class: "hints" },
      q.hints.map((hint, i) => used.includes(i)
        ? h("p", { class: "hint" }, h("strong", {}, `Hint ${i + 1}: `), hint.text)
        : h("button", { class: "btn small", disabled: i > 0 && !used.includes(i - 1), onclick: () => { this.g.useHint(q, i); this.render(); } }, `Hint ${i + 1} (−${hint.cost} pts)`)));
  }

  decision(q, box) {
    const chosen = this.g.p.decision;
    if (chosen) {
      const o = q.options.find((x) => x.id === chosen.option);
      add(box, 
        h("p", { class: "feedback ok" }, "Your team chose: ", h("strong", {}, o.text)),
        chosen.why ? h("blockquote", {}, chosen.why) : null,
        h("p", {}, o.feedback),
        h("details", {}, h("summary", {}, "What the other options would have meant"),
          q.options.filter((x) => x.id !== chosen.option).map((x) => h("div", { class: "alt" }, h("strong", {}, x.text), h("p", {}, x.feedback)))),
        this.nextButton());
      return;
    }
    const opts = h("fieldset", { class: "choices" }, h("legend", { class: "sr-only" }, "Options"),
      q.options.map((o) => h("label", {}, h("input", { type: "radio", name: `opt-${q.id}`, value: o.id }), " ", o.text)));
    const why = h("textarea", { rows: 3, placeholder: "One or two sentences: why this option? (You'll defend it to the CFO.)", "aria-label": "Rationale" });
    add(box, opts, why, h("div", { class: "row-actions" }, h("button", {
      class: "btn primary",
      onclick: () => {
        const v = opts.querySelector("input:checked")?.value;
        if (!v) return;
        this.g.p.decision = { option: v, why: why.value.trim() };
        this.g.save();
        this.render();
      },
    }, "Lock in decision")),
    h("p", { class: "muted" }, "Every option here can be defended. There's no single right answer, but there are consequences."));
  }

  reflection(q, box) {
    const done = this.g.p.reflection;
    if (done) {
      add(box, q.options.map((o) => h("div", { class: "alt" + (done.includes(o.id) ? " picked" : "") },
        h("strong", {}, (done.includes(o.id) ? "☑ " : "☐ ") + o.text), h("p", {}, o.feedback))), this.nextButton());
      return;
    }
    const opts = h("fieldset", { class: "choices" }, h("legend", { class: "sr-only" }, "Options"),
      q.options.map((o) => h("label", {}, h("input", { type: "checkbox", value: o.id }), " ", o.text)));
    add(box, opts, h("div", { class: "row-actions" }, h("button", {
      class: "btn primary",
      onclick: () => {
        this.g.p.reflection = [...opts.querySelectorAll("input:checked")].map((x) => x.value);
        this.g.save();
        this.render();
      },
    }, "Submit")));
  }

  nextButton() {
    const qs = this.g.s.questions;
    const cur = this.g.p.current || 0;
    return cur < qs.length - 1 ? h("button", { class: "btn primary", onclick: () => this.go(cur + 1) }, "Next question →") : null;
  }
}
