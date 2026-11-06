import { CREDITS } from './credits.js';

// Built-in machine catalog. Photos: Wikimedia Commons (free licences), see CREDITS in credits.js.
// regions: which muscles a machine works (1 = main, 0.5 = helper) — drives the body figure.
// start: beginner start weight as a fraction of lean body mass (men; women ×0.6) — only a first guess.

export const REGION_NAMES = {
  chest: 'Brust', front_delts: 'Vordere Schulter', side_delts: 'Seitliche Schulter', rear_delts: 'Hintere Schulter', traps: 'Nacken (Trapez)',
  lats: 'Latissimus', lower_back: 'Unterer Rücken', biceps: 'Bizeps', triceps: 'Trizeps', forearms: 'Unterarme', abs: 'Bauch',
  obliques: 'Seitliche Bauchmuskeln', glutes: 'Po', quads: 'Oberschenkel vorne', hamstrings: 'Oberschenkel hinten', adductors: 'Adduktoren', calves: 'Waden',
};

const M = (name, muscle, regions, start, reps, how, extra = {}) => ({ name, muscle, kind: 'kraft', regions, start, reps, how, ...extra });
const C = (name, regions, how) => ({ name, muscle: 'Cardio', kind: 'cardio', regions, start: null, reps: '20–40 min', how });

