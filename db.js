// Local "backend": everything lives on the device in IndexedDB. Exposes the same
// api(path, {method, body}) routes the UI used to call over HTTP.
import { rulePlan, progression, suggestions, targetsFor } from './planner.js';
import { CATALOG, CHAINS, regionsFor } from './catalog.js';
import { bodyState } from './bodystate.js';

// Global admin, hardcoded: this account always has admin rights and cannot be demoted or deleted.
export const SUPER_ADMIN = 'florian';

// ---------- IndexedDB persistence (one record per table) ----------
const TABLES = ['users', 'gyms', 'machines', 'workouts', 'sets', 'body', 'plans', 'settings'];
let idb, T = {};
function openIdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('fitcrew', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('tables');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const idbGet = (k) => new Promise((res, rej) => { const q = idb.transaction('tables').objectStore('tables').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
// Writes are committed before api() resolves, so nothing is lost if iOS kills the app.
const dirty = new Set();
function save(...tables) { tables.forEach((t) => dirty.add(t)); }
async function flush() {
  if (!dirty.size) return;
  const ts = [...dirty]; dirty.clear();
  await new Promise((res, rej) => {
    const tx = idb.transaction('tables', 'readwrite'), st = tx.objectStore('tables');
    for (const t of ts) st.put(T[t], t);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Speichern abgebrochen'));
  });
}

export async function initDb() {
  idb = await openIdb();
  for (const t of TABLES) T[t] = (await idbGet(t)) ?? (t === 'settings' ? {} : []);
  navigator.storage?.persist?.().catch(() => {});
}
const nextId = (t) => T[t].reduce((m, r) => Math.max(m, r.id), 0) + 1;
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const today = () => new Date().toISOString().slice(0, 10);

// ---------- helpers ----------
class HttpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const need = (c, code, msg) => { if (!c) throw new HttpErr(code, msg); };
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const parse = (s) => (typeof s === 'string' ? JSON.parse(s || '{}') : s || {});
export const isAdmin = (u) => !!u && (u.username.toLowerCase() === SUPER_ADMIN || !!u.admin);

async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

const gymOf = (id) => T.gyms.find((g) => g.id === id) || null;
const userOut = (u) => ({ id: u.id, username: u.username, gym_id: u.gym_id, profile: parse(u.profile), gym: gymOf(u.gym_id), hasRecovery: !!u.recHash, passkey: !!u.passkeys?.length,
  admin: isAdmin(u), superAdmin: u.username.toLowerCase() === SUPER_ADMIN });

function history(userId, key) {
  const rows = T.sets.filter((s) => s.user_id === userId && (key.machine_id ? s.machine_id === key.machine_id : s.exercise.toLowerCase() === key.exercise.toLowerCase()));
  const byW = new Map();
  for (const r of rows) {
    const w = T.workouts.find((x) => x.id === r.workout_id); if (!w) continue;
    if (!byW.has(r.workout_id)) byW.set(r.workout_id, { workout_id: r.workout_id, date: w.started, sets: [] });
    byW.get(r.workout_id).sets.push({ id: r.id, weight: r.weight, reps: r.reps, minutes: r.minutes });
  }
  return [...byW.values()].sort((a, b) => b.workout_id - a.workout_id);
}

function context(user) {
  const profile = parse(user.profile);
  const machines = T.machines.filter((m) => m.gym_id === user.gym_id).map(({ id, name, muscle, kind, notes }) => ({ id, name, muscle, kind, notes }));
  const groups = new Map();
  for (const s of T.sets.filter((s) => s.user_id === user.id)) {
    const k = (s.machine_id || '') + '|' + s.exercise.toLowerCase();
    const w = T.workouts.find((x) => x.id === s.workout_id);
    const g = groups.get(k) || { exercise: s.exercise, machine_id: s.machine_id, w: new Set(), last: '' };
    g.w.add(s.workout_id); if (w && w.started > g.last) g.last = w.started; groups.set(k, g);
  }
  const exercises = [...groups.values()].sort((a, b) => (b.last > a.last ? 1 : -1)).map((g) => ({
    exercise: g.exercise, machine_id: g.machine_id, sessions: g.w.size, last: g.last,
    history: history(user.id, g.machine_id ? { machine_id: g.machine_id } : { exercise: g.exercise }).slice(0, 6),
    muscle: g.machine_id ? T.machines.find((m) => m.id === g.machine_id)?.muscle : null }));
  const body = T.body.filter((b) => b.user_id === user.id).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, 30);
  const cutoff = new Date(Date.now() - 28 * 864e5).toISOString().replace('T', ' ');
  const workoutsLast28 = T.workouts.filter((w) => w.user_id === user.id && w.started > cutoff).length;
  const plan = T.plans.filter((p) => p.user_id === user.id).at(-1);
  const first = T.workouts.filter((w) => w.user_id === user.id).reduce((m, w) => (w.started < m ? w.started : m), '9999');
  const firstWorkoutDays = first === '9999' ? 0 : (Date.now() - Date.parse(first.replace(' ', 'T') + 'Z')) / 864e5;
  return { profile, machines, exercises, body, workoutsLast28, firstWorkoutDays, plan: plan ? plan.data : null };
}

function seedGym(gym) {
  const chain = CHAINS.find((c) => c.name === gym.chain) || CHAINS.find((c) => c.id === 'generic');
  let id = nextId('machines');
  for (const key of chain.machines) {
    const c = CATALOG[key]; if (!c) continue;
    if (T.machines.some((m) => m.gym_id === gym.id && m.catalog === key)) continue;
    T.machines.push({ id: id++, gym_id: gym.id, catalog: key, name: c.name, muscle: c.muscle, kind: c.kind, photo: null,
      notes: c.how, brand: chain.brands?.[c.kind === 'cardio' ? 'cardio' : c.plate ? 'plate' : 'strength'] || '', created_by: null, created: now() });
  }
  save('machines');
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, auth, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), auth, fn });
const adminOnly = (user) => need(isAdmin(user), 403, 'Nur für Admins');
const current = () => { const id = +localStorage.getItem('fitcrew:uid'); return T.users.find((u) => u.id === id) || null; };

