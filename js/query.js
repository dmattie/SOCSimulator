// A small Splunk-flavoured search language over the scenario's events.
//
//   field=value  field:value  field="quoted value"  field=*wild*card*
//   field!=value  field>10  field<=3     free text   "quoted phrase"
//   AND / OR / NOT (implicit AND), parentheses
//
// Field names and values are case-insensitive. A word only counts as
// field=value when the field exists in the data, so free text like
// C:\Windows still works. Pipes (| stats ...) are not supported.

const OPS = ["!=", ">=", "<=", "=", ":", ">", "<"];

export class QueryError extends Error {}

function tokenize(q) {
  const toks = [];
  let i = 0;
  const readQuoted = () => {
    let s = "";
    i++; // opening quote
    while (i < q.length && q[i] !== '"') {
      if (q[i] === "\\" && q[i + 1] === '"') { s += '"'; i += 2; continue; }
      s += q[i++];
    }
    if (q[i] !== '"') throw new QueryError("Unclosed quote");
    i++;
    return s;
  };
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "|") throw new QueryError("Pipe commands (| stats, | table …) aren't supported here. Use the field list on the left to see top values.");
    if (c === "(" || c === ")") { toks.push({ t: c }); i++; continue; }
    if (c === '"') { toks.push({ t: "word", v: readQuoted(), quoted: true }); continue; }
    let w = "";
    while (i < q.length && !/[\s()"]/.test(q[i])) w += q[i++];
    // field="quoted value"
    if (q[i] === '"' && OPS.some((op) => w.endsWith(op))) {
      w += "\u0000" + readQuoted();
    }
    toks.push({ t: "word", v: w });
  }
  return toks;
}

function splitField(word, fieldIndex) {
  const quotedValue = word.includes("\u0000");
  const plain = word.replace("\u0000", "");
  for (let i = 1; i < plain.length; i++) {
    for (const op of OPS) {
      if (plain.startsWith(op, i)) {
        const name = plain.slice(0, i);
        const fields = fieldIndex.get(name.toLowerCase());
        if (!fields) break; // not a known field; try later positions/ops
        return { name, fields, op, value: plain.slice(i + op.length), quotedValue };
      }
    }
  }
  return null;
}

function parse(toks, fieldIndex) {
  let p = 0;
  const peek = () => toks[p];
  const isKw = (tok, kw) => tok && tok.t === "word" && !tok.quoted && tok.v === kw;

  function orExpr() {
    let left = andExpr();
    while (isKw(peek(), "OR")) { p++; left = { k: "or", a: left, b: andExpr() }; }
    return left;
  }
  function andExpr() {
    let left = notExpr();
    while (peek() && peek().t !== ")" && !isKw(peek(), "OR")) {
      if (isKw(peek(), "AND")) p++;
      left = { k: "and", a: left, b: notExpr() };
    }
    return left;
  }
  function notExpr() {
    if (isKw(peek(), "NOT")) { p++; return { k: "not", a: notExpr() }; }
    return primary();
  }
  function primary() {
    const tok = toks[p++];
    if (!tok) throw new QueryError("Search ends too early");
    if (tok.t === "(") {
      const e = orExpr();
      if (!toks[p] || toks[p].t !== ")") throw new QueryError("Missing )");
      p++;
      return e;
    }
    if (tok.t === ")") throw new QueryError("Unexpected )");
    if (!tok.quoted) {
      const f = splitField(tok.v, fieldIndex);
      if (f) return { k: "field", ...f };
    }
    return { k: "text", value: tok.v.replace("\u0000", ""), quoted: !!tok.quoted };
  }

  if (!toks.length) return { k: "all" };
  const e = orExpr();
  if (p < toks.length) throw new QueryError(`Unexpected "${toks[p].v || toks[p].t}"`);
  return e;
}

const escRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
const wildRe = (v, anchored) =>
  new RegExp((anchored ? "^" : "") + v.split("*").map(escRe).join(".*") + (anchored ? "$" : ""), "is");

function valueMatcher(op, value) {
  const v = value.toLowerCase();
  if ([">", "<", ">=", "<="].includes(op)) {
    const n = Number(value);
    if (Number.isNaN(n)) throw new QueryError(`${op} needs a number`);
    return (x) => {
      const m = Number(x);
      if (Number.isNaN(m)) return false;
      return op === ">" ? m > n : op === "<" ? m < n : op === ">=" ? m >= n : m <= n;
    };
  }
  if (v === "*") return () => true;
  if (v.includes("*")) { const re = wildRe(v, true); return (x) => re.test(String(x)); }
  return (x) => String(x).toLowerCase() === v;
}

function compileNode(n) {
  switch (n.k) {
    case "all": return () => true;
    case "and": { const a = compileNode(n.a), b = compileNode(n.b); return (e) => a(e) && b(e); }
    case "or": { const a = compileNode(n.a), b = compileNode(n.b); return (e) => a(e) || b(e); }
    case "not": { const a = compileNode(n.a); return (e) => !a(e); }
    case "text": {
      const v = n.value.toLowerCase();
      if (!n.quoted && v.includes("*")) { const re = wildRe(v, false); return (e) => re.test(e._h); }
      return (e) => e._h.includes(v);
    }
    case "field": {
      const neg = n.op === "!=";
      const m = valueMatcher(neg ? "=" : n.op, n.value);
      const fields = n.fields;
      const has = (e) => {
        for (const f of fields) {
          const x = e[f];
          if (x == null) continue;
          if (Array.isArray(x) ? x.some(m) : m(x)) return true;
        }
        return false;
      };
      // Splunk semantics: field!=v only matches events that have the field.
      return neg ? (e) => fields.some((f) => e[f] != null) && !has(e) : has;
    }
  }
  throw new QueryError("Bad query");
}

export function compile(query, fieldIndex) {
  return compileNode(parse(tokenize(query), fieldIndex));
}

// Prepare events once: a lowercase haystack for free text, and the field index
// (lowercase name -> canonical names) used to resolve field=value terms.
export function prepare(events) {
  const index = new Map();
  for (const e of events) {
    const parts = [];
    for (const [k, v] of Object.entries(e)) {
      if (k === "_h") continue;
      if (k !== "_time" && k !== "_raw") {
        const lk = k.toLowerCase();
        if (!index.has(lk)) index.set(lk, new Set());
        index.get(lk).add(k);
      }
      if (k !== "_time") parts.push(Array.isArray(v) ? v.join(" ") : String(v));
    }
    Object.defineProperty(e, "_h", { value: parts.join(" \u0001 ").toLowerCase(), enumerable: false });
  }
  const fieldIndex = new Map([...index].map(([k, s]) => [k, [...s]]));
  return fieldIndex;
}

// Quote a value for appending to a query.
export function term(field, value) {
  const s = String(value);
  return /^[\w.:\/\\-]+$/.test(s) && !/^(AND|OR|NOT)$/.test(s) ? `${field}=${s}` : `${field}="${s.replace(/"/g, '\\"')}"`;
}