export const CATALOG = {
  brustpresse: M('Brustpresse', 'Brust', { chest: 1, front_delts: 0.5, triceps: 0.5 }, 0.4, '3×10–12', 'Griffe auf Brusthöhe einstellen, Schulterblätter zurück, kontrolliert drücken.'),
  butterfly: M('Butterfly / Pec Deck', 'Brust', { chest: 1, front_delts: 0.5 }, 0.25, '3×12–15', 'Ellbogen leicht gebeugt, Arme vor der Brust zusammenführen, langsam öffnen.'),
  schraegbank: M('Schrägbankpresse (Plate-Loaded)', 'Brust', { chest: 1, front_delts: 0.5, triceps: 0.5 }, 0.3, '3×8–12', 'Mit Scheiben beladen, obere Brust – Gewicht pro Seite zählen.', { plate: true }),
  latzug: M('Latzug', 'Rücken', { lats: 1, biceps: 0.5, rear_delts: 0.5 }, 0.45, '3×10–12', 'Oberschenkel fixieren, Stange zur oberen Brust ziehen, Brust raus.'),
  rudern: M('Rudermaschine sitzend', 'Rücken', { lats: 1, traps: 0.5, rear_delts: 0.5, biceps: 0.5 }, 0.4, '3×10–12', 'Brust ans Polster, Ellbogen eng nach hinten ziehen, Schulterblätter zusammen.'),
  rueckenstrecker: M('Rückenstrecker', 'Rücken', { lower_back: 1, glutes: 0.5, hamstrings: 0.5 }, 0.3, '3×12–15', 'Langsam aus der Hüfte aufrichten, nicht ins Hohlkreuz überstrecken.'),
  reverse_fly: M('Reverse Butterfly', 'Schultern', { rear_delts: 1, traps: 0.5 }, 0.15, '3×12–15', 'Am Butterfly umgekehrt sitzen, Arme mit leicht gebeugten Ellbogen nach hinten öffnen.', { photoOf: 'butterfly' }),
  schulterpresse: M('Schulterpresse', 'Schultern', { front_delts: 1, side_delts: 0.5, triceps: 0.5 }, 0.25, '3×10–12', 'Griffe auf Schulterhöhe, nach oben drücken, ohne die Ellbogen ganz durchzustrecken.'),
  seitheben: M('Seitheben-Maschine', 'Schultern', { side_delts: 1, traps: 0.5 }, 0.12, '3×12–15', 'Ellbogen gegen die Polster, Arme bis Schulterhöhe seitlich heben.'),
  bizeps: M('Bizepscurl-Maschine', 'Bizeps', { biceps: 1, forearms: 0.5 }, 0.15, '3×10–12', 'Ellbogen auf dem Polster lassen, nur den Unterarm bewegen.'),
  trizeps: M('Trizeps-Maschine', 'Trizeps', { triceps: 1, chest: 0.3 }, 0.2, '3×10–12', 'Oberarme ruhig, Arme nach unten strecken, langsam zurück.'),
  kabelzug: M('Kabelzug / Cable Cross', 'Ganzkörper', { chest: 0.5, lats: 0.5, triceps: 0.5, biceps: 0.5, side_delts: 0.5 }, 0.1, '3×12–15', 'Vielseitig: Trizepsdrücken, Face Pulls, Cable Flys – Rolle auf passende Höhe stellen.'),
  beinpresse: M('Beinpresse', 'Beine', { quads: 1, glutes: 0.7, hamstrings: 0.4, adductors: 0.3 }, 1.0, '3×10–12', 'Füße schulterbreit, Knie zeigen über die Zehen, unten nicht den Po abheben.'),
  beinstrecker: M('Beinstrecker', 'Beine', { quads: 1 }, 0.35, '3×12–15', 'Polster knapp über dem Fußgelenk, Knie auf Höhe der Drehachse.'),
  beinbeuger: M('Beinbeuger', 'Beine', { hamstrings: 1, calves: 0.3 }, 0.3, '3×10–12', 'Polster über der Ferse, Fersen Richtung Po ziehen, langsam ablassen.'),
  adduktor: M('Adduktoren-Maschine', 'Beine', { adductors: 1 }, 0.4, '3×12–15', 'Beine gegen den Widerstand zusammendrücken, kontrolliert öffnen.', { photoOf: 'abduktor' }),
  abduktor: M('Abduktoren-Maschine', 'Po', { glutes: 1 }, 0.4, '3×12–15', 'Knie nach außen drücken, leicht nach vorne lehnen für mehr Po.'),
  hipthrust: M('Hip-Thrust-Maschine', 'Po', { glutes: 1, hamstrings: 0.5 }, 0.6, '3×10–12', 'Rücken am Polster, Hüfte ganz nach oben strecken, oben Po anspannen.'),
  waden: M('Wadenmaschine', 'Beine', { calves: 1 }, 0.6, '3×12–20', 'Fersen tief absenken, dann auf die Zehenspitzen drücken – oben kurz halten.'),
  hackenschmidt: M('Hackenschmidt / Kniebeugemaschine', 'Beine', { quads: 1, glutes: 0.7, adductors: 0.3 }, 0.5, '3×8–12', 'Rücken am Polster, tief beugen, solange der untere Rücken anliegt.', { plate: true }),
  bauch: M('Bauchmaschine (Crunch)', 'Bauch', { abs: 1, obliques: 0.4 }, 0.25, '3×12–20', 'Oberkörper einrollen statt mit den Armen ziehen, ausatmen beim Crunch.'),
  smith: M('Multipresse (Smith Machine)', 'Ganzkörper', { quads: 0.7, glutes: 0.7, chest: 0.5, front_delts: 0.5 }, 0.4, '3×8–12', 'Geführte Langhantel: Kniebeugen, Bankdrücken, Schulterdrücken – Sicherungen einstellen.'),
  hantelbank: M('Hantelbank & Kurzhanteln', 'Ganzkörper', { chest: 0.5, front_delts: 0.5, biceps: 0.5, triceps: 0.5 }, 0.12, '3×10–12', 'Für freie Übungen: Kurzhantel-Drücken, Rudern, Curls (Gewicht pro Hand).'),
  powerrack: M('Power Rack / Langhantel', 'Beine', { quads: 1, glutes: 1, lower_back: 0.5, hamstrings: 0.5 }, 0.5, '3×5–8', 'Kniebeuge & Kreuzheben – Sicherheitsablagen knapp unter der tiefsten Position.'),
  laufband: C('Laufband', { quads: 0.4, calves: 0.6, hamstrings: 0.3 }, 'Zum Abnehmen: zügiges Gehen mit 5–10 % Steigung ist gelenkschonend.'),
  crosstrainer: C('Crosstrainer', { quads: 0.4, glutes: 0.3, calves: 0.3 }, 'Gelenkschonend – gut bei Übergewicht oder Knieproblemen.'),
  ergometer: C('Fahrrad-Ergometer', { quads: 0.6, calves: 0.3 }, 'Sattel so hoch, dass das Knie unten leicht gebeugt bleibt.'),
  rudergeraet: C('Rudergerät', { lats: 0.5, quads: 0.5, biceps: 0.3, lower_back: 0.3 }, 'Kraft kommt zu 60 % aus den Beinen: erst Beine, dann Rücken, dann Arme.'),
  stepper: C('Stepper / Treppensteiger', { glutes: 0.6, quads: 0.5, calves: 0.5 }, 'Aufrecht bleiben, nicht auf die Griffe stützen.'),
  indoorcycling: C('Indoor-Cycling-Bike', { quads: 0.6, calves: 0.3, glutes: 0.3 }, 'Intervalle: 30 s schnell / 90 s locker.'),
  vibration: M('Vibrationsplatte', 'Ganzkörper', { quads: 0.3, glutes: 0.3, abs: 0.3 }, null, '3×30–60 s', 'Statische Übungen (Kniebeuge halten, Plank) auf der Platte.'),
};
for (const [k, c] of Object.entries(CATALOG)) { const src = c.photoOf || k; c.photo = CREDITS[src] ? `catalog/${src}.jpg` : null; }