async function createUser(username, pw, admin = false) {
  need(/^[\w.\-äöüÄÖÜß]{3,40}$/.test(username), 400, 'Benutzername: 3–40 Zeichen, keine Leerzeichen');
  need(pw.length >= 6, 400, 'Passwort: mindestens 6 Zeichen');
  need(!T.users.some((u) => u.username.toLowerCase() === username.toLowerCase()), 409, 'Benutzername ist vergeben');
  const salt = randHex(16);
  const u = { id: nextId('users'), username, hash: await hashPw(pw, salt), salt, admin, gym_id: null, profile: {}, created: now() };
  T.users.push(u); save('users'); return u;
}

// ---- account recovery ----
// Every account gets a recovery code (shown once). Only its hash is stored.
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function newRecoveryCode(u) {
  const raw = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => CODE_ABC[b % CODE_ABC.length]).join('');
  u.recSalt = randHex(16); u.recHash = await hashPw(raw, u.recSalt); save('users');
  return raw.match(/.{4}/g).join('-');
}
const findUser = (name) => T.users.find((x) => x.username.toLowerCase() === str(name, 40).toLowerCase());
const setPassword = async (u, pw) => { need(String(pw).length >= 6, 400, 'Passwort: mindestens 6 Zeichen'); u.salt = randHex(16); u.hash = await hashPw(String(pw), u.salt); save('users'); };
// Accounts made before recovery codes existed have none. On a single-account device the owner may reset it once;
// afterwards the account has a code and this path is closed.
const legacyResetAllowed = (u) => !!u && !u.recHash && T.users.length === 1;

