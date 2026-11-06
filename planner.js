// Rule-based coach: calorie targets, training split from the gym's machines,
// progressive overload and improvement suggestions. Used directly when no AI
// key is configured, and as a fallback / sanity source for the AI agent.

export const MUSCLES = ['Brust', 'Rücken', 'Beine', 'Po', 'Schultern', 'Bizeps', 'Trizeps', 'Bauch', 'Ganzkörper', 'Cardio', 'Sonstiges'];
const REPS = { muskeln: [8, 12], abnehmen: [12, 15], cardio: [15, 20] };
const REST = { muskeln: 90, abnehmen: 60, cardio: 45 };

const round = (x, step = 1) => Math.round(x / step) * step;
const de = (n) => String(n).replace('.', ',');
const e1rm = (w, r) => (w && r ? w * (1 + r / 30) : 0);

export function targetsFor(p, goal) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'w' ? -161 : 5);
  const tdee = bmr * ({ niedrig: 1.375, mittel: 1.55, hoch: 1.725 }[p.activity] || 1.55);
  let kcal = goal === 'abnehmen' ? Math.max(tdee - 450, bmr * 1.1) : goal === 'muskeln' ? tdee + 250 : tdee;
  kcal = round(kcal, 50);
  const protein = round(p.weight * ({ abnehmen: 2.0, muskeln: 1.8, cardio: 1.6 }[goal]), 5);
  const fat = round(p.weight * 0.8, 5);
  const carbs = Math.max(50, round((kcal - protein * 4 - fat * 9) / 4, 5));
  return { kcal, protein, fat, carbs, bmr: Math.round(bmr), tdee: Math.round(tdee), water: +(p.weight * 0.035 + 0.5).toFixed(1) };
}

// ---------- progression ----------
export function progression(hist, goal = 'muskeln', kind = 'kraft') {
  const [lo, hi] = REPS[goal] || REPS.muskeln;
  if (!hist?.length) return { text: `Neu: wähle ein Gewicht, das du ${lo}–${hi}× sauber schaffst.`, weight: null, reps: hi };
  const last = hist[0].sets;
  if (kind === 'cardio' || last.every((s) => !s.weight && s.minutes)) {
    const mins = Math.max(...last.map((s) => s.minutes || 0));
    return { text: mins ? `Letztes Mal ${mins} min – heute ${mins + 2} min oder höhere Stufe.` : 'Notiere Minuten, um Fortschritt zu sehen.',
      minutes: mins ? mins + 2 : null };
  }
  const weighted = last.filter((s) => s.weight);
  if (!weighted.length) {
    const r = Math.max(...last.map((s) => s.reps || 0));
    return { text: `Letztes Mal max. ${r} Wdh. – heute ${r + 1} schaffen.`, weight: null, reps: r + 1 };
  }
  const top = Math.max(...weighted.map((s) => s.weight));
  const atTop = weighted.filter((s) => s.weight === top);
  const minReps = Math.min(...atTop.map((s) => s.reps || 0));
  if (atTop.length >= 2 && minReps >= hi) {
    const next = top + Math.max(2.5, round(top * 0.05, 2.5));
    return { text: `Alle Sätze mit ${de(top)} kg × ${hi}+ geschafft – erhöhe auf ${de(next)} kg (Ziel ${lo} Wdh.).`, weight: next, reps: lo, up: true };
  }
  if (hist.length >= 3) {
    const best = (h) => Math.max(...h.sets.map((s) => e1rm(s.weight, s.reps)));
    if (best(hist[0]) <= best(hist[2]) * 1.0 && best(hist[1]) <= best(hist[2]))
      return { text: `Plateau bei ${de(top)} kg. Tipp: heute 10 % leichter (${de(round(top * 0.9, 2.5))} kg) mit sauberer Technik, dann neu steigern.`,
        weight: round(top * 0.9, 2.5), reps: hi, plateau: true };
  }
  const target = Math.min(hi, minReps + 1);
  return { text: `Bleib bei ${de(top)} kg – Ziel: ${target} Wdh. in jedem Satz.`, weight: top, reps: target };
}

