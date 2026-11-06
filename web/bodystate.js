// Turns profile, logged sets and weigh-ins into what the body figure shows:
// body fat (shape), per-muscle development (size) and per-muscle soreness (glow).
import { REGION_NAMES } from './catalog.js';

// Typical DOMS duration in hours (bigger muscles / eccentric-heavy = longer)
export const DOMS_H = { quads: 72, hamstrings: 72, glutes: 72, adductors: 60, calves: 48, lats: 60, lower_back: 60, traps: 48, chest: 60,
  front_delts: 48, side_delts: 48, rear_delts: 48, biceps: 48, triceps: 48, forearms: 36, abs: 36, obliques: 36 };

const H = 3600e3;
const parseT = (s) => Date.parse(String(s).replace(' ', 'T') + 'Z');

export function bodyFatEstimate(p, weight) {
  if (!weight || !p.height) return null;
  const bmi = weight / (p.height / 100) ** 2;
  // Deurenberg (1991) BMI-based estimate
  return Math.max(5, Math.min(60, 1.2 * bmi + 0.23 * (p.age || 30) - 10.8 * (p.sex === 'w' ? 0 : 1) - 5.4));
}

export function bodyState(profile, sets, weighIns, at = Date.now()) {
  const latest = weighIns.at(-1);
  const weight = latest?.weight || profile.weight || null;
  const bf = latest?.bodyfat || bodyFatEstimate(profile, weight);
  const bmi = weight && profile.height ? weight / (profile.height / 100) ** 2 : null;

  // muscle development: decayed training load per region (half-life ~5 weeks), plus a baseline from experience
  const base = { anfaenger: 0.12, fortgeschritten: 0.35, profi: 0.55 }[profile.experience] ?? 0.12;
  const load = {}, sessions = {};
  for (const s of sets) {
    const t = parseT(s.at); if (!t || t > at) continue;
    const age = (at - t) / (24 * H);
    const decay = Math.pow(0.5, age / 35);
    const effort = s.minutes ? Math.min(1, s.minutes / 30) * 0.5 : 1;
    for (const [r, w] of Object.entries(s.regions || {})) {
      load[r] = (load[r] || 0) + w * effort * decay;
      (sessions[r] ||= new Map()).set(s.workout_id, Math.max(sessions[r].get(s.workout_id) || 0, t));
    }
  }
  const muscles = {}, sore = {};
  for (const r of Object.keys(DOMS_H)) {
    muscles[r] = Math.min(1, base + (1 - base) * (1 - Math.exp(-(load[r] || 0) / 60)));
    // soreness: last session that hit this region
    const ss = sessions[r]; if (!ss) continue;
    const [wid, t] = [...ss.entries()].sort((a, b) => b[1] - a[1])[0];
    const vol = sets.filter((s) => s.workout_id === wid).reduce((a, s) => a + (s.regions?.[r] || 0) * (s.minutes ? 0.4 : 1), 0);
    const dur = DOMS_H[r] * (vol >= 6 ? 1 : 0.75);
    const left = dur - (at - t) / H;
    if (left > 0) sore[r] = { level: Math.max(0.3, Math.min(1, vol / 6)) * (0.35 + 0.65 * (left / dur)), hoursLeft: Math.round(left), name: REGION_NAMES[r] };
  }
  const trainedAgo = Object.fromEntries(Object.entries(sessions).map(([r, m]) => [r, Math.round((at - Math.max(...m.values())) / (24 * H))]));
  const ready = ['chest', 'lats', 'quads', 'glutes', 'front_delts', 'hamstrings', 'abs', 'biceps', 'triceps']
    .filter((r) => !sore[r]).sort((a, b) => (trainedAgo[b] ?? 99) - (trainedAgo[a] ?? 99)).slice(0, 4).map((r) => ({ region: r, name: REGION_NAMES[r], days: trainedAgo[r] ?? null }));
  return { weight, height: profile.height || null, sex: profile.sex || 'm', bf, bmi, muscles, sore, ready,
    weights: weighIns.map((w) => ({ date: w.date, weight: w.weight })) };
}