route('POST', '/register', false, async ({ body }) => {
  const u = await createUser(str(body.username, 40), String(body.password || ''));
  const recoveryCode = await newRecoveryCode(u);
  localStorage.setItem('fitcrew:uid', u.id); return { user: userOut(u), recoveryCode };
});
route('POST', '/login', false, async ({ body }) => {
  const u = findUser(body.username);
  need(u && (await hashPw(String(body.password || ''), u.salt)) === u.hash, 401, 'Benutzername oder Passwort falsch');
  localStorage.setItem('fitcrew:uid', u.id); return { user: userOut(u), needsRecovery: !u.recHash };
});
route('GET', '/recover-info', false, ({ url }) => {
  const u = findUser(url.searchParams.get('username'));
  return { exists: !!u, hasCode: !!u?.recHash, legacy: legacyResetAllowed(u), otherAdmins: T.users.some((x) => x !== u && isAdmin(x)) };
});
route('POST', '/recover', false, async ({ body }) => {
  const u = findUser(body.username); need(u, 404, 'Benutzer nicht gefunden');
  if (legacyResetAllowed(u)) { /* one-time owner reset, see above */ }
  else {
    need(u.recHash, 400, 'Für dieses Konto gibt es keinen Wiederherstellungscode – ein Admin kann das Passwort zurücksetzen.');
    need((await hashPw(normCode(body.code), u.recSalt)) === u.recHash, 401, 'Wiederherstellungscode stimmt nicht');
  }
  await setPassword(u, body.password);
  const recoveryCode = await newRecoveryCode(u);   // old code is used up
  localStorage.setItem('fitcrew:uid', u.id); return { user: userOut(u), recoveryCode };
});
route('PUT', '/me/password', true, async ({ user, body }) => {
  need((await hashPw(String(body.old || ''), user.salt)) === user.hash, 401, 'Aktuelles Passwort stimmt nicht');
  await setPassword(user, body.password); return { ok: true };
});
route('POST', '/me/recovery', true, async ({ user, body }) => {
  need((await hashPw(String(body.password || ''), user.salt)) === user.hash, 401, 'Passwort stimmt nicht');
  return { recoveryCode: await newRecoveryCode(user) };
});
// Face ID / Touch ID via passkey (WebAuthn platform authenticator). Local app: the credential id identifies the user.
route('GET', '/passkeys', false, () => ({ ids: T.users.flatMap((u) => u.passkeys || []) }));
route('POST', '/me/passkey', true, ({ user, body }) => {
  need(typeof body.id === 'string' && body.id.length > 10, 400, 'Ungültiger Schlüssel');
  user.passkeys = [...new Set([...(user.passkeys || []), body.id])]; save('users'); return { ok: true };
});
route('POST', '/login-passkey', false, ({ body }) => {
  const u = T.users.find((x) => (x.passkeys || []).includes(body.id)); need(u, 401, 'Face ID ist für kein Konto auf diesem Gerät eingerichtet');
  localStorage.setItem('fitcrew:uid', u.id); return { user: userOut(u) };
});
route('POST', '/logout', false, () => { localStorage.removeItem('fitcrew:uid'); return { ok: true }; });
route('GET', '/me', true, ({ user }) => ({ user: userOut(user), ai: aiReady() }));
route('PUT', '/me/profile', true, ({ user, body }) => {
  const p = {
    name: str(body.name, 60), sex: ['m', 'w'].includes(body.sex) ? body.sex : 'm', age: num(body.age), height: num(body.height), weight: num(body.weight),
    activity: ['niedrig', 'mittel', 'hoch'].includes(body.activity) ? body.activity : 'mittel',
    days: Math.min(6, Math.max(2, num(body.days) || 3)), minutes: Math.min(150, Math.max(20, num(body.minutes) || 60)),
    experience: ['anfaenger', 'fortgeschritten', 'profi'].includes(body.experience) ? body.experience : 'anfaenger',
    goal: ['abnehmen', 'muskeln', 'cardio'].includes(body.goal) ? body.goal : 'muskeln', diet: str(body.diet, 120), limits: str(body.limits, 300),
  };
  user.profile = p;
  if (p.weight) { T.body = T.body.filter((b) => !(b.user_id === user.id && b.date === today())); T.body.push({ id: nextId('body'), user_id: user.id, date: today(), weight: p.weight }); }
  save('users', 'body'); return { user: userOut(user) };
});