// ---------- training plan ----------
const DEFAULT_EX = {
  Brust: ['Bankdrücken (Langhantel)', 'Schrägbankdrücken (Kurzhantel)', 'Liegestütze'],
  Rücken: ['Latzug', 'Rudern am Kabel', 'Klimmzüge (assistiert)'],
  Beine: ['Beinpresse', 'Kniebeuge (Goblet)', 'Beinstrecker', 'Beinbeuger'],
  Po: ['Hip Thrust', 'Rumänisches Kreuzheben', 'Ausfallschritte'],
  Schultern: ['Schulterdrücken (Kurzhantel)', 'Seitheben', 'Face Pulls'],
  Bizeps: ['Bizepscurls (Kurzhantel)', 'Hammercurls'],
  Trizeps: ['Trizepsdrücken am Kabel', 'Dips (assistiert)'],
  Bauch: ['Plank', 'Crunches', 'Beinheben hängend'],
  Cardio: ['Laufband', 'Crosstrainer', 'Rudergerät', 'Fahrrad-Ergometer'],
};
const SPLITS = {
  2: [['Ganzkörper A', ['Beine', 'Brust', 'Rücken', 'Schultern', 'Bauch']], ['Ganzkörper B', ['Po', 'Rücken', 'Brust', 'Bizeps', 'Trizeps', 'Bauch']]],
  4: [['Oberkörper A', ['Brust', 'Rücken', 'Schultern', 'Bizeps', 'Trizeps']], ['Unterkörper A', ['Beine', 'Po', 'Beine', 'Bauch']],
    ['Oberkörper B', ['Rücken', 'Brust', 'Schultern', 'Trizeps', 'Bizeps']], ['Unterkörper B', ['Po', 'Beine', 'Beine', 'Bauch']]],
  5: [['Push', ['Brust', 'Brust', 'Schultern', 'Schultern', 'Trizeps']], ['Pull', ['Rücken', 'Rücken', 'Schultern', 'Bizeps']],
    ['Beine', ['Beine', 'Po', 'Beine', 'Bauch']]],
};

