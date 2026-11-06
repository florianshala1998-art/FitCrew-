// Procedural anatomical body (front/back) as SVG.
// Shape follows body fat + sex; each muscle's size follows its training development;
// sore muscles glow and fade over the typical soreness duration.

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const SKINS = { hell: ['#f3d2bd', '#d9a98c'], mittel: ['#dcae8b', '#b98463'], oliv: ['#c08e64', '#956645'], dunkel: ['#8a5a3c', '#5f3b25'] };

// Catmull-Rom → cubic bezier through points (closed)
function smooth(pts, closed = true) {
  const n = pts.length, P = (i) => pts[(i + n) % n];
  let d = `M${P(0)[0].toFixed(1)},${P(0)[1].toFixed(1)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = closed ? P(i - 1) : pts[Math.max(0, i - 1)], p1 = P(i), p2 = P(i + 1), p3 = closed ? P(i + 2) : pts[Math.min(n - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + (closed ? 'Z' : '');
}
const CX = 120;
const mirror = (pts) => pts.map(([x, y]) => [CX - x, y]).reverse();
const right = (pts) => pts.map(([x, y]) => [CX + x, y]);

function geometry(st) {
  const male = st.sex !== 'w';
  const bf = st.bf ?? (male ? 18 : 26);
  const f = clamp(male ? (bf - 10) / 34 : (bf - 18) / 30);           // 0 lean … 1 very heavy
  const m = st.muscles || {};
  const d = (r) => m[r] ?? 0.15;                                       // muscle development 0..1
  const sh = male ? 0 : -5, hipX = male ? 0 : 7;
  const dd = (d('front_delts') + d('side_delts')) / 2;
  const armOut = 4 + 22 * f * f + 8 * f;
  const g = { f, male, d, dd, armOut };
  g.torso = [
    [7 + 2.5 * f, 60], [9 + 5 * f, 72], [20 + 6 * f + 4 * d('traps') + sh / 2, 80], [33 + 6 * f + 4 * dd + sh, 88],
    [39 + 8 * f + 5 * dd + sh, 101], [35 + 12 * f + 3 * d('lats') + sh, 118], [32 + 16 * f + (male ? 5 : 1) * d('lats'), 140],
    [26 + 26 * f + (male ? 0 : -3), 168], [28 + 36 * f + hipX * 0.4, 194], [31 + 26 * f + hipX, 222], [27 + 20 * f + hipX, 246], [0, 254],
  ];
  // legs (right leg, absolute offsets from centre)
  const q = d('quads'), c = d('calves');
  g.leg = [
    [31 + 26 * f + hipX, 226], [31 + 30 * f + hipX + 3 * q, 262], [27 + 28 * f + hipX * 0.6 + 3 * q, 302], [21 + 17 * f + hipX * 0.2, 346],
    [22 + 16 * f + 4 * c, 384], [16 + 8 * f, 440], [18 + 7 * f, 462], [21 + 7 * f, 474], [6, 474], [7 + 1 * f, 444],
    [5 + 3 * f + 2 * c, 388], [6 + 2 * f, 348], [3 + 1 * f, 300], [1, 256],
  ];
  const b = d('biceps'), t = d('triceps'), fa = d('forearms'), a = armOut;
  g.arm = [
    [34 + 6 * f + sh, 89], [41 + 10 * f + 5 * dd + sh, 101], [42 + 20 * f + 3 * Math.max(b, t) + a * 0.55 + sh, 136], [41 + 15 * f + a + sh, 168],
    [43 + 13 * f + 2 * fa + a + sh, 192], [43 + 7 * f + a + sh, 228], [44 + 5 * f + a + sh, 250], [39 + 4 * f + a + sh, 262],
    [34 + 2 * f + a + sh, 250], [35 + 1 * f + a + sh, 228], [33 + 2 * f + a + sh, 196], [32 + 3 * f + a + sh, 168], [31 + 4 * f + a * 0.55 + sh, 136], [30 + 9 * f + sh, 112],
  ];
  g.at = (pts, y) => { // x on a polyline (first monotone run) at height y
    for (let i = 0; i < pts.length - 1; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]; if ((y - y1) * (y - y2) <= 0 && y1 !== y2) return x1 + ((y - y1) / (y2 - y1)) * (x2 - x1); }
    return pts[0][0];
  };
  g.armMid = (y) => { const half = g.arm.length / 2; const outer = g.at(g.arm.slice(0, half + 1), y), inner = g.at(g.arm.slice(half).reverse(), y); return [(outer + inner) / 2, Math.abs(outer - inner) / 2]; };
  g.legMid = (y) => { const outer = g.at(g.leg.slice(0, 7), y), inner = g.at(g.leg.slice(9).reverse(), y); return [(outer + inner) / 2, Math.abs(outer - inner) / 2]; };
  return g;
}

const E = (cx, cy, rx, ry, rot = 0) => `<ellipse cx="${(CX + cx).toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${rot} ${(CX + cx).toFixed(1)} ${cy.toFixed(1)})"/>`;
const both = (fn) => fn(1) + fn(-1);

function muscleShapes(g, view) {
  const { f, d } = g, S = {};
  const fatSoft = 1 - 0.55 * f;
  if (view === 'front') {
    S.traps = both((s) => `<path d="${smooth(right([[s * 9, 70], [s * (18 + 4 * d('traps')), 79], [s * 12, 82]]), true)}"/>`);
    S.chest = both((s) => { const k = d('chest'), w = 26 + 8 * f + 5 * k, drop = 8 * f * f + (g.male ? 0 : 6);
      return `<path d="${smooth([[CX + s * 2, 94], [CX + s * (w * 0.6), 89], [CX + s * w, 99], [CX + s * (w - 2), 114 + drop * 0.6], [CX + s * (w * 0.55), 124 + drop], [CX + s * 3, 122 + drop * 0.5]])}"/>`; });
    S.front_delts = both((s) => E(s * (36 + 7 * f + 3 * g.dd + (g.male ? 0 : -5)), 101, 6 + 3 * g.dd + 2 * f, 11 + 2 * g.dd, s * -15));
    S.side_delts = both((s) => E(s * (41 + 8 * f + 4 * g.dd + (g.male ? 0 : -5)), 104, 3.5 + 2 * g.dd, 9, s * -10));
    S.biceps = both((s) => { const [x, hw] = g.armMid(140); return E(s * x, 140, hw * (0.6 + 0.3 * d('biceps')), 15 + 2 * d('biceps'), s * -6); });
    S.forearms = both((s) => { const [x, hw] = g.armMid(196); return E(s * x, 196, hw * 0.75, 18, s * -4); });
    S.abs = (() => { const w = 9 + 6 * f, rows = [134, 152, 170, 188]; let out = '';
      rows.forEach((y, i) => { const h = 15 - i, yy = y + 8 * f * (i / 3); out += `<rect x="${CX - w - 1}" y="${yy}" width="${w}" height="${h}" rx="4"/><rect x="${CX + 1}" y="${yy}" width="${w}" height="${h}" rx="4"/>`; });
      return out; })();
    S.obliques = both((s) => `<path d="${smooth(right([[s * (13 + 8 * f), 140], [s * (27 + 16 * f), 146], [s * (25 + 26 * f), 182], [s * (16 + 12 * f), 196]]))}"/>`);
    S.quads = both((s) => { const [x, hw] = g.legMid(296); return E(s * (x + 1), 296, hw * (0.7 + 0.2 * d('quads')), 40, s * 4); });
    S.adductors = both((s) => { const [x, hw] = g.legMid(270); return E(s * (x - hw * 0.55), 272, hw * 0.35, 22, s * -8); });
    S.calves = both((s) => { const [x, hw] = g.legMid(388); return E(s * (x + hw * 0.3), 390, hw * 0.45, 24); });
  } else {
    S.traps = `<path d="${smooth([[CX, 66], [CX + 24 + 5 * d('traps') + 6 * f, 82], [CX + 8, 100], [CX, 140], [CX - 8, 100], [CX - 24 - 5 * d('traps') - 6 * f, 82]])}"/>`;
    S.rear_delts = both((s) => E(s * (37 + 7 * f + 3 * g.dd + (g.male ? 0 : -5)), 102, 7 + 3 * g.dd + 2 * f, 10, s * 15));
    S.lats = both((s) => { const k = d('lats'); return `<path d="${smooth(right([[s * 12, 104], [s * (32 + 10 * f + 6 * k), 112], [s * (31 + 16 * f + 5 * k), 140], [s * (22 + 22 * f), 172], [s * 7, 168]]))}"/>`; });
    S.lower_back = both((s) => E(s * (7 + 2 * f), 182, 5 + 2 * f, 20));
    S.triceps = both((s) => { const [x, hw] = g.armMid(138); return E(s * x, 138, hw * (0.6 + 0.3 * d('triceps')), 17, s * -6); });
    S.forearms = both((s) => { const [x, hw] = g.armMid(196); return E(s * x, 196, hw * 0.75, 18, s * -4); });
    S.glutes = both((s) => { const k = d('glutes'), w = 22 + 18 * f + 5 * k + (g.male ? 0 : 4); return `<path d="${smooth(right([[s * 2, 214], [s * (w * 0.7), 206], [s * w, 224], [s * (w * 0.9), 250 + 4 * f], [s * (w * 0.45), 262 + 5 * f], [s * 3, 256]]))}"/>`; });
    S.hamstrings = both((s) => { const [x, hw] = g.legMid(308); return E(s * x, 308, hw * (0.65 + 0.2 * d('hamstrings')), 36); });
    S.calves = both((s) => { const [x, hw] = g.legMid(384); return E(s * x, 384, hw * (0.75 + 0.2 * d('calves')), 26); });
    S.obliques = both((s) => `<path d="${smooth(right([[s * (24 + 18 * f), 150], [s * (27 + 26 * f), 178], [s * (22 + 22 * f), 200], [s * (16 + 14 * f), 186]]))}"/>`);
  }
  return { S, fatSoft };
}

let uid = 0;
export function renderBody(st, view = 'front', opts = {}) {
  const g = geometry(st), id = 'b' + ++uid;
  const [skin, shade] = SKINS[opts.skin] || SKINS.mittel;
  const { S, fatSoft } = muscleShapes(g, view);
  const sil = smooth(right(g.torso).concat(mirror(g.torso)));
  const legR = smooth(right(g.leg)), legL = smooth(g.leg.map(([x, y]) => [CX - x, y]));
  const armR = smooth(right(g.arm)), armL = smooth(g.arm.map(([x, y]) => [CX - x, y]));
  const headRx = 14.5 + 2.5 * g.f, headCy = 38;
  const sore = opts.noSore ? {} : st.sore || {};
  const muscles = Object.entries(S).map(([r, shape]) => {
    const dev = st.muscles?.[r] ?? 0.15;
    const op = (0.16 + 0.34 * dev) * fatSoft * (r === 'abs' || r === 'obliques' ? (1 - g.f) ** 2 : 1);
    return `<g class="mu" data-r="${r}" fill="url(#${id}m)" opacity="${op.toFixed(2)}" filter="url(#${id}b)">${shape}</g>`;
  }).join('');
  const glow = Object.entries(S).filter(([r]) => sore[r]).map(([r, shape]) =>
    `<g class="sore" data-r="${r}" fill="${sore[r].level > 0.6 ? '#ff3b2f' : '#ff8a2a'}" opacity="${(0.35 + 0.6 * sore[r].level).toFixed(2)}" filter="url(#${id}g)">${shape}</g>`).join('');
  const belly = view === 'front' && g.f > 0.25
    ? `<ellipse cx="${CX}" cy="${196 + 4 * g.f}" rx="${18 + 30 * g.f}" ry="${14 + 18 * g.f}" fill="url(#${id}fat)" opacity="${(g.f - 0.2).toFixed(2)}"/>
       <path d="M${CX - 14 - 26 * g.f},${212 + 10 * g.f} Q${CX},${224 + 16 * g.f} ${CX + 14 + 26 * g.f},${212 + 10 * g.f}" fill="none" stroke="${shade}" stroke-width="1.4" opacity="${g.f}"/>` : '';
  const face = view === 'front'
    ? `<g fill="${shade}" opacity=".55"><ellipse cx="${CX - 5}" cy="${headCy - 2}" rx="1.6" ry="1.2"/><ellipse cx="${CX + 5}" cy="${headCy - 2}" rx="1.6" ry="1.2"/></g>
       <path d="M${CX - 4},${headCy + 9} Q${CX},${headCy + 11} ${CX + 4},${headCy + 9}" stroke="${shade}" stroke-width="1" fill="none" opacity=".6"/>
       <circle cx="${CX}" cy="${200 + 10 * g.f}" r="1.6" fill="${shade}" opacity=".7"/>`
    : `<path d="M${CX},${76} L${CX},${214}" stroke="${shade}" stroke-width="1.2" opacity=".5"/>`;
  const chin = g.f > 0.35 ? `<ellipse cx="${CX}" cy="${headCy + 18}" rx="${9 + 8 * g.f}" ry="${4 + 4 * g.f}" fill="${skin}"/>` : '';
  const hair = `<path d="M${CX - headRx},${headCy - 2} Q${CX - headRx},${headCy - 24} ${CX},${headCy - 22} Q${CX + headRx},${headCy - 24} ${CX + headRx},${headCy - 2} Q${CX + headRx - 3},${headCy - 14} ${CX},${headCy - 15} Q${CX - headRx + 3},${headCy - 14} ${CX - headRx},${headCy - 2}Z" fill="#3a2a20" opacity="${view === 'back' ? 1 : 0.95}"/>`;
  const shorts = `<path d="M${CX - 33 - 27 * g.f},${226} L${CX + 33 + 27 * g.f},${226} L${CX + 34 + 32 * g.f},${262} L${CX + 4},${262} L${CX},${252} L${CX - 4},${262} L${CX - 34 - 32 * g.f},${262}Z" fill="#20252d"/>`;
  const top = !g.male ? `<path d="${smooth([[CX - 30 - 10 * g.f, 96], [CX, 92], [CX + 30 + 10 * g.f, 96], [CX + 30 + 14 * g.f, 124 + 6 * g.f], [CX, 128 + 6 * g.f], [CX - 30 - 14 * g.f, 124 + 6 * g.f]])}" fill="#20252d"/>` : '';
  return `<svg viewBox="0 0 240 484" class="bodysvg" role="img" aria-label="Körper ${view === 'front' ? 'vorne' : 'hinten'}">
  <defs>
    <linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="${shade}"/><stop offset=".35" stop-color="${skin}"/><stop offset=".65" stop-color="${skin}"/><stop offset="1" stop-color="${shade}"/></linearGradient>
    <radialGradient id="${id}m"><stop offset="0" stop-color="#7a2a20"/><stop offset="1" stop-color="#4a1610"/></radialGradient>
    <radialGradient id="${id}fat" cx=".5" cy=".35"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".7" stop-color="${shade}" stop-opacity=".2"/><stop offset="1" stop-color="${shade}" stop-opacity=".55"/></radialGradient>
    <filter id="${id}g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${id}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>
    <filter id="${id}sh"><feDropShadow dx="0" dy="0" stdDeviation="1.2" flood-color="#000" flood-opacity=".5"/></filter>
    <clipPath id="${id}c"><path d="${sil}"/><path d="${legR}"/><path d="${legL}"/><path d="${armR}"/><path d="${armL}"/></clipPath>
  </defs>
  <ellipse cx="${CX}" cy="478" rx="${60 + 30 * g.f}" ry="5" fill="#000" opacity=".35"/>
  <g filter="url(#${id}sh)" fill="url(#${id}s)">
    <path d="${armR}"/><path d="${armL}"/><path d="${legR}"/><path d="${legL}"/><path d="${sil}"/>
    <rect x="${CX - 7 - 2.5 * g.f}" y="50" width="${14 + 5 * g.f}" height="22" fill="${skin}"/>
    <ellipse cx="${CX}" cy="${headCy}" rx="${headRx}" ry="20"/>${chin}
  </g>
  <g clip-path="url(#${id}c)">${muscles}${glow}${belly}</g>
  ${shorts}${top}${hair}${face}
</svg>`;
}