// gyms
route('GET', '/chains', true, () => ({ chains: CHAINS }));
route('GET', '/gyms', true, ({ url }) => {
  const s = (url.searchParams.get('q') || '').toLowerCase();
  return { gyms: T.gyms.filter((g) => [g.name, g.chain, g.city].join(' ').toLowerCase().includes(s))
    .map((g) => ({ ...g, machines: T.machines.filter((m) => m.gym_id === g.id).length, members: T.users.filter((u) => u.gym_id === g.id).length })) };
});
route('POST', '/gyms', true, ({ user, body }) => {
  const name = str(body.name, 80); need(name, 400, 'Name fehlt');
  const g = { id: nextId('gyms'), name, chain: str(body.chain, 60), city: str(body.city, 60), address: str(body.address, 120), created_by: user.id, created: now() };
  T.gyms.push(g); user.gym_id = g.id; seedGym(g); save('gyms', 'users'); return { gym: g };
});
route('POST', '/gyms/:id/join', true, ({ user, params }) => {
  need(gymOf(+params.id), 404, 'Studio nicht gefunden'); user.gym_id = +params.id; save('users'); return { user: userOut(user) };
});
route('POST', '/gyms/:id/seed', true, ({ params }) => { const g = gymOf(+params.id); need(g, 404, 'Studio nicht gefunden'); seedGym(g); return { ok: true }; });

// machines
route('GET', '/gyms/:id/machines', true, ({ params }) => ({
  machines: T.machines.filter((m) => m.gym_id === +params.id).map((m) => ({ ...m, photo: m.photo || CATALOG[m.catalog]?.photo || null, author: T.users.find((u) => u.id === m.created_by)?.username || (m.catalog ? 'Katalog' : '') }))
    .sort((a, b) => (a.muscle + a.name).localeCompare(b.muscle + b.name, 'de')),
}));
route('POST', '/gyms/:id/machines', true, ({ user, params, body }) => {
  const name = str(body.name, 80); need(name, 400, 'Gerätename fehlt'); need(gymOf(+params.id), 404, 'Studio nicht gefunden');
  const m = { id: nextId('machines'), gym_id: +params.id, name, muscle: str(body.muscle, 40) || 'Sonstiges', kind: body.kind === 'cardio' ? 'cardio' : 'kraft',
    photo: body.photo || null, notes: str(body.notes, 500), brand: str(body.brand, 60), created_by: user.id, created: now() };
  T.machines.push(m); save('machines'); return { machine: m };
});
route('PUT', '/machines/:id', true, ({ params, body }) => {
  const m = T.machines.find((x) => x.id === +params.id); need(m, 404, 'Gerät nicht gefunden');
  Object.assign(m, { name: str(body.name, 80) || m.name, muscle: str(body.muscle, 40) || m.muscle, kind: body.kind === 'cardio' ? 'cardio' : 'kraft',
    notes: str(body.notes, 500), photo: body.photo || m.photo, brand: body.brand != null ? str(body.brand, 60) : m.brand });
  save('machines'); return { machine: m };
});
route('DELETE', '/machines/:id', true, ({ user, params }) => {
  const m = T.machines.find((x) => x.id === +params.id); need(m, 404, 'Gerät nicht gefunden');
  need(m.created_by === user.id || !m.created_by || isAdmin(user), 403, 'Nur wer das Gerät angelegt hat, kann es löschen');
  T.sets.forEach((s) => { if (s.machine_id === m.id) s.machine_id = null; });
  T.machines = T.machines.filter((x) => x !== m); save('machines', 'sets'); return { ok: true };
});