export function rulePlan(ctx, goal, targets) {
  const p = ctx.profile, days = p.days || 3;
  const [lo, hi] = REPS[goal];
  const sets = goal === 'muskeln' ? (p.experience === 'anfaenger' ? 3 : 4) : 3;
  const strength = ctx.machines.filter((m) => m.kind !== 'cardio');
  const cardioM = ctx.machines.filter((m) => m.kind === 'cardio');
  const used = new Map();
  const pick = (muscle, taken) => {
    const pool = strength.filter((m) => m.muscle === muscle && !taken.has('m' + m.id));
    if (pool.length) {
      pool.sort((a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0));
      const m = pool[0]; used.set(m.id, (used.get(m.id) || 0) + 1); taken.add('m' + m.id); taken.add(m.name.toLowerCase());
      return { name: m.name, machine_id: m.id };
    }
    const opts = DEFAULT_EX[muscle] || DEFAULT_EX.Bauch;
    const name = opts.find((n) => !taken.has(n.toLowerCase())) || opts[0];
    taken.add(name.toLowerCase()); return { name, machine_id: null };
  };
  const hint = (ex) => {
    const e = ctx.exercises.find((x) => (ex.machine_id && x.machine_id === ex.machine_id) || x.exercise.toLowerCase() === ex.name.toLowerCase());
    return e ? progression(e.history, goal).text : null;
  };
  const cardioBlock = (minutes, style) => {
    const m = cardioM[Math.floor(Math.random() * cardioM.length)];
    return { name: m ? m.name : DEFAULT_EX.Cardio[0], machine_id: m?.id ?? null, sets: 1, reps: `${minutes} min`, rest_sec: 0, note: style };
  };

  const template = SPLITS[days <= 3 ? 2 : days === 4 ? 4 : 5];
  const plan = [];
  for (let i = 0; i < days; i++) {
    const [name, muscles] = template[i % template.length];
    if (goal === 'cardio' && i % 2 === 1) {
      plan.push({ name: `Cardio ${Math.ceil(i / 2)}`, focus: 'Ausdauer', exercises: [
        cardioBlock(10, 'Aufwärmen, locker'), cardioBlock(20, 'Intervalle: 1 min schnell / 2 min locker'),
        { name: 'Plank', machine_id: null, sets: 3, reps: '30–45 s', rest_sec: 30 }] });
      continue;
    }
    const taken = new Set();
    const ex = muscles.map((mu) => {
      const e = pick(mu, taken);
      return { ...e, sets: mu === 'Bauch' ? 3 : sets, reps: mu === 'Bauch' ? '15–20' : `${lo}–${hi}`, rest_sec: REST[goal], hint: hint(e) };
    });
    if (goal === 'abnehmen') ex.push(cardioBlock(20, 'Zone 2: du kannst noch sprechen'));
    if (goal === 'cardio') ex.unshift(cardioBlock(10, 'Aufwärmen'));
    plan.push({ name: template.length < days && i >= template.length ? `${name} (Wdh.)` : name, focus: muscles.filter((m, j, a) => a.indexOf(m) === j).join(', '), exercises: ex });
  }

  const goalTxt = { abnehmen: 'Fett verlieren und Muskeln halten', muskeln: 'Muskeln aufbauen', cardio: 'Ausdauer verbessern' }[goal];
  return {
    summary: `${days}× pro Woche, Ziel: ${goalTxt}. ${targets.kcal} kcal/Tag, ${targets.protein} g Eiweiß.` +
      (strength.length ? ` Plan nutzt ${strength.length} Geräte aus deinem Studio.` : ' Lege Geräte in deinem Studio an, damit der Plan sie nutzt.'),
    targets, days: plan, meals: mealPlan(targets, p.diet || ''),
    tips: baseTips(goal, targets),
  };
}

function baseTips(goal, t) {
  const tips = [`Trinke ca. ${t.water} l Wasser am Tag.`, 'Schlafe 7–9 Stunden – Muskeln wachsen in der Erholung.',
    'Steigere erst Wiederholungen, dann Gewicht (siehe Hinweis bei jeder Übung).'];
  if (goal === 'abnehmen') tips.push('Ziel: 0,5–0,8 % Körpergewicht pro Woche verlieren. 8 000+ Schritte täglich helfen enorm.');
  if (goal === 'muskeln') tips.push('Ziel: ca. 0,25–0,5 kg Zunahme pro Monat. Mehr ist meistens Fett.');
  if (goal === 'cardio') tips.push('80 % deines Cardios locker (Zone 2), 20 % intensiv – so wirst du am schnellsten fitter.');
  return tips;
}

