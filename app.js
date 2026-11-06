// FitCrew client — runs fully on the device (IndexedDB), no server.
import { api as localApi, initDb } from './db.js';
import { renderBody, SKINS } from './body.js';
import { CHAINS as CHAIN_LIST, CATALOG, REGION_NAMES } from './catalog.js';
import { DOMS_H } from './bodystate.js';
import { CREDITS } from './credits.js';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => (n == null ? '–' : (+n).toLocaleString('de-DE', { maximumFractionDigits: d }));
const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const MUSCLES = ['Brust', 'Rücken', 'Beine', 'Po', 'Schultern', 'Bizeps', 'Trizeps', 'Bauch', 'Ganzkörper', 'Cardio', 'Sonstiges'];
const CHAINS = CHAIN_LIST.map((c) => c.name);
const GOALS = { abnehmen: ['🔥', 'Abnehmen'], muskeln: ['💪', 'Muskeln'], cardio: ['🫀', 'Cardio'] };

const S = { user: null, body: null, view: 'front', ai: false, tab: ls.get('tab', 'training'), machines: [], workouts: [], active: null,
  plan: null, progress: null, sugg: [], filter: 'Alle', mealDay: 0, rest: null };

async function api(path, opts = {}) {
  try { return await localApi(path, opts); }
  catch (e) { if (e.code === 401 && S.user) { S.user = null; render(); } throw e; }
}
function toast(msg, err) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 2800);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------- icons ----------
const IC = {
  training: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>',
  studio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-6h6v6"/></svg>',
  progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" stroke-linecap="round"/></svg>',
  plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  cam: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h3l2-3h6l2 3h3v11H4z" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5"/></svg>',
  body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="4.5" r="2.5"/><path d="M6 9h12M12 9v6M12 15l-3 6M12 15l3 6"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const TABS = [['training', 'Training'], ['studio', 'Studio'], ['progress', 'Körper'], ['plan', 'Coach'], ['profile', 'Profil']];

// ---------- data loading ----------
async function loadAll() {
  const me = await api('/me'); S.user = me.user; S.ai = me.ai;
  const [w, p, s] = await Promise.all([api('/workouts'), api('/plan'), api('/suggestions')]);
  S.workouts = w.workouts; S.active = w.active; S.plan = p.plan; S.sugg = s.suggestions;
  if (S.user.gym_id) S.machines = (await api(`/gyms/${S.user.gym_id}/machines`)).machines;
}
const refreshWorkouts = async () => { const w = await api('/workouts'); S.workouts = w.workouts; S.active = w.active; };
const refreshMachines = async () => { if (S.user.gym_id) S.machines = (await api(`/gyms/${S.user.gym_id}/machines`)).machines; };
const machine = (id) => S.machines.find((m) => m.id === id);

// ---------- render shell ----------
function render() {
  const app = $('#app');
  if (!S.user) { app.innerHTML = authView(); bindAuth(); $('nav.tabs')?.remove(); return; }
  const view = { training: trainingView, studio: studioView, progress: progressView, plan: planView, profile: profileView }[S.tab];
  app.innerHTML = view();
  let nav = $('nav.tabs');
  if (!nav) { nav = document.createElement('nav'); nav.className = 'tabs'; document.body.append(nav); }
  nav.innerHTML = `<div class="in">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${IC[k === 'progress' ? 'body' : k]}${l}</button>`).join('')}</div>`;
  nav.querySelectorAll('button').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  ({ training: bindTraining, studio: bindStudio, progress: bindProgress, plan: bindPlan, profile: bindProfile })[S.tab]();
}
async function go(tab) {
  S.tab = tab; ls.set('tab', tab); window.scrollTo(0, 0);
  if (tab === 'progress') S.progress = null;
  render();
  if (tab === 'progress') { [S.progress, S.body] = await Promise.all([api('/progress'), api('/body-state')]); render(); }
  if (tab === 'plan' || tab === 'training') { S.sugg = (await api('/suggestions')).suggestions; if (S.tab === tab) render(); }
}

// ---------- auth ----------
function authView() {
  return `<div class="auth">
    <div class="logo">Fit<span>Crew</span></div>
    <p class="muted">Dein Studio. Deine Geräte. Dein Fortschritt. Dein Coach.<br><span class="small">Alle Daten bleiben auf diesem Gerät.</span></p>
    <form id="auth" class="card" style="margin-top:20px">
      <label class="f">Benutzername</label><input class="i" name="username" autocomplete="username" required autocapitalize="off">
      <label class="f">Passwort</label><input class="i" type="password" name="password" autocomplete="current-password" required>
      <button class="btn primary block" style="margin-top:18px" name="go">Anmelden</button>
      <button type="button" class="btn ghost block" style="margin-top:10px" id="reg">Neues Konto erstellen</button>
    </form></div>`;
}
function bindAuth() {
  const f = $('#auth');
  const submit = (path) => guard(async () => {
    const r = await api(path, { body: { username: f.username.value, password: f.password.value } });
    S.tab = r.user.gym_id ? 'training' : 'studio';
    await loadAll(); render();
    if (path === '/register') toast('Willkommen! Wähle zuerst dein Studio.');
  })();
  f.onsubmit = (e) => { e.preventDefault(); submit('/login'); };
  $('#reg').onclick = () => { if (f.reportValidity()) submit('/register'); };
}
function logout() { api('/logout', { method: 'POST' }).catch(() => {}); S.user = null; render(); }

// ---------- sheets ----------
function sheet(html, bind) {
  closeSheet();
  const bd = document.createElement('div'); bd.className = 'backdrop'; bd.onclick = closeSheet;
  const sh = document.createElement('div'); sh.className = 'sheet'; sh.innerHTML = '<div class="grab"></div>' + html;
  document.body.append(bd, sh); bind?.(sh);
  return sh;
}
function closeSheet() { document.querySelectorAll('.backdrop,.sheet').forEach((e) => e.remove()); }

// ---------- image helper: shrink before upload ----------
function pickImage(cb) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.82)); URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };
  inp.click();
}

// ======================================================================
// TRAINING
// ======================================================================
function suggList(n = 3) {
  if (!S.sugg.length) return '';
  return `<div class="list">${S.sugg.slice(0, n).map((s) => `<div class="card tight sugg"><span class="dot ${s.level}"></span>
    <div><b>${esc(s.title)}</b><div class="muted small">${esc(s.text)}</div></div></div>`).join('')}</div>`;
}
function elapsed(start) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(start.replace(' ', 'T') + 'Z')) / 1000));
  return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function groupSets(sets) {
  const g = new Map();
  for (const s of sets) { const k = s.machine_id ? 'm' + s.machine_id : 'e' + s.exercise.toLowerCase(); if (!g.has(k)) g.set(k, { key: k, machine_id: s.machine_id, exercise: s.exercise, sets: [] }); g.get(k).sets.push(s); }
  return g;
}
function trainingView() {
  const name = S.user.profile.name || S.user.username;
  if (!S.active) {
    const days = S.plan?.days || [];
    const last = S.workouts.filter((w) => w.ended).slice(0, 5);
    return `<header class="top"><div><h1>Hallo ${esc(name)}</h1><div class="sub">${S.user.gym ? esc(S.user.gym.name) : 'Noch kein Studio gewählt'}</div></div></header>
      ${days.length ? `<h2>Heute trainieren</h2><div class="list">${days.map((d, i) => `<div class="card tight row">
          <div class="grow"><b>${esc(d.name)}</b><div class="muted small">${esc(d.focus || '')} · ${d.exercises.length} Übungen</div></div>
          <button class="btn primary sm" data-start="${i}">Start</button></div>`).join('')}</div>
        <button class="btn ghost block" style="margin-top:10px" data-start="-1">Freies Training starten</button>`
      : `<div class="card hl"><h3>Bereit?</h3><p class="muted small">Erstelle im Tab „Coach“ deinen Plan – oder starte einfach frei und trage deine Sätze ein.</p>
         <button class="btn primary block" data-start="-1">Training starten</button></div>`}
      ${S.sugg.length ? `<h2>Coach-Hinweise</h2>${suggList(3)}` : ''}
      ${last.length ? `<h2>Letzte Trainings</h2><div class="list">${last.map((w) => {
        const g = groupSets(w.sets); const vol = w.sets.reduce((a, s) => a + (s.weight || 0) * (s.reps || 0), 0);
        return `<div class="card tight"><div class="row"><b class="grow">${esc(w.title || 'Training')}</b><span class="muted small">${new Date(w.started.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span></div>
          <div class="muted small">${g.size} Übungen · ${w.sets.length} Sätze${vol ? ` · ${fmt(vol, 0)} kg bewegt` : ''}</div></div>`; }).join('')}</div>` : ''}`;
  }
  const w = S.workouts.find((x) => x.id === S.active.id) || S.active;
  const g = groupSets(w.sets || []);
  const planDay = ls.get('planday:' + w.id, null);
  const planned = planDay != null && S.plan?.days?.[planDay] ? S.plan.days[planDay].exercises : [];
  for (const p of planned) { const k = p.machine_id ? 'm' + p.machine_id : 'e' + p.name.toLowerCase(); if (!g.has(k)) g.set(k, { key: k, machine_id: p.machine_id, exercise: p.name, sets: [], plan: p }); else g.get(k).plan = p; }
  for (const k of ls.get('extra:' + w.id, [])) if (!g.has(k.key)) g.set(k.key, { ...k, sets: [] });
  return `<header class="top"><div><h1>${esc(w.title || 'Training')}</h1><div class="sub">Läuft seit <span class="timer" id="elapsed">${elapsed(w.started)}</span></div></div>
      <button class="btn primary sm" id="finish">Beenden</button></header>
    <div id="exlist">${[...g.values()].map(exBlock).join('') || '<div class="empty"><div class="em">🏋️</div>Füge deine erste Übung hinzu.</div>'}</div>
    <button class="btn block" style="margin-top:14px" id="addex">${IC.plus} Übung hinzufügen</button>`;
}
function exBlock(e) {
  const m = e.machine_id ? machine(e.machine_id) : null;
  const cardio = m?.kind === 'cardio' || /cardio|lauf|rad|crosstrainer|rudern|ergometer|stepper/i.test(e.exercise) && !e.sets.some((s) => s.weight);
  const last = e.sets[e.sets.length - 1];
  return `<div class="ex" data-key="${esc(e.key)}" data-mid="${e.machine_id ?? ''}" data-name="${esc(e.exercise)}" data-cardio="${cardio ? 1 : ''}" data-has="${e.sets.length ? 1 : ''}">
    <div class="row"><div class="thumb" style="${m?.photo ? `background-image:url('${m.photo}')` : ''}"></div>
      <div class="grow"><b>${esc(e.exercise)}</b><div class="muted small">${esc(m?.muscle || '')}${e.plan ? ` · Plan: ${e.plan.sets}× ${esc(e.plan.reps)}` : ''}</div></div></div>
    <div class="hint" data-hint>…</div>
    ${e.sets.map((s, i) => `<div class="setrow"><span class="n">${i + 1}</span>
      ${cardio ? `<span class="v" style="grid-column:span 2">${fmt(s.minutes)} min</span>` : `<span class="v">${s.weight != null ? fmt(s.weight) + ' kg' : '–'}</span><span class="v">${s.reps ?? '–'} Wdh.</span>`}
      <button class="icon-btn" style="width:34px;height:34px" data-del="${s.id}">${IC.x}</button></div>`).join('')}
    <form class="setrow" data-add><span class="n">${e.sets.length + 1}</span>
      ${cardio ? `<input class="i" style="grid-column:span 2" name="minutes" inputmode="decimal" placeholder="Minuten" value="${last?.minutes ?? ''}">`
      : `<input class="i" name="weight" inputmode="decimal" placeholder="kg" value="${last?.weight ?? ''}"><input class="i" name="reps" inputmode="numeric" placeholder="Wdh." value="${last?.reps ?? ''}">`}
      <button class="icon-btn accent" style="width:34px;height:34px">${IC.plus}</button></form></div>`;
}
let tick;
function bindTraining() {
  clearInterval(tick);
  document.querySelectorAll('[data-start]').forEach((b) => (b.onclick = guard(async () => {
    const i = +b.dataset.start; const day = S.plan?.days?.[i];
    const r = await api('/workouts', { body: { title: day ? day.name : 'Freies Training' } });
    if (day) ls.set('planday:' + r.workout.id, i);
    await refreshWorkouts(); render();
  })));
  if (!S.active) return;
  const w = S.active;
  tick = setInterval(() => { const el = $('#elapsed'); if (el) el.textContent = elapsed(w.started); else clearInterval(tick); }, 1000);
  $('#finish').onclick = guard(async () => {
    const r = await api(`/workouts/${w.id}/finish`, { method: 'POST' });
    toast(r.deleted ? 'Leeres Training verworfen' : 'Stark! Deine trainierten Muskeln leuchten jetzt im Tab „Körper“ 💪');
    stopRest(); await refreshWorkouts(); S.sugg = (await api('/suggestions')).suggestions; render();
  });
  $('#addex').onclick = () => exercisePicker(w.id);
  document.querySelectorAll('.ex').forEach(async (el) => {
    const mid = el.dataset.mid, qs = mid ? `machine_id=${mid}` : `exercise=${encodeURIComponent(el.dataset.name)}`;
    const form = el.querySelector('[data-add]');
    form.onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const body = { workout_id: w.id, machine_id: mid ? +mid : null, exercise: el.dataset.name };
      if (el.dataset.cardio) body.minutes = form.minutes.value.replace(',', '.');
      else { body.weight = form.weight.value.replace(',', '.'); body.reps = form.reps.value; if (!body.reps) throw new Error('Wiederholungen eintragen'); }
      await api('/sets', { body }); await refreshWorkouts(); render();
      if (!el.dataset.cardio) startRest(S.plan?.days?.flatMap((d) => d.exercises).find((p) => (mid && p.machine_id === +mid))?.rest_sec || 90);
      navigator.vibrate?.(30);
    });
    el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = guard(async () => { await api('/sets/' + b.dataset.del, { method: 'DELETE' }); await refreshWorkouts(); render(); })));
    try {
      const pr = await api(`/progress?${qs}&exclude=${w.id}`);
      const h = pr.history, next = pr.next, hint = el.querySelector('[data-hint]');
      const lastTxt = h[0] ? 'Letztes Mal: ' + h[0].sets.map((s) => s.weight ? `${fmt(s.weight)}×${s.reps}` : s.minutes ? `${fmt(s.minutes)} min` : `${s.reps} Wdh.`).join(', ') + '. ' : '';
      hint.textContent = lastTxt + (next?.text || '');
      if (next?.plateau) hint.classList.add('plateau');
      if (!el.dataset.has && next) {
        if (form.weight && next.weight != null) form.weight.value = next.weight;
        if (form.reps && next.reps) form.reps.value = next.reps;
        if (form.minutes && next.minutes) form.minutes.value = next.minutes;
      }
    } catch {}
  });
}

function exercisePicker(wid) {
  const plan = S.plan?.days?.flatMap((d) => d.exercises).filter((e, i, a) => a.findIndex((x) => x.name === e.name) === i) || [];
  const sh = sheet(`<h2>Übung hinzufügen</h2>
    <input class="i" id="exq" placeholder="Suchen oder eigene Übung eingeben">
    <div id="exres" class="list" style="margin-top:12px"></div>`, (sh) => {
    const draw = () => {
      const q = $('#exq', sh).value.trim().toLowerCase();
      const ms = S.machines.filter((m) => !q || (m.name + m.muscle).toLowerCase().includes(q));
      const ps = plan.filter((p) => !p.machine_id && (!q || p.name.toLowerCase().includes(q)));
      $('#exres', sh).innerHTML =
        (q ? `<div class="card tight row" data-free="${esc($('#exq', sh).value.trim())}" style="cursor:pointer">${IC.plus}<b>„${esc($('#exq', sh).value.trim())}“ als freie Übung</b></div>` : '') +
        ms.map((m) => `<div class="card tight row" data-m="${m.id}" style="cursor:pointer"><div class="thumb" style="width:44px;height:44px;border-radius:10px;background:var(--card2) center/cover;${m.photo ? `background-image:url('${m.photo}')` : ''}"></div>
          <div class="grow"><b>${esc(m.name)}</b><div class="muted small">${esc(m.muscle)}</div></div></div>`).join('') +
        ps.map((p) => `<div class="card tight" data-free="${esc(p.name)}" style="cursor:pointer"><b>${esc(p.name)}</b><div class="muted small">aus deinem Plan</div></div>`).join('') ||
        '<div class="empty">Keine Treffer – tippe einen Namen ein.</div>';
      sh.querySelectorAll('[data-m],[data-free]').forEach((c) => (c.onclick = () => {
        const m = c.dataset.m ? machine(+c.dataset.m) : null;
        const item = m ? { key: 'm' + m.id, machine_id: m.id, exercise: m.name } : { key: 'e' + c.dataset.free.toLowerCase(), machine_id: null, exercise: c.dataset.free };
        const extra = ls.get('extra:' + wid, []); if (!extra.some((x) => x.key === item.key)) extra.push(item); ls.set('extra:' + wid, extra);
        closeSheet(); render();
        setTimeout(() => document.querySelector(`.ex[data-key="${CSS.escape(item.key)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      }));
    };
    $('#exq', sh).oninput = draw; draw();
  });
}

