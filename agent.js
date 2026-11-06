// KI-Coach: Claude erstellt Trainings- und Ernährungsplan aus Profil, Studio-Geräten
// und Trainingshistorie. Aktiv, sobald ANTHROPIC_API_KEY gesetzt ist.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.FITCREW_MODEL || 'claude-opus-5-5';
let client = null;
export const aiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const getClient = () => (client ||= new Anthropic({ timeout: 180_000 }));

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const S = { type: 'string' }, N = { type: 'number' }, I = { type: 'integer' };
const NULLABLE_INT = { anyOf: [I, { type: 'null' }] };
const SCHEMA = obj({
  summary: S,
  days: { type: 'array', items: obj({
    name: S, focus: S,
    exercises: { type: 'array', items: obj({ name: S, machine_id: NULLABLE_INT, sets: I, reps: S, rest_sec: I, hint: S }) },
  }) },
  meals: { type: 'array', items: obj({
    name: S, note: S,
    meals: { type: 'array', items: obj({
      slot: S, name: S, kcal: N, protein: N, carbs: N, fat: N,
      items: { type: 'array', items: obj({ food: S, grams: N }) },
    }) },
  }) },
  tips: { type: 'array', items: S },
});

const SYSTEM = `Du bist der Coach in der Fitness-App „FitCrew“. Du erstellst einen persönlichen Wochen-Trainingsplan und einen Ernährungsplan auf Deutsch.

Regeln:
- Nutze bevorzugt die Geräte aus dem Studio des Nutzers und gib dann deren machine_id an; für freie Übungen machine_id = null.
- Genau so viele Trainingstage wie im Profil angegeben, passend zur Trainingsdauer und Erfahrung.
- Ziel „abnehmen“: Kraft 12–15 Wdh. + Cardio; „muskeln“: 8–12 Wdh., progressive Steigerung; „cardio“: Ausdauer-Schwerpunkt mit Intervallen plus etwas Kraft.
- Feld „hint“ je Übung: konkreter Gewichts-/Wdh.-Vorschlag aus der Historie (z. B. „letztes Mal 40 kg × 12 → heute 42,5 kg“), sonst ein kurzer Technik-Hinweis.
- Ernährung: 3 Beispieltage (Tag A, B, C) mit je 4–5 Mahlzeiten, Lebensmittel in Gramm, alltagstauglich und in Deutschland gut erhältlich. Treffe die Kalorien- und Eiweißziele auf ±5 %. Beachte Ernährungsform und Einschränkungen. „note“ leer lassen, wenn es nichts zu sagen gibt.
- Berücksichtige Verletzungen/Einschränkungen und lasse riskante Übungen weg.
- „tips“: 4–7 konkrete Verbesserungsvorschläge aus den Daten (Plateaus, vernachlässigte Muskeln, Gewichtstrend, Regelmäßigkeit). Keine medizinischen Diagnosen.
- „summary“: 2–3 Sätze, was der Plan bewirken soll.`;

export async function aiPlan(ctx, goal, targets, wish) {
  const data = {
    ziel: goal, kalorien_ziel: targets, profil: ctx.profile, wunsch: wish || null,
    studio_geraete: ctx.machines,
    trainings_letzte_28_tage: ctx.workoutsLast28,
    uebungen: ctx.exercises.slice(0, 25).map((e) => ({ uebung: e.exercise, machine_id: e.machine_id, muskel: e.muscle,
      letzte_einheiten: e.history.slice(0, 4).map((h) => ({ datum: h.date, saetze: h.sets.map((s) => [s.weight, s.reps, s.minutes]) })) })),
    koerper_verlauf: ctx.body.slice(0, 12),
  };
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: 'Erstelle meinen Plan. Daten (JSON):\n' + JSON.stringify(data) }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Anfrage abgelehnt');
  if (msg.stop_reason === 'max_tokens') throw new Error('Antwort abgeschnitten');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const plan = JSON.parse(text);

  // sanity: only keep machine ids that exist in this gym
  const ids = new Set(ctx.machines.map((m) => m.id));
  for (const d of plan.days) for (const e of d.exercises) if (e.machine_id != null && !ids.has(e.machine_id)) e.machine_id = null;
  if (!plan.days.length || !plan.meals.length) throw new Error('Unvollständiger Plan');
  // normalise meals to the same shape the rule planner uses
  plan.meals = plan.meals.map((day) => {
    const meals = day.meals.map((m) => ({ ...m, items: Object.fromEntries(m.items.map((i) => [i.food, Math.round(i.grams)])) }));
    const total = meals.reduce((s, m) => ({ kcal: s.kcal + m.kcal, protein: s.protein + m.protein, carbs: s.carbs + m.carbs, fat: s.fat + m.fat }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    return { name: day.name, meals, total, note: day.note || null };
  });
  return { ...plan, targets };
}