// ---------- meal plan ----------
const FOOD = { // per 100 g: kcal, protein, carbs, fat
  Haferflocken: [372, 13.5, 58.7, 7], Skyr: [63, 11, 4, 0.2], Magerquark: [67, 12, 4, 0.2], Beeren: [45, 1, 9, 0.3],
  Banane: [93, 1.1, 20, 0.2], Apfel: [52, 0.3, 14, 0.2], Vollkornbrot: [220, 8, 40, 1.5], Eier: [145, 12.5, 0.7, 10],
  Hüttenkäse: [98, 12, 3, 4.3], Hähnchenbrust: [110, 23, 0, 1.5], 'Reis (roh)': [350, 7, 78, 0.6], Brokkoli: [35, 3, 4, 0.4],
  Lachs: [200, 20, 0, 13], Kartoffeln: [75, 2, 15, 0.1], 'Vollkornnudeln (roh)': [350, 13, 65, 2.5], 'Rinderhack 5 %': [120, 21, 0, 5],
  Tomatensoße: [40, 1.5, 7, 0.5], 'Linsen (roh)': [330, 24, 50, 1.5], Tofu: [120, 13, 2, 7], Nüsse: [620, 20, 10, 55],
  Olivenöl: [884, 0, 0, 100], Gemüse: [30, 2, 5, 0.3], 'Thunfisch (Wasser)': [110, 25, 0, 1], Vollkornwraps: [300, 9, 48, 7],
  Avocado: [160, 2, 9, 15], Proteinpulver: [380, 78, 6, 5], 'Sojajoghurt': [55, 4, 3, 2.5],
};
const MEALS = {
  'Frühstück': [['Overnight Oats', { Haferflocken: 60, Skyr: 200, Beeren: 100, Nüsse: 15 }],
    ['Eier-Brot', { Vollkornbrot: 100, Eier: 120, Hüttenkäse: 100, Gemüse: 100 }]],
  'Mittag': [['Hähnchen-Reis-Bowl', { Hähnchenbrust: 150, 'Reis (roh)': 70, Brokkoli: 200, Olivenöl: 10 }],
    ['Bolognese', { 'Vollkornnudeln (roh)': 80, 'Rinderhack 5 %': 125, Tomatensoße: 150, Gemüse: 100 }],
    ['Linsen-Curry', { 'Linsen (roh)': 80, Gemüse: 200, 'Reis (roh)': 50, Olivenöl: 10 }, true]],
  'Snack': [['Quark mit Obst', { Magerquark: 250, Apfel: 150 }], ['Shake & Banane', { Proteinpulver: 30, Banane: 120 }]],
  'Abendessen': [['Lachs mit Kartoffeln', { Lachs: 125, Kartoffeln: 300, Gemüse: 200 }],
    ['Tofu-Pfanne', { Tofu: 200, 'Reis (roh)': 60, Gemüse: 200, Olivenöl: 10 }, true],
    ['Thunfisch-Wraps', { 'Thunfisch (Wasser)': 120, Vollkornwraps: 120, Avocado: 50, Gemüse: 100 }]],
};
const MEAT = ['Hähnchenbrust', 'Lachs', 'Rinderhack 5 %', 'Thunfisch (Wasser)'];

function macros(items) {
  const t = [0, 0, 0, 0];
  for (const [f, g] of Object.entries(items)) FOOD[f].forEach((v, i) => (t[i] += (v * g) / 100));
  return { kcal: Math.round(t[0]), protein: Math.round(t[1]), carbs: Math.round(t[2]), fat: Math.round(t[3]) };
}