// rest timer
function startRest(sec) {
  stopRest(); let left = sec;
  const el = document.createElement('div'); el.className = 'rest';
  const upd = () => (el.innerHTML = `Pause ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} <button data-p>+15</button><button data-x>✕</button>`);
  upd(); document.body.append(el);
  el.onclick = (e) => { if (e.target.dataset.p != null) { left += 15; upd(); } if (e.target.dataset.x != null) stopRest(); };
  S.rest = setInterval(() => { left--; if (left <= 0) { navigator.vibrate?.([200, 100, 200]); toast('Pause vorbei – nächster Satz!'); stopRest(); } else upd(); }, 1000);
}
function stopRest() { clearInterval(S.rest); document.querySelectorAll('.rest').forEach((e) => e.remove()); }

// ======================================================================
// STUDIO
// ======================================================================
function studioView() {
  if (!S.user.gym) return gymPickerView();
  const muscles = ['Alle', ...MUSCLES.filter((m) => S.machines.some((x) => x.muscle === m))];
  const list = S.machines.filter((m) => S.filter === 'Alle' || m.muscle === S.filter);
  return `<header class="top"><div><h1>${esc(S.user.gym.name)}</h1><div class="sub">${esc([S.user.gym.chain, S.user.gym.city].filter(Boolean).join(' · '))} · ${S.machines.length} Geräte</div></div>
      <button class="icon-btn accent" id="addm" aria-label="Gerät hinzufügen">${IC.plus}</button></header>
    ${S.machines.length > 3 ? `<div class="chips">${muscles.map((m) => `<button class="chip ${S.filter === m ? 'on' : ''}" data-f="${m}">${m}</button>`).join('')}</div><div style="height:12px"></div>` : ''}
    ${list.length ? `<div class="mgrid">${list.map((m) => `<button class="mcard" data-m="${m.id}">
        <div class="ph" style="${m.photo ? `background-image:url('${m.photo}')` : ''}">${m.photo ? '' : IC.cam}</div>
        <div class="meta"><b>${esc(m.name)}</b><span class="muted small">${esc(m.muscle)}${m.kind === 'cardio' && m.muscle !== 'Cardio' ? ' · Cardio' : ''}</span></div></button>`).join('')}</div>`
      : `<div class="empty"><div class="em">📸</div>Noch keine Geräte in diesem Studio.</div>`}
    <p class="muted small">Katalogfotos zeigen den Gerätetyp. Ersetze sie mit „Bearbeiten“ durch ein Foto aus deinem Studio. Jedes Studio ist anders aufgestellt – lösche, was es bei dir nicht gibt.</p>
    <div class="grid2"><button class="btn ghost" id="seed">Katalog ergänzen</button><button class="btn ghost" id="switch">Studio wechseln</button></div>`;
}
function gymPickerView() {
  return `<header class="top"><div><h1>Dein Studio</h1><div class="sub">Wähle die Kette – typische Geräte mit Fotos, Wiederholungen und Startgewicht werden automatisch angelegt.</div></div></header>
    <input class="i" id="gq" placeholder="z. B. Clever Fit München" value="${esc(S.gq || '')}">
    <div id="gres" class="list" style="margin-top:12px"><div class="empty"><div class="spinner" style="margin:auto"></div></div></div>
    <h2>Nicht dabei?</h2>
    <form id="newgym" class="card">
      <label class="f">Kette</label><select class="i" name="chain">${CHAINS.map((c) => `<option>${c}</option>`).join('')}</select>
      <label class="f">Name des Studios</label><input class="i" name="name" placeholder="Clever Fit Hamburg-Altona" required>
      <div class="grid2"><div><label class="f">Stadt</label><input class="i" name="city"></div><div><label class="f">Straße</label><input class="i" name="address"></div></div>
      <button class="btn primary block" style="margin-top:16px">Studio anlegen</button></form>
    <p class="muted small">Gerätemarken laut Ketten-Angaben (z. B. Clever Fit: Life Fitness / Hammer Strength, McFit & John Reed: gym80). Einzelne Studios können abweichen.</p>`;
}
function bindStudio() {
  if (!S.user.gym) {
    const search = async () => {
      S.gq = $('#gq').value;
      const { gyms } = await api('/gyms?q=' + encodeURIComponent(S.gq));
      const res = $('#gres'); if (!res) return;
      res.innerHTML = gyms.map((g) => `<div class="card tight row"><div class="grow"><b>${esc(g.name)}</b>
        <div class="muted small">${esc([g.chain, g.city, g.address].filter(Boolean).join(' · '))}<br>${g.machines} Geräte · ${g.members} Mitglieder</div></div>
        <button class="btn primary sm" data-join="${g.id}">Beitreten</button></div>`).join('') || '<div class="empty small">Kein Studio gefunden – leg es unten an.</div>';
      res.querySelectorAll('[data-join]').forEach((b) => (b.onclick = guard(async () => {
        await api(`/gyms/${b.dataset.join}/join`, { method: 'POST' }); await loadAll(); render(); toast('Studio gewählt');
      })));
    };
    let t; $('#gq').oninput = () => { clearTimeout(t); t = setTimeout(guard(search), 250); };
    guard(search)();
    const f = $('#newgym');
    f.chain.onchange = () => { if (!f.name.value && f.chain.value !== 'Unabhängig') f.name.value = f.chain.value + ' '; f.name.focus(); };
    f.onsubmit = guard(async (e) => {
      e.preventDefault();
      await api('/gyms', { body: { chain: f.chain.value === 'Unabhängig' ? '' : f.chain.value, name: f.name.value, city: f.city.value, address: f.address.value } });
      await loadAll(); render(); toast(`Studio angelegt – ${S.machines.length} Geräte aus dem Katalog übernommen`);
    });
    return;
  }
  $('#addm').onclick = () => machineForm();
  $('#switch').onclick = () => { S.user.gym = null; render(); };
  $('#seed').onclick = guard(async () => { const n = S.machines.length; await api(`/gyms/${S.user.gym_id}/seed`, { method: 'POST' }); await refreshMachines(); render(); toast(`${S.machines.length - n} Geräte ergänzt`); });
  document.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; render(); }));
  document.querySelectorAll('.mcard').forEach((c) => (c.onclick = () => machineDetail(+c.dataset.m)));
}
function machineForm(m = null) {
  let photo = null;
  sheet(`<h2>${m ? 'Gerät bearbeiten' : 'Neues Gerät'}</h2>
    <form id="mf">
      <div class="photo-pick" id="pp" style="${m?.photo ? `background-image:url('${m.photo}')` : ''}">${m?.photo ? '' : `<div>${IC.cam}<div class="small">Foto aufnehmen</div></div>`}</div>
      <label class="f">Name</label><input class="i" name="name" required placeholder="z. B. Beinpresse (Gym80)" value="${esc(m?.name || '')}">
      <div class="grid2"><div><label class="f">Muskelgruppe</label><select class="i" name="muscle">${MUSCLES.map((x) => `<option ${m?.muscle === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div><label class="f">Art</label><select class="i" name="kind"><option value="kraft">Kraft</option><option value="cardio" ${m?.kind === 'cardio' ? 'selected' : ''}>Cardio</option></select></div></div>
      <label class="f">Marke (optional)</label><input class="i" name="brand" placeholder="z. B. Life Fitness, gym80" value="${esc(m?.brand || '')}">
      <label class="f">Hinweise (Einstellung, Sitzhöhe, Standort …)</label><textarea class="i" name="notes" placeholder="Sitz auf Stufe 4, hinten links neben den Spiegeln">${esc(m?.notes || '')}</textarea>
      <button class="btn primary block" style="margin-top:16px">Speichern</button>
    </form>`, (sh) => {
    const pp = $('#pp', sh), f = $('#mf', sh);
    pp.onclick = () => pickImage((d) => { photo = d; pp.style.backgroundImage = `url('${d}')`; pp.innerHTML = ''; });
    f.muscle.onchange = () => { if (f.muscle.value === 'Cardio') f.kind.value = 'cardio'; };
    f.onsubmit = guard(async (e) => {
      e.preventDefault(); const btn = f.querySelector('button'); btn.disabled = true;
      const body = { name: f.name.value, muscle: f.muscle.value, kind: f.kind.value, notes: f.notes.value, brand: f.brand.value, photo };
      try {
        if (m) await api('/machines/' + m.id, { method: 'PUT', body }); else await api(`/gyms/${S.user.gym_id}/machines`, { body });
      } finally { btn.disabled = false; }
      closeSheet(); await refreshMachines(); render(); toast('Gespeichert');
    });
  });
}
async function machineDetail(id) {
  const m = machine(id); if (!m) return;
  const sh = sheet(`${m.photo ? `<img class="photo-big" src="${m.photo}" alt="">` : ''}
    <h2>${esc(m.name)}</h2><div class="row wrap"><span class="tag">${esc(m.muscle)}</span>${m.brand ? `<span class="tag">${esc(m.brand)}</span>` : ''}
      <span class="muted small">${m.catalog ? 'aus dem Katalog' : 'angelegt von ' + esc(m.author || '–')}</span></div>
    ${m.catalog && CATALOG[m.catalog] ? `<div class="row wrap" style="margin-top:8px">${Object.entries(CATALOG[m.catalog].regions).filter(([, w]) => w >= 0.5).map(([r, w]) => `<span class="tag ${w === 1 ? 'green' : ''}">${REGION_NAMES[r]}</span>`).join('')}</div>` : ''}
    ${m.notes ? `<p>${esc(m.notes)}</p>` : ''}
    <div id="mh" class="stack" style="margin-top:14px"><div class="spinner"></div></div>
    <div class="grid2" style="margin-top:16px"><button class="btn" id="edit">Bearbeiten</button>
      ${m.created_by === S.user.id || !m.created_by || S.user.admin ? '<button class="btn danger" id="del">Löschen</button>' : '<span></span>'}</div>
    ${S.active ? '<button class="btn primary block" style="margin-top:10px" id="toW">Zum laufenden Training</button>' : ''}`);
  $('#edit', sh).onclick = () => machineForm(m);
  if ($('#del', sh)) $('#del', sh).onclick = guard(async () => {
    if (!confirm('Gerät löschen?')) return;
    await api('/machines/' + m.id, { method: 'DELETE' }); closeSheet(); await refreshMachines(); render();
  });
  if ($('#toW', sh)) $('#toW', sh).onclick = () => {
    const extra = ls.get('extra:' + S.active.id, []); if (!extra.some((x) => x.key === 'm' + m.id)) extra.push({ key: 'm' + m.id, machine_id: m.id, exercise: m.name });
    ls.set('extra:' + S.active.id, extra); closeSheet(); go('training');
  };
  const pr = await api('/progress?machine_id=' + m.id);
  $('#mh', sh).innerHTML = pr.history.length
    ? `<div class="card tight"><b>Dein Fortschritt</b>${lineChart(pr.history.slice().reverse().map((h) => ({ x: h.date, y: bestOf(h) })), m.kind === 'cardio' ? 'min' : 'kg')}
       <div class="hint ${pr.next.plateau ? 'plateau' : ''}">${esc(pr.next.text)}</div></div>`
    : `<div class="card tight hl"><b>Empfehlung für dich</b><div class="small" style="margin-top:4px">${pr.start
        ? `Start: <b>${fmt(pr.start.weight)} kg</b> · ${esc(pr.start.reps)}<br><span class="muted">Richtwert – Gewichtsangaben sind je nach Hersteller verschieden. Die letzten 2 Wiederholungen sollen schwer sein, aber sauber.</span>`
        : esc(CATALOG[m.catalog]?.reps || pr.next.text)}</div></div>`;
}

// ======================================================================
// PROGRESS
// ======================================================================
const bestOf = (h) => Math.max(...h.sets.map((s) => (s.weight ? s.weight * (1 + (s.reps || 0) / 30) : s.minutes || s.reps || 0)));
function lineChart(pts, unit = '', h = 160) {
  pts = pts.filter((p) => p.y != null && isFinite(p.y));
  if (pts.length < 2) return '<div class="muted small" style="padding:10px 0">Mindestens 2 Einträge für eine Kurve.</div>';
  const W = 320, P = 26, ys = pts.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const X = (i) => P + (i * (W - P - 8)) / (pts.length - 1), Y = (v) => 12 + (h - 34) * (1 - (v - lo) / span);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const date = (s) => new Date(s.replace(' ', 'T')).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="gg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#c8f560" stop-opacity=".35"/><stop offset="1" stop-color="#c8f560" stop-opacity="0"/></linearGradient></defs>
    <text x="0" y="${Y(hi) + 3}">${fmt(hi)}</text><text x="0" y="${Y(lo) + 3}">${fmt(lo)}</text>
    <path d="${d}L${X(pts.length - 1)},${h - 22}L${P},${h - 22}Z" fill="url(#gg)"/>
    <path d="${d}" fill="none" stroke="#c8f560" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.y)}" r="3" fill="#c8f560"/>`).join('')}
    <text x="${P}" y="${h - 6}">${date(pts[0].x)}</text><text x="${W - 8}" y="${h - 6}" text-anchor="end">${date(pts[pts.length - 1].x)} ${unit}</text></svg>`;
}
function spark(vals) {
  if (vals.length < 2) return '<span class="spark"></span>';
  const lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${(i * 88) / (vals.length - 1) + 1},${30 - ((v - lo) / sp) * 28}`).join('');
  const up = vals[vals.length - 1] >= vals[0];
  return `<svg class="spark" viewBox="0 0 90 32"><path d="${d}" fill="none" stroke="${up ? '#5ee59a' : '#ff6b6b'}" stroke-width="2"/></svg>`;
}
function bodyFig(st, view, opts = {}) { return renderBody(st, view, { skin: ls.get('skin', 'mittel'), ...opts }); }
function fatFor(p, w) { const bmi = w / (p.height / 100) ** 2; return Math.max(5, Math.min(60, 1.2 * bmi + 0.23 * (p.age || 30) - 10.8 * (p.sex === 'w' ? 0 : 1) - 5.4)); }
function progressView() {
  const P = S.progress, B = S.body, p = S.user.profile;
  if (!P || !B) return `<header class="top"><h1>Körper</h1></header><div class="empty"><div class="spinner" style="margin:auto"></div></div>`;
  const w = P.body.slice().reverse().filter((b) => b.weight);
  if (!B.weight || !B.height) return `<header class="top"><h1>Körper</h1></header><div class="card hl"><b>Trag deine Maße ein</b>
    <p class="muted small">Mit Größe, Gewicht und Alter wird dein Körper berechnet – er verändert sich, wenn du abnimmst oder Muskeln aufbaust.</p>
    <button class="btn primary block" id="toProfile">Zum Profil</button></div>`;
  const tw = S.timeW ?? B.weight;
  const view = { ...B, weight: tw, bf: tw === B.weight ? B.bf : fatFor(p, tw), sore: tw === B.weight ? B.sore : {} };
  const startW = B.weights[0]?.weight, goalW = Math.min(B.weight, Math.round(25 * (B.height / 100) ** 2));
  const goalSt = { ...B, weight: goalW, bf: Math.min(fatFor(p, goalW), p.sex === 'w' ? 24 : 15), sore: {},
    muscles: Object.fromEntries(Object.entries(B.muscles).map(([r, v]) => [r, Math.min(1, v + 0.35)])) };
  const sore = Object.entries(B.sore).sort((a, b) => b[1].level - a[1].level);
  const dev = Object.entries(B.muscles).sort((a, b) => b[1] - a[1]);
  const skin = ls.get('skin', 'mittel');
  return `<header class="top"><div><h1>Körper</h1><div class="sub">${fmt(B.height, 0)} cm · ${fmt(tw)} kg · BMI ${fmt(tw / (B.height / 100) ** 2)} · ca. ${fmt(view.bf, 0)} % Fett</div></div></header>
    <div class="chips"><button class="chip ${S.view === 'front' ? 'on' : ''}" data-v="front">Vorne</button><button class="chip ${S.view === 'back' ? 'on' : ''}" data-v="back">Hinten</button>
      ${Object.keys(SKINS).map((k) => `<button class="chip ${skin === k ? 'on' : ''}" data-skin="${k}" title="Hautton"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:-2px;background:${SKINS[k][0]}"></span></button>`).join('')}</div>
    <div class="bodywrap">${bodyFig(view, S.view)}</div>
    ${w.length > 1 ? `<div class="card tight"><div class="row"><b class="grow">Zeitreise</b><span class="muted small">${tw === B.weight ? 'heute' : fmt(tw) + ' kg'}</span></div>
      <input type="range" id="tw" min="${Math.min(...w.map((x) => x.weight), goalW)}" max="${Math.max(...w.map((x) => x.weight))}" step="0.5" value="${tw}" style="width:100%;accent-color:var(--accent)">
      <div class="muted small">Schieb, um deinen Körper bei anderem Gewicht zu sehen.</div></div>` : ''}
    <h2>Muskelkater & Erholung</h2>
    ${sore.length ? `<div class="list">${sore.map(([r, x]) => `<div class="card tight"><div class="row"><span class="dot ${x.level > 0.6 ? 'wichtig' : 'tipp'}" style="width:10px;height:10px;border-radius:50%"></span>
        <b class="grow">${esc(x.name)}</b><span class="muted small">noch ca. ${x.hoursLeft} h</span></div>
        <div class="bar"><i style="width:${Math.round((x.hoursLeft / DOMS_H[r]) * 100)}%"></i></div></div>`).join('')}</div>`
      : '<div class="card tight muted small">Kein Muskelkater – alle Muskeln sind erholt. Nach dem Training leuchten die trainierten Muskeln so lange, wie Muskelkater normalerweise anhält (Bauch ~1,5 Tage, Arme/Schultern/Waden ~2, Brust/Rücken ~2,5, Beine/Po ~3).</div>'}
    ${B.ready.length ? `<div class="card tight hl" style="margin-top:10px"><b>Bereit für Training</b><div class="small muted">${B.ready.map((r) => `${r.name}${r.days != null ? ` (zuletzt vor ${r.days} T.)` : ' (noch nie)'}`).join(' · ')}</div></div>` : ''}
    <h2>Vorher · Jetzt · Ziel</h2>
    <div class="grid3 center small">
      <div>${startW ? bodyFig({ ...B, weight: startW, bf: fatFor(p, startW), sore: {} }, 'front', { noSore: true }) : ''}<div class="muted">${startW ? fmt(startW) + ' kg' : '–'}</div></div>
      <div>${bodyFig(B, 'front', { noSore: true })}<div><b>${fmt(B.weight)} kg</b></div></div>
      <div>${bodyFig(goalSt, 'front')}<div class="muted">${fmt(goalW)} kg + Muskeln</div></div></div>
    <h2>Muskelaufbau</h2>
    <div class="card tight">${dev.map(([r, v]) => `<div class="row small" style="margin:5px 0"><span style="width:150px">${esc(REGION_NAMES[r])}</span>
      <div class="bar grow"><i style="width:${Math.round(v * 100)}%;background:var(--green)"></i></div></div>`).join('')}
      <div class="muted small" style="margin-top:6px">Wächst mit jedem Satz, der den Muskel trifft, und baut sich ab, wenn du ihn wochenlang nicht trainierst.</div></div>
    <h2>Gewicht</h2>
    <div class="card"><div class="row"><b class="grow">Körpergewicht</b>${w.length ? `<span class="muted">${fmt(w[w.length - 1].weight)} kg</span>` : ''}</div>
      ${lineChart(w.map((b) => ({ x: b.date, y: b.weight })), 'kg')}
      <form id="bf" class="grid3" style="margin-top:8px"><input class="i" name="weight" inputmode="decimal" placeholder="kg"><input class="i" name="bodyfat" inputmode="decimal" placeholder="KFA %">
        <button class="btn primary">Wiegen</button></form></div>
    <h2>Übungen</h2>
    ${P.exercises.length ? `<div class="list">${P.exercises.map((e, i) => {
      const vals = e.history.slice().reverse().map(bestOf);
      return `<div class="card tight row" data-ex="${i}" style="cursor:pointer"><div class="grow"><b>${esc(e.exercise)}</b>
        <div class="muted small">${e.sessions}× trainiert · ${esc(e.next.text)}</div></div>${spark(vals)}</div>`; }).join('')}</div>`
      : '<div class="empty"><div class="em">📈</div>Nach deinem ersten Training siehst du hier jede Übung mit Verlauf.</div>'}`;
}
function bindProgress() {
  if ($('#toProfile')) $('#toProfile').onclick = () => go('profile');
  if (!S.progress || !$('#bf')) return;
  document.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { S.view = b.dataset.v; render(); }));
  document.querySelectorAll('[data-skin]').forEach((b) => (b.onclick = () => { ls.set('skin', b.dataset.skin); render(); }));
  if ($('#tw')) $('#tw').oninput = (e) => { S.timeW = +e.target.value; const y = window.scrollY; render(); window.scrollTo(0, y); };
  $('#bf').onsubmit = guard(async (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.weight.value) throw new Error('Gewicht eintragen');
    await api('/body', { body: { weight: f.weight.value.replace(',', '.'), bodyfat: f.bodyfat.value.replace(',', '.') } });
    S.timeW = null; [S.progress, S.body] = await Promise.all([api('/progress'), api('/body-state')]); S.user = (await api('/me')).user; render(); toast('Gespeichert – dein Körper wurde aktualisiert');
  });
  document.querySelectorAll('[data-ex]').forEach((c) => (c.onclick = () => {
    const e = S.progress.exercises[+c.dataset.ex];
    sheet(`<h2>${esc(e.exercise)}</h2>
      ${lineChart(e.history.slice().reverse().map((h) => ({ x: h.date, y: bestOf(h) })), e.history[0]?.sets[0]?.weight ? 'kg (1RM)' : '')}
      <div class="hint ${e.next.plateau ? 'plateau' : ''}">${esc(e.next.text)}</div>
      <table class="t" style="margin-top:12px"><tr><th>Datum</th><th>Sätze</th></tr>
      ${e.history.map((h) => `<tr><td>${new Date(h.date.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE')}</td>
        <td>${h.sets.map((s) => s.weight ? `${fmt(s.weight)}×${s.reps}` : s.minutes ? `${fmt(s.minutes)} min` : `${s.reps}`).join(' · ')}</td></tr>`).join('')}</table>`);
  }));
}

// ======================================================================
// COACH / PLAN
// ======================================================================
function planView() {
  const p = S.plan, goal = S.goal || p?.goal || S.user.profile.goal || 'muskeln';
  const t = p?.targets;
  const md = p?.meals?.[S.mealDay] || p?.meals?.[0];
  return `<header class="top"><div><h1>Coach</h1><div class="sub">${S.ai ? 'KI-Coach aktiv' : 'Eingebauter Coach'} · Trainings- & Essensplan</div></div></header>
    <div class="goals">${Object.entries(GOALS).map(([k, [em, l]]) => `<div class="goal ${goal === k ? 'on' : ''}" data-goal="${k}"><div class="em">${em}</div><b>${l}</b></div>`).join('')}</div>
    <label class="f">Wünsche an den Coach (optional)</label>
    <textarea class="i" id="wish" placeholder="z. B. Rücken stärken, nur 45 Minuten Zeit, keine Kniebeugen wegen Knie">${esc(S.wish || '')}</textarea>
    <button class="btn primary block" style="margin-top:12px" id="gen">${p ? 'Plan neu erstellen' : 'Meinen Plan erstellen'}</button>
    ${p ? `
      <h2>Dein Plan <span class="tag ${p.source === 'ki' ? 'ki' : ''}">${p.source === 'ki' ? 'KI' : 'Regeln'}</span> <span class="tag">${GOALS[p.goal]?.[1] || ''}</span></h2>
      ${p.note ? `<div class="card tight small" style="border-color:var(--orange)">${esc(p.note)}</div><div style="height:10px"></div>` : ''}
      <div class="card"><p style="margin-top:0">${esc(p.summary)}</p>
        <div class="macro"><div><b>${fmt(t.kcal, 0)}</b><span>kcal</span></div><div><b>${t.protein} g</b><span>Eiweiß</span></div>
          <div><b>${t.carbs} g</b><span>Kohlenh.</span></div><div><b>${t.fat} g</b><span>Fett</span></div></div>
        <div class="muted small" style="margin-top:8px">Grundumsatz ${t.bmr} kcal · Gesamtumsatz ~${t.tdee} kcal · Wasser ${fmt(t.water)} l</div></div>
      <h2>Training</h2>
      ${p.days.map((d) => `<details class="day"><summary><div><b>${esc(d.name)}</b><div class="muted small">${esc(d.focus || '')}</div></div></summary>
        ${d.exercises.map((e) => { const m = e.machine_id ? machine(e.machine_id) : null; return `<div class="pex">
          <div class="thumb" style="width:46px;height:46px;border-radius:10px;flex:none;background:var(--card2) center/cover;${m?.photo ? `background-image:url('${m.photo}')` : ''}"></div>
          <div class="grow"><b>${esc(e.name)}</b> <span class="muted small">${e.sets}× ${esc(e.reps)}${e.rest_sec ? ` · ${e.rest_sec}s Pause` : ''}</span>
          ${e.hint || e.note ? `<div class="small" style="color:var(--accent)">${esc(e.hint || e.note)}</div>` : ''}</div></div>`; }).join('')}</details>`).join('')}
      <h2>Ernährung</h2>
      <div class="chips">${p.meals.map((d, i) => `<button class="chip ${i === S.mealDay ? 'on' : ''}" data-md="${i}">${esc(d.name)}</button>`).join('')}</div>
      <div class="card" style="margin-top:10px">${md.meals.map((m) => `<div class="meal"><div class="row"><b class="grow">${esc(m.slot)}: ${esc(m.name)}</b><span class="muted small">${fmt(m.kcal, 0)} kcal · ${fmt(m.protein, 0)} g E</span></div>
          <ul>${Object.entries(m.items).map(([f, g]) => `<li>${g} g ${esc(f)}</li>`).join('')}</ul></div>`).join('')}
        <div class="muted small" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px">Summe: ${fmt(md.total.kcal, 0)} kcal · ${fmt(md.total.protein, 0)} g Eiweiß · ${fmt(md.total.carbs, 0)} g KH · ${fmt(md.total.fat, 0)} g Fett${md.note ? `<br>${esc(md.note)}` : ''}</div></div>
      <h2>Verbesserungsvorschläge</h2>
      ${suggList(10)}
      <div class="list" style="margin-top:10px">${(p.tips || []).map((x) => `<div class="card tight sugg"><span class="dot info"></span><div class="small">${esc(x)}</div></div>`).join('')}</div>
      <p class="muted small center" style="margin-top:20px">Allgemeine Empfehlungen, kein Ersatz für ärztlichen Rat.</p>`
    : `<div style="height:16px"></div>${suggList(5)}`}`;
}
function bindPlan() {
  document.querySelectorAll('[data-goal]').forEach((g) => (g.onclick = () => { S.goal = g.dataset.goal; S.wish = $('#wish').value; render(); }));
  document.querySelectorAll('[data-md]').forEach((c) => (c.onclick = () => { S.mealDay = +c.dataset.md; render(); }));
  $('#wish').oninput = (e) => (S.wish = e.target.value);
  $('#gen').onclick = guard(async () => {
    const pr = S.user.profile;
    if (!pr.age || !pr.height || !pr.weight) { toast('Bitte zuerst dein Profil ausfüllen'); return go('profile'); }
    const b = $('#gen'); b.disabled = true; b.innerHTML = `<span class="spinner"></span> ${S.ai ? 'KI-Coach analysiert deine Daten …' : 'Erstelle Plan …'}`;
    try {
      const r = await api('/plan', { body: { goal: S.goal || pr.goal || 'muskeln', wish: S.wish || '' } });
      S.plan = r.plan; S.mealDay = 0; S.user.profile.goal = r.plan.goal; S.sugg = (await api('/suggestions')).suggestions;
      render(); toast('Dein Plan ist fertig');
    } finally { if ($('#gen')) { $('#gen').disabled = false; } }
  });
}

// ======================================================================
// PROFILE
// ======================================================================
function profileView() {
  const p = S.user.profile;
  const sel = (name, opts, val) => `<select class="i" name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const ios = /iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone;
  return `<header class="top"><div><h1>Profil</h1><div class="sub">@${esc(S.user.username)}${S.user.superAdmin ? ' · Global-Admin' : S.user.admin ? ' · Admin' : ''}</div></div></header>
    ${ios ? '<div class="card tight small hl">📲 Als App installieren: unten auf <b>Teilen</b> tippen → <b>Zum Home-Bildschirm</b>.</div><div style="height:12px"></div>' : ''}
    <form id="pf" class="card">
      <label class="f">Name</label><input class="i" name="name" value="${esc(p.name || '')}">
      <div class="grid2"><div><label class="f">Geschlecht</label>${sel('sex', [['m', 'männlich'], ['w', 'weiblich']], p.sex)}</div>
        <div><label class="f">Alter</label><input class="i" name="age" inputmode="numeric" value="${p.age ?? ''}"></div></div>
      <div class="grid2"><div><label class="f">Größe (cm)</label><input class="i" name="height" inputmode="numeric" value="${p.height ?? ''}"></div>
        <div><label class="f">Gewicht (kg)</label><input class="i" name="weight" inputmode="decimal" value="${p.weight ?? ''}"></div></div>
      <div class="grid2"><div><label class="f">Alltag</label>${sel('activity', [['niedrig', 'Sitzend'], ['mittel', 'Etwas Bewegung'], ['hoch', 'Körperlich aktiv']], p.activity || 'mittel')}</div>
        <div><label class="f">Erfahrung</label>${sel('experience', [['anfaenger', 'Anfänger'], ['fortgeschritten', 'Fortgeschritten'], ['profi', 'Profi']], p.experience)}</div></div>
      <div class="grid2"><div><label class="f">Trainingstage / Woche</label>${sel('days', [2, 3, 4, 5, 6].map((d) => [d, d + '×']), p.days || 3)}</div>
        <div><label class="f">Minuten pro Training</label>${sel('minutes', [30, 45, 60, 75, 90].map((d) => [d, d + ' min']), p.minutes || 60)}</div></div>
      <label class="f">Ziel</label>${sel('goal', Object.entries(GOALS).map(([k, [, l]]) => [k, l]), p.goal || 'muskeln')}
      <label class="f">Ernährung</label><input class="i" name="diet" placeholder="z. B. vegetarisch, laktosefrei, mag keinen Fisch" value="${esc(p.diet || '')}">
      <label class="f">Verletzungen / Einschränkungen</label><input class="i" name="limits" placeholder="z. B. Knie links, Bandscheibe" value="${esc(p.limits || '')}">
      <button class="btn primary block" style="margin-top:16px">Speichern</button></form>
    ${S.user.admin ? '<div id="admin"><h2>Admin</h2><div class="card"><div class="spinner"></div></div></div>' : ''}
    <h2>Daten</h2>
    <div class="card tight small muted">Alle Daten liegen nur auf diesem Gerät. Mach ab und zu eine Sicherung (Datei in „Dateien“ speichern).</div>
    <div class="grid2" style="margin-top:10px"><button class="btn" id="exp">Sicherung exportieren</button>${S.user.admin ? '<button class="btn" id="imp">Sicherung laden</button>' : '<span></span>'}</div>
    <details class="day" style="margin-top:12px"><summary><b>Bildnachweise</b></summary><div class="small muted" style="margin-top:8px">
      Gerätefotos von Wikimedia Commons:<br>${Object.values(CREDITS).map((c) => `„${esc(c.title)}“ – ${esc(c.author)}, ${esc(c.license)}`).join('<br>') || '–'}</div></details>
    <button class="btn ghost block" style="margin-top:12px" id="out">Abmelden</button>
    <p class="muted small center">FitCrew · ${S.ai ? 'KI-Coach aktiv' : 'Eingebauter Coach (KI aus)'}</p>`;
}
function bindProfile() {
  $('#pf').onsubmit = guard(async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target)); body.weight = body.weight.replace(',', '.');
    S.user = (await api('/me/profile', { method: 'PUT', body })).user; toast('Profil gespeichert');
  });
  $('#out').onclick = logout;
  $('#exp').onclick = guard(async () => {
    const data = await api('/export');
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], `fitcrew-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'FitCrew-Sicherung' }).catch(() => {});
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); }
  });
  if ($('#imp')) $('#imp').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = guard(async () => {
      const data = JSON.parse(await inp.files[0].text());
      if (!confirm('Alle Daten auf diesem Gerät durch die Sicherung ersetzen?')) return;
      await api('/import', { body: data }); await loadAll(); render(); toast('Sicherung geladen');
    });
    inp.click();
  };
  if (S.user.admin) adminPanel();
}

// ---------- admin ----------
async function adminPanel() {
  const [st, { users }] = await Promise.all([api('/admin/settings'), api('/admin/users')]);
  const el = $('#admin'); if (!el) return;
  el.innerHTML = `<h2>Admin</h2>
    <div class="card"><div class="row"><div class="grow"><b>KI-Coach (Anthropic)</b><div class="muted small">${st.hasKey ? 'Schlüssel: ' + esc(st.keyHint) : 'Noch kein API-Schlüssel'} · Modell ${esc(st.model)}</div></div>
        <label class="switch"><input type="checkbox" id="aiOn" ${st.aiEnabled ? 'checked' : ''} ${st.hasKey ? '' : 'disabled'}><span></span></label></div>
      <label class="f">API-Schlüssel</label><input class="i" id="key" type="password" autocomplete="off" placeholder="${st.hasKey ? 'neuen Schlüssel einfügen …' : 'sk-ant-…'}">
      <div class="grid2" style="margin-top:10px"><button class="btn primary" id="saveKey">Speichern</button><button class="btn" id="testKey" ${st.hasKey ? '' : 'disabled'}>Testen</button></div>
      <div class="muted small" style="margin-top:8px">Den Schlüssel bekommst du unter console.anthropic.com → API Keys. Er wird nur auf diesem Gerät gespeichert und gilt für alle Benutzer hier.</div></div>
    <h2>Benutzer</h2>
    <div class="list">${users.map((u) => `<div class="card tight admin-user"><div class="grow"><b>${esc(u.username)}</b>
        ${u.superAdmin ? '<span class="tag ki">Global-Admin</span>' : u.admin ? '<span class="tag green">Admin</span>' : ''}
        <div class="muted small">${u.workouts} Trainings${u.gym ? ' · ' + esc(u.gym.name) : ''}</div></div>
        <button class="btn sm" data-pw="${u.id}">Passwort</button>
        ${u.superAdmin ? '' : `<button class="btn sm" data-adm="${u.id}" data-val="${u.admin ? 0 : 1}">${u.admin ? 'Admin ✕' : 'Admin'}</button>`}
        ${u.superAdmin || u.id === S.user.id ? '' : `<button class="icon-btn" style="width:34px;height:34px" data-delu="${u.id}">${IC.x}</button>`}</div>`).join('')}</div>
    <form id="newu" class="card" style="margin-top:10px"><b>Benutzer anlegen</b>
      <div class="grid2"><input class="i" name="username" placeholder="Name" required autocapitalize="off" style="margin-top:10px"><input class="i" name="password" type="password" placeholder="Passwort" required style="margin-top:10px"></div>
      <label class="row small" style="margin-top:10px"><input type="checkbox" name="admin"> Admin-Rechte</label>
      <button class="btn primary block" style="margin-top:10px">Anlegen</button></form>`;
  $('#saveKey').onclick = guard(async () => {
    const k = $('#key').value.trim(); if (!k) throw new Error('Schlüssel einfügen');
    await api('/admin/settings', { method: 'PUT', body: { apiKey: k, aiEnabled: true } });
    S.ai = (await api('/me')).ai; toast('Gespeichert – KI-Coach aktiviert'); adminPanel();
  });
  $('#aiOn').onchange = guard(async (e) => { const r = await api('/admin/settings', { method: 'PUT', body: { aiEnabled: e.target.checked } }); S.ai = r.ai; toast(r.ai ? 'KI-Coach an' : 'KI-Coach aus'); });
  $('#testKey').onclick = guard(async () => { const b = $('#testKey'); b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try { await api('/admin/test-key', { method: 'POST' }); toast('Verbindung zu Claude funktioniert ✓'); } finally { b.disabled = false; b.textContent = 'Testen'; } });
  el.querySelectorAll('[data-pw]').forEach((b) => (b.onclick = guard(async () => {
    const pw = prompt('Neues Passwort (min. 6 Zeichen)'); if (!pw) return;
    await api('/admin/users/' + b.dataset.pw, { method: 'PUT', body: { password: pw } }); toast('Passwort geändert');
  })));
  el.querySelectorAll('[data-adm]').forEach((b) => (b.onclick = guard(async () => { await api('/admin/users/' + b.dataset.adm, { method: 'PUT', body: { admin: b.dataset.val === '1' } }); adminPanel(); })));
  el.querySelectorAll('[data-delu]').forEach((b) => (b.onclick = guard(async () => {
    if (!confirm('Benutzer und alle seine Trainingsdaten löschen?')) return;
    await api('/admin/users/' + b.dataset.delu, { method: 'DELETE' }); adminPanel();
  })));
  $('#newu').onsubmit = guard(async (e) => { e.preventDefault(); const f = e.target;
    await api('/admin/users', { body: { username: f.username.value, password: f.password.value, admin: f.admin.checked } }); toast('Benutzer angelegt'); adminPanel(); });
}

// ---------- boot ----------
(async () => {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
    navigator.serviceWorker.register('sw.js').catch(() => {});
  await initDb();
  try { await loadAll(); } catch { S.user = null; }
  render();
  if (S.user && S.tab === 'progress') go('progress');
})();
