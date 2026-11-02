// DOM helpers. Event data contains live attack strings (XSS payloads in
// User-Agents, SQL injection in URLs), so nothing from data ever goes through
// innerHTML: h() sets text with textContent only.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Like el.append(), but flattens arrays and skips null/false (native append
// would insert the text "null").
export function add(el, ...children) {
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

export function clear(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

export const pad = (n) => String(n).padStart(2, "0");

export function fmtTime(t, withDate = true) {
  const d = new Date(t * 1000);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const ms = String(Math.floor((t % 1) * 1000)).padStart(3, "0");
  if (!withDate) return `${time}.${ms}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${time}.${ms}`;
}

export const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// Small pub/sub so panels can talk without knowing about each other.
let subs = {};
export const bus = {
  on(name, fn) { (subs[name] ||= []).push(fn); },
  emit(name, ...args) { (subs[name] || []).forEach((fn) => fn(...args)); },
  reset() { subs = {}; },
};
