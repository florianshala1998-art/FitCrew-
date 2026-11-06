// FitCrew server: zero-framework Node HTTP + built-in SQLite.
// Run: node --no-warnings server.js   (PORT, HOST, ANTHROPIC_API_KEY optional)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { rulePlan, progression, suggestions, targetsFor } from './planner.js';
import { aiPlan, aiAvailable } from './agent.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.FITCREW_DATA || path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const db = new DatabaseSync(path.join(DATA, 'fitcrew.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, hash TEXT, salt TEXT,
  gym_id INTEGER, profile TEXT DEFAULT '{}', created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tokens(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS gyms(id INTEGER PRIMARY KEY, name TEXT, chain TEXT, city TEXT, address TEXT, created_by INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS machines(id INTEGER PRIMARY KEY, gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE, name TEXT, muscle TEXT,
  kind TEXT DEFAULT 'kraft', photo TEXT, notes TEXT, created_by INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS workouts(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, gym_id INTEGER,
  started TEXT DEFAULT CURRENT_TIMESTAMP, ended TEXT, title TEXT);
CREATE TABLE IF NOT EXISTS sets(id INTEGER PRIMARY KEY, workout_id INTEGER REFERENCES workouts(id) ON DELETE CASCADE, user_id INTEGER,
  machine_id INTEGER, exercise TEXT, weight REAL, reps INTEGER, minutes REAL, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS body(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, date TEXT, weight REAL, bodyfat REAL, waist REAL);
CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, goal TEXT, source TEXT, data TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS sets_user ON sets(user_id, exercise);
`);

// ---------- helpers ----------
const q = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
class HttpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const need = (cond, code, msg) => { if (!cond) throw new HttpErr(code, msg); };
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);

function savePhoto(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl);
  need(m, 400, 'Ungültiges Bild');
  const buf = Buffer.from(m[2], 'base64');
  need(buf.length < 4_000_000, 413, 'Bild zu groß');
  const name = crypto.randomBytes(12).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return '/uploads/' + name;
}
function dropPhoto(p) {
  if (p && p.startsWith('/uploads/')) fs.rmSync(path.join(UPLOADS, path.basename(p)), { force: true });
}

const userOut = (u) => ({ id: u.id, username: u.username, gym_id: u.gym_id, profile: JSON.parse(u.profile || '{}'),
  gym: u.gym_id ? one('SELECT * FROM gyms WHERE id=?', u.gym_id) : null });

function history(userId, key) {
  // key = {machine_id} or {exercise}; returns sessions newest first: [{date, sets:[{weight,reps,minutes}]}]
  const rows = key.machine_id
    ? q('SELECT s.*, w.started FROM sets s JOIN workouts w ON w.id=s.workout_id WHERE s.user_id=? AND s.machine_id=? ORDER BY s.id', userId, key.machine_id)
    : q('SELECT s.*, w.started FROM sets s JOIN workouts w ON w.id=s.workout_id WHERE s.user_id=? AND s.exercise=? COLLATE NOCASE ORDER BY s.id', userId, key.exercise);
  const byW = new Map();
  for (const r of rows) {
    if (!byW.has(r.workout_id)) byW.set(r.workout_id, { workout_id: r.workout_id, date: r.started, sets: [] });
    byW.get(r.workout_id).sets.push({ id: r.id, weight: r.weight, reps: r.reps, minutes: r.minutes });
  }
  return [...byW.values()].reverse();
}

function context(user) {
  const profile = JSON.parse(user.profile || '{}');
  const machines = user.gym_id ? q('SELECT id,name,muscle,kind,notes FROM machines WHERE gym_id=?', user.gym_id) : [];
  const exercises = q(`SELECT exercise, machine_id, COUNT(DISTINCT workout_id) sessions, MAX(started) last
      FROM sets s JOIN workouts w ON w.id=s.workout_id WHERE s.user_id=? GROUP BY exercise, machine_id ORDER BY last DESC`, user.id)
    .map((e) => ({ ...e, history: history(user.id, e.machine_id ? { machine_id: e.machine_id } : { exercise: e.exercise }).slice(0, 6),
      muscle: e.machine_id ? one('SELECT muscle FROM machines WHERE id=?', e.machine_id)?.muscle : null }));
  const body = q('SELECT date,weight,bodyfat,waist FROM body WHERE user_id=? ORDER BY date DESC LIMIT 30', user.id);
  const workouts = q(`SELECT started FROM workouts WHERE user_id=? AND started > datetime('now','-28 days')`, user.id);
  const plan = one('SELECT * FROM plans WHERE user_id=? ORDER BY id DESC LIMIT 1', user.id);
  return { profile, machines, exercises, body, workoutsLast28: workouts.length, plan: plan ? JSON.parse(plan.data) : null };
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, auth, fn) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), auth, fn });

route('POST', '/api/register', false, ({ body }) => {
  const username = str(body.username, 40), pw = String(body.password || '');
  need(/^[\w.\-äöüÄÖÜß]{3,40}$/.test(username), 400, 'Benutzername: 3–40 Zeichen, keine Leerzeichen');
  need(pw.length >= 6, 400, 'Passwort: mindestens 6 Zeichen');
  need(!one('SELECT 1 FROM users WHERE username=?', username), 409, 'Benutzername ist vergeben');
  const salt = crypto.randomBytes(16).toString('hex');
  const id = run('INSERT INTO users(username,hash,salt) VALUES(?,?,?)', username, hashPw(pw, salt), salt).lastInsertRowid;
  const token = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO tokens(token,user_id) VALUES(?,?)', token, id);
  return { token, user: userOut(one('SELECT * FROM users WHERE id=?', id)) };
});
route('POST', '/api/login', false, ({ body }) => {
  const u = one('SELECT * FROM users WHERE username=?', str(body.username, 40));
  need(u && crypto.timingSafeEqual(Buffer.from(u.hash, 'hex'), Buffer.from(hashPw(String(body.password || ''), u.salt), 'hex')),
    401, 'Benutzername oder Passwort falsch');
  const token = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO tokens(token,user_id) VALUES(?,?)', token, u.id);
  return { token, user: userOut(u) };
});
route('POST', '/api/logout', true, ({ token }) => { run('DELETE FROM tokens WHERE token=?', token); return { ok: true }; });
route('GET', '/api/me', true, ({ user }) => ({ user: userOut(user), ai: aiAvailable() }));
route('PUT', '/api/me/profile', true, ({ user, body }) => {
  const p = {
    name: str(body.name, 60), sex: ['m', 'w'].includes(body.sex) ? body.sex : 'm',
    age: num(body.age), height: num(body.height), weight: num(body.weight),
    activity: ['niedrig', 'mittel', 'hoch'].includes(body.activity) ? body.activity : 'mittel',
    days: Math.min(6, Math.max(2, num(body.days) || 3)), minutes: Math.min(150, Math.max(20, num(body.minutes) || 60)),
    experience: ['anfaenger', 'fortgeschritten', 'profi'].includes(body.experience) ? body.experience : 'anfaenger',
    goal: ['abnehmen', 'muskeln', 'cardio'].includes(body.goal) ? body.goal : 'muskeln',
    diet: str(body.diet, 120), limits: str(body.limits, 300),
  };
  run('UPDATE users SET profile=? WHERE id=?', JSON.stringify(p), user.id);
  if (p.weight && !one(`SELECT 1 FROM body WHERE user_id=? AND date=date('now')`, user.id))
    run(`INSERT INTO body(user_id,date,weight) VALUES(?,date('now'),?)`, user.id, p.weight);
  return { user: userOut(one('SELECT * FROM users WHERE id=?', user.id)) };
});

// gyms
route('GET', '/api/gyms', true, ({ url }) => {
  const s = '%' + (url.searchParams.get('q') || '') + '%';
  return { gyms: q(`SELECT g.*, (SELECT COUNT(*) FROM machines m WHERE m.gym_id=g.id) machines,
      (SELECT COUNT(*) FROM users u WHERE u.gym_id=g.id) members FROM gyms g
      WHERE g.name LIKE ? OR g.chain LIKE ? OR g.city LIKE ? ORDER BY members DESC, g.name LIMIT 50`, s, s, s) };
});
route('POST', '/api/gyms', true, ({ user, body }) => {
  const name = str(body.name, 80); need(name, 400, 'Name fehlt');
  const id = run('INSERT INTO gyms(name,chain,city,address,created_by) VALUES(?,?,?,?,?)',
    name, str(body.chain, 60), str(body.city, 60), str(body.address, 120), user.id).lastInsertRowid;
  run('UPDATE users SET gym_id=? WHERE id=?', id, user.id);
  return { gym: one('SELECT * FROM gyms WHERE id=?', id) };
});
route('POST', '/api/gyms/:id/join', true, ({ user, params }) => {
  need(one('SELECT 1 FROM gyms WHERE id=?', params.id), 404, 'Studio nicht gefunden');
  run('UPDATE users SET gym_id=? WHERE id=?', +params.id, user.id);
  return { user: userOut(one('SELECT * FROM users WHERE id=?', user.id)) };
});

// machines (shared by everyone in the gym)
route('GET', '/api/gyms/:id/machines', true, ({ params }) => ({
  machines: q(`SELECT m.*, u.username author FROM machines m LEFT JOIN users u ON u.id=m.created_by
    WHERE m.gym_id=? ORDER BY m.muscle, m.name`, params.id),
}));
route('POST', '/api/gyms/:id/machines', true, ({ user, params, body }) => {
  const name = str(body.name, 80); need(name, 400, 'Gerätename fehlt');
  need(one('SELECT 1 FROM gyms WHERE id=?', params.id), 404, 'Studio nicht gefunden');
  const photo = savePhoto(body.photo);
  const id = run('INSERT INTO machines(gym_id,name,muscle,kind,photo,notes,created_by) VALUES(?,?,?,?,?,?,?)',
    +params.id, name, str(body.muscle, 40) || 'Sonstiges', body.kind === 'cardio' ? 'cardio' : 'kraft', photo, str(body.notes, 500), user.id).lastInsertRowid;
  return { machine: one('SELECT * FROM machines WHERE id=?', id) };
});
route('PUT', '/api/machines/:id', true, ({ params, body }) => {
  const m = one('SELECT * FROM machines WHERE id=?', params.id); need(m, 404, 'Gerät nicht gefunden');
  let photo = m.photo;
  if (body.photo) { photo = savePhoto(body.photo); dropPhoto(m.photo); }
  run('UPDATE machines SET name=?,muscle=?,kind=?,notes=?,photo=? WHERE id=?', str(body.name, 80) || m.name,
    str(body.muscle, 40) || m.muscle, body.kind === 'cardio' ? 'cardio' : 'kraft', str(body.notes, 500), photo, m.id);
  return { machine: one('SELECT * FROM machines WHERE id=?', m.id) };
});
route('DELETE', '/api/machines/:id', true, ({ user, params }) => {
  const m = one('SELECT * FROM machines WHERE id=?', params.id); need(m, 404, 'Gerät nicht gefunden');
  need(m.created_by === user.id, 403, 'Nur wer das Gerät angelegt hat, kann es löschen');
  run('UPDATE sets SET machine_id=NULL WHERE machine_id=?', m.id);
  run('DELETE FROM machines WHERE id=?', m.id); dropPhoto(m.photo);
  return { ok: true };
});

// workouts & sets
route('GET', '/api/workouts', true, ({ user }) => {
  const ws = q('SELECT * FROM workouts WHERE user_id=? ORDER BY id DESC LIMIT 30', user.id);
  for (const w of ws) w.sets = q('SELECT * FROM sets WHERE workout_id=? ORDER BY id', w.id);
  return { workouts: ws, active: ws.find((w) => !w.ended) || null };
});
route('POST', '/api/workouts', true, ({ user, body }) => {
  const open = one('SELECT * FROM workouts WHERE user_id=? AND ended IS NULL', user.id);
  if (open) return { workout: open };
  const id = run('INSERT INTO workouts(user_id,gym_id,title) VALUES(?,?,?)', user.id, user.gym_id, str(body.title, 80)).lastInsertRowid;
  return { workout: one('SELECT * FROM workouts WHERE id=?', id) };
});
route('POST', '/api/workouts/:id/finish', true, ({ user, params }) => {
  const w = one('SELECT * FROM workouts WHERE id=? AND user_id=?', params.id, user.id); need(w, 404, 'Training nicht gefunden');
  if (!one('SELECT 1 FROM sets WHERE workout_id=?', w.id)) { run('DELETE FROM workouts WHERE id=?', w.id); return { deleted: true }; }
  run('UPDATE workouts SET ended=CURRENT_TIMESTAMP WHERE id=?', w.id);
  return { ok: true };
});
route('POST', '/api/sets', true, ({ user, body }) => {
  const w = one('SELECT * FROM workouts WHERE id=? AND user_id=?', body.workout_id, user.id); need(w, 404, 'Training nicht gefunden');
  const m = body.machine_id ? one('SELECT * FROM machines WHERE id=?', body.machine_id) : null;
  const exercise = str(body.exercise, 80) || m?.name; need(exercise, 400, 'Übung fehlt');
  const id = run('INSERT INTO sets(workout_id,user_id,machine_id,exercise,weight,reps,minutes) VALUES(?,?,?,?,?,?,?)',
    w.id, user.id, m?.id ?? null, exercise, num(body.weight), num(body.reps), num(body.minutes)).lastInsertRowid;
  return { set: one('SELECT * FROM sets WHERE id=?', id) };
});
route('DELETE', '/api/sets/:id', true, ({ user, params }) => {
  run('DELETE FROM sets WHERE id=? AND user_id=?', params.id, user.id); return { ok: true };
});

// progress
route('GET', '/api/progress', true, ({ user, url }) => {
  const machine_id = num(url.searchParams.get('machine_id')), exercise = url.searchParams.get('exercise');
  const profile = JSON.parse(user.profile || '{}');
  if (machine_id || exercise) {
    const ex = num(url.searchParams.get('exclude'));
    const h = history(user.id, machine_id ? { machine_id } : { exercise }).filter((x) => x.workout_id !== ex);
    const kind = machine_id ? one('SELECT kind FROM machines WHERE id=?', machine_id)?.kind : 'kraft';
    return { history: h, next: progression(h, profile.goal, kind) };
  }
  const ctx = context(user);
  return { exercises: ctx.exercises.map((e) => ({ ...e, next: progression(e.history, profile.goal) })), body: ctx.body,
    workoutsLast28: ctx.workoutsLast28 };
});
route('POST', '/api/body', true, ({ user, body }) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  run('DELETE FROM body WHERE user_id=? AND date=?', user.id, date);
  run('INSERT INTO body(user_id,date,weight,bodyfat,waist) VALUES(?,?,?,?,?)', user.id, date, num(body.weight), num(body.bodyfat), num(body.waist));
  if (num(body.weight)) {
    const p = JSON.parse(user.profile || '{}'); p.weight = num(body.weight);
    run('UPDATE users SET profile=? WHERE id=?', JSON.stringify(p), user.id);
  }
  return { ok: true };
});

// plan agent
route('GET', '/api/plan', true, ({ user }) => {
  const p = one('SELECT * FROM plans WHERE user_id=? ORDER BY id DESC LIMIT 1', user.id);
  return { plan: p ? { ...JSON.parse(p.data), goal: p.goal, source: p.source, created: p.created } : null };
});
route('POST', '/api/plan', true, async ({ user, body }) => {
  const ctx = context(user);
  const goal = ['abnehmen', 'muskeln', 'cardio'].includes(body.goal) ? body.goal : ctx.profile.goal || 'muskeln';
  ctx.profile.goal = goal;
  run('UPDATE users SET profile=? WHERE id=?', JSON.stringify(ctx.profile), user.id);
  need(ctx.profile.weight && ctx.profile.height && ctx.profile.age, 400, 'Bitte zuerst Profil ausfüllen (Alter, Größe, Gewicht)');
  const targets = targetsFor(ctx.profile, goal);
  let plan = null, source = 'regeln', note = null;
  if (aiAvailable() && body.ai !== false) {
    try { plan = await aiPlan(ctx, goal, targets, str(body.wish, 500)); source = 'ki'; }
    catch (e) { console.error('[agent]', e.message); note = 'KI nicht erreichbar – Plan wurde mit den eingebauten Regeln erstellt.'; }
  }
  if (!plan) plan = rulePlan(ctx, goal, targets);
  if (note) plan.note = note;
  run('INSERT INTO plans(user_id,goal,source,data) VALUES(?,?,?,?)', user.id, goal, source, JSON.stringify(plan));
  return { plan: { ...plan, goal, source, created: new Date().toISOString() } };
});
route('GET', '/api/suggestions', true, ({ user }) => ({ suggestions: suggestions(context(user)) }));

// ---------- static ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let file;
  if (pathname.startsWith('/uploads/')) file = path.join(UPLOADS, path.basename(pathname));
  else {
    file = path.normalize(path.join(ROOT, 'public', pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(path.join(ROOT, 'public'))) file = null;
  }
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'public', 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': pathname.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const r = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!r) return send(404, { error: 'Nicht gefunden' });
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 6_000_000) throw new HttpErr(413, 'Anfrage zu groß'); }
    const body = raw ? JSON.parse(raw) : {};
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    let user = null;
    if (r.auth) {
      user = token && one('SELECT u.* FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.token=?', token);
      need(user, 401, 'Bitte anmelden');
    }
    send(200, await r.fn({ req, url, body, user, token, params: url.pathname.match(r.re).groups || {} }));
  } catch (e) {
    if (!(e instanceof HttpErr)) console.error(e);
    send(e.code || 500, { error: e instanceof HttpErr ? e.message : 'Serverfehler' });
  }
}).listen(PORT, HOST, () => console.log(`FitCrew läuft auf http://${HOST}:${PORT}  (KI-Agent: ${aiAvailable() ? 'an' : 'aus'})`));
