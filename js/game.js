// Scenario + team progress + scoring, shared by the stepper, board and debrief.
import { answerHash, answerKeyMaterial, instructorKeyMaterial, unlock } from "./crypto.js";
import { loadProgress, saveProgress } from "./store.js";
import { bus } from "./util.js";

export const KILL_CHAIN = [
  ["recon", "Reconnaissance"], ["weaponization", "Weaponization"], ["delivery", "Delivery"],
  ["exploitation", "Exploitation"], ["installation", "Installation"],
  ["c2", "Command & Control"], ["actions", "Actions on Objectives"],
];
export const DIAMOND = [["adversary", "Adversary"], ["capability", "Capability"], ["infrastructure", "Infrastructure"], ["victim", "Victim"]];

const DEFAULT_SCORING = { question: 100, wrong: 5, min_fraction: 0.25, decision: 50, board: 10 };

export class Game {
  constructor(scenario, team) {
    this.s = scenario;
    this.team = team;
    this.scoring = { ...DEFAULT_SCORING, ...(scenario.scoring || {}) };
    this.p = loadProgress(team, scenario.id);
  }

  save() {
    saveProgress(this.team, this.s.id, this.p);
    bus.emit("progress", this);
  }

  q(id) { return this.s.questions.find((q) => q.id === id); }
  a(id) { return (this.p.answers[id] ||= { attempts: 0, hints: [] }); }

  async check(q, value) {
    const hash = await answerHash(this.s.salt, q.id, value);
    const ok = (q.accept || []).includes(hash);
    const a = this.a(q.id);
    if (a.correct) return true;
    if (ok) {
      a.correct = true;
      a.value = value;
      a.points = this.questionPoints(q, a);
      if (q.card) this.p.board[q.id] ||= { diamond: "", killchain: "", attack: "" };
    } else {
      a.attempts++;
    }
    this.save();
    return ok;
  }

  questionPoints(q, a) {
    const full = q.points ?? this.scoring.question;
    const hintCost = (a.hints || []).reduce((s, i) => s + (q.hints[i].cost || 0), 0);
    return Math.max(Math.round(full * this.scoring.min_fraction), full - hintCost - a.attempts * this.scoring.wrong);
  }

  useHint(q, i) {
    const a = this.a(q.id);
    if (!a.hints.includes(i)) a.hints.push(i);
    this.save();
  }

  skip(q) {
    const a = this.a(q.id);
    a.skipped = true;
    this.save();
  }

  // Unlock step explanations and debrief entries locked by a question's answer
  // (or by the instructor passphrase).
  async open(locks, by) {
    if (!locks || !locks.length) return null;
    if (this.p.instructor) {
      const t = await unlock(locks, instructorKeyMaterial(this.s.salt, this.p.instructor), "instructor");
      if (t != null) return t;
    }
    const a = by && this.p.answers[by];
    if (a && a.correct) return unlock(locks, answerKeyMaterial(this.s.salt, by, a.value), by);
    return null;
  }

  async instructorUnlock(passphrase) {
    const probe = this.s.instructor_check;
    const ok = (await unlock([probe], instructorKeyMaterial(this.s.salt, passphrase), "instructor")) === "ok";
    if (ok) { this.p.instructor = passphrase; this.save(); }
    return ok;
  }

  cards() {
    return this.s.questions
      .filter((q) => q.card && this.p.answers[q.id]?.correct)
      .map((q) => {
        const a = this.p.answers[q.id];
        const shown = q.type === "choice" ? (q.options.find((o) => o.id === a.value) || {}).text : a.value;
        return { q, label: q.card.label, value: shown, place: this.p.board[q.id] || {}, ref: q.card.ref };
      });
  }

  boardScore() {
    if (!this.p.boardSubmitted) return 0;
    let s = 0;
    for (const c of this.cards()) for (const k of ["diamond", "killchain", "attack"]) if (c.ref[k] && c.place[k] === c.ref[k]) s += this.scoring.board;
    return s;
  }

  score() {
    let qs = 0;
    for (const q of this.s.questions) { const a = this.p.answers[q.id]; if (a && a.correct) qs += a.points || 0; }
    const decision = this.p.decision ? this.scoring.decision : 0;
    const board = this.boardScore();
    return { questions: qs, decision, board, total: qs + decision + board };
  }

  done(q) {
    const a = this.p.answers[q.id];
    if (q.type === "decision") return !!this.p.decision;
    if (q.type === "reflection") return !!this.p.reflection;
    return !!(a && (a.correct || a.skipped));
  }
}