// workouts & sets
route('GET', '/workouts', true, ({ user }) => {
  const ws = T.workouts.filter((w) => w.user_id === user.id).sort((a, b) => b.id - a.id).slice(0, 30)
    .map((w) => ({ ...w, sets: T.sets.filter((s) => s.workout_id === w.id).sort((a, b) => a.id - b.id) }));
  return { workouts: ws, active: ws.find((w) => !w.ended) || null };
});
route('POST', '/workouts', true, ({ user, body }) => {
  const open = T.workouts.find((w) => w.user_id === user.id && !w.ended); if (open) return { workout: open };
  const w = { id: nextId('workouts'), user_id: user.id, gym_id: user.gym_id, started: now(), ended: null, title: str(body.title, 80) };
  T.workouts.push(w); save('workouts'); return { workout: w };
});
route('POST', '/workouts/:id/finish', true, ({ user, params }) => {
  const w = T.workouts.find((x) => x.id === +params.id && x.user_id === user.id); need(w, 404, 'Training nicht gefunden');
  if (!T.sets.some((s) => s.workout_id === w.id)) { T.workouts = T.workouts.filter((x) => x !== w); save('workouts'); return { deleted: true }; }
  w.ended = now(); save('workouts'); return { ok: true };
});
route('POST', '/sets', true, ({ user, body }) => {
  const w = T.workouts.find((x) => x.id === +body.workout_id && x.user_id === user.id); need(w, 404, 'Training nicht gefunden');
  const m = body.machine_id ? T.machines.find((x) => x.id === +body.machine_id) : null;
  const exercise = str(body.exercise, 80) || m?.name; need(exercise, 400, 'Übung fehlt');
  const s = { id: nextId('sets'), workout_id: w.id, user_id: user.id, machine_id: m?.id ?? null, exercise, weight: num(body.weight), reps: num(body.reps), minutes: num(body.minutes), created: now() };
  T.sets.push(s); save('sets'); return { set: s };
});
route('DELETE', '/sets/:id', true, ({ user, params }) => { T.sets = T.sets.filter((s) => !(s.id === +params.id && s.user_id === user.id)); save('sets'); return { ok: true }; });

// progress & body
route('GET', '/progress', true, ({ user, url }) => {
  const machine_id = num(url.searchParams.get('machine_id')), exercise = url.searchParams.get('exercise'), profile = parse(user.profile);
  if (machine_id || exercise) {
    const ex = num(url.searchParams.get('exclude'));
    const h = history(user.id, machine_id ? { machine_id } : { exercise }).filter((x) => x.workout_id !== ex);
    const m = machine_id ? T.machines.find((x) => x.id === machine_id) : null;
    return { history: h, next: progression(h, profile.goal, m?.kind), start: m ? startWeight(m, profile) : null };
  }
  const ctx = context(user);
  return { exercises: ctx.exercises.map((e) => ({ ...e, next: progression(e.history, profile.goal) })), body: ctx.body, workoutsLast28: ctx.workoutsLast28 };
});
route('POST', '/body', true, ({ user, body }) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today();
  T.body = T.body.filter((b) => !(b.user_id === user.id && b.date === date));
  T.body.push({ id: nextId('body'), user_id: user.id, date, weight: num(body.weight), bodyfat: num(body.bodyfat), waist: num(body.waist) });
  if (num(body.weight)) { const p = parse(user.profile); p.weight = num(body.weight); user.profile = p; }
  save('body', 'users'); return { ok: true };
});
route('GET', '/body-state', true, ({ user }) => {
  const sets = T.sets.filter((s) => s.user_id === user.id).map((s) => {
    const w = T.workouts.find((x) => x.id === s.workout_id); const m = s.machine_id ? T.machines.find((x) => x.id === s.machine_id) : null;
    return { ...s, at: w?.started, regions: regionsFor(m, s.exercise) };
  });
  const body = T.body.filter((b) => b.user_id === user.id && b.weight).sort((a, b) => (a.date > b.date ? 1 : -1));
  return bodyState(parse(user.profile), sets, body);
});