export function mealPlan(targets, diet) {
  const veg = /veg/i.test(diet);
  const out = [];
  for (let d = 0; d < 3; d++) {
    let meals = Object.entries(MEALS).map(([slot, opts]) => {
      const ok = opts.filter((o) => !veg || o[2] || !Object.keys(o[1]).some((f) => MEAT.includes(f)));
      const [name, items] = ok[d % ok.length];
      return { slot, name, items: { ...items } };
    });
    const total = meals.reduce((s, m) => s + macros(m.items).kcal, 0);
    const k = targets.kcal / total;
    meals = meals.map((m) => {
      const items = Object.fromEntries(Object.entries(m.items).map(([f, g]) => [f, Math.max(5, round(g * k, f === 'Olivenöl' ? 5 : 10))]));
      return { slot: m.slot, name: m.name, items, ...macros(items) };
    });
    const sum = meals.reduce((s, m) => ({ kcal: s.kcal + m.kcal, protein: s.protein + m.protein, carbs: s.carbs + m.carbs, fat: s.fat + m.fat }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    out.push({ name: `Tag ${'ABC'[d]}`, meals, total: sum,
      note: sum.protein < targets.protein - 10 ? `+${targets.protein - sum.protein} g Eiweiß ergänzen (z. B. Shake oder Skyr).` : null });
  }
  return out;
}

// ---------- suggestions ----------
export function suggestions(ctx) {
  const p = ctx.profile, out = [];
  const add = (level, title, text) => out.push({ level, title, text });
  if (!p.weight || !p.height || !p.age) add('wichtig', 'Profil vervollständigen', 'Alter, Größe und Gewicht braucht der Coach, um Kalorien und Plan zu berechnen.');
  if (!ctx.machines.length) add('info', 'Studio-Geräte anlegen', 'Im Tab „Studio“ ein Foto vom Gerät machen – alle Mitglieder deines Studios sehen es danach.');
  if (!ctx.plan) add('wichtig', 'Plan erstellen', 'Wähle unter „Plan“ dein Ziel (Abnehmen, Muskeln, Cardio) – du bekommst Trainings- und Essensplan.');

  const perWeek = ctx.workoutsLast28 / 4, want = p.days || 3;
  if (ctx.exercises.length && perWeek < want - 0.5)
    add('wichtig', 'Mehr Regelmäßigkeit', `Du trainierst im Schnitt ${perWeek.toFixed(1)}× pro Woche, geplant sind ${want}×. ` +
      (perWeek < 2 ? `Lieber einen Plan mit ${Math.max(2, Math.round(perWeek + 1))} Tagen machen, den du sicher schaffst.` : 'Feste Termine im Kalender helfen.'));

  for (const e of ctx.exercises) {
    const pr = progression(e.history, p.goal);
    if (pr.plateau) add('tipp', `Plateau: ${e.exercise}`, pr.text + ' Alternativ den Wiederholungsbereich für 3 Wochen wechseln.');
    else if (pr.up) add('erfolg', `Steigern: ${e.exercise}`, pr.text);
  }

  if (ctx.exercises.length >= 4) {
    const lastBy = {};
    for (const e of ctx.exercises) if (e.muscle) lastBy[e.muscle] = Math.max(lastBy[e.muscle] || 0, Date.parse(e.last.replace(' ', 'T') + 'Z'));
    for (const mu of ['Beine', 'Rücken', 'Brust', 'Schultern']) {
      const days = lastBy[mu] ? (Date.now() - lastBy[mu]) / 864e5 : Infinity;
      if (days > 14) add('tipp', `${mu} vernachlässigt`, days === Infinity ? `Du hast ${mu} noch nie mit einem Studio-Gerät trainiert.` : `${mu} zuletzt vor ${Math.round(days)} Tagen trainiert.`);
    }
  }

  const b = ctx.body.filter((x) => x.weight);
  if (b.length >= 4) {
    const t = (d) => Date.parse(d) / 864e5, now = t(b[0].date);
    const avg = (from, to) => { const s = b.filter((x) => now - t(x.date) >= from && now - t(x.date) < to); return s.length ? s.reduce((a, x) => a + x.weight, 0) / s.length : null; };
    const recent = avg(0, 7), before = avg(14, 28);
    if (recent && before) {
      const perWk = ((recent - before) / before) * 100 / 2.5;
      if (p.goal === 'abnehmen' && perWk > -0.2) add('wichtig', 'Gewicht stagniert', 'Seit 2–3 Wochen kaum Abnahme. Vorschlag: 150 kcal weniger am Tag oder 2 000 Schritte mehr.');
      if (p.goal === 'abnehmen' && perWk < -1.2) add('tipp', 'Zu schnelle Abnahme', 'Mehr als 1 % pro Woche kostet Muskeln. Iss ca. 150 kcal mehr.');
      if (p.goal === 'muskeln' && perWk < 0.05) add('tipp', 'Zu wenig Zunahme', 'Für Muskelaufbau 150–200 kcal mehr pro Tag einplanen.');
      if (p.goal === 'muskeln' && perWk > 0.6) add('tipp', 'Zu schnelle Zunahme', 'Mehr als 0,5 % pro Woche ist meist Fett – 150 kcal weniger.');
    }
  }
  if (!b.length || Date.now() - Date.parse(b[0]?.date) > 7 * 864e5)
    add('info', 'Wiegen nicht vergessen', 'Einmal pro Woche morgens wiegen – so kann der Coach deinen Plan anpassen.');
  const order = { wichtig: 0, tipp: 1, erfolg: 2, info: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
