// Answer hashing and lock/unlock, shared by the browser and tools/*.mjs (Node 20+).
//
// Answers are stored as SHA-256("<salt>|<questionId>|<normalised answer>").
// Text that would give answers away (step explanations, the debrief chain) is
// AES-GCM encrypted under a key derived from a correct answer, so it unlocks
// when the team gets that answer, or under the instructor passphrase.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export function normalise(s) {
  return String(s)
    .normalize("NFKC")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .toLowerCase();
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256hex(s) {
  return hex(await subtle.digest("SHA-256", enc.encode(s)));
}

export function answerHash(salt, qid, answer) {
  return sha256hex(`${salt}|${qid}|${normalise(answer)}`);
}

async function keyFrom(material) {
  const raw = await subtle.digest("SHA-256", enc.encode(material));
  return subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const answerKeyMaterial = (salt, qid, answer) => `${salt}|key|${qid}|${normalise(answer)}`;
export const instructorKeyMaterial = (salt, passphrase) => `${salt}|instructor|${passphrase.trim()}`;

export async function lock(material, by, plaintext) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(material), enc.encode(plaintext));
  return { by, iv: b64(iv), ct: b64(ct) };
}

// Try each lock (optionally only those with a given `by`) with the key material;
// returns the plaintext or null. AES-GCM authentication rejects wrong keys.
export async function unlock(locks, material, by) {
  const key = await keyFrom(material);
  for (const l of locks || []) {
    if (by && l.by !== by) continue;
    try {
      return dec.decode(await subtle.decrypt({ name: "AES-GCM", iv: unb64(l.iv) }, key, unb64(l.ct)));
    } catch {
      /* wrong key for this lock */
    }
  }
  return null;
}