const ALL = Object.keys(CATALOG).filter((k) => k !== 'vibration');
// Brands: Clever Fit – Life Fitness/Hammer Strength/ICG (fitnessmanagement.de 2019, clever-fit.com Studio Höchstadt),
// Power Plate/Prowave vibration plates; McFit – gym80 (RSG/gym80, Wikipedia); John Reed – gym80 + Matrix cardio (johnreed.fitness);
// FitX – Hammer Strength + Technogym (FitX help centre); Kieser – own machines. Individual studios differ!
export const CHAINS = [
  { id: 'cleverfit', name: 'Clever Fit', brands: { strength: 'Life Fitness', plate: 'Hammer Strength', cardio: 'Life Fitness' }, machines: [...ALL, 'vibration'] },
  { id: 'mcfit', name: 'McFit', brands: { strength: 'gym80', plate: 'gym80', cardio: '' }, machines: ALL },
  { id: 'johnreed', name: 'John Reed', brands: { strength: 'gym80', plate: 'gym80', cardio: 'Matrix' }, machines: ALL },
  { id: 'fitx', name: 'FitX', brands: { strength: 'Technogym', plate: 'Hammer Strength', cardio: 'Technogym' }, machines: ALL },
  { id: 'kieser', name: 'Kieser', brands: { strength: 'Kieser (Eigenbau)', plate: 'Kieser (Eigenbau)', cardio: '' },
    machines: ['brustpresse', 'butterfly', 'latzug', 'rudern', 'rueckenstrecker', 'schulterpresse', 'bizeps', 'trizeps', 'beinpresse', 'beinstrecker', 'beinbeuger', 'adduktor', 'abduktor', 'waden', 'bauch'] },
  { id: 'fitnessfirst', name: 'Fitness First', brands: {}, machines: ALL },
  { id: 'easyfit', name: 'EasyFit', brands: {}, machines: ALL },
  { id: 'fitstar', name: 'Fit Star', brands: {}, machines: ALL },
  { id: 'generic', name: 'Unabhängig', brands: {}, machines: ALL },
];

const GROUP_REGIONS = {
  Brust: { chest: 1, front_delts: 0.5, triceps: 0.5 }, Rücken: { lats: 1, traps: 0.5, rear_delts: 0.5, biceps: 0.4, lower_back: 0.4 },
  Beine: { quads: 1, hamstrings: 0.7, glutes: 0.5, calves: 0.5 }, Po: { glutes: 1, hamstrings: 0.5 }, Schultern: { front_delts: 1, side_delts: 1, rear_delts: 0.5, traps: 0.5 },
  Bizeps: { biceps: 1, forearms: 0.5 }, Trizeps: { triceps: 1 }, Bauch: { abs: 1, obliques: 0.6 },
  Ganzkörper: { chest: 0.4, lats: 0.4, quads: 0.4, glutes: 0.4, abs: 0.3, front_delts: 0.3 }, Cardio: { quads: 0.4, calves: 0.4 }, Sonstiges: {},
};
const NAME_HINTS = [[/bank|brust|bench|liegest|push/i, 'Brust'], [/klimm|lat|ruder|row|pull/i, 'Rücken'], [/kniebeug|squat|bein|lunge|ausfall/i, 'Beine'],
  [/hip|po|glute|kreuzheb|deadlift/i, 'Po'], [/schulter|seitheb|military/i, 'Schultern'], [/curl|bizeps/i, 'Bizeps'], [/dip|trizeps|french/i, 'Trizeps'],
  [/plank|crunch|bauch|sit-?up/i, 'Bauch'], [/lauf|rad|bike|cardio|crosstrainer|stepper/i, 'Cardio']];
export function regionsFor(machine, exercise = '') {
  if (machine?.catalog && CATALOG[machine.catalog]) return CATALOG[machine.catalog].regions;
  if (machine?.muscle) return GROUP_REGIONS[machine.muscle] || {};
  const hit = NAME_HINTS.find(([re]) => re.test(exercise));
  return hit ? GROUP_REGIONS[hit[1]] : {};
}