// plan / coach
route('GET', '/plan', true, ({ user }) => { const p = T.plans.filter((x) => x.user_id === user.id).at(-1); return { plan: p ? { ...p.data, goal: p.goal, source: p.source, created: p.created } : null }; });
route('POST', '/plan', true, async ({ user, body }) => {
  const ctx = context(user);
  const goal = ['abnehmen', 'muskeln', 'cardio'].includes(body.goal) ? body.goal : ctx.profile.goal || 'muskeln';
  ctx.profile.goal = goal; user.profile = ctx.profile; save('users');
  need(ctx.profile.weight && ctx.profile.height && ctx.profile.age, 400, 'Bitte zuerst Profil ausfüllen (Alter, Größe, Gewicht)');
  const targets = targetsFor(ctx.profile, goal);
  let plan = null, source = 'regeln', note = null;
  if (aiReady() && body.ai !== false) {
    if (!navigator.onLine) note = 'Offline – Plan wurde mit den eingebauten Regeln erstellt.';
    else try { const { aiPlan } = await import('./coach.js'); plan = await aiPlan(T.settings, ctx, goal, targets, str(body.wish, 500)); source = 'ki'; }
    catch (e) { console.error('[coach]', e); note = 'KI nicht erreichbar (' + (e.message || 'Fehler') + ') – Plan wurde mit den eingebauten Regeln erstellt.'; }
  }
  if (!plan) plan = rulePlan(ctx, goal, targets);
  if (note) plan.note = note;
  const rec = { id: nextId('plans'), user_id: user.id, goal, source, data: plan, created: now() };
  T.plans.push(rec); save('plans');
  return { plan: { ...plan, goal, source, created: rec.created } };
});
route('GET', '/suggestions', true, ({ user }) => ({ suggestions: suggestions(context(user)) }));

// admin: settings (Anthropic key) + user management
const aiReady = () => !!(T.settings.aiEnabled && T.settings.apiKey);
route('GET', '/admin/settings', true, ({ user }) => { adminOnly(user); const s = T.settings;
  return { aiEnabled: !!s.aiEnabled, hasKey: !!s.apiKey, keyHint: s.apiKey ? s.apiKey.slice(0, 10) + '…' + s.apiKey.slice(-4) : '', model: s.model || 'claude-haiku-5-5' }; });
