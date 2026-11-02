// Per-team progress in localStorage. Team names only, no personal data.
const PREFIX = "socsim:v1:";

function read(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: play continues, progress just isn't saved */
  }
}

export const getTeam = () => read("team", "");
export const setTeam = (name) => write("team", name);

export function emptyProgress() {
  return { answers: {}, board: {}, decision: null, reflection: null, current: 0, unlocked: {}, instructor: false };
}

export const loadProgress = (team, scenario) => ({ ...emptyProgress(), ...read(`p:${team}:${scenario}`, {}) });
export const saveProgress = (team, scenario, p) => write(`p:${team}:${scenario}`, p);
export function resetProgress(team, scenario) {
  try { localStorage.removeItem(`${PREFIX}p:${team}:${scenario}`); } catch { /* ignore */ }
}