route('PUT', '/admin/settings', true, ({ user, body }) => {
  adminOnly(user);
  if (typeof body.apiKey === 'string') { const k = body.apiKey.trim(); need(!k || /^sk-ant-/.test(k), 400, 'Der Schlüssel beginnt mit „sk-ant-“'); T.settings.apiKey = k; }
  if (typeof body.aiEnabled === 'boolean') T.settings.aiEnabled = body.aiEnabled;
  save('settings'); return { ok: true, ai: aiReady() };
});
route('POST', '/admin/test-key', true, async ({ user }) => {
  adminOnly(user); need(T.settings.apiKey, 400, 'Kein Schlüssel hinterlegt'); need(navigator.onLine, 400, 'Keine Internetverbindung');
  const { testKey } = await import('./coach.js'); await testKey(T.settings); return { ok: true };
});
route('GET', '/admin/users', true, ({ user }) => {
  adminOnly(user);
  return { users: T.users.map((u) => ({ ...userOut(u), created: u.created, workouts: T.workouts.filter((w) => w.user_id === u.id).length })) };
});
route('POST', '/admin/users', true, async ({ user, body }) => {
  adminOnly(user); const u = await createUser(str(body.username, 40), String(body.password || ''), !!body.admin); return { user: userOut(u) };
});
route('PUT', '/admin/users/:id', true, async ({ user, params, body }) => {
  adminOnly(user); const u = T.users.find((x) => x.id === +params.id); need(u, 404, 'Benutzer nicht gefunden');
  if (typeof body.admin === 'boolean') { need(u.username.toLowerCase() !== SUPER_ADMIN, 400, 'Florian ist fest als Admin eingestellt'); u.admin = body.admin; }
  if (body.password) { need(String(body.password).length >= 6, 400, 'Passwort: mindestens 6 Zeichen'); u.salt = randHex(16); u.hash = await hashPw(String(body.password), u.salt); }
  save('users'); return { user: userOut(u) };
});
route('DELETE', '/admin/users/:id', true, ({ user, params }) => {
  adminOnly(user); const u = T.users.find((x) => x.id === +params.id); need(u, 404, 'Benutzer nicht gefunden');
  need(u.username.toLowerCase() !== SUPER_ADMIN, 400, 'Florian kann nicht gelöscht werden'); need(u.id !== user.id, 400, 'Du kannst dich nicht selbst löschen');
  const wids = new Set(T.workouts.filter((w) => w.user_id === u.id).map((w) => w.id));
  T.sets = T.sets.filter((s) => !wids.has(s.workout_id)); T.workouts = T.workouts.filter((w) => w.user_id !== u.id);
  T.body = T.body.filter((b) => b.user_id !== u.id); T.plans = T.plans.filter((p) => p.user_id !== u.id); T.users = T.users.filter((x) => x !== u);
  save('users', 'sets', 'workouts', 'body', 'plans'); return { ok: true };
});

// backup (own data; admins get everything)
route('GET', '/export', true, ({ user }) => {
  const all = isAdmin(user);
  const mine = (t) => (all ? T[t] : T[t].filter((r) => r.user_id === user.id));
  return { app: 'fitcrew', version: 1, exported: now(), users: all ? T.users : [user], gyms: T.gyms, machines: T.machines,
    workouts: mine('workouts'), sets: mine('sets'), body: mine('body'), plans: mine('plans') };
});
route('POST', '/import', true, ({ user, body }) => {
  adminOnly(user); need(body?.app === 'fitcrew', 400, 'Keine FitCrew-Sicherung');
  for (const t of ['users', 'gyms', 'machines', 'workouts', 'sets', 'body', 'plans']) if (Array.isArray(body[t])) T[t] = body[t];
  save('users', 'gyms', 'machines', 'workouts', 'sets', 'body', 'plans'); return { ok: true };
});

function startWeight(m, p) {
  const c = CATALOG[m.catalog]; if (!c?.start || !p.weight || !p.height) return null;
  const lbm = p.sex === 'w' ? 0.252 * p.weight + 0.473 * p.height - 48.3 : 0.407 * p.weight + 0.267 * p.height - 19.2;
  const k = (p.sex === 'w' ? 0.6 : 1) * ({ anfaenger: 1, fortgeschritten: 1.4, profi: 1.8 }[p.experience] || 1);
  return { weight: Math.max(2.5, Math.round((lbm * c.start * k) / 2.5) * 2.5), reps: c.reps };
}

export async function api(path, opts = {}) {
  const url = new URL(path, 'http://local');
  const method = opts.method || (opts.body ? 'POST' : 'GET');
  const r = routes.find((r) => r.method === method && r.re.test(url.pathname));
  if (!r) throw new Error('Nicht gefunden');
  const user = current();
  if (r.auth && !user) { const e = new Error('Bitte anmelden'); e.code = 401; throw e; }
  try { return await r.fn({ url, body: opts.body || {}, user, params: url.pathname.match(r.re).groups || {} }); }
  finally { await flush(); }
}
